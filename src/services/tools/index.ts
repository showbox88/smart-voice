import { ToolRegistry } from "./ToolRegistry";
import { createSearchNotesTool } from "./searchNotesTool";
import { getNoteTool } from "./getNoteTool";
import { createNoteTool } from "./createNoteTool";
import { updateNoteTool } from "./updateNoteTool";
import { listFoldersTool } from "./listFoldersTool";
import { clipboardTool } from "./clipboardTool";
import { webSearchTool } from "./webSearchTool";
import { calendarTool } from "./calendarTool";

export { ToolRegistry } from "./ToolRegistry";
export type { ToolDefinition, ToolResult } from "./ToolRegistry";

// Music + VeSync tools are no longer registered here — they live as skill
// files in `skills/` and are merged in by useChatStreaming via loadAllSkills.
// Keep `vesyncAvailable` / `musicAvailable` in the settings shape only for
// callers that still pass them; they are unused at registration time.
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

  return registry;
}
