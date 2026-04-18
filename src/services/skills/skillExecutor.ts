import type { LoadedSkill, ResponseMode } from "./skillLoader";

export type ResponseDecision =
  | { kind: "commentary" }
  | { kind: "final"; text: string };

// Map of skill name → response mode, built once per `sendToAI` call.
// Looked up in the streaming loop when a `tool_result` chunk arrives.
export class SkillResponseMap {
  private map = new Map<string, ResponseMode>();

  constructor(skills: LoadedSkill[]) {
    for (const s of skills) this.map.set(s.name, s.responseMode);
  }

  // Decide what to do after a tool result:
  //  - commentary: let the LLM continue (current behaviour)
  //  - final: use this text as the final assistant message, cancel stream
  decide(
    toolName: string,
    displayText: string,
    metadata?: Record<string, unknown>
  ): ResponseDecision {
    const mode = this.map.get(toolName);
    if (!mode) return { kind: "commentary" };
    if (mode === "commentary") return { kind: "commentary" };
    if (mode === "passthrough") return { kind: "final", text: displayText };
    if (typeof mode === "object" && typeof mode.template === "string") {
      return { kind: "final", text: renderTemplate(mode.template, displayText, metadata) };
    }
    return { kind: "commentary" };
  }
}

// Minimal `{{key}}` substitution. Pulls from `metadata` first, then falls
// back to a reserved `{{displayText}}` placeholder. No loops, no conditionals —
// anything fancier belongs in the handler.
function renderTemplate(
  template: string,
  displayText: string,
  metadata?: Record<string, unknown>
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    if (key === "displayText") return displayText;
    if (!metadata) return "";
    const path = key.split(".");
    let cur: unknown = metadata;
    for (const p of path) {
      if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return "";
      }
    }
    if (cur == null) return "";
    return typeof cur === "string" ? cur : String(cur);
  });
}
