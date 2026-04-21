const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const debugLogger = require("./debugLogger");

const INDEX_FILENAME = ".openwhispr-music-index.json";
const ARCHIVE_FILENAME = ".openwhispr-music-archive.json";
const INDEX_VERSION = 1;
const AUDIO_EXTS = new Set([
  ".mp3",
  ".flac",
  ".m4a",
  ".aac",
  ".wav",
  ".ogg",
  ".opus",
  ".wma",
]);

// music-metadata is an ESM package. We load it lazily via dynamic import so the
// main bundle (still CommonJS) can require this helper synchronously.
let _mmModule = null;
async function loadMusicMetadata() {
  if (_mmModule) return _mmModule;
  _mmModule = await import("music-metadata");
  return _mmModule;
}

function normalizeSep(p) {
  return p.replace(/\\/g, "/");
}

// 6-hex-char ID from sha1 of the relative path (normalized). Stable across
// rescans — if a file's rel path doesn't change, its ID doesn't either. So
// user_meta written against an ID survives rescans, file renames within the
// library, and library moves.
function deriveId(relPath) {
  const h = crypto.createHash("sha1").update(normalizeSep(relPath)).digest("hex");
  return h.slice(0, 6);
}

function indexPath(root) {
  return path.join(root, INDEX_FILENAME);
}

function archivePath(root) {
  return path.join(root, ARCHIVE_FILENAME);
}

async function walkDir(dir, out, rootLen, depth = 0) {
  if (depth > 12) return;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, out, rootLen, depth + 1);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (AUDIO_EXTS.has(ext)) {
        const rel = normalizeSep(full.slice(rootLen));
        out.push({ full, rel });
      }
    }
  }
}

async function readJsonSafe(p) {
  try {
    const raw = await fs.promises.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonAtomic(p, data) {
  const tmp = p + ".tmp";
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.promises.rename(tmp, p);
}

function basenameNoExt(rel) {
  const last = rel.split("/").pop() || rel;
  return last.replace(/\.[^.]+$/, "");
}

async function extractMetadata(filePath) {
  try {
    const mm = await loadMusicMetadata();
    const meta = await mm.parseFile(filePath, { duration: true });
    const common = meta.common || {};
    return {
      title: common.title || null,
      artist: common.artist || null,
      album: common.album || null,
      genre: Array.isArray(common.genre) && common.genre.length ? common.genre[0] : null,
      year: common.year || null,
      duration_sec:
        typeof meta.format?.duration === "number"
          ? Math.round(meta.format.duration)
          : null,
    };
  } catch (err) {
    debugLogger.debug("[music-index] metadata extract failed", {
      file: filePath,
      error: err?.message,
    });
    return {
      title: null,
      artist: null,
      album: null,
      genre: null,
      year: null,
      duration_sec: null,
    };
  }
}

async function loadIndex(root) {
  if (!root) return null;
  return readJsonSafe(indexPath(root));
}

// Rebuild the index from disk. Existing user_meta and mood/tags are preserved
// for files whose rel path is unchanged. Dropped files (and their user_meta)
// are moved into the archive file so a user's manual tags aren't lost if they
// accidentally remove-and-readd the same file later.
async function scan(root, { onProgress } = {}) {
  if (!root) return { success: false, error: "missing_root" };
  if (!fs.existsSync(root)) return { success: false, error: "root_not_found" };

  const previous = (await loadIndex(root)) || { tracks: [] };
  const previousById = new Map();
  for (const t of previous.tracks || []) {
    if (t && t.id) previousById.set(t.id, t);
  }

  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  const found = [];
  await walkDir(root, found, rootWithSep.length);
  // Exclude our own index files if they happen to match the audio filter
  // (they don't, but be defensive).
  const filtered = found.filter(
    (f) => f.rel !== INDEX_FILENAME && f.rel !== ARCHIVE_FILENAME
  );
  filtered.sort((a, b) => a.rel.localeCompare(b.rel));

  const tracks = [];
  const seenIds = new Set();
  const total = filtered.length;
  let done = 0;

  for (const { full, rel } of filtered) {
    const id = deriveId(rel);
    seenIds.add(id);
    const prev = previousById.get(id);
    const meta = await extractMetadata(full);
    const name = meta.title || basenameNoExt(rel);
    const track = {
      id,
      rel,
      name,
      artist: meta.artist,
      album: meta.album,
      genre: meta.genre,
      year: meta.year,
      duration_sec: meta.duration_sec,
      // user_meta wins over ID3 values at read time; keep it intact across rescans.
      user_meta: prev?.user_meta && typeof prev.user_meta === "object" ? prev.user_meta : {},
      tags: Array.isArray(prev?.tags) ? prev.tags : [],
      mood: prev?.mood ?? null,
    };
    tracks.push(track);
    done++;
    if (typeof onProgress === "function") {
      try {
        onProgress({ done, total, current: rel });
      } catch {
        /* ignore */
      }
    }
  }

  // Tracks that disappeared — archive any with user-provided data so we can
  // restore them if the file reappears later.
  const archived = [];
  for (const [id, prev] of previousById) {
    if (seenIds.has(id)) continue;
    const hasUserData =
      (prev.user_meta && Object.keys(prev.user_meta).length > 0) ||
      (Array.isArray(prev.tags) && prev.tags.length > 0) ||
      prev.mood;
    if (hasUserData) archived.push({ ...prev, archived_at: new Date().toISOString() });
  }
  if (archived.length > 0) {
    const existingArchive = (await readJsonSafe(archivePath(root))) || { tracks: [] };
    const keepIds = new Set(existingArchive.tracks.map((t) => t.id));
    for (const t of archived) {
      if (!keepIds.has(t.id)) existingArchive.tracks.push(t);
    }
    await writeJsonAtomic(archivePath(root), existingArchive);
  }

  const index = {
    version: INDEX_VERSION,
    root,
    scanned_at: new Date().toISOString(),
    tracks,
  };
  await writeJsonAtomic(indexPath(root), index);

  return {
    success: true,
    total: tracks.length,
    added: tracks.filter((t) => !previousById.has(t.id)).length,
    removed: archived.length,
  };
}

// Patch the user_meta / mood / tags for a single track. Returns the updated
// track, or an error if the track id isn't in the index.
async function updateTrack(root, id, patch) {
  if (!root) return { success: false, error: "missing_root" };
  if (!id) return { success: false, error: "missing_id" };
  const index = await loadIndex(root);
  if (!index) return { success: false, error: "no_index" };
  const track = (index.tracks || []).find((t) => t.id === id);
  if (!track) return { success: false, error: "track_not_found" };

  if (patch && typeof patch === "object") {
    if (typeof patch.mood === "string" || patch.mood === null) {
      track.mood = patch.mood || null;
    }
    if (Array.isArray(patch.tags)) {
      track.tags = patch.tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim());
    }
    if (patch.user_meta && typeof patch.user_meta === "object") {
      track.user_meta = { ...(track.user_meta || {}), ...patch.user_meta };
      // Explicit null clears a field.
      for (const k of Object.keys(patch.user_meta)) {
        if (patch.user_meta[k] === null) delete track.user_meta[k];
      }
    }
  }

  await writeJsonAtomic(indexPath(root), index);
  return { success: true, track };
}

// Return the effective value of a field, preferring user_meta override over
// the scanned ID3 value. Used by callers that want "the genre the user sees".
function effectiveField(track, field) {
  if (!track) return null;
  const user = track.user_meta && track.user_meta[field];
  if (user !== undefined && user !== null && user !== "") return user;
  return track[field] ?? null;
}

module.exports = {
  INDEX_FILENAME,
  INDEX_VERSION,
  deriveId,
  loadIndex,
  scan,
  updateTrack,
  effectiveField,
};
