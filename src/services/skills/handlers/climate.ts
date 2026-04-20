import type { ToolResult } from "../../tools/ToolRegistry";

// Air-conditioning handler. Stubbed: no IR blaster or vendor API wired yet.
// The handler returns a consistent "未配置" message so the router still
// classifies these utterances as actions (good training signal) instead of
// the model improvising an apology in chat mode.

export async function aircon(args: Record<string, unknown>): Promise<ToolResult> {
  const action = String(args.action || "").toLowerCase();
  const value = args.value;

  let intent = "空调";
  if (action === "on") intent = "开空调";
  else if (action === "off") intent = "关空调";
  else if (action === "set_temp" && typeof value === "number") intent = `空调调到 ${value}°C`;
  else if (action === "mode" && typeof value === "string") intent = `空调切换到${value}模式`;

  return {
    success: false,
    data: { action, value, configured: false },
    displayText: `${intent} —— 空调控制尚未配置（需要 IR 发射器或品牌 API）`,
  };
}
