#!/usr/bin/env node
// Transform a run-v*.json from eval-router.mjs into a review-friendly markdown
// table so the user can eyeball intent / skill / slots / latency and mark
// corrections in the 复核 column.

import { readFileSync, writeFileSync } from "node:fs";

const inputPath = process.argv[2] || "docs/skill-router/run-v5-2026-04-20.json";
const outputPath = process.argv[3] || "docs/skill-router/review-table-v5-2026-04-20.md";
const csvPath = outputPath.replace(/\.md$/, ".csv");

const data = JSON.parse(readFileSync(inputPath, "utf8"));

function compactSlots(s) {
  if (!s || typeof s !== "object") return "";
  const parts = Object.entries(s).map(([k, v]) => {
    if (typeof v === "string") return `${k}:"${v}"`;
    return `${k}:${JSON.stringify(v)}`;
  });
  return parts.join(", ");
}

function cell(x) {
  return String(x ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

const rows = [...data.rows].sort((a, b) => a.n - b.n);

const lines = [];
lines.push(`# Router ${data.variant} · 124 条复核表 (${new Date().toISOString().slice(0, 10)})`);
lines.push("");
lines.push(`- 模型: \`${data.model}\` · 端点: \`${data.endpoint}\``);
lines.push(`- 准确率: **${data.pass}/${data.total} (${((data.pass / data.total) * 100).toFixed(1)}%)**`);
lines.push(`- 延迟 ms: min=${data.latencies.min} p50=${data.latencies.p50} avg=${data.latencies.avg} p95=${data.latencies.p95} max=${data.latencies.max}`);
lines.push("");
lines.push("> 复核列说明：如果模型输出与你心目中的真实意图一致，留空或 ✓。不一致就在「真实意图」列写下你希望的 intent/skill/slots，我会据此调 prompt 或接受新的期望值。");
lines.push("");
lines.push("| # | 句子 | 模型 intent | 模型 skill | 模型 slots | 延迟 ms | 我的预期 | 判定 | 真实意图（你填） |");
lines.push("|---|------|-------------|------------|-----------|--------:|---------|:----:|-----------------|");

for (const r of rows) {
  const gotIntent = r.json?.intent ?? "(no-json)";
  const gotSkill = r.json?.skill ?? (r.json?.intent === "chat" || r.json?.intent === "unclear" ? "—" : "—");
  const gotSlots = compactSlots(r.json?.slots);
  const want = r.want;
  const wantStr = want.intent === "action"
    ? `${want.intent}/${want.skill}${want.slots ? ` {${compactSlots(want.slots)}}` : ""}${want.alt ? ` · alt:${want.alt.join(",")}` : ""}`
    : `${want.intent}${want.alt ? ` · alt:${want.alt.join(",")}` : ""}`;
  const mark = r.result.pass ? "✓" : "✗";
  const reason = r.result.pass ? "" : ` (${r.result.reason})`;

  lines.push(`| ${r.n} | ${cell(r.q)} | ${cell(gotIntent)} | ${cell(gotSkill)} | ${cell(gotSlots) || "—"} | ${r.latency} | ${cell(wantStr)}${reason} | ${mark} | |`);
}

lines.push("");
lines.push("## 分布");
lines.push("");
const byIntent = rows.reduce((acc, r) => {
  const k = r.json?.intent ?? "no-json";
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});
for (const [k, v] of Object.entries(byIntent).sort((a, b) => b[1] - a[1])) {
  lines.push(`- \`${k}\`: ${v}`);
}

lines.push("");
lines.push("## 失败项（我的预期 ≠ 模型输出）");
lines.push("");
const fails = rows.filter((r) => !r.result.pass);
if (fails.length === 0) {
  lines.push("_无_");
} else {
  for (const r of fails) {
    lines.push(`- **#${r.n}** 「${r.q}」 — 预期 \`${r.want.intent}${r.want.skill ? "/" + r.want.skill : ""}\`，模型返回 \`${r.json?.intent}${r.json?.skill ? "/" + r.json.skill : ""}\` · ${r.result.reason}`);
  }
}

writeFileSync(outputPath, lines.join("\n") + "\n");
console.log(`Wrote ${outputPath}`);

// ---- CSV for Google Sheets (File → Import → Upload) ----
function csvCell(x) {
  const s = String(x ?? "");
  // RFC 4180: quote if contains comma, quote, newline, or leading/trailing space
  if (/[",\n\r]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const csvHeader = [
  "#",
  "句子",
  "模型_intent",
  "模型_skill",
  "模型_slots",
  "延迟_ms",
  "预期_intent",
  "预期_skill",
  "预期_slots",
  "判定",
  "失败原因",
  "真实意图(你填)",
].map(csvCell).join(",");

const csvLines = [csvHeader];
for (const r of rows) {
  const got = r.json || {};
  const want = r.want || {};
  csvLines.push([
    r.n,
    r.q,
    got.intent ?? "",
    got.skill ?? "",
    compactSlots(got.slots),
    r.latency,
    want.intent ?? "",
    want.skill ?? "",
    compactSlots(want.slots),
    r.result.pass ? "PASS" : "FAIL",
    r.result.pass ? "" : r.result.reason,
    "",
  ].map(csvCell).join(","));
}

// BOM for Excel compatibility; Google Sheets reads UTF-8 either way.
writeFileSync(csvPath, "\ufeff" + csvLines.join("\r\n") + "\r\n");
console.log(`Wrote ${csvPath}`);
