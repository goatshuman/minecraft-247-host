import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import fs from "fs";
import path from "path";

// Path to mc-bot data directory (shared filesystem)
// cwd = /workspace/artifacts/api-server → ../../mc-bot/data = /workspace/mc-bot/data
const MC_DATA_DIR = path.join(process.cwd(), "..", "..", "mc-bot", "data");

function ensureDataDir() {
  fs.mkdirSync(MC_DATA_DIR, { recursive: true });
}

function uploadPageHtml(token: string, type: string): string {
  const label = type === "world" ? "🌍 World" : "🔧 Mods";
  const hint =
    type === "world"
      ? "Upload a .zip of your Minecraft world folder (must contain <code>level.dat</code> inside)"
      : "Upload a .zip of your mods folder (containing .jar files)";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Upload ${label}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
    .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:40px;max-width:480px;width:100%;text-align:center}
    h1{font-size:1.8rem;margin-bottom:8px;color:#58a6ff}
    .hint{color:#8b949e;font-size:.9rem;margin-bottom:28px;line-height:1.5}
    .drop-zone{border:2px dashed #30363d;border-radius:8px;padding:40px 20px;cursor:pointer;transition:all .2s;margin-bottom:20px}
    .drop-zone:hover,.drop-zone.drag{border-color:#58a6ff;background:#0d2137}
    .drop-zone .icon{font-size:3rem;margin-bottom:12px}
    .drop-zone p{color:#8b949e;font-size:.9rem}
    .drop-zone .filename{color:#58a6ff;font-weight:600;margin-top:8px;display:none}
    input[type=file]{display:none}
    .btn{background:#238636;color:#fff;border:none;border-radius:6px;padding:12px 28px;font-size:1rem;cursor:pointer;width:100%;transition:background .2s;font-weight:600}
    .btn:hover{background:#2ea043}
    .btn:disabled{background:#21262d;color:#6e7681;cursor:not-allowed}
    .progress-bar{background:#21262d;border-radius:6px;height:8px;margin-top:16px;overflow:hidden;display:none}
    .progress-fill{height:100%;background:#238636;width:0%;transition:width .3s}
    .status-msg{margin-top:16px;font-size:.9rem;color:#8b949e;min-height:24px}
    .success{color:#3fb950}.error{color:#f85149}
  </style>
</head>
<body>
  <div class="card">
    <h1>${label} Upload</h1>
    <p class="hint">${hint}</p>
    <div class="drop-zone" id="dropZone" onclick="document.getElementById('fileInput').click()">
      <div class="icon">📁</div>
      <p>Click or drag &amp; drop your .zip file here</p>
      <p class="filename" id="filename"></p>
    </div>
    <input type="file" id="fileInput" accept=".zip">
    <button class="btn" id="uploadBtn" onclick="doUpload()" disabled>Upload</button>
    <div class="progress-bar" id="progressBar"><div class="progress-fill" id="progressFill"></div></div>
    <p class="status-msg" id="statusMsg"></p>
  </div>
  <script>
    const dropZone=document.getElementById('dropZone'),fileInput=document.getElementById('fileInput'),uploadBtn=document.getElementById('uploadBtn'),statusMsg=document.getElementById('statusMsg'),progressBar=document.getElementById('progressBar'),progressFill=document.getElementById('progressFill'),filenameEl=document.getElementById('filename');
    let selectedFile=null;
    fileInput.addEventListener('change',()=>{if(fileInput.files[0])selectFile(fileInput.files[0]);});
    dropZone.addEventListener('dragover',e=>{e.preventDefault();dropZone.classList.add('drag');});
    dropZone.addEventListener('dragleave',()=>dropZone.classList.remove('drag'));
    dropZone.addEventListener('drop',e=>{e.preventDefault();dropZone.classList.remove('drag');if(e.dataTransfer.files[0])selectFile(e.dataTransfer.files[0]);});
    function selectFile(file){if(!file.name.endsWith('.zip')){statusMsg.textContent='❌ Please select a .zip file';statusMsg.className='status-msg error';return;}selectedFile=file;filenameEl.textContent=file.name+' ('+(file.size/1024/1024).toFixed(1)+' MB)';filenameEl.style.display='block';uploadBtn.disabled=false;statusMsg.textContent='';statusMsg.className='status-msg';}
    async function doUpload(){
      if(!selectedFile)return;
      uploadBtn.disabled=true;progressBar.style.display='block';statusMsg.textContent='Uploading...';statusMsg.className='status-msg';
      const xhr=new XMLHttpRequest();
      xhr.open('POST','/upload/file?token=${token}&type=${type}');
      xhr.setRequestHeader('Content-Type','application/octet-stream');
      xhr.upload.onprogress=e=>{if(e.lengthComputable){const pct=Math.round(e.loaded/e.total*100);progressFill.style.width=pct+'%';statusMsg.textContent='Uploading... '+pct+'%';}};
      xhr.onload=()=>{if(xhr.status===200){statusMsg.textContent='✅ Upload complete! The bot is now processing your ${type}. Check Discord for progress.';statusMsg.className='status-msg success';progressFill.style.width='100%';}else{statusMsg.textContent='❌ Upload failed: '+xhr.responseText;statusMsg.className='status-msg error';uploadBtn.disabled=false;}};
      xhr.onerror=()=>{statusMsg.textContent='❌ Network error. Please try again.';statusMsg.className='status-msg error';uploadBtn.disabled=false;};
      xhr.send(selectedFile);
    }
  </script>
</body>
</html>`;
}

const app: Express = express();

// ── Upload routes (before body parsers so we can handle raw binary) ────────────
app.get("/upload", (req: Request, res: Response) => {
  ensureDataDir();
  const token = req.query.token as string;
  const type = (req.query.type as string) || "world";
  const tokenFile = path.join(MC_DATA_DIR, `token_${token}.json`);
  if (!token || !fs.existsSync(tokenFile)) {
    res.status(400).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#0d1117;color:#f85149"><h2>❌ Invalid or expired upload link</h2><p style="color:#8b949e;margin-top:12px">Click Upload World/Mods again in Discord to get a new link.</p></body></html>`);
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(uploadPageHtml(token, type));
});

app.post("/upload/file", express.raw({ type: "application/octet-stream", limit: "2gb" }), (req: Request, res: Response) => {
  ensureDataDir();
  const token = req.query.token as string;
  const type = (req.query.type as string) || "world";
  const tokenFile = path.join(MC_DATA_DIR, `token_${token}.json`);
  if (!token || !fs.existsSync(tokenFile)) {
    res.status(400).send("Invalid or expired token");
    return;
  }
  const body = req.body as Buffer;
  if (!body || body.length < 100) {
    res.status(400).send("Empty file received");
    return;
  }
  try {
    const zipPath = path.join(MC_DATA_DIR, `upload_${token}.zip`);
    fs.writeFileSync(zipPath, body);
    const tokenData = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
    tokenData.received = true;
    tokenData.type = type;
    tokenData.zipPath = zipPath;
    fs.writeFileSync(tokenFile, JSON.stringify(tokenData));
    res.send("OK");
  } catch (e: any) {
    logger.error({ err: e }, "Upload file error");
    res.status(500).send("Server error: " + e.message);
  }
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
