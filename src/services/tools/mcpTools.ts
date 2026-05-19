// Bridge: register currently-connected MCP server tools into the chat
// ToolRegistry. Names are prefixed `mcp_<server>__<tool>` so the LLM can
// distinguish providers and we can route calls back to the right server.

import type { ToolRegistry, ToolResult } from "./ToolRegistry";

const PREFIX = "mcp_";
const NAME_SEP = "__";
const NAME_MAX = 64;

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, "_");
}

function toolKey(serverName: string, toolName: string): string {
  const raw = `${PREFIX}${sanitize(serverName)}${NAME_SEP}${sanitize(toolName)}`;
  return raw.length > NAME_MAX ? raw.slice(0, NAME_MAX) : raw;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

const SUMMARY_MAX_CHARS = 200;
const FULL_TEXT_MAX_CHARS = 8000;

function summarizeJson(parsed: unknown): string {
  if (Array.isArray(parsed)) {
    return `Returned ${parsed.length} item${parsed.length === 1 ? "" : "s"}`;
  }
  if (isObject(parsed)) {
    if (Array.isArray(parsed.items) && typeof parsed.count !== "undefined") {
      return `Returned ${parsed.count} item${parsed.count === 1 ? "" : "s"}`;
    }
    if (Array.isArray(parsed.items)) {
      return `Returned ${parsed.items.length} item${parsed.items.length === 1 ? "" : "s"}`;
    }
    if (Array.isArray(parsed.results)) {
      return `Returned ${parsed.results.length} result${parsed.results.length === 1 ? "" : "s"}`;
    }
    if (typeof parsed.count === "number") {
      return `Returned count: ${parsed.count}`;
    }
    const keys = Object.keys(parsed);
    if (keys.length > 0) {
      return `Returned JSON {${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""}}`;
    }
  }
  return "Returned JSON";
}

function shortenText(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= SUMMARY_MAX_CHARS) return oneLine;
  return oneLine.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd() + "…";
}

function renderResult(payload: unknown): {
  success: boolean;
  data: unknown;
  displayText: string;
} {
  if (!isObject(payload)) {
    const text = String(payload ?? "");
    return {
      success: true,
      data: { text },
      displayText: shortenText(text) || "Tool call completed",
    };
  }
  const isError = payload.isError === true;
  const content = Array.isArray(payload.content) ? payload.content : [];
  const textParts: string[] = [];
  for (const part of content) {
    if (isObject(part) && part.type === "text" && typeof part.text === "string") {
      textParts.push(part.text);
    }
  }
  const rawText = textParts.join("\n").trim();

  let summary: string;
  let parsed: unknown = undefined;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
      summary = summarizeJson(parsed);
    } catch {
      summary = shortenText(rawText);
    }
  } else {
    summary = isError ? "Tool call failed" : "Tool call completed";
  }

  // `data` is what the AI sees (serialized into the tool-result message) and
  // also what the UI consumes as `metadata`. Keep it clean: just the parsed
  // structured payload (or raw text fallback). The UI's expanded view will
  // pretty-print `metadata` itself, so we don't need a redundant __fullText.
  let data: unknown;
  if (parsed !== undefined) {
    data = parsed;
  } else if (rawText) {
    const capped =
      rawText.length > FULL_TEXT_MAX_CHARS
        ? rawText.slice(0, FULL_TEXT_MAX_CHARS) +
          `\n\n… (truncated, ${rawText.length - FULL_TEXT_MAX_CHARS} more chars)`
        : rawText;
    data = { text: capped };
  } else {
    data = {};
  }

  return { success: !isError, data, displayText: summary };
}

export async function registerMcpTools(registry: ToolRegistry): Promise<number> {
  if (!window.electronAPI?.mcpAllActiveTools || !window.electronAPI?.mcpCallServerTool) {
    return 0;
  }
  let active: Array<{
    serverName: string;
    tool: { name: string; description?: string; inputSchema?: unknown };
  }> = [];
  try {
    active = await window.electronAPI.mcpAllActiveTools();
  } catch {
    return 0;
  }
  let count = 0;
  for (const { serverName, tool } of active) {
    const name = toolKey(serverName, tool.name);
    registry.register({
      name,
      description: tool.description || `${tool.name} (MCP server: ${serverName})`,
      parameters: (isObject(tool.inputSchema)
        ? tool.inputSchema
        : { type: "object", properties: {} }) as Record<string, unknown>,
      readOnly: false,
      execute: async (args): Promise<ToolResult> => {
        try {
          const res = await window.electronAPI!.mcpCallServerTool!(
            serverName,
            tool.name,
            args || {}
          );
          if (!res?.success) {
            return {
              success: false,
              data: { error: res?.error },
              displayText: res?.error || "MCP tool call failed",
            };
          }
          return renderResult(res.result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, data: { error: msg }, displayText: msg };
        }
      },
    });
    count++;
  }
  return count;
}
