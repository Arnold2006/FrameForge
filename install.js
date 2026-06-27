module.exports = {
  requires: {
    bundle: "ai"
  },
  run: [
    {
      method: "shell.run",
      params: {
        path: "app",
        message: ["npm install"]
      }
    },
    // Download the main model (~2.5 GB)
    {
      method: "hf.download",
      params: {
        path: "app",
        "_": ["noctrex/Huihui-Qwen3-VL-4B-Instruct-abliterated-GGUF", "Huihui-Qwen3-VL-4B-Instruct-abliterated-Q4_K_M.gguf"],
        "local-dir": "models"
      }
    },
    // Download the vision projector (~836 MB) — required for image input
    {
      method: "hf.download",
      params: {
        path: "app",
        "_": ["noctrex/Huihui-Qwen3-VL-4B-Instruct-abliterated-GGUF", "mmproj-F16.gguf"],
        "local-dir": "models"
      }
    }
  ]
}
