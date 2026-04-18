import { ToolRegistry } from "./ToolRegistry";
import { createSearchNotesTool } from "./searchNotesTool";
import { getNoteTool } from "./getNoteTool";
import { createNoteTool } from "./createNoteTool";
import { updateNoteTool } from "./updateNoteTool";
import { listFoldersTool } from "./listFoldersTool";
import { clipboardTool } from "./clipboardTool";
import { webSearchTool } from "./webSearchTool";
import { calendarTool } from "./calendarTool";
import { listSmartDevicesTool, setDevicePowerTool } from "./vesyncTool";
import {
  listMusicTool,
  playMusicTool,
  pauseMusicTool,
  nextMusicTool,
  previousMusicTool,
  stopMusicTool,
  setMusicVolumeTool,
  setMusicRepeatTool,
  setMusicShuffleTool,
} from "./musicTool";

export { ToolRegistry } from "./ToolRegistry";
export type { ToolDefinition, ToolResult } from "./ToolRegistry";

interface ToolRegistrySettings {
  isSignedIn: boolean;
  gcalConnected: boolean;
  cloudBackupEnabled: boolean;
  vesyncAvailable: boolean;
  musicAvailable: boolean;
}

export function createToolRegistry(settings: ToolRegistrySettings): ToolRegistry {
  const registry = new ToolRegistry();

  const useCloudSearch = settings.isSignedIn && settings.cloudBackupEnabled;
  registry.register(createSearchNotesTool({ useCloudSearch }));
  registry.register(getNoteTool);
  registry.register(createNoteTool);
  registry.register(updateNoteTool);
  registry.register(listFoldersTool);
  registry.register(clipboardTool);

  if (settings.isSignedIn) {
    registry.register(webSearchTool);
  }

  if (settings.gcalConnected) {
    registry.register(calendarTool);
  }

  if (settings.vesyncAvailable) {
    registry.register(listSmartDevicesTool);
    registry.register(setDevicePowerTool);
  }

  if (settings.musicAvailable) {
    registry.register(listMusicTool);
    registry.register(playMusicTool);
    registry.register(pauseMusicTool);
    registry.register(nextMusicTool);
    registry.register(previousMusicTool);
    registry.register(stopMusicTool);
    registry.register(setMusicVolumeTool);
    registry.register(setMusicRepeatTool);
    registry.register(setMusicShuffleTool);
  }

  return registry;
}
