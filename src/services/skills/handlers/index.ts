import type { ToolResult } from "../../tools/ToolRegistry";
import * as musicHandlers from "./music";
import * as vesyncHandlers from "./vesync";
import * as systemHandlers from "./system";
import * as infoHandlers from "./info";
import * as climateHandlers from "./climate";
import * as messagingHandlers from "./messaging";
import * as calendarHandlers from "./calendar";
import * as windowsControlHandlers from "./windowsControl";

export type SkillHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

// Handler name → function map. Skill files reference handlers via
// `handler: "<module>.<function>"`, e.g. "music.play".
const REGISTRY: Record<string, SkillHandler> = {
  "music.play": musicHandlers.play,
  "music.control": musicHandlers.control,
  "music.list": musicHandlers.list,
  "vesync.control": vesyncHandlers.control,
  "vesync.dim": vesyncHandlers.dim,
  "system.launchApp": systemHandlers.launchApp,
  "system.createReminder": systemHandlers.createReminder,
  "info.query": infoHandlers.query,
  "climate.aircon": climateHandlers.aircon,
  "messaging.send": messagingHandlers.send,
  "calendar.query": calendarHandlers.query,
  "calendar.create": calendarHandlers.create,
  "windowsControl.execute": windowsControlHandlers.execute,
};

export function getHandler(name: string): SkillHandler | undefined {
  return REGISTRY[name];
}

export function listHandlers(): string[] {
  return Object.keys(REGISTRY);
}
