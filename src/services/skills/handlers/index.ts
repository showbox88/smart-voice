import type { ToolResult } from "../../tools/ToolRegistry";
import * as musicHandlers from "./music";
import * as vesyncHandlers from "./vesync";

export type SkillHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

// Handler name → function map. Skill files reference handlers via
// `handler: "<module>.<function>"`, e.g. "music.play".
const REGISTRY: Record<string, SkillHandler> = {
  "music.play": musicHandlers.play,
  "music.control": musicHandlers.control,
  "music.list": musicHandlers.list,
  "vesync.control": vesyncHandlers.control,
};

export function getHandler(name: string): SkillHandler | undefined {
  return REGISTRY[name];
}

export function listHandlers(): string[] {
  return Object.keys(REGISTRY);
}
