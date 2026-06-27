
import https from "node:https";
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

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "node" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) return resolve(get(res.headers.location));
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const doGet = (u) => {
      https.get(u, { headers: { "User-Agent": "node" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return doGet(res.headers.location);
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
        file.on("error", reject);
      }).on("error", reject);
    };
    doGet(url);
  });
}

console.log("Fetching latest llama.cpp release tag...");
const release = JSON.parse(await get("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"));
const tag = release.tag_name;
console.log(`Latest release: ${tag}`);

const zipUrl = `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/llama-${tag}-bin-win-avx2-x64.zip`;
console.log(`Downloading ${zipUrl} ...`);
await download(zipUrl, zipPath);
console.log("Download complete, extracting...");

fs.mkdirSync(binDir, { recursive: true });
execSync(
  `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${binDir}' -Force"`,
  { stdio: "inherit" }
);
fs.unlinkSync(zipPath);
console.log(`Done — llama-server.exe is in ${binDir}`);
