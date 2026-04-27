from http.server import HTTPServer, BaseHTTPRequestHandler
import os
import threading

HTML = """<!DOCTYPE html>
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
</body>
</html>"""

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(HTML.encode('utf-8'))

    def log_message(self, format, *args):
        pass  # Suppress access logs

def run():
    port = int(os.environ.get('PORT', 3000))
    server = HTTPServer(('0.0.0.0', port), Handler)
    print(f'[KeepAlive] Server running on port {port}')
    server.serve_forever()

if __name__ == '__main__':
    run()
