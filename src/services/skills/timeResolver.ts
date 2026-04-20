// Time resolver for scheduled actions. Two-tier strategy:
//   1. Regex fast path (parseWhenFast) — covers ~90% of utterances. Sync,
//      deterministic, sub-millisecond.
//   2. LLM fallback (resolveTime, llmFallback=true) — for expressions the
//      regex doesn't understand: "下周三下午", "月底", "周五晚上八点".
//
// Keep the fast path the main road — LLM only on miss. This matches the
// design we agreed on ("Plan C"): deterministic first, slow/fuzzy second.

export type WhenType = "immediate" | "absolute" | "relative" | "recurring";

export interface ResolvedTime {
  fireAt: number;
  whenType: WhenType;
  whenExpr: string;
  source: "immediate" | "regex" | "llm";
}

// Chinese numeral → Arabic, 0–99. Returns null if unrecognized.
const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const CN_NUM_CHARS = "零〇一二两三四五六七八九十";

function cnToNum(s: string): number | null {
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === "十") return 10;
  let m = s.match(/^十([零〇一二三四五六七八九])$/);
  if (m) return 10 + CN_DIGIT[m[1]];
  m = s.match(/^([一二两三四五六七八九])十$/);
  if (m) return CN_DIGIT[m[1]] * 10;
  m = s.match(/^([一二两三四五六七八九])十([零〇一二三四五六七八九])$/);
  if (m) return CN_DIGIT[m[1]] * 10 + CN_DIGIT[m[2]];
  if (s.length === 1 && s in CN_DIGIT) return CN_DIGIT[s];
  return null;
}

// Sync regex parse. Returns { fireAt, whenType } or null if unparsable.
// whenType distinguishes relative vs absolute for storage/display — the
// scheduler itself only needs fire_at.
export function parseWhenFast(
  expr: string,
  now: Date = new Date()
): { fireAt: number; whenType: Exclude<WhenType, "immediate" | "recurring"> } | null {
  const s = expr.trim();
  if (!s) return null;

  // Relative: "N分钟后" / "N小时后" / "N秒后"
  const relRe = new RegExp(
    `([\\d${CN_NUM_CHARS}]+)\\s*(秒|分钟|分|小时|时|天|s|sec|min|minute|hour|hr|day)s?\\s*(后|later)?`,
    "i"
  );
  const rel = s.match(relRe);
  if (rel) {
    const n = cnToNum(rel[1]);
    if (n !== null) {
      const unit = rel[2].toLowerCase();
      let ms = 0;
      if (unit === "秒" || unit.startsWith("s")) ms = n * 1000;
      else if (unit === "分钟" || unit === "分" || unit.startsWith("min")) ms = n * 60_000;
      else if (unit === "小时" || unit === "时" || unit.startsWith("h")) ms = n * 3600_000;
      else if (unit === "天" || unit.startsWith("d")) ms = n * 86_400_000;
      if (ms > 0) return { fireAt: now.getTime() + ms, whenType: "relative" };
    }
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
      return { fireAt: d.getTime(), whenType: "absolute" };
    }
  }

  // Chinese "X点" / "下午X点" / "X点半"
  const cnRe = new RegExp(
    `(早上|上午|中午|下午|晚上)?([\\d${CN_NUM_CHARS}]+)\\s*点\\s*(半|([\\d${CN_NUM_CHARS}]+)\\s*分)?`
  );
  const cn = s.match(cnRe);
  if (cn) {
    const hParsed = cnToNum(cn[2]);
    if (hParsed !== null) {
      let h = hParsed;
      const period = cn[1];
      const half = cn[3] === "半";
      const minStr = cn[4];
      const mParsed = half ? 30 : minStr ? cnToNum(minStr) : 0;
      if (mParsed === null) return null;
      const m = mParsed;

      if (period === "下午" || period === "晚上") {
        if (h < 12) h += 12;
      } else if (period === "中午") {
        h = 12;
      } else if (period === "上午" || period === "早上") {
        if (h === 12) h = 0;
      }

      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        const d = new Date(now);
        if (/明天|明早|明晚/.test(s)) d.setDate(d.getDate() + 1);
        if (/后天/.test(s)) d.setDate(d.getDate() + 2);
        d.setHours(h, m, 0, 0);
        if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
        return { fireAt: d.getTime(), whenType: "absolute" };
      }
    }
  }

  // "immediate" sentinels — caller may want to recognize these too
  if (/^(马上|立刻|现在|立即|now|immediately)$/i.test(s)) {
    return { fireAt: now.getTime(), whenType: "absolute" };
  }

  return null;
}

// Strip the leading time phrase from a user utterance so what remains is the
// substantive request. Used by the delayed-chat (__chat__) path: at fire time
// the LLM should see "帮我查一下北京的天气", not "一分钟以后,帮我查一下北京
// 的天气" — otherwise the time word distracts it or leaks into the answer.
//
// We match the same set of patterns as parseWhenFast so callers don't need to
// know two sets of regexes.
export function stripTimePhrase(expr: string): string {
  let s = expr.trim();
  if (!s) return s;

  const relPattern = new RegExp(
    `[\\d${CN_NUM_CHARS}]+\\s*(?:秒|分钟|分|小时|时|天|s|sec|min|minute|hour|hr|day)s?\\s*(?:以?后|later)?`,
    "i"
  );
  const cnClockPattern = new RegExp(
    `(?:明早|明晚|明天|后天|今晚|今早|今天)?\\s*(?:早上|上午|中午|下午|晚上)?[\\d${CN_NUM_CHARS}]+\\s*点\\s*(?:半|[\\d${CN_NUM_CHARS}]+\\s*分)?`
  );
  const absPattern = /\d{1,2}[:：]\d{2}/;

  for (const re of [relPattern, cnClockPattern, absPattern]) {
    const m = s.match(re);
    if (m) {
      const before = s.slice(0, m.index);
      const after = s.slice((m.index ?? 0) + m[0].length);
      s = (before + after).trim();
      break;
    }
  }

  // Tidy leading/trailing punctuation left over after removing the time phrase.
  s = s.replace(/^[,，。、:：;；\s]+/, "").replace(/[,，。、:：;；\s]+$/, "");
  return s;
}

// Strip leading first-person/polite prefixes so the assistant can echo the
// user's utterance without sounding grammatically inverted. "帮我查天气" from
// the user's lips becomes awkward if the assistant parrots it back verbatim
// ("我会去查：帮我查天气") — drop the "帮我" entirely. Iterates so stacked
// prefixes ("请你帮我...") collapse in one call.
export function stripPolitePrefix(expr: string): string {
  let s = expr.trim();
  const re = /^(?:请|麻烦|帮忙|帮我|帮你|给我|替我|你|我)[,，。、:：;；\s]*/;
  for (let i = 0; i < 6 && re.test(s); i++) {
    s = s.replace(re, "").trim();
  }
  return s;
}

// Composite stripper for echoing the user's request back — both the
// scheduling confirmation ("好的，19:26 我会去查：...") and the fire-time
// user message. Time phrase first (it's usually at the start), then polite
// prefix, then final punctuation tidy.
export function stripForEcho(expr: string): string {
  let s = stripTimePhrase(expr);
  s = stripPolitePrefix(s);
  s = s.replace(/^[,，。、:：;；\s]+/, "").replace(/[,，。、:：;；\s]+$/, "");
  return s;
}

// LLM fallback — caller passes a callable that takes a prompt and returns
// JSON { fireAt: number } | { error: string }. We don't bind to a specific
// AI provider here so this module stays renderer-reusable.
type LlmCallable = (prompt: string) => Promise<string>;

async function llmResolve(
  expr: string,
  now: Date,
  llm: LlmCallable
): Promise<{ fireAt: number; whenType: WhenType } | null> {
  const isoNow = now.toISOString();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const prompt = `你是时间解析器。把中文/英文时间短语转成 ISO 8601 时间戳。

当前时间: ${isoNow}
用户时区: ${tz}
要解析的时间表达式: "${expr}"

只返回一行 JSON，不要别的文字：
{"iso":"2026-04-20T15:30:00+08:00","recurring":false}

- iso: 用用户时区的 ISO 8601 时间，必须是未来时间
- recurring: true 表示周期性（"每天"/"每周X"），false 表示一次性
- 无法解析时返回: {"error":"unparseable"}`;

  let raw: string;
  try {
    raw = await llm(prompt);
  } catch {
    return null;
  }
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (obj.error) return null;
    if (typeof obj.iso !== "string") return null;
    const t = Date.parse(obj.iso);
    if (!Number.isFinite(t)) return null;
    return {
      fireAt: t,
      whenType: obj.recurring ? "recurring" : "absolute",
    };
  } catch {
    return null;
  }
}

export interface ResolveOptions {
  now?: Date;
  llm?: LlmCallable | null;
}

// Main entry point. Tries regex fast path; falls back to LLM if allowed.
// Returns null only when both paths fail — caller should surface an error.
export async function resolveTime(
  expr: string,
  opts: ResolveOptions = {}
): Promise<ResolvedTime | null> {
  const now = opts.now ?? new Date();
  const trimmed = expr.trim();
  if (!trimmed) return null;

  // Shortcut: empty/immediate markers fire now.
  if (/^(马上|立刻|现在|立即|now|immediately)$/i.test(trimmed)) {
    return { fireAt: now.getTime(), whenType: "immediate", whenExpr: trimmed, source: "immediate" };
  }

  const fast = parseWhenFast(trimmed, now);
  if (fast) {
    return { fireAt: fast.fireAt, whenType: fast.whenType, whenExpr: trimmed, source: "regex" };
  }

  if (opts.llm) {
    const llm = await llmResolve(trimmed, now, opts.llm);
    if (llm) {
      return { fireAt: llm.fireAt, whenType: llm.whenType, whenExpr: trimmed, source: "llm" };
    }
  }

  return null;
}
