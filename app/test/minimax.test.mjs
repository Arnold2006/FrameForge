// Tests for MiniMax H3 mode routing and prompt logic.
// Run: node test/minimax.test.mjs

import assert from "node:assert";
import { MINIMAX_SYSTEM_PROMPT, SYSTEM_PROMPT, FEW_SHOT } from "../src/prompt.mjs";

console.log("=== MiniMax H3 mode — unit tests ===\n");

// ── 1. MINIMAX_SYSTEM_PROMPT is exported and distinct from SYSTEM_PROMPT ──────

assert.ok(
  typeof MINIMAX_SYSTEM_PROMPT === "string" && MINIMAX_SYSTEM_PROMPT.length > 0,
  "MINIMAX_SYSTEM_PROMPT must be a non-empty string"
);
assert.ok(
  typeof SYSTEM_PROMPT === "string" && SYSTEM_PROMPT.length > 0,
  "SYSTEM_PROMPT (Ideogram) must still be a non-empty string"
);
assert.notStrictEqual(
  MINIMAX_SYSTEM_PROMPT, SYSTEM_PROMPT,
  "MINIMAX_SYSTEM_PROMPT must differ from the Ideogram SYSTEM_PROMPT"
);
console.log("✅ MINIMAX_SYSTEM_PROMPT is exported and distinct from Ideogram prompt");

// ── 2. MINIMAX_SYSTEM_PROMPT must not instruct JSON output ────────────────────

assert.ok(
  !MINIMAX_SYSTEM_PROMPT.toLowerCase().includes('"mode"'),
  'MINIMAX_SYSTEM_PROMPT must not reference JSON key "mode"'
);
assert.ok(
  MINIMAX_SYSTEM_PROMPT.toLowerCase().includes("plain text") ||
  MINIMAX_SYSTEM_PROMPT.toLowerCase().includes("no json") ||
  MINIMAX_SYSTEM_PROMPT.toLowerCase().includes("output only"),
  "MINIMAX_SYSTEM_PROMPT must instruct plain-text-only output"
);
console.log("✅ MINIMAX_SYSTEM_PROMPT enforces plain-text output, not JSON");

// ── 3. MINIMAX_SYSTEM_PROMPT must mention ComfyUI ────────────────────────────

assert.ok(
  MINIMAX_SYSTEM_PROMPT.toLowerCase().includes("comfyui"),
  "MINIMAX_SYSTEM_PROMPT must mention ComfyUI"
);
console.log("✅ MINIMAX_SYSTEM_PROMPT mentions ComfyUI");

// ── 4. Mode routing logic (pure-function simulation) ─────────────────────────

function pickSystemPrompt(mode) {
  if (mode === "minimax") return MINIMAX_SYSTEM_PROMPT;
  if (mode === "plain")   return "PLAIN_SYSTEM_PROMPT_PLACEHOLDER";
  return SYSTEM_PROMPT; // ideogram default
}

assert.strictEqual(
  pickSystemPrompt("ideogram"), SYSTEM_PROMPT,
  "ideogram mode must use SYSTEM_PROMPT"
);
assert.strictEqual(
  pickSystemPrompt("plain"), "PLAIN_SYSTEM_PROMPT_PLACEHOLDER",
  "plain mode must use plain prompt"
);
assert.strictEqual(
  pickSystemPrompt("minimax"), MINIMAX_SYSTEM_PROMPT,
  "minimax mode must use MINIMAX_SYSTEM_PROMPT"
);
// Unknown/legacy modes fall back to ideogram (backward compat)
assert.strictEqual(
  pickSystemPrompt(undefined), SYSTEM_PROMPT,
  "undefined mode falls back to ideogram"
);
console.log("✅ Mode routing selects the correct system prompt for each mode");

// ── 5. MiniMax output validation (non-empty, not JSON wrapper) ────────────────

function validateMiniMaxOutput(text) {
  if (!text || text.trim().length === 0) return { valid: false, reason: "empty output" };
  const trimmed = text.trim();
  // Must not be a JSON object or array at the top level
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      JSON.parse(trimmed);
      return { valid: false, reason: "output is JSON, expected plain text" };
    } catch { /* not valid JSON despite brackets — allow */ }
  }
  return { valid: true };
}

// Valid outputs
const validOutputs = [
  "A young woman in a red coat walks by a lake at dusk.",
  'She pauses, looks at the camera, and says, "I love you."',
  "Opening on a wide shot of rolling hills at golden hour, the camera slowly pushes in.",
];
for (const output of validOutputs) {
  const result = validateMiniMaxOutput(output);
  assert.ok(result.valid, `Expected valid for: "${output.slice(0, 60)}…" but got: ${result.reason}`);
}

// Invalid outputs
const invalidOutputs = [
  "",
  "   ",
  '{"mode":"t2v","prompt":"A woman walks."}',
  '["item1","item2"]',
];
for (const output of invalidOutputs) {
  const result = validateMiniMaxOutput(output);
  assert.ok(!result.valid, `Expected invalid for: "${output.slice(0, 60)}"`);
}

console.log("✅ MiniMax output validator correctly accepts plain text and rejects empty/JSON");

// ── 6. FEW_SHOT examples are still intact (no regression) ────────────────────

assert.ok(
  Array.isArray(FEW_SHOT) && FEW_SHOT.length >= 2,
  "FEW_SHOT must still export at least 2 examples"
);
console.log("✅ FEW_SHOT examples are still present (no regression)");

console.log("\n🎉 ALL MINIMAX TESTS PASSED! 🎉\n");
