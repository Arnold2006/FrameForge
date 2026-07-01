// Ideoprompt — local Ideogram 4 JSON prompt generator.
//
// Spawns llama-server (downloaded to app/bin/) as a subprocess with
// --mmproj so vision input works, then talks to its OpenAI-compatible API.
// The same normalize → validate pipeline is preserved.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeCaption, serializeCaption } from "./src/normalize.mjs";
import { validateCaption } from "./src/validate.mjs";
import { SYSTEM_PROMPT, FEW_SHOT } from "./src/prompt.mjs";
import { GENERATION_SCHEMA } from "./src/generation-schema.mjs";
import { IDEOGRAM_SCHEMA } from "./src/ideogram-schema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PLAIN_SYSTEM_PROMPT = `You are an expert prompt engineer for text-to-image AI models.
When given a description or reference image, write a single rich plain-text prompt optimised for models like Flux, SDXL, or similar diffusion models.

Rules:
- Output ONLY the prompt text itself — no preamble, no explanation, no quotes, no markdown
- Be highly descriptive: subject, style, lighting, mood, color palette, camera/lens feel, era
- Use natural flowing prose mixed with comma-separated descriptive phrases
- Aim for 60-120 words
- Do not mention Ideogram, JSON, or any schema`;
const PORT = Number(process.env.PORT) || 8123;
const HOST = "127.0.0.1";
const LLAMA_PORT = Number(process.env.LLAMA_PORT) || 8124;
const CONTEXT_SIZE = Number(process.env.CONTEXT_SIZE) || 8192;
const MAX_ATTEMPTS = 2;

// ── model / mmproj discovery ──────────────────────────────────────────────────
function resolveModels() {
  const modelsDir = path.join(__dirname, "models");
  if (!fs.existsSync(modelsDir)) {
    console.error("No models/ directory found. Run the install script first.");
    process.exit(1);
  }
  const files = fs.readdirSync(modelsDir);

  const modelFile = process.env.MODEL_PATH
    ? path.resolve(process.env.MODEL_PATH)
    : (() => {
        const f = files
          .filter(f => f.toLowerCase().endsWith(".gguf") && !f.toLowerCase().startsWith("mmproj"))
          .sort()[0];
        if (!f) { console.error("No model .gguf found in app/models/"); process.exit(1); }
        return path.join(modelsDir, f);
      })();

  const mmprojFile = process.env.MMPROJ_PATH
    ? path.resolve(process.env.MMPROJ_PATH)
    : (() => {
        const f = files
          .filter(f => f.toLowerCase().startsWith("mmproj") && f.toLowerCase().endsWith(".gguf"))
          .sort()[0];
        return f ? path.join(modelsDir, f) : null;
      })();

  return { modelFile, mmprojFile };
}

// ── find llama-server binary ──────────────────────────────────────────────────
function resolveLlamaServer() {
  // Prefer our downloaded binary in app/bin/
  const candidates = [
    path.join(__dirname, "bin", "llama-server.exe"), // Windows (downloaded)
    path.join(__dirname, "bin", "llama-server"),     // Linux/Mac (downloaded)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  console.error(
    "llama-server binary not found in app/bin/.\n" +
    "Run the install script to download it (scripts/download-llama.mjs)."
  );
  process.exit(1);
}

// ── spawn llama-server ────────────────────────────────────────────────────────
async function startLlamaServer(serverBin, modelFile, mmprojFile) {
  const args = [
    "--model", modelFile,
    "--ctx-size", String(CONTEXT_SIZE),
    "--port", String(LLAMA_PORT),
    "--host", "127.0.0.1",
    "--no-webui",
    "--jinja",
    "--flash-attn", "on",
    "--n-gpu-layers", "99",  // offload all layers to GPU (RTX 3090 has plenty of VRAM)
    "--parallel", "1",
    "--log-disable",
  ];

  if (mmprojFile) {
    args.push("--mmproj", mmprojFile);
    console.log(`Vision enabled: ${path.basename(mmprojFile)}`);
  } else {
    console.warn("No mmproj file found in models/ — image input will not work.");
  }

  console.log(`Starting llama-server on port ${LLAMA_PORT}…`);
  const proc = spawn(serverBin, args, { stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout.on("data", d => process.stdout.write(d));
  proc.stderr.on("data", d => process.stderr.write(d));
  proc.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`llama-server exited unexpectedly with code ${code}`);
      process.exit(1);
    }
  });

  // Wait until the server is accepting connections (up to 120s)
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("llama-server startup timeout after 120s")), 120_000);
    const check = async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/health`);
        if (r.ok) { clearTimeout(timeout); resolve(); return; }
      } catch {}
      setTimeout(check, 500);
    };
    proc.on("error", (err) => { clearTimeout(timeout); reject(err); });
    check();
  });

  process.on("exit", () => { try { proc.kill(); } catch {} });
  return proc;
}

// ── build messages for llama-server ──────────────────────────────────────────
function buildMessages(description, imageBase64, lastErrors, steering = "", aspectRatio = "1:1") {
  const [arW, arH] = aspectRatio.split(":").map(Number);
  // Scale the 1000x1000 grid to match the target aspect ratio
  const gridW = arW >= arH ? 1000 : Math.round(1000 * arW / arH);
  const gridH = arH >= arW ? 1000 : Math.round(1000 * arH / arW);
  const arNote = `\n\nTarget aspect ratio: ${aspectRatio} (bbox grid is ${gridW}\u00d7${gridH}, x in [0,${gridW}], y in [0,${gridH}]). Place and size all bboxes to suit this canvas shape.`;
  const styleNote = `\n\nYou MUST always include the "style_description" object in your output. It is required, never optional. Choose either the photograph variant (with fields: aesthetics, lighting, photo, medium="photograph", color_palette) or the art variant (with fields: aesthetics, lighting, medium, art_style, color_palette). Always populate all fields with rich, specific values. Never omit style_description.`;
  const sysPrompt = (steering ? SYSTEM_PROMPT + "\n\nAdditional style guidance:\n" + steering : SYSTEM_PROMPT) + styleNote + arNote;
  const messages = [{ role: "system", content: sysPrompt }];

  // Few-shot examples (text only)
  for (const [user, response] of FEW_SHOT) {
    messages.push({ role: "user", content: user });
    messages.push({ role: "assistant", content: response });
  }

  // Build the user turn
  const errorSuffix = lastErrors.length > 0
    ? "\n\n(Your previous answer had these problems, fix them: " + lastErrors.join("; ") + ")"
    : "";

  let userContent;
  if (imageBase64) {
    const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, "");
    userContent = [
      {
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${base64Data}` }
      },
      {
        type: "text",
        text: (description
          ? `Analyse this image and use it as the subject. Additional context from user: ${description}`
          : "Analyse this image carefully and generate a detailed Ideogram 4 JSON prompt for it."
        ) + errorSuffix
      }
    ];
  } else {
    userContent = description + errorSuffix;
  }

  messages.push({ role: "user", content: userContent });
  return messages;
}

// ── build messages for plain text mode ───────────────────────────────────────
function buildPlainMessages(description, imageBase64, aspectRatio = "1:1") {
  const arNote = `\n\nTarget image aspect ratio: ${aspectRatio}. Keep composition descriptions appropriate for this shape.`;
  const sysPrompt = PLAIN_SYSTEM_PROMPT + arNote;
  const messages = [{ role: "system", content: sysPrompt }];
  let userContent;
  if (imageBase64) {
    const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, "");
    userContent = [
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
      { type: "text", text: description
          ? `Analyse this image and write a prompt for it. Extra context: ${description}`
          : "Analyse this image and write a detailed text-to-image prompt for it." }
    ];
  } else {
    userContent = `Write a text-to-image prompt for: ${description}`;
  }
  messages.push({ role: "user", content: userContent });
  return messages;
}

// ── call llama-server via OpenAI-compatible streaming API ─────────────────────
async function callLlamaServer(messages, temperature, onChunk) {
  const res = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "local",
      messages,
      temperature,
      max_tokens: 3000,
      stream: true,
      response_format: {
        type: "json_schema",
        json_schema: { name: "ideogram_prompt", schema: GENERATION_SCHEMA, strict: true }
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`llama-server error ${res.status}: ${err}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const evt = JSON.parse(data);
        const chunk = evt.choices?.[0]?.delta?.content ?? "";
        if (chunk) { fullText += chunk; onChunk(chunk); }
      } catch {}
    }
  }
  return fullText;
}

// ── plain text streaming call (no grammar constraint) ────────────────────────
async function callLlamaServerPlain(messages, onChunk) {
  const res = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "local",
      messages,
      temperature: 0.8,
      max_tokens: 512,
      stream: true
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`llama-server error ${res.status}: ${err}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", fullText = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const evt = JSON.parse(data);
        const chunk = evt.choices?.[0]?.delta?.content ?? "";
        if (chunk) { fullText += chunk; onChunk(chunk); }
      } catch {}
    }
  }
  return fullText.trim();
}

// ── plain text generation pipeline ───────────────────────────────────────────
async function generatePlain(description, imageBase64, emit, aspectRatio = "1:1") {
  const started = Date.now();
  const messages = buildPlainMessages(description, imageBase64, aspectRatio);
  let text;
  try {
    text = await callLlamaServerPlain(
      messages,
      (chunk) => emit({ type: "chunk", text: chunk })
    );
  } catch (err) {
    emit({ type: "error", message: String(err?.message || err) });
    return;
  }
  emit({
    type: "done",
    mode: "plain",
    text,
    duration_ms: Date.now() - started
  });
}

// ── main generation pipeline ──────────────────────────────────────────────────
async function generateCaption(description, imageBase64, emit, aspectRatio = "1:1") {
  let lastErrors = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) emit({ type: "retry", attempt, errors: lastErrors });

    const messages = buildMessages(description, imageBase64, lastErrors, aspectRatio);
    const started = Date.now();

    let text;
    try {
      text = await callLlamaServer(
        messages,
        attempt === 1 ? 0.7 : 0.3,
        (chunk) => emit({ type: "chunk", text: chunk })
      );
    } catch (err) {
      emit({ type: "error", message: String(err?.message || err) });
      return;
    }

    let raw;
    try { raw = JSON.parse(text); }
    catch { lastErrors = ["output was not parseable JSON"]; continue; }

    const normalized = normalizeCaption(raw);
    if (!normalized.ok) { lastErrors = [normalized.reason]; continue; }

    const { valid, errors } = validateCaption(normalized.value);
    if (!valid) { lastErrors = errors; continue; }

    emit({
      type: "done",
      mode: "ideogram",
      prompt: normalized.value,
      prompt_compact: serializeCaption(normalized.value),
      valid: true,
      attempts: attempt,
      duration_ms: Date.now() - started
    });
    return;
  }

  emit({
    type: "error",
    message: `Could not produce a valid caption after ${MAX_ATTEMPTS} attempts.`,
    errors: lastErrors
  });
}

// ── batch folder captioning ──────────────────────────────────────────────────
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);
const IMAGE_MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif"
};

// Runs a single-image generation (ideogram or plain) and resolves with the
// final "done"/"error" event, while forwarding every event to forwardEmit.
function generateForFile(reqMode, imageBase64, aspectRatio, forwardEmit) {
  return new Promise((resolve) => {
    let resultEvent = null;
    const emit = (event) => {
      forwardEmit(event);
      if (event.type === "done" || event.type === "error") resultEvent = event;
    };
    const job = reqMode === "plain"
      ? generatePlain("", imageBase64, emit, aspectRatio)
      : generateCaption("", imageBase64, emit, aspectRatio);
    job.then(() => resolve(resultEvent ?? { type: "error", message: "no result produced" }));
  });
}

async function generateFolder(folderPath, reqMode, aspectRatio, emit) {
  let entries;
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch (err) {
    emit({ type: "error", message: `Could not read folder: ${err.message}` });
    return;
  }

  const files = entries
    .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort();

  if (files.length === 0) {
    emit({ type: "error", message: "No supported image files found in folder." });
    return;
  }

  let succeeded = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    emit({ type: "file-start", file, index: i + 1, total: files.length });

    const ext = path.extname(file).toLowerCase();
    const base = file.slice(0, -ext.length);
    const filePath = path.join(folderPath, file);

    let imageBase64;
    try {
      const buf = fs.readFileSync(filePath);
      imageBase64 = `data:${IMAGE_MIME_TYPES[ext] || "image/jpeg"};base64,${buf.toString("base64")}`;
    } catch (err) {
      failed++;
      emit({ type: "file-error", file, message: `Could not read file: ${err.message}` });
      continue;
    }

    const forwardEmit = (event) => emit({ ...event, file });
    const result = await generateForFile(reqMode, imageBase64, aspectRatio, forwardEmit);

    if (result.type === "error") {
      failed++;
      emit({ type: "file-error", file, message: result.message });
      continue;
    }

    const isPlain = result.mode === "plain";
    const content = isPlain ? result.text : JSON.stringify(result.prompt, null, 2);
    const outName = base + (isPlain ? ".txt" : ".json");
    const outPath = path.join(folderPath, outName);
    try {
      fs.writeFileSync(outPath, content, "utf8");
    } catch (err) {
      failed++;
      emit({ type: "file-error", file, message: `Could not write caption: ${err.message}` });
      continue;
    }

    succeeded++;
    emit({ type: "file-done", file, outFile: outName, duration_ms: result.duration_ms });
  }

  emit({ type: "batch-done", total: files.length, succeeded, failed });
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

// One generation at a time — keeps memory bounded
let queue = Promise.resolve();
function enqueue(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

// ── startup ───────────────────────────────────────────────────────────────────
const { modelFile, mmprojFile } = resolveModels();
const serverBin = resolveLlamaServer();
console.log(`Model:  ${path.basename(modelFile)}`);
console.log(`Binary: ${serverBin}`);

await startLlamaServer(serverBin, modelFile, mmprojFile);
console.log("llama-server ready.");

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(path.join(__dirname, "public", "index.html")).pipe(res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    try {
      const h = await fetch(`http://127.0.0.1:${LLAMA_PORT}/health`);
      const hj = await h.json();
      sendJson(res, 200, {
        status: hj.status ?? "ok",
        model: path.basename(modelFile),
        mmproj: mmprojFile ? path.basename(mmprojFile) : null,
        vision: !!mmprojFile
      });
    } catch {
      sendJson(res, 503, { status: "starting" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/schema") {
    sendJson(res, 200, IDEOGRAM_SCHEMA);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/generate") {
    let description, imageBase64 = null, reqMode = "ideogram", aspectRatio = "1:1";
    try {
      const body = JSON.parse(await readBody(req));
      description = typeof body.description === "string" ? body.description.trim() : "";
      if (typeof body.image === "string" && body.image.length > 0) imageBase64 = body.image;
      if (body.mode === "plain") reqMode = "plain";
      if (typeof body.aspectRatio === "string") aspectRatio = body.aspectRatio;
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }
    if (!description && !imageBase64) {
      sendJson(res, 400, { error: "provide 'description', 'image' (base64), or both" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no"
    });
    const emit = (event) => res.write(JSON.stringify(event) + "\n");
    try {
      if (reqMode === "plain") {
        await enqueue(() => generatePlain(description, imageBase64, emit, aspectRatio));
      } else {
        await enqueue(() => generateCaption(description, imageBase64, emit, aspectRatio));
      }
    } catch (err) {
      emit({ type: "error", message: String(err?.message || err) });
    }
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/generate-folder") {
    let folderPath, reqMode = "ideogram", aspectRatio = "1:1";
    try {
      const body = JSON.parse(await readBody(req));
      folderPath = typeof body.folderPath === "string" ? body.folderPath.trim() : "";
      if (body.mode === "plain") reqMode = "plain";
      if (typeof body.aspectRatio === "string") aspectRatio = body.aspectRatio;
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }
    if (!folderPath) {
      sendJson(res, 400, { error: "provide 'folderPath'" });
      return;
    }
    const resolvedPath = path.resolve(folderPath);
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
      sendJson(res, 400, { error: "folderPath is not an existing directory" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no"
    });
    const emit = (event) => res.write(JSON.stringify(event) + "\n");
    try {
      await enqueue(() => generateFolder(resolvedPath, reqMode, aspectRatio, emit));
    } catch (err) {
      emit({ type: "error", message: String(err?.message || err) });
    }
    res.end();
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Ideoprompt running at http://${HOST}:${PORT}`);
});
