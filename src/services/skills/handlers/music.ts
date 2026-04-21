import type { ToolResult } from "../../tools/ToolRegistry";

// Cross-turn state: the tracks the user last saw via list_music, in display
// order. Lets `play_music` resolve "第 3 首" / "play number 3" to the right
// path without shoving the whole list into the LLM prompt. Preloaded from the
// index at chat mount so a cold "播放第三首" works without a prior list call.
// `id` is the stable 6-char sha1 from the index (absent for fallback file-walk
// entries, where no index exists yet); `meta` carries the raw track fields
// used by mood/tag/genre filtering.
type Entry = {
  id: string | null;
  name: string;
  path: string;
  meta: {
    artist: string | null;
    album: string | null;
    genre: string | null;
    mood: string | null;
    tags: string[];
    user_meta: Record<string, string | null>;
  } | null;
};
let lastListed: Entry[] = [];

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

// Build the canonical display-ordered list: prefer the persistent index (has
// ID3 titles + user_meta overrides), fall back to a live walk. Sorts by
// artist → album → name, empty-artist tracks last. Shared by both `list()`
// and `play()`-with-number so the numbering stays consistent across turns.
async function loadEntries(): Promise<
  { ok: true; entries: Entry[]; root: string } | { ok: false; error: string }
> {
  const api = window.electronAPI;
  if (!api?.musicList) return { ok: false, error: "音乐功能不可用" };

  let entries: Entry[] = [];
  let root = "";
  if (api.musicGetIndex) {
    try {
      const idxR = await api.musicGetIndex();
      if (idxR?.success && idxR.exists && idxR.index) {
        root = idxR.index.root || "";
        const tracks = [...(idxR.index.tracks || [])];
        const cmp = (a: string, b: string) =>
          a.localeCompare(b, "zh", { sensitivity: "base" });
        tracks.sort((a, b) => {
          const aArtist = (a.user_meta?.artist as string | undefined) || a.artist || "";
          const bArtist = (b.user_meta?.artist as string | undefined) || b.artist || "";
          if (!aArtist && bArtist) return 1;
          if (aArtist && !bArtist) return -1;
          const byArtist = cmp(aArtist, bArtist);
          if (byArtist !== 0) return byArtist;
          const byAlbum = cmp(a.album || "", b.album || "");
          if (byAlbum !== 0) return byAlbum;
          return cmp(a.name || "", b.name || "");
        });
        const sep = root.includes("\\") ? "\\" : "/";
        const prefix = root && !root.endsWith(sep) ? root + sep : root;
        entries = tracks.map((t) => {
          const artist = (t.user_meta?.artist as string | undefined) || t.artist;
          return {
            id: t.id,
            name: artist ? `${t.name} — ${artist}` : t.name,
            path: prefix + t.rel.replace(/\//g, sep),
            meta: {
              artist: t.artist,
              album: t.album,
              genre: t.genre,
              mood: (t.user_meta?.mood as string | undefined) || t.mood,
              tags: Array.isArray(t.tags) ? t.tags : [],
              user_meta: t.user_meta || {},
            },
          };
        });
      }
    } catch {
      /* fall through to live walk */
    }
  }

  if (entries.length === 0) {
    const r = await fetchFiles();
    if (!r.ok) return { ok: false, error: r.error };
    root = r.root;
    entries = r.files.map((f) => ({
      id: null,
      name: shortRelPath(f, r.root),
      path: f,
      meta: null,
    }));
  }

  return { ok: true, entries, root };
}

// Collapse every "label-like" field on a track into one lowercased haystack:
// mood, tags, genre, plus any user_meta values. Used so a single user word
// like "欢快" matches regardless of whether the user put it under mood or
// tag in the library UI, and regardless of which slot the LLM classified
// it into.
function labelHaystack(e: Entry): string {
  if (!e.meta) return "";
  const m = e.meta;
  const parts: string[] = [];
  if (m.mood) parts.push(m.mood);
  if (m.genre) parts.push(m.genre);
  if (Array.isArray(m.tags)) parts.push(...m.tags);
  for (const [k, v] of Object.entries(m.user_meta || {})) {
    if (typeof v !== "string") continue;
    if (k === "artist" || k === "album" || k === "title") continue; // handled separately
    // user_meta.tags may be a CSV string
    parts.push(...v.split(","));
  }
  return parts.map((s) => s.trim().toLowerCase()).filter(Boolean).join(" | ");
}

// Filter entries by metadata slots. `mood` and `tag` are both treated as
// "label-like" — they match against the unified haystack (mood + tags +
// genre + user_meta values), because the distinction between the two
// columns in the UI is a labelling choice the LLM can't reliably guess.
// `genre` and `artist` stay strict (their columns are semantically
// narrower). Entries with no meta (live-walk fallback) are skipped when
// any meta filter is set.
function filterByMeta(
  entries: Entry[],
  filters: { mood?: string; tag?: string; genre?: string; artist?: string }
): Entry[] {
  const mood = filters.mood?.trim().toLowerCase() || "";
  const tag = filters.tag?.trim().toLowerCase() || "";
  const genre = filters.genre?.trim().toLowerCase() || "";
  const artist = filters.artist?.trim().toLowerCase() || "";
  if (!mood && !tag && !genre && !artist) return entries;
  return entries.filter((e) => {
    if (!e.meta) return false;
    const m = e.meta;
    const hay = labelHaystack(e);
    if (mood && !hay.includes(mood)) return false;
    if (tag && !hay.includes(tag)) return false;
    if (genre) {
      const v = (m.genre || "").toLowerCase();
      if (!v.includes(genre) && !hay.includes(genre)) return false;
    }
    if (artist) {
      const v = (m.artist || "").toLowerCase();
      if (!v.includes(artist)) return false;
    }
    return true;
  });
}

// Populates `lastListed` in the background. Called on module import so a
// cold "播放第 3 首" resolves immediately without requiring a prior list turn.
// Safe to call multiple times; last write wins. Fire-and-forget — failures
// are swallowed since `play()` will lazy-load on its own if cache is still
// empty at use time.
export function preloadLibrary(): void {
  loadEntries()
    .then((r) => {
      if (r.ok) lastListed = r.entries;
    })
    .catch(() => {
      /* ignore — lazy fallback covers this */
    });
}

// Fire at module import. Only runs when window.electronAPI is available
// (i.e. in the renderer), so no-op in any SSR/test environment.
if (typeof window !== "undefined" && window.electronAPI) {
  preloadLibrary();
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

  // Number picker — "播放第 3 首" / "play number 3". Short-circuits everything
  // else; resolves against lastListed (preloaded at chat mount).
  const rawNumber = args.number ?? args.index ?? args.track_number;
  const pickNumber = (() => {
    if (typeof rawNumber === "number" && Number.isFinite(rawNumber)) return Math.trunc(rawNumber);
    if (typeof rawNumber === "string" && rawNumber.trim()) {
      const n = parseInt(rawNumber.trim(), 10);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  })();

  if (pickNumber !== null) {
    if (lastListed.length === 0) {
      const r = await loadEntries();
      if (!r.ok) return { success: false, data: null, displayText: r.error };
      if (r.entries.length === 0) {
        return { success: false, data: null, displayText: "音乐文件夹里没有音频文件" };
      }
      lastListed = r.entries;
    }
    if (pickNumber < 1 || pickNumber > lastListed.length) {
      return {
        success: false,
        data: null,
        displayText: `列表里只有 ${lastListed.length} 首，没有第 ${pickNumber} 首。`,
      };
    }
    const picked = lastListed[pickNumber - 1];
    return playPaths([picked], false, `正在播放：第 ${pickNumber} 首 · ${picked.name}`);
  }

  // "上次那首" / "play last song" — resolve via agent-state.
  const lastPlayedFlag =
    args.last_played === true ||
    args.last_played === "true" ||
    args.lastPlayed === true ||
    args.lastPlayed === "true";
  if (lastPlayedFlag) {
    if (!api.agentStateGet) {
      return { success: false, data: null, displayText: "还没有记录过上次播放的曲目" };
    }
    const r = await loadEntries();
    if (!r.ok) return { success: false, data: null, displayText: r.error };
    const st = await api.agentStateGet();
    const lastId = (st?.state?.lastPlayedTrackId as string | undefined) || "";
    const lastPath = (st?.state?.lastPlayedPath as string | undefined) || "";
    let picked: Entry | undefined;
    if (lastId) picked = r.entries.find((e) => e.id === lastId);
    if (!picked && lastPath) picked = r.entries.find((e) => e.path === lastPath);
    if (!picked) {
      return { success: false, data: null, displayText: "还没有记录过上次播放的曲目" };
    }
    return playPaths([picked], false, `正在播放上次那首：${picked.name}`);
  }

  const query = (args.query as string | undefined)?.trim() || "";
  const mood = (args.mood as string | undefined)?.trim() || "";
  const tag = (args.tag as string | undefined)?.trim() || "";
  const genre = (args.genre as string | undefined)?.trim() || "";
  const artistSlot = (args.artist as string | undefined)?.trim() || "";
  const hasMetaFilter = Boolean(mood || tag || genre || artistSlot);
  const shuffle =
    args.shuffle === undefined ? !query || hasMetaFilter : Boolean(args.shuffle);

  // Meta-filtered path (mood / tag / genre / artist slot) — needs the index.
  if (hasMetaFilter) {
    const r = await loadEntries();
    if (!r.ok) return { success: false, data: null, displayText: r.error };
    let pool = filterByMeta(r.entries, { mood, tag, genre, artist: artistSlot });
    // If a free-text query was also given, narrow further by name match.
    if (query && pool.length > 0) {
      const q = normalize(query);
      pool = pool.filter((e) => normalize(e.name).includes(q));
    }
    if (pool.length === 0) {
      const label = [mood && `mood=${mood}`, tag && `tag=${tag}`, genre && `genre=${genre}`, artistSlot && `artist=${artistSlot}`]
        .filter(Boolean)
        .join(", ");
      return { success: false, data: null, displayText: `找不到符合条件的曲目（${label}）` };
    }
    const queue = shuffle ? shuffleInPlace([...pool]) : pool;
    return playPaths(queue, shuffle);
  }

  // Free-text path. If a query is given we try it against: (1) index labels
  // (mood/tag/genre) — a single word like "欢快" often ends up here when the
  // LLM didn't pick a specific slot; (2) filename + folder fuzzy match. If
  // no query, shuffle-play everything.
  const walk = await fetchFiles();
  if (!walk.ok) return { success: false, data: null, displayText: walk.error };
  if (walk.files.length === 0) {
    return { success: false, data: null, displayText: "音乐文件夹里没有音频文件" };
  }

  let toPlayQueue: Entry[] | null = null;
  let toPlayPaths: string[];
  if (query) {
    // Try label match first — user might've said "欢快" / "gentle" as a
    // plain query when they meant mood/tag.
    const idx = await loadEntries();
    if (idx.ok) {
      const labelMatches = filterByMeta(idx.entries, { tag: query });
      if (labelMatches.length > 0) toPlayQueue = labelMatches;
    }
    if (!toPlayQueue) {
      const { matches } = matchTracks(query, walk.files);
      if (matches.length === 0) {
        return { success: false, data: null, displayText: `找不到匹配「${query}」的曲目` };
      }
      toPlayPaths = matches;
    } else {
      toPlayPaths = toPlayQueue.map((e) => e.path);
    }
  } else {
    toPlayPaths = [...walk.files];
  }

  if (shuffle && toPlayPaths.length > 1) {
    if (toPlayQueue) shuffleInPlace(toPlayQueue);
    shuffleInPlace(toPlayPaths);
  }

  const result = await api.musicPlay(toPlayPaths);
  if (!result?.success) {
    return { success: false, data: null, displayText: playErrorText(result?.error) };
  }
  // Prefer the queue entry's name (has artist + ID3 title) over a raw
  // filename stripped from the VLC response.
  const firstEntry = toPlayQueue ? toPlayQueue[0] : null;
  const firstName = firstEntry
    ? firstEntry.name
    : result.playing
      ? shortRelPath(result.playing, walk.root)
      : "";
  const firstPath = firstEntry?.path || result.playing || toPlayPaths[0];
  writeLastPlayed(firstName, firstPath, firstEntry?.id ?? null);
  return {
    success: true,
    data: { firstTrack: firstName, queued: toPlayPaths.length, shuffle },
    displayText: `正在播放：${firstName}`,
  };
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function playErrorText(code: string | undefined): string {
  if (code === "vlc_not_found") return "找不到 VLC 播放器";
  if (code === "vlc_http_unreachable") return "VLC 启动了但 HTTP 接口无法连接";
  return code || "播放失败";
}

// Fire-and-forget: record the first track of the queue so "上次那首" works
// later. We store id + path + name + ISO timestamp. Failures are swallowed —
// the play already succeeded and this is bookkeeping.
function writeLastPlayed(name: string, filePath: string, id: string | null = null): void {
  const api = window.electronAPI;
  if (!api?.agentStateSet) return;
  const patch: Record<string, unknown> = {
    lastPlayedName: name,
    lastPlayedPath: filePath,
    lastPlayedAt: new Date().toISOString(),
  };
  if (id) patch.lastPlayedTrackId = id;
  api.agentStateSet(patch).catch(() => {
    /* best-effort only */
  });
}

// Shared "play this queue of entries" path used by number picker, last_played,
// and meta-filter branches. Writes lastPlayed on success.
async function playPaths(
  queue: Entry[],
  shuffle: boolean,
  successText?: string
): Promise<ToolResult> {
  const api = window.electronAPI;
  if (!api?.musicPlay) return { success: false, data: null, displayText: "音乐功能不可用" };
  const paths = queue.map((e) => e.path);
  const result = await api.musicPlay(paths);
  if (!result?.success) {
    return { success: false, data: null, displayText: playErrorText(result?.error) };
  }
  const first = queue[0];
  writeLastPlayed(first.name, first.path, first.id);
  return {
    success: true,
    data: { firstTrack: first.name, queued: paths.length, shuffle },
    displayText: successText || `正在播放：${first.name}`,
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
  const r = await loadEntries();
  if (!r.ok) return { success: false, data: null, displayText: r.error };
  const entries = r.entries;
  if (entries.length === 0) {
    lastListed = [];
    return { success: true, data: [], displayText: "音乐文件夹里没有音频文件" };
  }

  // Cache the list for follow-up "播放第 N 首" resolution. Stores every track
  // (not just the visible slice) so the user can reference a song by number
  // even if it scrolled off the inline preview.
  lastListed = entries;

  const total = entries.length;
  // Show up to 15 titles inline — more than that overwhelms the chat bubble
  // and the full list is available in the Music Library panel.
  const VISIBLE = 15;
  const visible = entries.slice(0, VISIBLE).map((e) => e.name);
  const header = `共 ${total} 首${total > VISIBLE ? `，前 ${VISIBLE} 首：` : "："}`;
  const body = visible.map((n, i) => `${i + 1}. ${n}`).join("\n");
  const extraNote = total > VISIBLE ? `\n…还有 ${total - VISIBLE} 首` : "";
  const prompt = `\n\n告诉我「播放第 N 首」，或说歌名/歌手，也可以说「全部播放」。`;
  return {
    success: true,
    data: entries.map((e) => e.name),
    displayText: `${header}\n${body}${extraNote}${prompt}`,
  };
}
