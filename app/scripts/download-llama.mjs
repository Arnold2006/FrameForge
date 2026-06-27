// Downloads the latest pre-built llama.cpp Windows CUDA 12.4 binaries from GitHub.
// Also downloads the matching cudart DLLs so CUDA works without a full toolkit install.
// Extracts everything to app/bin/ — server.mjs looks for llama-server.exe there.
import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");
const binDir = path.join(appDir, "bin");

if (fs.existsSync(path.join(binDir, "llama-server.exe"))) {
  console.log("llama-server.exe already present, skipping download.");
  process.exit(0);
}

function getText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, { headers: { "User-Agent": "node" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) return resolve(getText(res.headers.location));
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function downloadFile(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) return reject(new Error("Too many redirects"));
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, { headers: { "User-Agent": "node" } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        return resolve(downloadFile(res.headers.location, dest, redirectCount + 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const total = parseInt(res.headers["content-length"] || "0", 10);
      let received = 0;
      const file = fs.createWriteStream(dest);
      res.on("data", (chunk) => {
        received += chunk.length;
        file.write(chunk);
        if (total) process.stdout.write(`\r  ${(received / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB`);
      });
      res.on("end", () => { file.close(() => { console.log(""); resolve(); }); });
      res.on("error", (e) => { file.close(); fs.unlink(dest, () => {}); reject(e); });
      file.on("error", (e) => { fs.unlink(dest, () => {}); reject(e); });
    }).on("error", reject);
  });
}

function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`,
    { stdio: "inherit" }
  );
  fs.unlinkSync(zipPath);
}

function findExe(dir, name) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) { const r = findExe(full, name); if (r) return r; }
    if (f.name.toLowerCase() === name.toLowerCase()) return full;
  }
  return null;
}

function hoistToBinRoot(binDir) {
  const found = findExe(binDir, "llama-server.exe");
  if (!found) throw new Error("llama-server.exe not found after extraction!");
  const subDir = path.dirname(found);
  if (subDir !== binDir) {
    console.log(`  Hoisting files from subdirectory to bin/`);
    for (const f of fs.readdirSync(subDir)) {
      const src = path.join(subDir, f);
      const dst = path.join(binDir, f);
      // Don't overwrite files already hoisted (e.g. from cudart zip)
      if (!fs.existsSync(dst)) fs.renameSync(src, dst);
      else fs.unlinkSync(src);
    }
    fs.rmSync(subDir, { recursive: true, force: true });
  }
}

// ── fetch release info ────────────────────────────────────────────────────────
console.log("Fetching latest llama.cpp release info...");
const release = JSON.parse(await getText("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"));
console.log(`Latest release: ${release.tag_name}`);

// ── find CUDA 12.4 main binary zip ───────────────────────────────────────────
// Matches: llama-bXXXX-bin-win-cuda-12.4-x64.zip  (not cudart-)
const cudaAsset = release.assets.find(a =>
  a.name.endsWith(".zip") &&
  a.name.includes("win") &&
  a.name.includes("cuda-12.4") &&
  a.name.includes("x64") &&
  !a.name.startsWith("cudart-")
);

if (!cudaAsset) {
  console.error("Available assets:\n" + release.assets.map(a => a.name).join("\n"));
  throw new Error("Could not find a CUDA 12.4 Windows x64 zip. Check the asset list above.");
}

// ── find cudart DLL zip (needed if CUDA toolkit isn't installed) ──────────────
const cudartAsset = release.assets.find(a =>
  a.name.startsWith("cudart-") &&
  a.name.includes("cuda-12.4") &&
  a.name.includes("win") &&
  a.name.endsWith(".zip")
);

// ── download & extract main binary ───────────────────────────────────────────
const cudaZip = path.join(appDir, "llama-cuda.zip");
console.log(`\nDownloading CUDA binary: ${cudaAsset.name}`);
await downloadFile(cudaAsset.browser_download_url, cudaZip);
const cudaSizeMB = fs.statSync(cudaZip).size / 1024 / 1024;
console.log(`  Size on disk: ${cudaSizeMB.toFixed(1)} MB`);
if (cudaSizeMB < 10) throw new Error("CUDA zip too small — download failed");

console.log("  Extracting...");
extractZip(cudaZip, binDir);
hoistToBinRoot(binDir);

// ── download & extract cudart DLLs ───────────────────────────────────────────
if (cudartAsset) {
  const cudartZip = path.join(appDir, "llama-cudart.zip");
  console.log(`\nDownloading CUDA runtime DLLs: ${cudartAsset.name}`);
  await downloadFile(cudartAsset.browser_download_url, cudartZip);
  const cudartSizeMB = fs.statSync(cudartZip).size / 1024 / 1024;
  console.log(`  Size on disk: ${cudartSizeMB.toFixed(1)} MB`);
  if (cudartSizeMB < 5) throw new Error("cudart zip too small — download failed");
  console.log("  Extracting...");
  extractZip(cudartZip, binDir);
  // cudart zip extracts flat, no subdir to hoist
} else {
  console.warn("cudart zip not found in release — if llama-server fails to start, install CUDA 12.4 toolkit.");
}

console.log(`\nDone — llama-server.exe is ready in ${binDir}`);
console.log("GPU: CUDA 12.4 (RTX 3090 will use full VRAM acceleration)");
