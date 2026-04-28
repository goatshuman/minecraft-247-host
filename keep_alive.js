const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.join(__dirname, 'data');
const TOKEN_PREFIX = 'token_';
const UPLOAD_PREFIX = 'upload_';

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─── HTML pages ───────────────────────────────────────────────────────────────
const HOME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>anshuman da goat</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0a0a0a;color:#00ff88;font-family:'Courier New',monospace;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh}
    .goat{font-size:clamp(2rem,8vw,5rem);font-weight:bold;text-shadow:0 0 30px #00ff88,0 0 60px #00ff44;animation:pulse 2s ease-in-out infinite;letter-spacing:2px}
    .emoji{font-size:clamp(3rem,10vw,7rem);animation:bounce 1.5s ease-in-out infinite;display:block;text-align:center;margin-top:20px}
    .status{margin-top:30px;color:#00aa55;font-size:1rem;opacity:.7}
    .uptime{margin-top:10px;color:#006633;font-size:.85rem}
    @keyframes pulse{0%,100%{text-shadow:0 0 30px #00ff88,0 0 60px #00ff44}50%{text-shadow:0 0 60px #00ff88,0 0 120px #00ff44,0 0 180px #00cc33}}
    @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-20px)}}
  </style>
</head>
<body>
  <div class="goat">anshuman da goat</div>
  <span class="emoji">🐐</span>
  <div class="status">✅ Minecraft 24/7 Host — Online</div>
  <div class="uptime" id="uptime">Loading uptime...</div>
  <script>
    const start=Date.now();
    setInterval(()=>{
      const s=Math.floor((Date.now()-start)/1000);
      const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
      document.getElementById('uptime').textContent='Session uptime: '+h+'h '+m+'m '+sec+'s';
    },1000);
  </script>
</body>
</html>`;

function uploadPage(token, type) {
  const label = type === 'world' ? '🌍 World' : '🔧 Mods';
  const hint = type === 'world'
    ? 'Upload a .zip of your Minecraft world folder (must contain <code>level.dat</code> inside)'
    : 'Upload a .zip of your mods folder (containing .jar files)';
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
    .success{color:#3fb950}
    .error{color:#f85149}
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
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const statusMsg = document.getElementById('statusMsg');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const filenameEl = document.getElementById('filename');
    let selectedFile = null;

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) selectFile(fileInput.files[0]);
    });
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); dropZone.classList.remove('drag');
      if (e.dataTransfer.files[0]) selectFile(e.dataTransfer.files[0]);
    });

    function selectFile(file) {
      if (!file.name.endsWith('.zip')) { statusMsg.textContent = '❌ Please select a .zip file'; statusMsg.className='status-msg error'; return; }
      selectedFile = file;
      filenameEl.textContent = file.name + ' (' + (file.size/1024/1024).toFixed(1) + ' MB)';
      filenameEl.style.display = 'block';
      uploadBtn.disabled = false;
      statusMsg.textContent = '';
      statusMsg.className = 'status-msg';
    }

    async function doUpload() {
      if (!selectedFile) return;
      uploadBtn.disabled = true;
      progressBar.style.display = 'block';
      statusMsg.textContent = 'Uploading...';
      statusMsg.className = 'status-msg';

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/upload/file?token=${token}&type=${type}');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) {
          const pct = Math.round(e.loaded / e.total * 100);
          progressFill.style.width = pct + '%';
          statusMsg.textContent = 'Uploading... ' + pct + '%';
        }
      };
      xhr.onload = () => {
        if (xhr.status === 200) {
          statusMsg.textContent = '✅ Upload complete! The bot is now processing your ${type}. Check Discord for progress.';
          statusMsg.className = 'status-msg success';
          progressFill.style.width = '100%';
        } else {
          statusMsg.textContent = '❌ Upload failed: ' + xhr.responseText;
          statusMsg.className = 'status-msg error';
          uploadBtn.disabled = false;
        }
      };
      xhr.onerror = () => {
        statusMsg.textContent = '❌ Network error. Please try again.';
        statusMsg.className = 'status-msg error';
        uploadBtn.disabled = false;
      };
      xhr.send(selectedFile);
    }
  </script>
</body>
</html>`;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#0d1117;color:#f85149"><h2>❌ ${msg}</h2><p style="color:#8b949e;margin-top:12px">This link may have expired or is invalid. Click Upload World/Mods again in Discord to get a new link.</p></body></html>`;
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  ensureDataDir();
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // ── Home page ──
  if (pathname === '/' || pathname === '') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(HOME_HTML);
  }

  // ── Upload form page ──
  if (req.method === 'GET' && pathname === '/upload') {
    const token = parsed.query.token;
    const type = parsed.query.type || 'world';
    const tokenFile = path.join(DATA_DIR, `${TOKEN_PREFIX}${token}.json`);
    if (!token || !fs.existsSync(tokenFile)) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(errorPage('Invalid or expired upload link'));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(uploadPage(token, type));
  }

  // ── File upload endpoint ──
  if (req.method === 'POST' && pathname === '/upload/file') {
    const token = parsed.query.token;
    const type = parsed.query.type || 'world';
    const tokenFile = path.join(DATA_DIR, `${TOKEN_PREFIX}${token}.json`);

    if (!token || !fs.existsSync(tokenFile)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Invalid or expired token');
    }

    const zipPath = path.join(DATA_DIR, `${UPLOAD_PREFIX}${token}.zip`);
    const chunks = [];

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks);
        if (body.length < 100) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          return res.end('Empty file received');
        }
        fs.writeFileSync(zipPath, body);

        // Mark token as received so bot.js picks it up
        const tokenData = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
        tokenData.received = true;
        tokenData.type = type;
        tokenData.zipPath = zipPath;
        fs.writeFileSync(tokenFile, JSON.stringify(tokenData));

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      } catch (e) {
        console.error('[UploadServer] Error saving file:', e.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error: ' + e.message);
      }
    });
    req.on('error', (e) => {
      console.error('[UploadServer] Request error:', e.message);
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[KeepAlive] 🐐 Server running on port ${PORT}`);
});

server.on('error', (e) => console.error('[KeepAlive] Error:', e.message));
