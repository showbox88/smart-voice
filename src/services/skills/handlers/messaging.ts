import type { ToolResult } from "../../tools/ToolRegistry";

// Messaging handler. Stubbed: no SMTP / WeChat bot / SMS gateway wired.
// Returns a friendly "未配置" message so the router pins utterances like
// "给张三发微信说我迟到了" to intent=action instead of the model trying to
// write the message itself.

export async function send(args: Record<string, unknown>): Promise<ToolResult> {
  const platform = String(args.platform || "").toLowerCase();
  const recipient = String(args.recipient || "").trim();
  const content = String(args.content || "").trim();

  const label =
    platform === "wechat"
      ? "微信"
      : platform === "email"
        ? "邮件"
        : platform === "sms"
          ? "短信"
          : "消息";

  const target = recipient ? `给「${recipient}」` : "";
  const preview = content ? `：${content.slice(0, 40)}${content.length > 40 ? "…" : ""}` : "";

  return {
    success: false,
    data: { platform, recipient, content, configured: false },
    displayText: `发送${label}${target}${preview} —— 消息发送尚未配置（需要账号/API 接入）`,
  };
}
