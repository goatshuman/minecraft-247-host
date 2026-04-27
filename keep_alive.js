const http = require('http');
const os = require('os');

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>anshuman da goat</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0a;
      color: #00ff88;
      font-family: 'Courier New', monospace;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      overflow: hidden;
    }
    .goat {
      font-size: clamp(2rem, 8vw, 5rem);
      font-weight: bold;
      text-shadow: 0 0 30px #00ff88, 0 0 60px #00ff44;
      animation: pulse 2s ease-in-out infinite;
      letter-spacing: 2px;
    }
    .emoji {
      font-size: clamp(3rem, 10vw, 7rem);
      animation: bounce 1.5s ease-in-out infinite;
      display: block;
      text-align: center;
      margin-top: 20px;
    }
    .status {
      margin-top: 30px;
      color: #00aa55;
      font-size: 1rem;
      opacity: 0.7;
    }
    .uptime {
      margin-top: 10px;
      color: #006633;
      font-size: 0.85rem;
    }
    @keyframes pulse {
      0%, 100% { text-shadow: 0 0 30px #00ff88, 0 0 60px #00ff44; }
      50% { text-shadow: 0 0 60px #00ff88, 0 0 120px #00ff44, 0 0 180px #00cc33; }
    }
    @keyframes bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-20px); }
    }
  </style>
</head>
<body>
  <div class="goat">anshuman da goat</div>
  <span class="emoji">🐐</span>
  <div class="status">✅ Minecraft 24/7 Host — Online</div>
  <div class="uptime" id="uptime">Loading uptime...</div>
  <script>
    const start = Date.now();
    setInterval(() => {
      const s = Math.floor((Date.now() - start) / 1000);
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      document.getElementById('uptime').textContent = 'Session uptime: ' + h + 'h ' + m + 'm ' + sec + 's';
    }, 1000);
  </script>
</body>
</html>`;

const PORT = parseInt(process.env.PORT || '3000', 10);

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Powered-By': 'anshuman-da-goat',
  });
  res.end(HTML);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[KeepAlive] 🐐 Server running on port ${PORT}`);
});

server.on('error', (e) => console.error('[KeepAlive] Error:', e.message));
