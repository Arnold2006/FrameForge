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
    // Download pre-built llama.cpp Windows binaries (includes llama-server.exe)
    // Uses GitHub API to get the latest release tag, then downloads the AVX2 zip
    {
      method: "shell.run",
      params: {
        path: "app",
        message: [
          "node -e \"" +
          "const https = require('https');" +
          "const fs = require('fs');" +
          "const path = require('path');" +
          "const { execSync } = require('child_process');" +
          "const req = https.get('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest', {headers:{'User-Agent':'node'}}, res => {" +
          "  let d=''; res.on('data',c=>d+=c); res.on('end',()=>{" +
          "    const tag = JSON.parse(d).tag_name;" +
          "    const url = 'https://github.com/ggml-org/llama.cpp/releases/download/'+tag+'/llama-'+tag+'-bin-win-avx2-x64.zip';" +
          "    console.log('Downloading',url);" +
          "    const file = fs.createWriteStream('llama-bin.zip');" +
          "    https.get(url,{headers:{'User-Agent':'node'}},r=>{" +
          "      if(r.statusCode===302||r.statusCode===301){" +
          "        https.get(r.headers.location,{headers:{'User-Agent':'node'}},r2=>{r2.pipe(file);file.on('finish',()=>{" +
          "          execSync('node -e \"const AdmZip=require(\\'adm-zip\\');const z=new AdmZip(\\'llama-bin.zip\\');z.extractAllTo(\\'bin\\',true);\"');" +
          "          console.log('Done');});});} else {r.pipe(file);file.on('finish',()=>{" +
          "          fs.mkdirSync('bin',{recursive:true});" +
          "          execSync('powershell -Command Expand-Archive -Path llama-bin.zip -DestinationPath bin -Force');" +
          "          console.log('Done');});}});" +
          "  });" +
          "}); req.on('error',e=>console.error(e));\""
        ]
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
    // Download the vision projector (~836 MB)
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
