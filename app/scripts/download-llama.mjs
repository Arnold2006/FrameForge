import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");
const binDir = path.join(appDir, "bin");
const zipPath = path.join(appDir, "llama-bin.zip");

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

console.log("Fetching latest llama.cpp release info...");
const release = JSON.parse(await getText("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"));
console.log(`Latest release: ${release.tag_name}`);

// Find the Windows CPU zip asset — matches win-avx2 or win-cpu, x64
const asset = release.assets.find(a =>
  a.name.endsWith(".zip") &&
  a.name.includes("win") &&
  a.name.includes("x64") &&
  (a.name.includes("avx2") || a.name.includes("win-cpu")) &&
  !a.name.includes("cuda") &&
  !a.name.includes("vulkan")
);
if (!asset) {
  console.error("Available assets:", release.assets.map(a => a.name).join("\n"));
  throw new Error("Could not find a Windows CPU x64 zip in the release assets");
}

console.log(`Downloading: ${asset.name}`);
await downloadFile(asset.browser_download_url, zipPath);

const sizeMB = fs.statSync(zipPath).size / 1024 / 1024;
console.log(`Zip size: ${sizeMB.toFixed(1)} MB`);
if (sizeMB < 5) throw new Error("Zip too small — download failed");

console.log("Extracting...");
fs.mkdirSync(binDir, { recursive: true });
execSync(
  `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${binDir}' -Force"`,
  { stdio: "inherit" }
);
fs.unlinkSync(zipPath);

// Find llama-server.exe wherever it landed and hoist to bin/ root
function findExe(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) { const r = findExe(full); if (r) return r; }
    if (f.name.toLowerCase() === "llama-server.exe") return full;
  }
  return null;
}

const found = findExe(binDir);
if (!found) throw new Error("llama-server.exe not found after extraction!");

const subDir = path.dirname(found);
if (subDir !== binDir) {
  console.log(`Hoisting files from subdirectory to bin/`);
  for (const f of fs.readdirSync(subDir)) {
    fs.renameSync(path.join(subDir, f), path.join(binDir, f));
  }
  fs.rmSync(subDir, { recursive: true, force: true });
}

console.log(`Done — llama-server.exe is ready in ${binDir}`);
