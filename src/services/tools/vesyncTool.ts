import type { ToolDefinition, ToolResult } from "./ToolRegistry";

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

async function fetchDevices(): Promise<
  | { ok: true; devices: VeSyncDevice[] }
  | { ok: false; error: string }
> {
  const api = window.electronAPI;
  if (!api?.vesyncListDevices) {
    return { ok: false, error: "VeSync integration not available" };
  }
  const r = await api.vesyncListDevices({ refresh: true });
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

// Fuzzy-match "Light 1" / "灯一" / "light1" / "第一盏灯" against device names.
// Strategy: normalize (lowercase, strip spaces), try exact → substring → digit match.
function matchDevice(
  query: string,
  devices: VeSyncDevice[]
): { matches: VeSyncDevice[] } {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const q = normalize(query);

  // 1. Exact normalized match
  let matches = devices.filter((d) => normalize(d.name) === q);
  if (matches.length > 0) return { matches };

  // 2. Substring match
  matches = devices.filter((d) => normalize(d.name).includes(q) || q.includes(normalize(d.name)));
  if (matches.length > 0) return { matches };

  // 3. Digit-based match — extract digit from query, compare with digit in device name
  const qDigit = query.match(/[0-9]|[一二三四五六七八九十]/)?.[0];
  if (qDigit) {
    const cnToNum: Record<string, string> = {
      一: "1", 二: "2", 三: "3", 四: "4", 五: "5",
      六: "6", 七: "7", 八: "8", 九: "9", 十: "10",
    };
    const qNum = cnToNum[qDigit] || qDigit;
    matches = devices.filter((d) => d.name.includes(qNum));
    if (matches.length > 0) return { matches };
  }

  return { matches: [] };
}

export const listSmartDevicesTool: ToolDefinition = {
  name: "list_smart_devices",
  description:
    "List the user's VeSync smart home devices (lights, plugs, switches). Returns each device's name, type, current on/off status, and whether it's online. Use this before controlling a device to know what's available.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  readOnly: true,

  async execute(): Promise<ToolResult> {
    const r = await fetchDevices();
    if (!r.ok) {
      return { success: false, data: null, displayText: r.error };
    }
    if (r.devices.length === 0) {
      return {
        success: true,
        data: [],
        displayText: "VeSync 账号下没有设备",
      };
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
  },
};

export const setDevicePowerTool: ToolDefinition = {
  name: "set_device_power",
  description:
    "Turn a VeSync smart home device on or off (e.g. a light or smart plug). The device name is fuzzy-matched — users may say 'Light 1', 'light one', '灯一', or '第一盏灯'. If the match is ambiguous or the device is offline, an error is returned.",
  parameters: {
    type: "object",
    properties: {
      device: {
        type: "string",
        description: "The device name or an identifying fragment (e.g. 'Light 1', '灯二').",
      },
      action: {
        type: "string",
        enum: ["on", "off", "toggle"],
        description: "Power action: 'on' to turn on, 'off' to turn off, 'toggle' to flip state.",
      },
    },
    required: ["device", "action"],
    additionalProperties: false,
  },
  readOnly: false,

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const device = String(args.device || "").trim();
    const action = String(args.action || "").toLowerCase();
    if (!device) {
      return { success: false, data: null, displayText: "缺少设备名称" };
    }
    if (action !== "on" && action !== "off" && action !== "toggle") {
      return { success: false, data: null, displayText: `无效动作: ${action}` };
    }

    const r = await fetchDevices();
    if (!r.ok) {
      return { success: false, data: null, displayText: r.error };
    }

    const { matches } = matchDevice(device, r.devices);
    if (matches.length === 0) {
      const names = r.devices.map((d) => d.name).join(", ");
      return {
        success: false,
        data: null,
        displayText: `找不到设备「${device}」。可用设备: ${names}`,
      };
    }
    if (matches.length > 1) {
      const names = matches.map((d) => d.name).join(", ");
      return {
        success: false,
        data: null,
        displayText: `「${device}」匹配多个设备: ${names}。请更具体地指定。`,
      };
    }

    const target = matches[0];
    if (!target.online) {
      return {
        success: false,
        data: null,
        displayText: `设备「${target.name}」当前离线`,
      };
    }

    const desired = action === "toggle" ? undefined : (action as "on" | "off");
    const result = await window.electronAPI.vesyncToggle(target.cid, desired);
    if (!result?.success) {
      return {
        success: false,
        data: null,
        displayText: `切换「${target.name}」失败: ${result?.error || "未知错误"}`,
      };
    }

    const finalStatus = result.status || desired || "切换";
    return {
      success: true,
      data: { device: target.name, status: finalStatus },
      displayText: `已${finalStatus === "on" ? "打开" : finalStatus === "off" ? "关闭" : "切换"}「${target.name}」`,
    };
  },
};
