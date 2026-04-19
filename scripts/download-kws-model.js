#!/usr/bin/env node
/**
 * Downloads the sherpa-onnx KWS (keyword spotting) model used by the wake-word feature.
 * Mirrors the pattern of download-minilm.js / download-qdrant.js.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { downloadFile } = require("./lib/download-utils");
const os = require("os");

const MODEL_NAME = "sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01";
const ARCHIVE = `${MODEL_NAME}.tar.bz2`;
const URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${ARCHIVE}`;

function getCacheDir() {
  const homeDir = os.homedir();
  return path.join(homeDir, ".cache", "openwhispr", "kws-models");
}

function extractTarBz2(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const cwd = path.dirname(archivePath);
  execFileSync("tar", ["-xjf", path.basename(archivePath), "-C", path.relative(cwd, destDir)], {
    stdio: "inherit",
    cwd,
  });
}

async function main() {
  const modelsDir = getCacheDir();
  const modelDir = path.join(modelsDir, MODEL_NAME);
  const sentinelFile = path.join(modelDir, "encoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx");

  const isForce = process.argv.includes("--force");

  console.log(`[kws] Target: ${modelDir}`);

  if (fs.existsSync(sentinelFile) && !isForce) {
    console.log(`[kws] Model already exists (use --force to re-download)`);
    return;
  }

  fs.mkdirSync(modelsDir, { recursive: true });

  const archivePath = path.join(modelsDir, ARCHIVE);
  console.log(`[kws] Downloading from ${URL}`);
  await downloadFile(URL, archivePath);

  console.log(`[kws] Extracting to ${modelsDir}`);
  extractTarBz2(archivePath, modelsDir);

  fs.unlinkSync(archivePath);

  console.log(`[kws] Done.`);
}

module.exports = { getCacheDir, MODEL_NAME };

if (require.main === module) {
  main().catch((err) => {
    console.error(`[kws] Failed: ${err.message}`);
    process.exit(1);
  });
}
