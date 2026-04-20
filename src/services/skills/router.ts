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

// Re-export for convenience — downstream ts files only import from router.ts.
export type { ToolResult };

export type RouterIntent = "chat" | "action" | "unclear";

// Parsed/validated router output. If parsing failed or the intent is missing
// from the JSON, we surface `intent: "unclear"` so the caller can fall back
// to either a clarifying question or the regular LLM path.
export interface RouterDecision {
  intent: RouterIntent;
  // chat
  reply?: string;
  // action
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

export interface DispatchOutcome {
  dispatched: boolean;
  skill?: string;
  result?: ToolResult;
  error?: string;
  responseMode?: LoadedSkill["responseMode"];
  latencyMs: number;
}

export function isDispatchEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const v = window.localStorage?.getItem("skillRouterDispatch");
  return v === "1" || v === "true";
}

// Classify the utterance and coerce the model's JSON into a typed decision.
// Reuses runRouterDryRun so the prompt + parser stay shared between dry-run
// UI and real dispatch — no drift.
export async function classify(
  userText: string,
  skills: LoadedSkill[]
): Promise<RouterDecision> {
  const r = await runRouterDryRun(userText, skills);
  const j = (r.json ?? {}) as Record<string, unknown>;
  const intent = (j.intent === "chat" || j.intent === "action" || j.intent === "unclear")
    ? (j.intent as RouterIntent)
    : "unclear";

  return {
    intent,
    reply: typeof j.reply === "string" ? j.reply : undefined,
    skill: typeof j.skill === "string" ? j.skill : undefined,
    category: typeof j.category === "string" ? j.category : undefined,
    slots: (j.slots && typeof j.slots === "object") ? (j.slots as Record<string, unknown>) : undefined,
    confidence: typeof j.confidence === "number" ? j.confidence : undefined,
    ask: typeof j.ask === "string" ? j.ask : undefined,
    latencyMs: r.latencyMs,
    raw: r,
  };
}

// Execute the skill handler for an action decision. Validates the skill is
// in the current catalog (loaded + available); unknown skills return
// `dispatched: false` so the caller can fall through to chat or an error UI.
export async function dispatchAction(
  decision: RouterDecision,
  skills: LoadedSkill[]
): Promise<DispatchOutcome> {
  if (decision.intent !== "action" || !decision.skill) {
    return { dispatched: false, latencyMs: 0 };
  }
  const skill = skills.find((s) => s.name === decision.skill);
  if (!skill) {
    return {
      dispatched: false,
      skill: decision.skill,
      error: `unknown skill: ${decision.skill}`,
      latencyMs: 0,
    };
  }

  const t0 = performance.now();
  try {
    const result = await skill.tool.execute(decision.slots || {});
    const latencyMs = Math.round(performance.now() - t0);
    return {
      dispatched: true,
      skill: skill.name,
      result,
      responseMode: skill.responseMode,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - t0);
    return {
      dispatched: false,
      skill: skill.name,
      error: (err as Error).message,
      latencyMs,
    };
  }
}

// Render the dispatch outcome into assistant-chat markdown, respecting the
// skill's responseMode:
//   - passthrough: use handler's displayText directly
//   - commentary:  fall back to a minimal "执行完成" header (no LLM follow-up
//                  — that's a future path if we want to chain chat)
//   - template:    {{displayText}}/{{metadata.*}} substitution
export function renderDispatchMessage(
  decision: RouterDecision,
  outcome: DispatchOutcome
): string {
  const totalMs = decision.latencyMs + outcome.latencyMs;
  const header = `⚡ **${outcome.skill || decision.skill}** · 🧠 ${decision.latencyMs}ms + 🛠 ${outcome.latencyMs}ms = ${totalMs}ms`;

  if (!outcome.dispatched) {
    return `${header}\n\n❌ ${outcome.error || "dispatch failed"}`;
  }
  const r = outcome.result;
  if (!r) return `${header}\n\n(no result)`;

  const displayText = r.displayText || (typeof r.data === "string" ? r.data : "");
  const mode = outcome.responseMode;

  if (mode === "passthrough") return `${header}\n\n${displayText}`;
  if (typeof mode === "object" && typeof mode.template === "string") {
    // Template substitution: {{displayText}} and {{data.*}} paths. ToolResult
    // has no separate metadata field — handlers expose structured info via
    // `data`, so that's what the template walks.
    const data = (r.data && typeof r.data === "object") ? (r.data as Record<string, unknown>) : {};
    const text = mode.template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
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
    return `${header}\n\n${text}`;
  }
  // commentary mode: we would ordinarily hand the result back to the LLM for
  // a natural-language wrap. In the half-open router path we short-circuit
  // that step — just show the raw displayText and let the operator decide if
  // it's good enough. Re-entering the LLM here is a later iteration.
  return `${header}\n\n${displayText}`;
}

// Render an unclear decision as a short clarifying question.
export function renderUnclearMessage(decision: RouterDecision): string {
  const header = `❓ **Router** · ⏱ ${decision.latencyMs}ms`;
  const ask = decision.ask || "能再说具体一点吗？";
  return `${header}\n\n${ask}`;
}
