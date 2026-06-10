module.exports = {
  requires: {
    bundle: "ai"
  },
  run: [
    // Install node dependencies (node-llama-cpp ships prebuilt llama.cpp
    // binaries for macOS/Windows/Linux — no compiler toolchain needed)
    {
      method: "shell.run",
      params: {
        path: "app",
        message: [
          "npm install"
        ]
      }
    },
    // Download the GGUF model (~2.5GB) into app/models
    {
      method: "hf.download",
      params: {
        path: "app",
        "_": ["unsloth/Qwen3-4B-Instruct-2507-GGUF", "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"],
        "local-dir": "models"
      }
    }
  ]
}
