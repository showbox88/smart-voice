// Phase B skill router — takes the classification from routerDryRun.ts and
// turns it into a dispatchable decision (action/chat/unclear) plus optional
// skill handler execution.
//
// Flag: `localStorage.skillRouterDispatch` — "1" enables the dispatch path.
// Default is OFF so existing dry-run behaviour keeps working until the
// operator flips the switch. Dry-run takes priority when both flags are on.

import type { LoadedSkill } from "./skillLoader";
import type { ToolResult } from "../tools/ToolRegistry";
import { runRouterDryRun, type RouterResult } from "./routerDryRun";
import { resolveTime, type ResolvedTime } from "./timeResolver";

// Re-export for convenience — downstream ts files only import from router.ts.
export type { ToolResult };

export type RouterIntent = "chat" | "action" | "unclear";

// One (动作, 内容, 时间) triple as produced by the router.
export interface RouterAction {
  skill: string;
  slots: Record<string, unknown>;
  when: string;                 // raw natural-language phrase, or "now"
}

// Parsed/validated router output. If parsing failed or the intent is missing
// from the JSON, we surface `intent: "unclear"` so the caller can fall back
// to either a clarifying question or the regular LLM path.
export interface RouterDecision {
  intent: RouterIntent;
  // chat
  reply?: string;
  // action — new schema: array of (skill, slots, when) triples. Single-
  // action utterances use a one-element array.
  actions?: RouterAction[];
  // Legacy single-action fields kept for backward compatibility with older
  // prompt versions / parse fallbacks; classify() collapses them into
  // `actions` so downstream dispatch only needs to iterate.
  skill?: string;
  category?: string;
  slots?: Record<string, unknown>;
  confidence?: number;
  // unclear
  ask?: string;
  // always
  latencyMs: number;
  raw: RouterResult;
}

// Per-action dispatch outcome. `mode` distinguishes:
//   - "executed"  : skill ran immediately (when=now or already past)
//   - "scheduled" : persisted to scheduled_actions with fireAt in the future
//   - "failed"    : skill lookup failed, time parse failed, or handler threw
export interface ActionOutcome {
  skill: string;
  slots: Record<string, unknown>;
  when: string;
  mode: "executed" | "scheduled" | "failed";
  result?: ToolResult;              // present on executed
  responseMode?: LoadedSkill["responseMode"];
  scheduledId?: number;             // present on scheduled
  fireAt?: number;                  // present on scheduled
  resolved?: ResolvedTime;          // time resolver output
  error?: string;                   // present on failed
  latencyMs: number;
}

// Rolled-up outcome from iterating over every action in a decision.
export interface DispatchOutcome {
  dispatched: boolean;
  outcomes: ActionOutcome[];
  groupId?: string;                 // shared tag when multiple scheduled actions came from one utterance
  latencyMs: number;
  // Legacy top-level fields kept so existing call-sites continue to compile.
  skill?: string;
  result?: ToolResult;
  responseMode?: LoadedSkill["responseMode"];
  error?: string;
}

export function isDispatchEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const v = window.localStorage?.getItem("skillRouterDispatch");
  return v === "1" || v === "true";
}

// Classify the utterance and coerce the model's JSON into a typed decision.
// Reuses runRouterDryRun so the prompt + parser stay shared between dry-run
// UI and real dispatch — no drift.
//
// Schema normalization: accepts the new `actions: [...]` format AND the
// legacy flat `{skill, slots}` single-action format. Both collapse into
// `decision.actions` so callers only deal with one shape.
export async function classify(
  userText: string,
  skills: LoadedSkill[]
): Promise<RouterDecision> {
  const r = await runRouterDryRun(userText, skills);
  const j = (r.json ?? {}) as Record<string, unknown>;
  const intent = (j.intent === "chat" || j.intent === "action" || j.intent === "unclear")
    ? (j.intent as RouterIntent)
    : "unclear";

  // Normalize actions — accept both shapes.
  let actions: RouterAction[] | undefined;
  if (Array.isArray(j.actions)) {
    actions = (j.actions as unknown[])
      .map((entry): RouterAction | null => {
        if (!entry || typeof entry !== "object") return null;
        const e = entry as Record<string, unknown>;
        const skill = typeof e.skill === "string" ? e.skill : "";
        if (!skill) return null;
        const slots =
          e.slots && typeof e.slots === "object" ? (e.slots as Record<string, unknown>) : {};
        const when = typeof e.when === "string" && e.when.trim() ? e.when.trim() : "now";
        return { skill, slots, when };
      })
      .filter((a): a is RouterAction => a !== null);
    if (actions.length === 0) actions = undefined;
  } else if (typeof j.skill === "string") {
    // Legacy single-action — wrap into a one-element array with "now" timing.
    actions = [
      {
        skill: j.skill,
        slots:
          j.slots && typeof j.slots === "object" ? (j.slots as Record<string, unknown>) : {},
        when:
          typeof j.when === "string" && j.when.trim() ? (j.when as string).trim() : "now",
      },
    ];
  }

  return {
    intent,
    reply: typeof j.reply === "string" ? j.reply : undefined,
    actions,
    skill: typeof j.skill === "string" ? j.skill : undefined,
    category: typeof j.category === "string" ? j.category : undefined,
    slots: (j.slots && typeof j.slots === "object") ? (j.slots as Record<string, unknown>) : undefined,
    confidence: typeof j.confidence === "number" ? j.confidence : undefined,
    ask: typeof j.ask === "string" ? j.ask : undefined,
    latencyMs: r.latencyMs,
    raw: r,
  };
}

// Immediate actions whose resolved fireAt is within this many ms of now are
// executed right away rather than persisted through the scheduler. Keeps
// "现在开灯" on the fast path even when the regex returns now.getTime().
const IMMEDIATE_WINDOW_MS = 2000;

// Iterate over decision.actions — for each triple (skill, slots, when):
//   1. Resolve when → fireAt via timeResolver (regex, then optional LLM).
//   2. If fireAt is within the immediate window, execute the skill now.
//   3. Otherwise persist to scheduled_actions and return the scheduled id.
// Multiple actions share a single group_id so a follow-up "取消" can cancel
// the whole batch.
export async function dispatchAction(
  decision: RouterDecision,
  skills: LoadedSkill[]
): Promise<DispatchOutcome> {
  if (decision.intent !== "action" || !decision.actions || decision.actions.length === 0) {
    return { dispatched: false, outcomes: [], latencyMs: 0 };
  }

  const t0 = performance.now();
  const outcomes: ActionOutcome[] = [];
  const groupId =
    decision.actions.length > 1
      ? (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `grp-${Date.now()}`)
      : undefined;

  for (const a of decision.actions) {
    const actionT0 = performance.now();
    const skill = skills.find((s) => s.name === a.skill);
    if (!skill) {
      outcomes.push({
        skill: a.skill,
        slots: a.slots,
        when: a.when,
        mode: "failed",
        error: `unknown skill: ${a.skill}`,
        latencyMs: Math.round(performance.now() - actionT0),
      });
      continue;
    }

    // Fast path: when="now" is always immediate — skip time resolution.
    const isNowLiteral = /^(now|immediately|马上|立刻|现在|立即)$/i.test(a.when.trim());
    let resolved: ResolvedTime | null = null;
    if (!isNowLiteral) {
      resolved = await resolveTime(a.when);
      if (!resolved) {
        outcomes.push({
          skill: a.skill,
          slots: a.slots,
          when: a.when,
          mode: "failed",
          error: `unparseable when: ${a.when}`,
          latencyMs: Math.round(performance.now() - actionT0),
        });
        continue;
      }
    }

    const now = Date.now();
    const fireAt = resolved ? resolved.fireAt : now;
    const isImmediate = isNowLiteral || fireAt - now <= IMMEDIATE_WINDOW_MS;

    if (isImmediate) {
      try {
        const result = await skill.tool.execute(a.slots);
        outcomes.push({
          skill: a.skill,
          slots: a.slots,
          when: a.when,
          mode: "executed",
          result,
          responseMode: skill.responseMode,
          resolved: resolved || undefined,
          latencyMs: Math.round(performance.now() - actionT0),
        });
      } catch (err) {
        outcomes.push({
          skill: a.skill,
          slots: a.slots,
          when: a.when,
          mode: "failed",
          error: (err as Error).message,
          latencyMs: Math.round(performance.now() - actionT0),
        });
      }
      continue;
    }

    // Scheduled — persist via IPC.
    const api = (typeof window !== "undefined"
      ? (window as unknown as {
          electronAPI?: {
            scheduledActionCreate?: (payload: {
              skill: string;
              slots: Record<string, unknown>;
              whenType: string;
              whenExpr: string;
              fireAt: number;
              groupId?: string | null;
            }) => Promise<{ success: boolean; id?: number; error?: string }>;
          };
        }).electronAPI
      : undefined);
    if (!api?.scheduledActionCreate) {
      outcomes.push({
        skill: a.skill,
        slots: a.slots,
        when: a.when,
        mode: "failed",
        error: "scheduled-action IPC unavailable",
        latencyMs: Math.round(performance.now() - actionT0),
      });
      continue;
    }
    try {
      const r = await api.scheduledActionCreate({
        skill: a.skill,
        slots: a.slots,
        whenType: resolved?.whenType || "absolute",
        whenExpr: a.when,
        fireAt,
        groupId: groupId ?? null,
      });
      if (r?.success && typeof r.id === "number") {
        outcomes.push({
          skill: a.skill,
          slots: a.slots,
          when: a.when,
          mode: "scheduled",
          scheduledId: r.id,
          fireAt,
          resolved: resolved || undefined,
          responseMode: skill.responseMode,
          latencyMs: Math.round(performance.now() - actionT0),
        });
      } else {
        outcomes.push({
          skill: a.skill,
          slots: a.slots,
          when: a.when,
          mode: "failed",
          error: r?.error || "schedule_failed",
          latencyMs: Math.round(performance.now() - actionT0),
        });
      }
    } catch (err) {
      outcomes.push({
        skill: a.skill,
        slots: a.slots,
        when: a.when,
        mode: "failed",
        error: (err as Error).message,
        latencyMs: Math.round(performance.now() - actionT0),
      });
    }
  }

  const latencyMs = Math.round(performance.now() - t0);
  const anyDispatched = outcomes.some((o) => o.mode !== "failed");
  // Legacy top-level fields — fill from first outcome so existing renderers
  // that haven't been updated yet keep working.
  const first = outcomes[0];
  return {
    dispatched: anyDispatched,
    outcomes,
    groupId,
    latencyMs,
    skill: first?.skill,
    result: first?.result,
    responseMode: first?.responseMode,
    error: anyDispatched ? undefined : first?.error,
  };
}

// Turn (skill, slots) into a short Chinese verb phrase — "开灯", "放音乐",
// "空调 26°C" — so scheduled-action confirmations read like natural speech
// instead of exposing the skill id. Falls back to the skill id when we don't
// recognize the shape.
export function humanizeAction(skill: string, slots: Record<string, unknown>): string {
  const s = slots || {};
  const str = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : "");
  const num = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : NaN);

  switch (skill) {
    case "smart_device": {
      const action = str("action");
      const device = str("device") || "设备";
      if (action === "on") return `开${device}`;
      if (action === "off") return `关${device}`;
      if (action === "toggle") return `切换${device}`;
      if (action === "list") return `列出${device}`;
      return `${action || "操作"}${device}`;
    }
    case "light_dim": {
      const level = num("level");
      return Number.isFinite(level) ? `调灯光至 ${level}%` : "调节灯光";
    }
    case "aircon": {
      const action = str("action");
      const value = s.value;
      if (action === "on") return "开空调";
      if (action === "off") return "关空调";
      if (action === "set_temp") return `空调调至 ${value ?? "?"}°C`;
      if (action === "mode") return `空调切到 ${value ?? ""}`.trim();
      return "空调";
    }
    case "play_music": {
      const q = str("query").trim();
      return q ? `播放「${q}」` : "播放音乐";
    }
    case "music_control": {
      const action = str("action");
      const map: Record<string, string> = {
        pause: "暂停/继续",
        next: "下一首",
        previous: "上一首",
        stop: "停止播放",
        volume: `音量 ${num("value") || ""}`.trim(),
        repeat: "循环播放",
        shuffle: "随机播放",
      };
      return map[action] || `音乐 ${action}`;
    }
    case "reminder": {
      const msg = str("message");
      return msg ? `提醒：${msg}` : "提醒";
    }
    case "app_launcher": {
      const name = str("app_name");
      return name ? `打开 ${name}` : "打开应用";
    }
    case "info_query": {
      const type = str("type");
      const map: Record<string, string> = {
        time: "时间",
        date: "日期",
        weekday: "星期",
      };
      return type ? `查询${map[type] || type}` : "查询";
    }
    case "messaging": {
      const platform = str("platform");
      const recipient = str("recipient");
      const platformCN =
        platform === "wechat" ? "微信" : platform === "email" ? "邮件" : platform === "sms" ? "短信" : platform;
      return recipient ? `${platformCN}发给 ${recipient}` : `发${platformCN}`;
    }
    default:
      return skill;
  }
}

// Render one ActionOutcome into a single assistant-facing line.
function renderOneOutcome(o: ActionOutcome): string {
  if (o.mode === "failed") {
    return `❌ ${o.error || "dispatch failed"}`;
  }
  if (o.mode === "scheduled") {
    const d = new Date(o.fireAt || Date.now());
    const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `好的，${hhmm} 执行：${humanizeAction(o.skill, o.slots)}`;
  }
  // executed
  const r = o.result;
  if (!r) return "(no result)";
  const displayText = r.displayText || (typeof r.data === "string" ? r.data : "");
  const mode = o.responseMode;
  if (mode === "passthrough") return displayText;
  if (typeof mode === "object" && typeof mode.template === "string") {
    const data = (r.data && typeof r.data === "object") ? (r.data as Record<string, unknown>) : {};
    return mode.template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
      if (key === "displayText") return String(displayText);
      const path = key.split(".");
      let cur: unknown = data;
      for (const p of path) {
        if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[p];
        } else {
          return "";
        }
      }
      return cur == null ? "" : typeof cur === "string" ? cur : String(cur);
    });
  }
  return displayText;
}

// Render the dispatch outcome — stacks per-action lines when the utterance
// produced multiple actions (e.g. "3点开灯，5点放音乐").
export function renderDispatchMessage(
  _decision: RouterDecision,
  outcome: DispatchOutcome
): string {
  if (!outcome.outcomes || outcome.outcomes.length === 0) {
    return `❌ ${outcome.error || "dispatch failed"}`;
  }
  if (outcome.outcomes.length === 1) {
    return renderOneOutcome(outcome.outcomes[0]);
  }
  return outcome.outcomes.map((o) => `· ${renderOneOutcome(o)}`).join("\n");
}

export function renderUnclearMessage(decision: RouterDecision): string {
  return decision.ask || "能再说具体一点吗？";
}
