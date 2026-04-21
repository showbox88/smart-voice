import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Music,
  RefreshCw,
  Loader2,
  Search,
  Tag,
  FolderOpen,
  AlertCircle,
  X,
  Check,
} from "lucide-react";
import { cn } from "./lib/utils";

type Track = {
  id: string;
  rel: string;
  name: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  duration_sec: number | null;
  mood: string | null;
  tags: string[];
  user_meta: Record<string, string | null>;
};

type IndexShape = {
  version: number;
  root: string;
  scanned_at: string;
  tracks: Track[];
};

// Mood presets — a small curated list matching common agent prompts
// ("播放轻柔的歌" etc). Users can still type a custom value.
const MOOD_PRESETS = [
  { value: "gentle", label: "轻柔" },
  { value: "chill", label: "舒缓" },
  { value: "upbeat", label: "欢快" },
  { value: "energetic", label: "动感" },
  { value: "focus", label: "专注" },
  { value: "sad", label: "悲伤" },
  { value: "party", label: "派对" },
  { value: "sleep", label: "助眠" },
];

function formatDuration(sec: number | null): string {
  if (!sec || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function effective(track: Track, field: "genre" | "artist" | "album"): string {
  const u = track.user_meta?.[field];
  if (u) return u;
  return track[field] || "";
}

export default function MusicLibraryView() {
  const [folder, setFolder] = useState<string>("");
  const [index, setIndex] = useState<IndexShape | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(
    null
  );
  const [error, setError] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [moodFilter, setMoodFilter] = useState<string>("");
  const [editing, setEditing] = useState<{ id: string; field: "genre" | "mood" | "tags" } | null>(
    null
  );
  const [draft, setDraft] = useState<string>("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const f = (await window.electronAPI?.getMusicFolder?.()) || "";
      setFolder(f);
      if (!f) {
        setIndex(null);
        return;
      }
      const r = await window.electronAPI?.musicGetIndex?.();
      if (r?.success && r.exists && r.index) {
        setIndex(r.index);
      } else {
        setIndex(null);
      }
    } catch (err) {
      setError((err as Error)?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Live progress events from main while scanning.
  useEffect(() => {
    const off = window.electronAPI?.onMusicScanProgress?.((p) => setProgress(p));
    return () => {
      if (typeof off === "function") off();
    };
  }, []);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setError("");
    setProgress(null);
    try {
      const r = await window.electronAPI?.musicScan?.();
      if (!r?.success) {
        setError(r?.error || "扫描失败");
        return;
      }
      await reload();
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, [reload]);

  const startEdit = (track: Track, field: "genre" | "mood" | "tags") => {
    setEditing({ id: track.id, field });
    if (field === "genre") setDraft(effective(track, "genre"));
    else if (field === "mood") setDraft(track.mood || "");
    else if (field === "tags") setDraft((track.tags || []).join(", "));
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
  };

  const commitEdit = useCallback(async () => {
    if (!editing || !index) return;
    const { id, field } = editing;
    setSavingId(id);
    try {
      let patch: {
        mood?: string | null;
        tags?: string[];
        user_meta?: Record<string, string | null>;
      } = {};
      if (field === "mood") {
        patch = { mood: draft.trim() || null };
      } else if (field === "tags") {
        patch = {
          tags: draft
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean),
        };
      } else if (field === "genre") {
        // genre lives in user_meta so we don't overwrite the ID3-read value
        // but still take precedence at read time. Empty clears the override.
        patch = { user_meta: { genre: draft.trim() || null } };
      }
      const r = await window.electronAPI?.musicUpdateTrack?.(id, patch);
      if (r?.success) {
        // Apply patch locally so UI is snappy without a full reload.
        setIndex((prev) => {
          if (!prev) return prev;
          const tracks = prev.tracks.map((t) => {
            if (t.id !== id) return t;
            const next = { ...t };
            if (field === "mood") next.mood = patch.mood ?? null;
            if (field === "tags") next.tags = patch.tags || [];
            if (field === "genre") {
              next.user_meta = { ...(next.user_meta || {}) };
              if (patch.user_meta?.genre) next.user_meta.genre = patch.user_meta.genre;
              else delete next.user_meta.genre;
            }
            return next;
          });
          return { ...prev, tracks };
        });
        setEditing(null);
        setDraft("");
      } else {
        setError(r?.error || "保存失败");
      }
    } finally {
      setSavingId(null);
    }
  }, [editing, draft, index]);

  const tracks = index?.tracks || [];
  // Group by artist (empty artists last), then album, then name.
  const sortedTracks = useMemo(() => {
    const cmp = (a: string, b: string) => a.localeCompare(b, "zh", { sensitivity: "base" });
    return [...tracks].sort((a, b) => {
      const aArtist = effective(a, "artist");
      const bArtist = effective(b, "artist");
      if (!aArtist && bArtist) return 1;
      if (aArtist && !bArtist) return -1;
      const byArtist = cmp(aArtist, bArtist);
      if (byArtist !== 0) return byArtist;
      const byAlbum = cmp(effective(a, "album"), effective(b, "album"));
      if (byAlbum !== 0) return byAlbum;
      return cmp(a.name || "", b.name || "");
    });
  }, [tracks]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortedTracks.filter((t) => {
      if (moodFilter && (t.mood || "") !== moodFilter) return false;
      if (!q) return true;
      const hay = [
        t.name,
        t.rel,
        effective(t, "artist"),
        effective(t, "album"),
        effective(t, "genre"),
        t.mood || "",
        ...(t.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sortedTracks, query, moodFilter]);

  const lastScanText = index?.scanned_at
    ? new Date(index.scanned_at).toLocaleString()
    : "尚未扫描";

  return (
    <div className="h-full w-full overflow-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Music size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">音乐库</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {folder ? (
                <>
                  <FolderOpen size={11} className="inline -mt-0.5 mr-1" />
                  {folder} · 上次扫描: {lastScanText}
                </>
              ) : (
                <span className="text-amber-500">
                  <AlertCircle size={11} className="inline -mt-0.5 mr-1" />
                  未设置音乐文件夹 —— 请到「智能家居」配置
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={handleScan}
          disabled={!folder || scanning}
          className={cn(
            "h-9 px-4 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
            scanning || !folder
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          {scanning ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          {scanning ? "扫描中..." : index ? "重新扫描" : "扫描音乐库"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive flex items-center gap-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {scanning && progress && (
        <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between mb-1">
            <span className="truncate max-w-[70%]">{progress.current}</span>
            <span>
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {!index && !loading && folder && !scanning && (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          还没有索引文件 —— 点击右上角「扫描音乐库」开始
        </div>
      )}

      {index && (
        <>
          {/* Filter bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                placeholder="搜索曲名 / 艺术家 / 类型 / 标签"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full h-8 pl-8 pr-2.5 text-xs rounded-md border border-border bg-transparent outline-none focus:border-primary/50"
              />
            </div>
            <select
              value={moodFilter}
              onChange={(e) => setMoodFilter(e.target.value)}
              className="h-8 px-2 text-xs rounded-md border border-border bg-transparent outline-none focus:border-primary/50"
            >
              <option value="">全部心情</option>
              {MOOD_PRESETS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground ml-auto">
              共 {tracks.length} 首 · 筛选后 {filtered.length} 首
            </span>
          </div>

          {/* Track table */}
          <div className="rounded-md border border-border overflow-hidden">
            <div className="grid grid-cols-[1fr_160px_140px_120px_120px_180px_60px] gap-2 px-3 py-2 bg-surface-2/60 text-xs font-medium text-muted-foreground border-b border-border">
              <div>曲名</div>
              <div>艺术家</div>
              <div>专辑</div>
              <div>类型</div>
              <div>心情</div>
              <div>标签</div>
              <div className="text-right">时长</div>
            </div>
            <div className="max-h-[calc(100vh-320px)] overflow-auto">
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  {tracks.length === 0 ? "索引为空" : "没有匹配的曲目"}
                </div>
              ) : (
                filtered.map((track) => {
                  const isEditingGenre = editing?.id === track.id && editing.field === "genre";
                  const isEditingMood = editing?.id === track.id && editing.field === "mood";
                  const isEditingTags = editing?.id === track.id && editing.field === "tags";
                  const saving = savingId === track.id;
                  return (
                    <div
                      key={track.id}
                      className="grid grid-cols-[1fr_160px_140px_120px_120px_180px_60px] gap-2 px-3 py-2 text-xs border-b border-border/50 hover:bg-surface-2/30 items-center"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{track.name}</div>
                        <div className="truncate text-[10px] text-muted-foreground/70">
                          {track.rel}
                        </div>
                      </div>
                      <div className="truncate text-muted-foreground">
                        {effective(track, "artist") || "—"}
                      </div>
                      <div className="truncate text-muted-foreground">
                        {effective(track, "album") || "—"}
                      </div>

                      {/* Genre — inline editable */}
                      <div>
                        {isEditingGenre ? (
                          <EditCell
                            draft={draft}
                            onDraft={setDraft}
                            onCommit={commitEdit}
                            onCancel={cancelEdit}
                            saving={saving}
                            placeholder="pop / rock..."
                          />
                        ) : (
                          <button
                            onClick={() => startEdit(track, "genre")}
                            className="w-full h-6 px-2 text-left rounded hover:bg-foreground/5 truncate text-muted-foreground"
                          >
                            {effective(track, "genre") || (
                              <span className="text-muted-foreground/40">+ 添加</span>
                            )}
                          </button>
                        )}
                      </div>

                      {/* Mood — inline editable w/ datalist for presets */}
                      <div>
                        {isEditingMood ? (
                          <EditCell
                            draft={draft}
                            onDraft={setDraft}
                            onCommit={commitEdit}
                            onCancel={cancelEdit}
                            saving={saving}
                            placeholder="gentle..."
                            list="mood-presets"
                          />
                        ) : (
                          <button
                            onClick={() => startEdit(track, "mood")}
                            className="w-full h-6 px-2 text-left rounded hover:bg-foreground/5 truncate text-muted-foreground"
                          >
                            {track.mood ? (
                              MOOD_PRESETS.find((m) => m.value === track.mood)?.label || track.mood
                            ) : (
                              <span className="text-muted-foreground/40">+ 添加</span>
                            )}
                          </button>
                        )}
                      </div>

                      {/* Tags — comma-separated inline */}
                      <div>
                        {isEditingTags ? (
                          <EditCell
                            draft={draft}
                            onDraft={setDraft}
                            onCommit={commitEdit}
                            onCancel={cancelEdit}
                            saving={saving}
                            placeholder="标签,逗号分隔"
                          />
                        ) : (
                          <button
                            onClick={() => startEdit(track, "tags")}
                            className="w-full h-6 px-2 text-left rounded hover:bg-foreground/5 truncate flex items-center gap-1"
                          >
                            {track.tags && track.tags.length > 0 ? (
                              <>
                                <Tag size={10} className="text-muted-foreground shrink-0" />
                                <span className="truncate text-muted-foreground">
                                  {track.tags.join(", ")}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground/40">+ 添加</span>
                            )}
                          </button>
                        )}
                      </div>

                      <div className="text-right text-muted-foreground tabular-nums">
                        {formatDuration(track.duration_sec)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Datalist for mood autocomplete */}
          <datalist id="mood-presets">
            {MOOD_PRESETS.map((m) => (
              <option key={m.value} value={m.value} />
            ))}
          </datalist>
        </>
      )}

      {loading && !index && (
        <div className="p-8 text-center text-xs text-muted-foreground">
          <Loader2 size={16} className="inline animate-spin mr-2" />
          加载中...
        </div>
      )}
    </div>
  );
}

// Small inline-edit cell: input with enter-to-save, esc-to-cancel, auto-focus.
function EditCell({
  draft,
  onDraft,
  onCommit,
  onCancel,
  saving,
  placeholder,
  list,
}: {
  draft: string;
  onDraft: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  saving: boolean;
  placeholder?: string;
  list?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div className="flex items-center gap-1">
      <input
        ref={ref}
        type="text"
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          else if (e.key === "Escape") onCancel();
        }}
        placeholder={placeholder}
        list={list}
        disabled={saving}
        className="flex-1 min-w-0 h-6 px-2 text-xs rounded border border-primary/40 bg-transparent outline-none focus:border-primary"
      />
      <button
        onClick={onCommit}
        disabled={saving}
        className="shrink-0 h-6 w-6 rounded hover:bg-primary/10 text-primary flex items-center justify-center"
        aria-label="保存"
      >
        {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
      </button>
      <button
        onClick={onCancel}
        disabled={saving}
        className="shrink-0 h-6 w-6 rounded hover:bg-foreground/5 text-muted-foreground flex items-center justify-center"
        aria-label="取消"
      >
        <X size={11} />
      </button>
    </div>
  );
}
