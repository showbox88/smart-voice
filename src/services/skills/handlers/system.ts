import type { ToolResult } from "../../tools/ToolRegistry";
import { parseWhenFast } from "../timeResolver";

// Launch a desktop app by name. The main process owns the actual spawn via
// the `app:launch` IPC channel — see src/helpers/ipcHandlers.js. This
// renderer-side handler is a thin marshaler.
export async function launchApp(args: Record<string, unknown>): Promise<ToolResult> {
  const appName = String(args.app_name || "").trim();
  if (!appName) {
    return {
      success: false,
      data: null,
      displayText: "缺少应用名称",
    };
  }
  const api = window.electronAPI as unknown as {
    appLaunch?: (name: string) => Promise<{ success: boolean; error?: string }>;
  };
  if (!api?.appLaunch) {
    return {
      success: false,
      data: null,
      displayText: "应用启动功能未就绪（IPC 未注册）",
    };
  }
  try {
    const r = await api.appLaunch(appName);
    if (r?.success) {
      return {
        success: true,
        data: { app: appName },
        displayText: `已启动「${appName}」`,
      };
    }
    const reason = r?.error || "启动失败";
    return {
      success: false,
      data: null,
      displayText: `启动「${appName}」失败：${reason}`,
    };
  } catch (err) {
    return {
      success: false,
      data: null,
      displayText: `启动「${appName}」出错：${(err as Error).message}`,
    };
  }
}

export async function createReminder(args: Record<string, unknown>): Promise<ToolResult> {
  const message = String(args.message || "").trim();
  const when = String(args.when || "").trim();
  if (!message) return { success: false, data: null, displayText: "缺少提醒内容" };
  if (!when) return { success: false, data: null, displayText: "缺少提醒时间" };

  const parsed = parseWhenFast(when);
  const fireAt = parsed?.fireAt ?? null;
  if (!fireAt) {
    return {
      success: false,
      data: null,
      displayText: `无法解析时间「${when}」。支持：15:30 / 下午 3 点 / 10 分钟后`,
    };
  }

  const api = window.electronAPI as unknown as {
    reminderCreate?: (payload: {
      message: string;
      fireAt: number;
    }) => Promise<{ success: boolean; error?: string; id?: number }>;
  };
  if (!api?.reminderCreate) {
    return {
      success: false,
      data: null,
      displayText: "提醒功能未就绪（IPC 未注册）",
    };
  }

  try {
    const r = await api.reminderCreate({ message, fireAt });
    if (r?.success) {
      const d = new Date(fireAt);
      const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      return {
        success: true,
        data: { id: r.id, fireAt, message },
        displayText: `好的，${hhmm} 提醒你：${message}`,
      };
    }
    return {
      success: false,
      data: null,
      displayText: `创建提醒失败：${r?.error || "unknown"}`,
    };
  } catch (err) {
    return {
      success: false,
      data: null,
      displayText: `创建提醒出错：${(err as Error).message}`,
    };
  }
}
