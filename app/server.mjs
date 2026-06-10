// Ideoprompt — local Ideogram 4 JSON prompt generator.
//
// Pipeline per request:
//   1. Grammar-constrained generation (node-llama-cpp GBNF grammar compiled
//      from generation-schema.mjs) — structure, key order and types are
//      enforced at the token-sampling level.
//   2. Deterministic normalization (normalize.mjs) — hex case, bbox clamping,
//      palette caps, variant conflicts, canonical key order.
//   3. AJV validation against the full official schema + key-order checks
//      (validate.mjs). Only valid captions are returned; one automatic
//      regeneration is attempted on the rare residual failure.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLlama, LlamaChatSession } from "node-llama-cpp";
import { GENERATION_SCHEMA } from "./src/generation-schema.mjs";
import { normalizeCaption, serializeCaption } from "./src/normalize.mjs";
import { validateCaption } from "./src/validate.mjs";
import { SYSTEM_PROMPT, FEW_SHOT } from "./src/prompt.mjs";
import { IDEOGRAM_SCHEMA } from "./src/ideogram-schema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8123;
const HOST = "127.0.0.1";
const CONTEXT_SIZE = Number(process.env.CONTEXT_SIZE) || 8192;
const MAX_ATTEMPTS = 2;

function resolveModelPath() {
  if (process.env.MODEL_PATH) return path.resolve(process.env.MODEL_PATH);
  const modelsDir = path.join(__dirname, "models");
  const ggufs = fs.existsSync(modelsDir)
    ? fs.readdirSync(modelsDir).filter((f) => f.toLowerCase().endsWith(".gguf")).sort()
    : [];
  if (ggufs.length === 0) {
    console.error(
      "No .gguf model found in app/models/. Run the install script, or set MODEL_PATH."
    );
    process.exit(1);
  }
  return path.join(modelsDir, ggufs[0]);
}

const modelPath = resolveModelPath();
console.log(`Loading model: ${path.basename(modelPath)} ...`);

const llama = await getLlama();
const model = await llama.loadModel({ modelPath });
const grammar = await llama.createGrammarForJsonSchema(GENERATION_SCHEMA);
console.log(`Model loaded (gpu: ${llama.gpu || "cpu"})`);

// One generation at a time — keeps memory bounded and avoids GPU contention.
let queue = Promise.resolve();
function enqueue(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

function buildChatHistory() {
  const history = [{ type: "system", text: SYSTEM_PROMPT }];
  for (const [user, response] of FEW_SHOT) {
    history.push({ type: "user", text: user });
    history.push({ type: "model", response: [response] });
  }
  return history;
}

async function generateOnce(description, { temperature, onTextChunk }) {
  const context = await model.createContext({ contextSize: CONTEXT_SIZE });
  try {
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt: SYSTEM_PROMPT
    });
    session.setChatHistory(buildChatHistory());
    const text = await session.prompt(description, {
      grammar,
      temperature,
      maxTokens: 3000,
      onTextChunk
    });
    return text;
  } finally {
    await context.dispose();
  }
}

async function generateCaption(description, emit) {
  let lastErrors = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) emit({ type: "retry", attempt, errors: lastErrors });

    let prompt = description;
    if (lastErrors.length > 0) {
      prompt +=
        "\n\n(Your previous answer had these problems, fix them: " +
        lastErrors.join("; ") +
        ")";
    }

    const started = Date.now();
    const text = await generateOnce(prompt, {
      temperature: attempt === 1 ? 0.7 : 0.3,
      onTextChunk: (chunk) => emit({ type: "chunk", text: chunk })
    });

    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      lastErrors = ["output was not parseable JSON"];
      continue;
    }

    const normalized = normalizeCaption(raw);
    if (!normalized.ok) {
      lastErrors = [normalized.reason];
      continue;
    }

    const { valid, errors } = validateCaption(normalized.value);
    if (!valid) {
      lastErrors = errors;
      continue;
    }

    emit({
      type: "done",
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
    message: "Could not produce a valid caption after " + MAX_ATTEMPTS + " attempts.",
    errors: lastErrors
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(path.join(__dirname, "public", "index.html")).pipe(res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      status: "ok",
      model: path.basename(modelPath),
      gpu: llama.gpu || "cpu"
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/schema") {
    sendJson(res, 200, IDEOGRAM_SCHEMA);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/generate") {
    let description;
    try {
      const body = JSON.parse(await readBody(req));
      description = typeof body.description === "string" ? body.description.trim() : "";
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }
    if (!description) {
      sendJson(res, 400, { error: "missing 'description'" });
      return;
    }

    // NDJSON stream: {type:"chunk"|"retry"|"done"|"error", ...} per line.
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no"
    });
    const emit = (event) => res.write(JSON.stringify(event) + "\n");
    try {
      await enqueue(() => generateCaption(description, emit));
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
