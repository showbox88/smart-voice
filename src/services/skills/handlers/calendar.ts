import type { ToolResult } from "../../tools/ToolRegistry";
import { parseWhenFast } from "../timeResolver";

// Calendar skills talk to Google Calendar via the main process (OAuth tokens live
// there). The renderer only marshals args and formats replies.

type CalendarApi = {
  calendarIsConnected?: () => Promise<{ connected: boolean }>;
  calendarQueryEvents?: (payload: { from: number; to: number }) => Promise<{
    success: boolean;
    events: Array<{
      id: string;
      summary: string | null;
      start_time: string;
      end_time: string;
      is_all_day?: boolean;
    }>;
    error?: string;
  }>;
  calendarCreateEvent?: (payload: {
    summary: string;
    startMs: number;
    endMs: number;
    description?: string;
  }) => Promise<{
    success: boolean;
    event?: {
      id: string;
      summary: string;
      htmlLink?: string;
      start: string;
      end: string;
    };
    error?: string;
  }>;
};

function getApi(): CalendarApi | null {
  const api = (window as unknown as { electronAPI?: CalendarApi }).electronAPI;
  return api || null;
}

function notReady(what: string): ToolResult {
  return {
    success: false,
    data: null,
    displayText: `日历功能未就绪（${what}）`,
  };
}

function formatHHMM(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatDayLabel(d: Date, now: Date): string {
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, now)) return "今天";
  if (sameDay(d, tomorrow)) return "明天";
  const months = d.getMonth() + 1;
  const day = d.getDate();
  return `${months}月${day}日`;
}

// Resolve `range` slot → [from, to] ms epochs.
//   "today" / "今天"   → [00:00, 23:59:59] today
//   "tomorrow" / "明天" → [00:00, 23:59:59] tomorrow
//   "week" / "这周"     → [now, +7d]
//   "next"              → [now, +3d]   (for "下一个/下一场")
// Default: today.
function resolveRange(range: string, now: Date): { from: number; to: number; label: string } {
  const r = (range || "today").toLowerCase();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  if (r === "tomorrow" || range === "明天") {
    const s = new Date(startOfDay);
    s.setDate(s.getDate() + 1);
    const e = new Date(endOfDay);
    e.setDate(e.getDate() + 1);
    return { from: s.getTime(), to: e.getTime(), label: "明天" };
  }
  if (r === "week" || range === "这周" || range === "本周") {
    return { from: now.getTime(), to: now.getTime() + 7 * 86_400_000, label: "这周" };
  }
  if (r === "next" || range === "下一个") {
    return { from: now.getTime(), to: now.getTime() + 3 * 86_400_000, label: "接下来" };
  }
  return { from: now.getTime(), to: endOfDay.getTime(), label: "今天" };
}

export async function query(args: Record<string, unknown>): Promise<ToolResult> {
  const api = getApi();
  if (!api?.calendarIsConnected || !api?.calendarQueryEvents) {
    return notReady("IPC 未注册");
  }
  const connected = await api.calendarIsConnected();
  if (!connected.connected) {
    return {
      success: false,
      data: null,
      displayText: "还没连接 Google 日历，请先在 Integrations 里登录。",
    };
  }

  const now = new Date();
  const range = String(args.range || "today");
  const { from, to, label } = resolveRange(range, now);
  const r = await api.calendarQueryEvents({ from, to });
  if (!r.success) {
    return { success: false, data: null, displayText: `查询日历失败：${r.error || "unknown"}` };
  }

  const events = r.events || [];
  if (events.length === 0) {
    return {
      success: true,
      data: { events: [] },
      displayText: `${label}没有安排。`,
    };
  }

  // "next" intent: only echo the first upcoming event.
  const isNextIntent = range === "next" || range === "下一个";
  const chosen = isNextIntent ? events.slice(0, 1) : events.slice(0, 5);

  const lines = chosen.map((e) => {
    const d = new Date(e.start_time);
    const dayLabel = formatDayLabel(d, now);
    const time = e.is_all_day ? "全天" : formatHHMM(e.start_time);
    const title = e.summary || "(无标题)";
    return `${dayLabel} ${time} ${title}`;
  });

  const header = isNextIntent
    ? `下一个安排：${lines[0]}`
    : `${label}有 ${events.length} 项安排：\n${lines.join("\n")}`;

  return {
    success: true,
    data: { count: events.length, events: chosen },
    displayText: header,
  };
}

// Create a new calendar event. Defaults to 1-hour duration if end not specified.
export async function create(args: Record<string, unknown>): Promise<ToolResult> {
  const api = getApi();
  if (!api?.calendarIsConnected || !api?.calendarCreateEvent) {
    return notReady("IPC 未注册");
  }
  const connected = await api.calendarIsConnected();
  if (!connected.connected) {
    return {
      success: false,
      data: null,
      displayText: "还没连接 Google 日历，请先在 Integrations 里登录。",
    };
  }

  const summary = String(args.summary || "").trim();
  const when = String(args.when || "").trim();
  const durationMin = Number(args.duration_min) > 0 ? Number(args.duration_min) : 60;

  if (!summary) return { success: false, data: null, displayText: "缺少日程标题" };
  if (!when) return { success: false, data: null, displayText: "缺少开始时间" };

  const parsed = parseWhenFast(when);
  if (!parsed?.fireAt) {
    return {
      success: false,
      data: null,
      displayText: `无法解析时间「${when}」。支持：下午3点 / 明天10点 / 15:30`,
    };
  }

  const startMs = parsed.fireAt;
  const endMs = startMs + durationMin * 60_000;

  const r = await api.calendarCreateEvent({ summary, startMs, endMs });
  if (!r.success || !r.event) {
    return {
      success: false,
      data: null,
      displayText: `创建日程失败：${r.error || "unknown"}`,
    };
  }

  const d = new Date(startMs);
  const dayLabel = formatDayLabel(d, new Date());
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return {
    success: true,
    data: r.event,
    displayText: `好的，已在日历添加：${dayLabel} ${time} ${summary}`,
  };
}
