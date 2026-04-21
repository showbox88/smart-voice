import type { ToolDefinition, ToolResult } from "../tools/ToolRegistry";
import { getHandler } from "./handlers";

export type ResponseMode =
  | "passthrough"
  | "commentary"
  | { template: string };

export interface LoadedSkill {
  name: string;
  category: string;
  description: string;
  responseMode: ResponseMode;
  tool: ToolDefinition;
}

interface RawSkill {
  name: string;
  category: string;
  description: string;
  triggerPhrases: Record<string, string[]> | null;
  parameters: Array<{
    name: string;
    type: string;
    required?: boolean;
    description?: string;
    default?: unknown;
    values?: string[];
    examples?: unknown[];
  }>;
  handler: string;
  responseMode: ResponseMode;
  availability: { requires?: string[] } | null;
  body: string;
  source: "bundled" | "user";
  filePath: string;
}

export interface AvailabilityContext {
  music_folder_configured: boolean;
  vlc_installed: boolean;
  vesync_logged_in: boolean;
  google_calendar_connected: boolean;
}

// Convert skill `parameters` array to JSON Schema object, matching the shape
// used by existing ToolDefinition.parameters (OpenAI function-calling format).
function parametersToJsonSchema(
  params: RawSkill["parameters"]
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of params) {
    let jsonType: string | string[] = "string";
    const prop: Record<string, unknown> = {};
    if (p.type === "enum" && Array.isArray(p.values)) {
      prop.type = "string";
      prop.enum = p.values;
    } else if (p.type === "number" || p.type === "integer") {
      jsonType = p.type === "integer" ? "integer" : "number";
      prop.type = jsonType;
    } else if (p.type === "boolean") {
      prop.type = "boolean";
    } else if (p.type === "any") {
      // AI SDKs handle unions poorly; keep as string for robustness.
      prop.type = ["string", "number", "boolean"];
    } else {
      prop.type = "string";
    }
    if (p.description) prop.description = p.description;
    if (p.examples) prop.examples = p.examples;
    if (p.default !== undefined) prop.default = p.default;
    properties[p.name] = prop;
    if (p.required) required.push(p.name);
  }
  const schema: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) schema.required = required;
  return schema;
}

// Weave trigger phrases into the description so the LLM sees the Chinese / English
// cue words without needing a separate field in the tool schema.
function buildDescription(raw: RawSkill): string {
  const parts: string[] = [raw.description || ""];
  if (raw.triggerPhrases) {
    const all: string[] = [];
    for (const arr of Object.values(raw.triggerPhrases)) {
      if (Array.isArray(arr)) all.push(...arr);
    }
    if (all.length > 0) {
      parts.push(`Call this when the user says things like: ${all.join(", ")}.`);
    }
  }
  return parts.filter(Boolean).join(" ");
}

function isAvailable(raw: RawSkill, ctx: AvailabilityContext): boolean {
  const requires = raw.availability?.requires;
  if (!requires || requires.length === 0) return true;
  for (const flag of requires) {
    if (!(ctx as unknown as Record<string, boolean>)[flag]) return false;
  }
  return true;
}

// Wrap a handler function (from handlers/) as a ToolDefinition so it plugs
// into the existing ToolRegistry without any changes there.
function toToolDefinition(raw: RawSkill): ToolDefinition | null {
  const handler = getHandler(raw.handler);
  if (!handler) {
    console.warn(`[skills] unknown handler "${raw.handler}" for skill "${raw.name}"`);
    return null;
  }
  const description = buildDescription(raw);
  const parameters = parametersToJsonSchema(raw.parameters);
  return {
    name: raw.name,
    description,
    parameters,
    readOnly: raw.category === "misc",
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => handler(args),
  };
}

export async function loadAllSkills(
  ctx: AvailabilityContext
): Promise<LoadedSkill[]> {
  const api = window.electronAPI;
  if (!api?.skillsLoadAll) return [];
  const r = await api.skillsLoadAll();
  if (!r?.success || !Array.isArray(r.skills)) return [];

  const out: LoadedSkill[] = [];
  for (const raw of r.skills as RawSkill[]) {
    if (!isAvailable(raw, ctx)) continue;
    const tool = toToolDefinition(raw);
    if (!tool) continue;
    out.push({
      name: raw.name,
      category: raw.category,
      description: raw.description,
      responseMode: raw.responseMode,
      tool,
    });
  }
  return out;
}
