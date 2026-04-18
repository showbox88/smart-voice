import type { ToolResult } from "../../tools/ToolRegistry";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\\/_.\-()[\]【】《》〈〉]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function basename(filePath: string): string {
  const normalised = filePath.replace(/\\/g, "/");
  const last = normalised.split("/").pop() || filePath;
  return last.replace(/\.[^.]+$/, "");
}

function shortRelPath(filePath: string, root: string): string {
  const sep = filePath.includes("\\") ? "\\" : "/";
  if (!root) return basename(filePath);
  const prefix = root.endsWith(sep) ? root : root + sep;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : basename(filePath);
}

function matchTracks(
  query: string,
  files: string[],
  limit = 30
): { matches: string[]; exactBasename: string | null } {
  const q = normalize(query);
  if (!q) return { matches: [], exactBasename: null };
  let exact: string | null = null;
  const scored: Array<{ file: string; score: number }> = [];
  for (const file of files) {
    const name = basename(file);
    const nameN = normalize(name);
    const pathN = normalize(file);
    if (nameN === q) {
      exact = file;
      scored.push({ file, score: 1000 - nameN.length });
      continue;
    }
    if (nameN.includes(q)) {
      scored.push({ file, score: 500 - Math.abs(nameN.length - q.length) });
    } else if (pathN.includes(q)) {
      scored.push({ file, score: 200 - Math.abs(pathN.length - q.length) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return { matches: scored.slice(0, limit).map((s) => s.file), exactBasename: exact };
}

async function fetchFiles(): Promise<
  { ok: true; files: string[]; root: string } | { ok: false; error: string }
> {
  const api = window.electronAPI;
  if (!api?.musicList) return { ok: false, error: "音乐功能不可用" };
  const root = (await api.getMusicFolder()) || "";
  if (!root) return { ok: false, error: "未设置音乐文件夹 —— 请在「智能家居」里配置" };
  const r = await api.musicList({});
  if (!r?.success) {
    const msg =
      r?.error === "no_folder_configured"
        ? "未设置音乐文件夹"
        : r?.error === "root_not_found"
          ? "音乐文件夹不存在"
          : r?.error || "无法扫描音乐文件夹";
    return { ok: false, error: msg };
  }
  return { ok: true, files: r.files || [], root };
}

export async function play(args: Record<string, unknown>): Promise<ToolResult> {
  const api = window.electronAPI;
  if (!api?.musicPlay) {
    return { success: false, data: null, displayText: "音乐功能不可用" };
  }
  const vlc = await api.musicVlcStatus();
  if (!vlc?.available) {
    return {
      success: false,
      data: null,
      displayText: "找不到 VLC —— 请先安装 VLC 或在设置里指定 vlc.exe 路径",
    };
  }

  const r = await fetchFiles();
  if (!r.ok) return { success: false, data: null, displayText: r.error };
  if (r.files.length === 0) {
    return { success: false, data: null, displayText: "音乐文件夹里没有音频文件" };
  }

  const query = (args.query as string | undefined)?.trim() || "";
  const shuffle = args.shuffle === undefined ? !query : Boolean(args.shuffle);

  let toPlay: string[];
  if (query) {
    const { matches } = matchTracks(query, r.files);
    if (matches.length === 0) {
      return { success: false, data: null, displayText: `找不到匹配「${query}」的曲目` };
    }
    toPlay = matches;
  } else {
    toPlay = [...r.files];
  }

  if (shuffle && toPlay.length > 1) {
    for (let i = toPlay.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [toPlay[i], toPlay[j]] = [toPlay[j], toPlay[i]];
    }
  }

  const result = await api.musicPlay(toPlay);
  if (!result?.success) {
    const msg =
      result?.error === "vlc_not_found"
        ? "找不到 VLC 播放器"
        : result?.error === "vlc_http_unreachable"
          ? "VLC 启动了但 HTTP 接口无法连接"
          : result?.error || "播放失败";
    return { success: false, data: null, displayText: msg };
  }
  const firstName = result.playing ? shortRelPath(result.playing, r.root) : "";
  return {
    success: true,
    data: { firstTrack: firstName, queued: toPlay.length, shuffle },
    displayText: `正在播放：${firstName}`,
  };
}

// Unified control dispatcher — covers pause, resume, next, previous, stop,
// volume, repeat, shuffle. Called by `music_control` skill.
export async function control(args: Record<string, unknown>): Promise<ToolResult> {
  const api = window.electronAPI;
  if (!api) return { success: false, data: null, displayText: "音乐功能不可用" };
  const action = String(args.action || "").toLowerCase();
  const value = args.value;

  switch (action) {
    case "pause":
    case "resume":
    case "toggle": {
      const r = await api.musicPause();
      if (!r?.success) {
        const msg = r?.error === "not_running" ? "当前没有在播放音乐" : r?.error || "操作失败";
        return { success: false, data: null, displayText: msg };
      }
      return { success: true, data: { action }, displayText: "已暂停/恢复播放" };
    }
    case "next": {
      const r = await api.musicNext();
      if (!r?.success) {
        const msg = r?.error === "not_running" ? "当前没有在播放音乐" : r?.error || "切换失败";
        return { success: false, data: null, displayText: msg };
      }
      return { success: true, data: { action }, displayText: "已切换到下一首" };
    }
    case "previous":
    case "prev": {
      const r = await api.musicPrevious();
      if (!r?.success) {
        const msg = r?.error === "not_running" ? "当前没有在播放音乐" : r?.error || "切换失败";
        return { success: false, data: null, displayText: msg };
      }
      return { success: true, data: { action }, displayText: "已切换到上一首" };
    }
    case "stop": {
      const r = await api.musicStop();
      if (!r?.success) {
        return { success: false, data: null, displayText: r?.error || "停止失败" };
      }
      return { success: true, data: { action }, displayText: "已停止播放" };
    }
    case "volume": {
      const v = Math.max(0, Math.min(100, Number(value) || 0));
      const r = await api.musicVolume(v);
      if (!r?.success) {
        const msg = r?.error === "not_running" ? "当前没有在播放音乐" : r?.error || "调整音量失败";
        return { success: false, data: null, displayText: msg };
      }
      return { success: true, data: { volume: v }, displayText: `音量已设为 ${v}%` };
    }
    case "repeat": {
      const raw = String(value || "").toLowerCase();
      const mode: "off" | "all" | "one" =
        raw === "all" || raw === "one" ? (raw as "all" | "one") : "off";
      const r = await api.musicSetRepeat(mode);
      if (!r?.success) {
        const msg = r?.error === "not_running" ? "当前没有在播放音乐" : r?.error || "设置循环失败";
        return { success: false, data: null, displayText: msg };
      }
      const label = mode === "all" ? "列表循环" : mode === "one" ? "单曲循环" : "关闭循环";
      return { success: true, data: { mode }, displayText: `已${label}` };
    }
    case "shuffle": {
      const on = Boolean(value);
      const r = await api.musicSetShuffle(on);
      if (!r?.success) {
        const msg = r?.error === "not_running" ? "当前没有在播放音乐" : r?.error || "设置随机失败";
        return { success: false, data: null, displayText: msg };
      }
      return {
        success: true,
        data: { shuffle: on },
        displayText: on ? "已开启随机播放" : "已关闭随机播放",
      };
    }
    default:
      return { success: false, data: null, displayText: `未知操作: ${action}` };
  }
}

export async function list(): Promise<ToolResult> {
  const r = await fetchFiles();
  if (!r.ok) return { success: false, data: null, displayText: r.error };
  if (r.files.length === 0) {
    return { success: true, data: [], displayText: "音乐文件夹里没有音频文件" };
  }
  const preview = r.files.slice(0, 50).map((f) => shortRelPath(f, r.root));
  return {
    success: true,
    data: preview,
    displayText: `找到 ${r.files.length} 首曲目${r.files.length > 50 ? "（显示前 50 首）" : ""}`,
  };
}
