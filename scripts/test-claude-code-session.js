// One-off manual test: verify ClaudeCodeSession spawns claude CLI, parses
// stream-json, emits events, and preserves session across turns.
//
// Run from repo root:
//   node scripts/test-claude-code-session.js "what is 2+2"

const path = require("path");

// Stub out debugLogger so we can run outside Electron.
require.cache[require.resolve(path.join(__dirname, "..", "src", "helpers", "debugLogger"))] = {
  exports: {
    log: (...a) => console.log("[log]", ...a),
    warn: (...a) => console.warn("[warn]", ...a),
    error: (...a) => console.error("[err]", ...a),
  },
};

const ClaudeCodeSession = require("../src/helpers/claudeCodeSession");

async function main() {
  const prompt = process.argv[2] || "reply with exactly: 一二三";
  const session = new ClaudeCodeSession({ cwd: path.resolve(__dirname, "..") });

  session.on("turn-start", (e) => console.log("→ turn-start:", e));
  session.on("assistant-text", (e) => process.stdout.write(e.text));
  session.on("sentence", (e) => console.log("\n  [sentence]", e.text));
  session.on("tool-use", (e) => console.log("\n  [tool-use]", e.name, JSON.stringify(e.input).slice(0, 120)));
  session.on("tool-result", (e) => console.log("  [tool-result]", e));
  session.on("turn-end", (e) => console.log("\n✓ turn-end:", e));
  session.on("error", (e) => console.error("✗ error:", e));

  console.log(`\n--- Turn 1: ${prompt} ---`);
  try {
    const r = await session.send(prompt);
    console.log("result:", r);
  } catch (err) {
    console.error("turn 1 failed:", err.message);
    process.exit(1);
  }

  console.log(`\n--- Turn 2: what did I just ask? ---`);
  try {
    const r = await session.send("what did I just ask you? answer in one short sentence.");
    console.log("result:", r);
  } catch (err) {
    console.error("turn 2 failed:", err.message);
    process.exit(1);
  }
}

main();
