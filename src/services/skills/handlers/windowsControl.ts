import type { ToolResult } from "../../tools/ToolRegistry";

// Thin IPC bridge — the real work (MCP client, local LLM tool pick,
// MCP tool call) happens in the main-process windowsMcpManager.

type McpApi = {
  windowsMcpIsAvailable?: () => Promise<{ available: boolean }>;
  windowsMcpExecute?: (payload: { intent: string }) => Promise<{
    success: boolean;
    summary: string;
    toolUsed?: string;
    toolArgs?: Record<string, unknown>;
  }>;
};

function getApi(): McpApi | null {
  const api = (window as unknown as { electronAPI?: McpApi }).electronAPI;
  return api || null;
}

export async function execute(args: Record<string, unknown>): Promise<ToolResult> {
  const intent = String(args.intent ?? "").trim();
  if (!intent) {
    return {
      success: false,
      displayText: "没听清要做什么",
      data: { reason: "empty-intent" },
    };
  }

  const api = getApi();
  if (!api?.windowsMcpExecute) {
    return {
      success: false,
      displayText: "Windows 控制功能不可用",
      data: { reason: "no-ipc" },
    };
  }

  const r = await api.windowsMcpExecute({ intent });
  return {
    success: Boolean(r?.success),
    displayText: r?.summary ?? (r?.success ? "已完成" : "没做成"),
    data: {
      toolUsed: r?.toolUsed,
      toolArgs: r?.toolArgs,
    },
  };
}
