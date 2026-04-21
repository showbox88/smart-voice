// Short "world state" summary the agent sees every turn via the system prompt.
// Only include things small enough that the token cost is worth the zero-
// latency awareness. Long lists (music library) stay tool-based.
//
// Currently covered:
//   - Smart-home devices (names + category, grouped)
//   - Last played music track (name + when)
//
// Keep each section under ~8 lines; if a section grows past that, split it
// into a tool-backed lookup instead of inlining.

function summarizeRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h ago`;
  const days = Math.floor(diffSec / 86400);
  return days === 1 ? "yesterday" : `${days} d ago`;
}

async function summarizeSmartHome(): Promise<string> {
  const api = window.electronAPI;
  if (!api?.vesyncListDevices) return "";
  try {
    // refresh:false — use whatever the main-side cache already has. A stale
    // device list is fine here; this is just for the agent to know names.
    const r = await api.vesyncListDevices({ refresh: false });
    const devices = (r?.success && Array.isArray(r.devices) ? r.devices : []) as Array<{
      name: string;
      category?: string;
      type?: string;
    }>;
    if (devices.length === 0) return "";

    const lightKw = /light|lamp|bulb|灯/i;
    const plugKw = /plug|outlet|socket|插/i;
    const switchKw = /switch|开关/i;
    const groups: Record<string, string[]> = { Lights: [], Plugs: [], Switches: [], Other: [] };
    for (const d of devices) {
      const hay = `${d.name} ${d.category || ""} ${d.type || ""}`;
      if (lightKw.test(hay)) groups.Lights.push(d.name);
      else if (plugKw.test(hay)) groups.Plugs.push(d.name);
      else if (switchKw.test(hay)) groups.Switches.push(d.name);
      else groups.Other.push(d.name);
    }
    const lines: string[] = [];
    for (const [label, names] of Object.entries(groups)) {
      if (names.length > 0) lines.push(`${label}: ${names.join(", ")}`);
    }
    if (lines.length === 0) return "";
    return "Smart-home devices in this home:\n" + lines.join("\n");
  } catch {
    return "";
  }
}

async function summarizeLastPlayed(): Promise<string> {
  const api = window.electronAPI;
  if (!api?.agentStateGet) return "";
  try {
    const r = await api.agentStateGet();
    const state = r?.state || {};
    const name = typeof state.lastPlayedName === "string" ? state.lastPlayedName : "";
    const at = typeof state.lastPlayedAt === "string" ? state.lastPlayedAt : "";
    if (!name) return "";
    const when = at ? summarizeRelativeTime(at) : "";
    return when
      ? `Last music played: "${name}" (${when}).`
      : `Last music played: "${name}".`;
  } catch {
    return "";
  }
}

// Build the full world context. Runs all section builders in parallel and
// drops empty ones. Safe to call per turn — individual calls are cached
// main-side (VeSync devices) or read a tiny JSON (agent-state).
export async function buildWorldContext(): Promise<string> {
  const [smartHome, lastPlayed] = await Promise.all([
    summarizeSmartHome(),
    summarizeLastPlayed(),
  ]);
  return [smartHome, lastPlayed].filter(Boolean).join("\n\n");
}
