import type { ToolResult } from "../../tools/ToolRegistry";

// Launch a desktop app by name. The main process owns the actual spawn via
// the `app:launch` IPC channel — see src/helpers/ipcHandlers.js. This
// renderer-side handler is a thin marshaler.
export async function launchApp(args: Record<string, unknown>): Promise<ToolResult> {
  const appName = String(args.app_name || "").trim();
  if (!appName) {
    return {
      success: false,
      data: null,
      displayText: "缺少应用名称",
    };
  }
  const api = window.electronAPI as unknown as {
    appLaunch?: (name: string) => Promise<{ success: boolean; error?: string }>;
  };
  if (!api?.appLaunch) {
    return {
      success: false,
      data: null,
      displayText: "应用启动功能未就绪（IPC 未注册）",
    };
  }
  try {
    const r = await api.appLaunch(appName);
    if (r?.success) {
      return {
        success: true,
        data: { app: appName },
        displayText: `已启动「${appName}」`,
      };
    }
    const reason = r?.error || "启动失败";
    return {
      success: false,
      data: null,
      displayText: `启动「${appName}」失败：${reason}`,
    };
  } catch (err) {
    return {
      success: false,
      data: null,
      displayText: `启动「${appName}」出错：${(err as Error).message}`,
    };
  }
}

// Parse relative/absolute Chinese-or-English time expressions into an absolute
// epoch ms. Returns null if we can't figure it out — caller should then say
// so instead of guessing.
//
// Supported:
//   - "10分钟后" / "10 minutes later" / "30秒后" / "2小时后"
//   - "15:30" / "下午3点" / "3点" / "7点半"
//   - "明天早上8点" / "tomorrow 9am"  (basic)
function parseWhen(when: string, now: Date = new Date()): number | null {
  const s = when.trim();
  if (!s) return null;

  // Relative: "N分钟后" / "N小时后" / "N秒后"
  const rel = s.match(/(\d+)\s*(秒|分钟|分|小时|时|天|s|sec|min|minute|hour|hr|day)s?\s*(后|later)?/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    let ms = 0;
    if (unit === "秒" || unit.startsWith("s")) ms = n * 1000;
    else if (unit === "分钟" || unit === "分" || unit.startsWith("min")) ms = n * 60_000;
    else if (unit === "小时" || unit === "时" || unit.startsWith("h")) ms = n * 3600_000;
    else if (unit === "天" || unit.startsWith("d")) ms = n * 86_400_000;
    if (ms > 0) return now.getTime() + ms;
  }

  // Absolute HH:MM (24h)
  const hm = s.match(/(\d{1,2})[:：](\d{2})/);
  if (hm) {
    const h = parseInt(hm[1], 10);
    const m = parseInt(hm[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      const d = new Date(now);
      d.setHours(h, m, 0, 0);
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
  }

  // Chinese "X点" / "下午X点" / "早上X点" / "X点半"
  const cn = s.match(/(早上|上午|中午|下午|晚上)?(\d{1,2})\s*点\s*(半|(\d{1,2})\s*分)?/);
  if (cn) {
    let h = parseInt(cn[2], 10);
    const period = cn[1];
    const half = cn[3] === "半";
    const minStr = cn[4];
    const m = half ? 30 : minStr ? parseInt(minStr, 10) : 0;

    if (period === "下午" || period === "晚上") {
      if (h < 12) h += 12;
    } else if (period === "中午") {
      h = 12;
    } else if (period === "上午" || period === "早上") {
      if (h === 12) h = 0;
    }

    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      const d = new Date(now);
      // 明天 prefix
      if (/明天|明早|明晚/.test(s)) d.setDate(d.getDate() + 1);
      d.setHours(h, m, 0, 0);
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
  }

  return null;
}

export async function createReminder(args: Record<string, unknown>): Promise<ToolResult> {
  const message = String(args.message || "").trim();
  const when = String(args.when || "").trim();
  if (!message) return { success: false, data: null, displayText: "缺少提醒内容" };
  if (!when) return { success: false, data: null, displayText: "缺少提醒时间" };

  const fireAt = parseWhen(when);
  if (!fireAt) {
    return {
      success: false,
      data: null,
      displayText: `无法解析时间「${when}」。支持：15:30 / 下午 3 点 / 10 分钟后`,
    };
  }

  const api = window.electronAPI as unknown as {
    reminderCreate?: (payload: {
      message: string;
      fireAt: number;
    }) => Promise<{ success: boolean; error?: string; id?: number }>;
  };
  if (!api?.reminderCreate) {
    return {
      success: false,
      data: null,
      displayText: "提醒功能未就绪（IPC 未注册）",
    };
  }

  try {
    const r = await api.reminderCreate({ message, fireAt });
    if (r?.success) {
      const d = new Date(fireAt);
      const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      return {
        success: true,
        data: { id: r.id, fireAt, message },
        displayText: `好的，${hhmm} 提醒你：${message}`,
      };
    }
    return {
      success: false,
      data: null,
      displayText: `创建提醒失败：${r?.error || "unknown"}`,
    };
  } catch (err) {
    return {
      success: false,
      data: null,
      displayText: `创建提醒出错：${(err as Error).message}`,
    };
  }
}
