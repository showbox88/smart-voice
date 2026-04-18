import type { ToolResult } from "../../tools/ToolRegistry";

type VeSyncDevice = {
  cid: string;
  uuid: string | null;
  name: string;
  type: string;
  category: string;
  status: string;
  online: boolean;
  mac: string | null;
  region: string | null;
};

async function fetchDevices(
  { refresh = false }: { refresh?: boolean } = {}
): Promise<{ ok: true; devices: VeSyncDevice[] } | { ok: false; error: string }> {
  const api = window.electronAPI;
  if (!api?.vesyncListDevices) {
    return { ok: false, error: "VeSync 不可用" };
  }
  const r = await api.vesyncListDevices({ refresh });
  if (r?.success && Array.isArray(r.devices) && r.devices.length === 0 && !refresh) {
    // Cache was empty (first call) — force a refresh to populate.
    const fresh = await api.vesyncListDevices({ refresh: true });
    if (fresh?.success) return { ok: true, devices: fresh.devices as VeSyncDevice[] };
  }
  if (!r?.success) {
    const msg =
      r?.error === "missing_credentials"
        ? "未登录 VeSync —— 请先在「智能家居」里登录"
        : r?.error === "credential_error"
          ? "VeSync 账号或密码错误"
          : r?.error === "region_mismatch"
            ? "VeSync 账号区域和国家代码不匹配"
            : r?.error || "获取设备列表失败";
    return { ok: false, error: msg };
  }
  return { ok: true, devices: r.devices as VeSyncDevice[] };
}

// Generic class aliases: user says "灯" / "light" → match every light-like device.
// Keyed by the normalized user query (lowercased, whitespace-stripped). Value is
// a list of keywords to look for in the device's name / type / category.
// The sentinel "*" means "match every device regardless of type" (for 全部/所有/all).
const LIGHT_KW = ["light", "lamp", "bulb", "灯"];
const PLUG_KW = ["plug", "outlet", "socket", "插"];
const SWITCH_KW = ["switch", "开关"];
const GENERIC_ALIASES: Record<string, string[]> = {
  // Lights — simplified + traditional Chinese variants.
  灯: LIGHT_KW,
  燈: LIGHT_KW,
  灯光: LIGHT_KW,
  燈光: LIGHT_KW,
  所有灯: LIGHT_KW,
  所有燈: LIGHT_KW,
  全部灯: LIGHT_KW,
  全部燈: LIGHT_KW,
  light: LIGHT_KW,
  lights: LIGHT_KW,
  lamp: LIGHT_KW,
  lamps: LIGHT_KW,
  // Plugs.
  插座: PLUG_KW,
  所有插座: PLUG_KW,
  plug: PLUG_KW,
  plugs: PLUG_KW,
  outlet: PLUG_KW,
  // Switches — simplified + traditional.
  开关: SWITCH_KW,
  開關: SWITCH_KW,
  switch: SWITCH_KW,
  switches: SWITCH_KW,
  // "all-device" aliases — match every device regardless of category.
  全部: ["*"],
  所有: ["*"],
  全部设备: ["*"],
  全部設備: ["*"],
  所有设备: ["*"],
  所有設備: ["*"],
  all: ["*"],
  everything: ["*"],
};

function matchDevice(
  query: string,
  devices: VeSyncDevice[]
): { matches: VeSyncDevice[]; isGeneric: boolean } {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const q = normalize(query);

  let matches = devices.filter((d) => normalize(d.name) === q);
  if (matches.length > 0) return { matches, isGeneric: false };

  matches = devices.filter(
    (d) => normalize(d.name).includes(q) || q.includes(normalize(d.name))
  );
  if (matches.length > 0) return { matches, isGeneric: false };

  // Generic class alias — "灯" matches every device that looks like a light.
  // "*" sentinel matches every device regardless of type (全部/所有/all).
  const aliasKeywords = GENERIC_ALIASES[q];
  if (aliasKeywords) {
    if (aliasKeywords.includes("*")) {
      return { matches: devices, isGeneric: true };
    }
    const hit = devices.filter((d) => {
      const hay = normalize(`${d.name} ${d.type} ${d.category}`);
      return aliasKeywords.some((kw) => hay.includes(normalize(kw)));
    });
    if (hit.length > 0) return { matches: hit, isGeneric: true };
  }

  const qDigit = query.match(/[0-9]|[一二三四五六七八九十]/)?.[0];
  if (qDigit) {
    const cnToNum: Record<string, string> = {
      一: "1", 二: "2", 三: "3", 四: "4", 五: "5",
      六: "6", 七: "7", 八: "8", 九: "9", 十: "10",
    };
    const qNum = cnToNum[qDigit] || qDigit;
    matches = devices.filter((d) => d.name.includes(qNum));
    if (matches.length > 0) return { matches, isGeneric: false };
  }

  return { matches: [], isGeneric: false };
}

// Unified smart-device handler — action: "list" | "on" | "off" | "toggle".
export async function control(args: Record<string, unknown>): Promise<ToolResult> {
  const action = String(args.action || "").toLowerCase();
  const device = String(args.device || "").trim();

  if (action === "list") {
    const r = await fetchDevices({ refresh: true });
    if (!r.ok) return { success: false, data: null, displayText: r.error };
    if (r.devices.length === 0) {
      return { success: true, data: [], displayText: "VeSync 账号下没有设备" };
    }
    const simplified = r.devices.map((d) => ({
      name: d.name,
      type: d.type,
      status: d.status,
      online: d.online,
    }));
    return {
      success: true,
      data: simplified,
      displayText: `找到 ${r.devices.length} 个智能设备`,
    };
  }

  if (action !== "on" && action !== "off" && action !== "toggle") {
    return { success: false, data: null, displayText: `无效动作: ${action}` };
  }
  if (!device) {
    return { success: false, data: null, displayText: "缺少设备名称" };
  }

  const r = await fetchDevices();
  if (!r.ok) return { success: false, data: null, displayText: r.error };

  const { matches, isGeneric } = matchDevice(device, r.devices);
  if (matches.length === 0) {
    const names = r.devices.map((d) => d.name).join(", ");
    return {
      success: false,
      data: null,
      displayText: `找不到设备「${device}」。可用设备: ${names}`,
    };
  }
  // Multiple specific matches → still ambiguous; multiple generic matches (e.g.
  // "开灯" hitting light1 + light2) → batch-apply to all of them.
  if (matches.length > 1 && !isGeneric) {
    const names = matches.map((d) => d.name).join(", ");
    return {
      success: false,
      data: null,
      displayText: `「${device}」匹配多个设备: ${names}。请更具体地指定。`,
    };
  }

  const verb = action === "on" ? "打开" : action === "off" ? "关闭" : "切换";
  const desired = action === "toggle" ? undefined : (action as "on" | "off");
  const succeeded: string[] = [];
  const failed: string[] = [];
  const offline: string[] = [];

  // Fire all toggles in parallel — VeSync cloud handles concurrent requests
  // fine and this cuts multi-device latency from N*rtt to max(rtt).
  const online = matches.filter((m) => m.online);
  offline.push(...matches.filter((m) => !m.online).map((m) => m.name));
  const results = await Promise.all(
    online.map((target) =>
      window.electronAPI
        .vesyncToggle(target.cid, desired)
        .then((result) => ({ target, result }))
        .catch((err) => ({ target, result: { success: false, error: err?.message || "失败" } }))
    )
  );
  for (const { target, result } of results) {
    if (result?.success) succeeded.push(target.name);
    else failed.push(`${target.name}(${result?.error || "失败"})`);
  }

  const parts: string[] = [];
  if (succeeded.length > 0) parts.push(`已${verb}${succeeded.map((n) => `「${n}」`).join("、")}`);
  if (offline.length > 0) parts.push(`${offline.map((n) => `「${n}」`).join("、")}离线`);
  if (failed.length > 0) parts.push(`失败: ${failed.join("、")}`);
  const displayText = parts.join("；") || `无设备可操作`;
  const overallSuccess = succeeded.length > 0 && failed.length === 0;
  return {
    success: overallSuccess,
    data: { devices: succeeded, offline, failed, action },
    displayText,
  };
}
