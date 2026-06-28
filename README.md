# FrameForge

![screenshot.png](screenshot.png)

Describe an image — or upload a reference photo — and get a structured **Ideogram 4 JSON prompt** or a **plain text prompt** for models like Flux and SDXL, generated entirely on your machine.

FrameForge runs locally: the vision-language model (Huihui-Qwen3-VL-4B abliterated) is served via [llama-server](https://github.com/ggml-org/llama.cpp) with full GPU acceleration (CUDA 12.4).

---

# What it does

Ideogram 4 was trained on structured JSON captions. Feeding it a JSON caption gives far better controllability — spatial layout via bounding boxes, exact text rendering, color palette conditioning — than plain text. But the JSON has strict rules (required fields, strict key order, `[y_min, x_min, y_max, x_max]` 0–1000 bboxes, uppercase `#RRGGBB` hex colors, photo vs. art-style variants) and hand-writing it is error-prone.

FrameForge converts a plain description or reference image into a valid caption with a three-layer guarantee:

1. **Grammar-constrained decoding** — token sampling is constrained by a JSON schema grammar; the model cannot emit malformed JSON, wrong keys, wrong types, or skip required fields like `style_description`.
2. **Deterministic normalization** — hex colors are uppercased and de-duplicated, bboxes clamped and ordered, palette sizes capped, keys re-serialized in canonical order.
3. **Validation gate** — the result must pass AJV validation against the complete official JSON Schema before it is shown. On the rare failure the app regenerates automatically with the errors in context.

Schema reference: [Ideogram 4 prompting docs](https://github.com/ideogram-oss/ideogram4/blob/main/docs/prompting.md).

---

# Features

- **Image input** — drag & drop, paste from clipboard, or upload a reference image; the vision model analyses it and generates a prompt based on what it sees
- **Two output modes** — toggle between a structured Ideogram 4 JSON prompt and a plain text prompt optimised for Flux / SDXL style models
- **Interactive bbox editor** — drag elements to move them, pull the corner handle to resize; coordinates update live in the JSON view
- **Aspect ratio selector** — choose from 8 common presets (1:1, 4:3, 3:2, 16:9, 21:9, 2:3, 3:4, 9:16); the canvas reshapes instantly and the model is informed of the target ratio
- **Style steering** — expand the "Steer the style" panel and describe a mood, aesthetic, or era; the text is appended to the system prompt without breaking schema constraints
- **GPU accelerated** — runs on CUDA 12.4; an RTX 3090 generates a prompt in roughly 5–15 seconds

---

# Install

## 1. One-click install (recommended)

Install [Pinokio](https://pinokio.co), open this project, and click **Install**. Pinokio downloads Node.js dependencies, the llama-server binary, the model (~2.5 GB), and the vision projector (~836 MB) automatically, then gives you one-click **Start**, **Update**, and **Reset** buttons.

## 2. Manual install

Prerequisites: [Node.js](https://nodejs.org) ≥ 20.

```bash
cd app

# 1. Install Node dependencies
npm install

# 2. Download llama-server binary (CUDA 12.4 build for Windows)
node scripts/download-llama.mjs

# 3. Download the model and vision projector
hf download noctrex/Huihui-Qwen3-VL-4B-Instruct-abliterated-GGUF \
  Huihui-Qwen3-VL-4B-Instruct-abliterated-Q4_K_M.gguf --local-dir models

hf download noctrex/Huihui-Qwen3-VL-4B-Instruct-abliterated-GGUF \
  mmproj-F16.gguf --local-dir models

# 4. Start the server
node server.mjs
```

Then open http://127.0.0.1:8123.

---

# How to use

1. **Start** the app — llama-server loads the model onto your GPU and the web UI opens.
2. Optionally **upload a reference image** by dragging it onto the card, pasting from clipboard, or clicking the upload row.
3. Type an optional description, choose a **mode** (Ideogram 4 JSON or Plain text) and an **aspect ratio**, then click **Generate**.
4. When the **✓ Valid Ideogram 4 prompt** badge appears, the **bbox editor** shows each element's bounding box on the canvas. Drag to move, pull the corner to resize — coordinates update live.
5. Optionally expand **Steer the style** to add mood or aesthetic guidance before regenerating.
6. Click **Copy** to copy the prompt and paste it directly into Ideogram or your preferred T2I model.

Tips:
- Put text you want rendered in the image inside "double quotes" — it is copied into `text` elements literally.
- Name a medium ("photo", "watercolor", "pixel art", "logo") to steer `style_description`.
- The model always populates `style_description` (aesthetics, lighting, medium, color palette) — check this section first when tweaking results.

---

# API

The server runs on `127.0.0.1:8123` (or the port assigned by Pinokio).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/generate` | Body: `{"description":"...","image":"<base64>","mode":"ideogram\|plain","aspectRatio":"16:9","steering":"..."}`. Streams NDJSON events. |
| `GET` | `/api/health` | `{"status":"ok","model":"...","mmproj":"...","vision":true}` |
| `GET` | `/api/schema` | Full Ideogram 4 JSON Schema used for validation. |

### Streamed events

```
{"type":"chunk","text":"..."}          — token stream while generating
{"type":"retry","attempt":2,...}       — automatic retry on validation failure
{"type":"done","mode":"ideogram","prompt":{...},"prompt_compact":"...","valid":true,"duration_ms":4201}
{"type":"done","mode":"plain","text":"...","duration_ms":2109}
{"type":"error","message":"..."}
```

## curl

```bash
curl -s -X POST http://127.0.0.1:8123/api/generate \
  -H "Content-Type: application/json" \
  -d '{"description": "A cozy bookshop at dusk", "mode": "ideogram", "aspectRatio": "16:9"}' \
  | tail -1 | jq .prompt
```

## JavaScript

```javascript
const res = await fetch("http://127.0.0.1:8123/api/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    description: "A cozy bookshop at dusk",
    mode: "ideogram",
    aspectRatio: "16:9",
    steering: "warm amber tones, film photography feel"
  })
});
const lines = (await res.text()).trim().split("\n").map(JSON.parse);
const done = lines.find(e => e.type === "done");
console.log(done.prompt_compact); // compact JSON ready to paste
```

## Python

```python
import json, requests

res = requests.post(
    "http://127.0.0.1:8123/api/generate",
    json={"description": "A cozy bookshop at dusk", "mode": "plain"},
    stream=True,
)
for line in res.iter_lines():
    event = json.loads(line)
    if event["type"] == "done":
        print(event["text"])
```

---

# Project layout

```
frameforge/
├── app/
│   ├── server.mjs              # HTTP server + generation pipeline
│   ├── public/index.html       # Web UI (FrameForge)
│   ├── scripts/
│   │   └── download-llama.mjs  # Downloads llama-server CUDA binary
│   ├── src/
│   │   ├── ideogram-schema.mjs     # Official Ideogram 4 JSON Schema (AJV)
│   │   ├── generation-schema.mjs   # Grammar schema — all fields required
│   │   ├── normalize.mjs           # Deterministic canonicalization
│   │   ├── validate.mjs            # AJV + key-order validation gate
│   │   └── prompt.mjs              # System prompt + few-shot examples
│   ├── bin/                    # llama-server binary (downloaded by install)
│   └── models/                 # GGUF model + mmproj (downloaded by install)
├── install.js / start.js / update.js / reset.js
└── README.md
```

---

# Configuration

Environment variables read by `app/server.mjs`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8123` | Listen port (set automatically by Pinokio). |
| `LLAMA_PORT` | `8124` | Internal llama-server port. |
| `MODEL_PATH` | First `.gguf` in `app/models/` (non-mmproj) | Path to an alternative model file. |
| `MMPROJ_PATH` | First `mmproj*.gguf` in `app/models/` | Path to the vision projector. Without this, image input is disabled. |
| `CONTEXT_SIZE` | `8192` | Context window size. |
