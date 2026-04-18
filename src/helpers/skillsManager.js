const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const debugLogger = require("./debugLogger");

// Reads skill markdown files from two roots:
//   1. bundled default at <app>/skills/
//   2. user overrides at <userData>/skills/
// A skill with the same `name` in userData wins.
class SkillsManager {
  constructor({ bundledRoot, userRoot }) {
    this.bundledRoot = bundledRoot;
    this.userRoot = userRoot;
  }

  // Returns parsed skill definitions, JSON-serializable.
  // Each: { name, category, description, triggerPhrases, parameters,
  //         handler, responseMode, availability, body, source }
  async loadAll() {
    const bundled = await this._readDir(this.bundledRoot, "bundled");
    const user = await this._readDir(this.userRoot, "user");
    // User overrides take precedence.
    const merged = new Map();
    for (const s of bundled) merged.set(s.name, s);
    for (const s of user) merged.set(s.name, s);
    return Array.from(merged.values());
  }

  async _readDir(root, source) {
    if (!root) return [];
    try {
      const exists = await fs.promises
        .access(root)
        .then(() => true)
        .catch(() => false);
      if (!exists) return [];
    } catch {
      return [];
    }

    const skills = [];
    await this._walk(root, skills, source);
    return skills;
  }

  async _walk(dir, out, source) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      debugLogger.warn("[skills] cannot read dir", { dir, err: err.message });
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this._walk(full, out, source);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const parsed = await this._parseFile(full, source);
        if (parsed) out.push(parsed);
      }
    }
  }

  async _parseFile(filePath, source) {
    try {
      const raw = await fs.promises.readFile(filePath, "utf8");
      const { data, content } = matter(raw);
      if (!data || typeof data !== "object") return null;
      // Files with no frontmatter at all (e.g. README.md) are docs, not skills.
      if (Object.keys(data).length === 0) return null;
      if (!data.name || typeof data.name !== "string") {
        debugLogger.warn("[skills] skill missing `name`", { filePath });
        return null;
      }
      if (!data.handler || typeof data.handler !== "string") {
        debugLogger.warn("[skills] skill missing `handler`", { filePath, name: data.name });
        return null;
      }
      return {
        name: data.name,
        category: data.category || "misc",
        description: typeof data.description === "string" ? data.description.trim() : "",
        triggerPhrases: data.trigger_phrases || null,
        parameters: Array.isArray(data.parameters) ? data.parameters : [],
        handler: data.handler,
        responseMode: data.response_mode || "commentary",
        availability:
          data.availability && typeof data.availability === "object" ? data.availability : null,
        body: content || "",
        source,
        filePath,
      };
    } catch (err) {
      debugLogger.error("[skills] parse error", { filePath, err: err.message });
      return null;
    }
  }
}

module.exports = SkillsManager;
