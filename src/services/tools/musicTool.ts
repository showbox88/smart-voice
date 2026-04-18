import type { ToolDefinition, ToolResult } from "./ToolRegistry";

// Normalise a string for fuzzy comparison: lowercase, strip common punctuation,
// collapse whitespace. Keeps CJK characters as-is so "轻音乐" still matches.
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

// Fuzzy-search the track list for a human query.
// Strategy: normalized substring on full path (so folder names like "轻音乐" count),
// ranked by (filename-hit > path-hit) and shorter name preferred.
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
  return {
    matches: scored.slice(0, limit).map((s) => s.file),
    exactBasename: exact,
  };
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

export const listMusicTool: ToolDefinition = {
  name: "list_music",
  description:
    "List all music tracks in the user's configured music folder (recursive). Returns up to 50 track names. Use this when the user asks what music is available or when a play request is ambiguous.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  readOnly: true,

  async execute(): Promise<ToolResult> {
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
  },
};

export const playMusicTool: ToolDefinition = {
  name: "play_music",
  description:
    "Play MP3/audio music from the user's local music folder through VLC. Call this when the user asks to play music, songs, or a specific track — e.g. '播放歌曲', '放歌', '播放音乐', '来点音乐', '听歌', 'play music', 'play a song'. If `query` is given, fuzzy-match tracks or folders by name (e.g. '周杰伦', '轻音乐', 'classical'). If no query, shuffle-play everything. VLC window opens with playback controls and spectrum visualisation.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Optional fuzzy match against track filenames and folder names. E.g. 'Coldplay', '轻音乐', 'chapter 3'.",
      },
      shuffle: {
        type: "boolean",
        description: "Shuffle the resulting track list before playing. Default true when no query.",
      },
    },
    additionalProperties: false,
  },
  readOnly: false,

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
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
    let label: string;
    if (query) {
      const { matches } = matchTracks(query, r.files);
      if (matches.length === 0) {
        return {
          success: false,
          data: null,
          displayText: `找不到匹配「${query}」的曲目`,
        };
      }
      toPlay = matches;
      label = `匹配「${query}」的 ${matches.length} 首曲目`;
    } else {
      toPlay = [...r.files];
      label = `全部 ${r.files.length} 首曲目`;
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
      data: { queued: toPlay.length, firstTrack: firstName },
      displayText: `正在播放：${firstName}（${label}${shuffle ? "，随机" : ""}）`,
    };
  },
};

export const pauseMusicTool: ToolDefinition = {
  name: "pause_music",
  description:
    "Pause (or resume) the currently playing music in VLC. VLC's pl_pause command toggles — if paused, this resumes.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  readOnly: false,

  async execute(): Promise<ToolResult> {
    const r = await window.electronAPI?.musicPause();
    if (!r?.success) {
      const msg = r?.error === "not_running" ? "当前没有在播放音乐" : r?.error || "暂停失败";
      return { success: false, data: null, displayText: msg };
    }
    return { success: true, data: null, displayText: "已暂停/恢复播放" };
  },
};

export const nextMusicTool: ToolDefinition = {
  name: "next_music",
  description: "Skip to the next track in the current VLC playlist.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  readOnly: false,

  async execute(): Promise<ToolResult> {
    const r = await window.electronAPI?.musicNext();
    if (!r?.success) {
      const msg = r?.error === "not_running" ? "当前没有在播放音乐" : r?.error || "切换失败";
      return { success: false, data: null, displayText: msg };
    }
    return { success: true, data: null, displayText: "已切换到下一首" };
  },
};

export const previousMusicTool: ToolDefinition = {
  name: "previous_music",
  description: "Go back to the previous track in the current VLC playlist.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  readOnly: false,

  async execute(): Promise<ToolResult> {
    const r = await window.electronAPI?.musicPrevious();
    if (!r?.success) {
      const msg = r?.error === "not_running" ? "当前没有在播放音乐" : r?.error || "切换失败";
      return { success: false, data: null, displayText: msg };
    }
    return { success: true, data: null, displayText: "已切换到上一首" };
  },
};

export const stopMusicTool: ToolDefinition = {
  name: "stop_music",
  description: "Stop music playback and close the VLC window.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  readOnly: false,

  async execute(): Promise<ToolResult> {
    const r = await window.electronAPI?.musicStop();
    if (!r?.success) {
      return { success: false, data: null, displayText: r?.error || "停止失败" };
    }
    return { success: true, data: null, displayText: "已停止播放" };
  },
};

export const setMusicRepeatTool: ToolDefinition = {
  name: "set_music_repeat",
  description:
    "Control loop/repeat playback mode in VLC. Use this when the user asks to 循环播放 / 单曲循环 / 列表循环 / repeat / loop, or to turn those off. Modes: 'off' (no repeat), 'all' (loop whole playlist / 列表循环), 'one' (repeat current track / 单曲循环).",
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["off", "all", "one"],
        description: "'off' = no repeat, 'all' = loop playlist, 'one' = repeat single track.",
      },
    },
    required: ["mode"],
    additionalProperties: false,
  },
  readOnly: false,

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const raw = typeof args.mode === "string" ? args.mode.toLowerCase() : "";
    const mode: "off" | "all" | "one" =
      raw === "all" || raw === "one" ? (raw as "all" | "one") : "off";
    const r = await window.electronAPI?.musicSetRepeat(mode);
    if (!r?.success) {
      const msg = r?.error === "not_running" ? "当前没有在播放音乐" : r?.error || "设置循环模式失败";
      return { success: false, data: null, displayText: msg };
    }
    const label = mode === "all" ? "列表循环" : mode === "one" ? "单曲循环" : "关闭循环";
    return { success: true, data: { mode }, displayText: `已${label}` };
  },
};

export const setMusicShuffleTool: ToolDefinition = {
  name: "set_music_shuffle",
  description:
    "Toggle shuffle (random) playback in VLC. Use when the user asks to 随机播放 / 打乱 / shuffle, or to turn shuffle off.",
  parameters: {
    type: "object",
    properties: {
      on: {
        type: "boolean",
        description: "true = shuffle on, false = play in playlist order.",
      },
    },
    required: ["on"],
    additionalProperties: false,
  },
  readOnly: false,

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const on = Boolean(args.on);
    const r = await window.electronAPI?.musicSetShuffle(on);
    if (!r?.success) {
      const msg = r?.error === "not_running" ? "当前没有在播放音乐" : r?.error || "设置随机播放失败";
      return { success: false, data: null, displayText: msg };
    }
    return { success: true, data: { shuffle: on }, displayText: on ? "已开启随机播放" : "已关闭随机播放" };
  },
};

export const setMusicVolumeTool: ToolDefinition = {
  name: "set_music_volume",
  description: "Set VLC playback volume. Accepts 0–100 (percentage).",
  parameters: {
    type: "object",
    properties: {
      volume: {
        type: "number",
        description: "Volume level 0–100.",
      },
    },
    required: ["volume"],
    additionalProperties: false,
  },
  readOnly: false,

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const v = Math.max(0, Math.min(100, Number(args.volume) || 0));
    const r = await window.electronAPI?.musicVolume(v);
    if (!r?.success) {
      const msg = r?.error === "not_running" ? "当前没有在播放音乐" : r?.error || "调整音量失败";
      return { success: false, data: null, displayText: msg };
    }
    return { success: true, data: { volume: v }, displayText: `音量已设为 ${v}%` };
  },
};
