import type { ToolResult } from "../../tools/ToolRegistry";

// Deterministic clock/calendar lookup. Weather / stocks / news deliberately
// route to chat instead so the main LLM can answer with full context (web
// search or a graceful "not wired yet"). See skills/info/query.md for scope.

function formatChineseDate(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${y} 年 ${m} 月 ${day} 日 星期${weekdays[d.getDay()]}`;
}

function formatClockTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export async function query(args: Record<string, unknown>): Promise<ToolResult> {
  const type = String(args.type || "").toLowerCase();
  const now = new Date();

  if (type === "time") {
    return {
      success: true,
      data: { type, iso: now.toISOString() },
      displayText: `现在 ${formatClockTime(now)}`,
    };
  }
  if (type === "date") {
    return {
      success: true,
      data: { type, iso: now.toISOString() },
      displayText: `今天是 ${formatChineseDate(now)}`,
    };
  }
  if (type === "weekday") {
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    return {
      success: true,
      data: { type, weekday: now.getDay() },
      displayText: `今天星期${weekdays[now.getDay()]}`,
    };
  }
  return {
    success: false,
    data: null,
    displayText: `未知查询类型「${type}」（info_query 只支持 time/date/weekday）`,
  };
}
