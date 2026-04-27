const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { SERVER_DIR, MC_PORT, RCON_PORT, RCON_PASSWORD } = require('./config');
const { getDownloadUrl } = require('./versions');

let serverProcess = null;
let serverStatus = 'offline'; // offline, starting, online, stopping
let serverVersion = '1.21.4';
let serverUptime = 0;
let uptimeTimer = null;
let onlineCount = 0;
let maxPlayers = 20;
let tps = 'N/A';
let mspt = 'N/A';
let ngrokUrl = null;
let logListeners = [];
let javaPath = 'java';

// Jar cache directory — persists between sessions
const JAR_CACHE_DIR = path.join(__dirname, '..', 'jars');

function setJavaPath(p) { javaPath = p; }
function setNgrokUrl(url) { ngrokUrl = url; }
function getNgrokUrl() { return ngrokUrl; }
function getStatus() { return serverStatus; }
function getVersion() { return serverVersion; }
function getUptime() { return serverUptime; }
function getOnlineCount() { return `${onlineCount} / ${maxPlayers}`; }
function getTPS() { return tps; }
function getMSPT() { return mspt; }
function getProcess() { return serverProcess; }

function addLogListener(fn) { logListeners.push(fn); }
function removeLogListener(fn) { logListeners = logListeners.filter(l => l !== fn); }
function emitLog(line) { logListeners.forEach(fn => fn(line)); }

async function downloadFile(url, dest, onProgress) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 300000,
    headers: { 'User-Agent': 'MCDiscordBot/1.0' },
  });

  const total = parseInt(response.headers['content-length'] || '0', 10);
  let downloaded = 0;
  const writer = fs.createWriteStream(dest);

  response.data.on('data', (chunk) => {
    downloaded += chunk.length;
    if (onProgress && total) onProgress(Math.round((downloaded / total) * 100));
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });
}

async function getJar(version) {
  if (!fs.existsSync(JAR_CACHE_DIR)) fs.mkdirSync(JAR_CACHE_DIR, { recursive: true });
  if (!fs.existsSync(SERVER_DIR)) fs.mkdirSync(SERVER_DIR, { recursive: true });

  // Check cache
  const cached = fs.readdirSync(JAR_CACHE_DIR).find(f => f.endsWith('.jar') && f.includes(version));
  if (cached) {
    console.log(`[Server] Using cached JAR: ${cached}`);
    emitLog(`__RAW__:[Server] Using cached JAR: ${cached}`);
    return path.join(JAR_CACHE_DIR, cached);
  }

  console.log(`[Server] Downloading Minecraft ${version}...`);
  emitLog(`__RAW__:[Server] Downloading Minecraft ${version}... (this may take a minute)`);

  let info;
  try {
    info = await getDownloadUrl(version);
  } catch (e) {
    emitLog(`__RAW__:[Server] ERROR: Could not find download for ${version}: ${e.message}`);
    throw e;
  }

  const jarPath = path.join(JAR_CACHE_DIR, info.filename);
  let lastPct = 0;

  await downloadFile(info.url, jarPath, (pct) => {
    if (pct - lastPct >= 20) {
      lastPct = pct;
      emitLog(`__RAW__:[Server] Downloading ${version}... ${pct}%`);
    }
  });

  console.log(`[Server] Downloaded ${info.filename}`);
  emitLog(`__RAW__:[Server] Downloaded ${info.filename} — starting server...`);
  return jarPath;
}

function writeServerProperties(gamemode, seed, cracked) {
  const actualGamemode = gamemode === 'hardcore' ? 'survival' : gamemode;
  const props = [
    `server-port=${MC_PORT}`,
    `rcon.port=${RCON_PORT}`,
    `rcon.password=${RCON_PASSWORD}`,
    'enable-rcon=true',
    `online-mode=${cracked ? 'false' : 'true'}`,
    `gamemode=${actualGamemode}`,
    `hardcore=${gamemode === 'hardcore' ? 'true' : 'false'}`,
    `level-seed=${seed || ''}`,
    'max-players=20',
    'motd=Discord MC Server',
    'view-distance=10',
    'level-name=world',
    'difficulty=normal',
    'allow-flight=true',
    'spawn-protection=0',
    'enable-command-block=true',
    'pvp=true',
    'generate-structures=true',
  ].join('\n');
  fs.writeFileSync(path.join(SERVER_DIR, 'server.properties'), props);
}

async function startServer(version, gamemode, seed, cracked) {
  if (serverProcess) return false;

  serverVersion = version;
  serverStatus = 'starting';
  onlineCount = 0;
  tps = 'N/A';
  mspt = 'N/A';

  let jarPath;
  try {
    jarPath = await getJar(version);
  } catch (e) {
    serverStatus = 'offline';
    emitLog(`__RAW__:[Error] Failed to get server JAR: ${e.message}`);
    return false;
  }

  // Accept EULA
  fs.writeFileSync(path.join(SERVER_DIR, 'eula.txt'), 'eula=true\n');

  // Write server.properties
  writeServerProperties(gamemode, seed, cracked);

  // Ensure server dir has the jar symlinked/copied
  const localJar = path.join(SERVER_DIR, path.basename(jarPath));
  if (!fs.existsSync(localJar)) {
    try {
      fs.symlinkSync(jarPath, localJar);
    } catch (e) {
      fs.copyFileSync(jarPath, localJar);
    }
  }

  const args = [
    '-Xmx2G',
    '-Xms512M',
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-jar', localJar,
    '--nogui',
  ];

  console.log(`[Server] Starting with: ${javaPath} ${args.join(' ')}`);
  emitLog(`__RAW__:[Server] Starting Java process...`);

  serverProcess = spawn(javaPath, args, {
    cwd: SERVER_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  serverUptime = 0;
  uptimeTimer = setInterval(() => { if (serverStatus === 'online') serverUptime++; }, 1000);

  serverProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      parseLine(line);
      // Emit raw important lines to Discord
      if (
        line.includes('INFO') || line.includes('WARN') || line.includes('ERROR') ||
        line.includes('Exception') || line.includes('Error') || line.includes('FATAL')
      ) {
        const clean = line.replace(/\[[\d:]+\] /, '').replace(/\[Server thread\/\w+\]: /, '').trim();
        if (clean.length > 3 && !clean.includes('Generating keypair') && !clean.includes('Starting Minecraft')) {
          emitLog(`__RAW__:${clean}`);
        }
      }
    });
  });

  serverProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      const clean = line.replace(/\[[\d:]+\] /, '').trim();
      if (clean.length > 3) {
        emitLog(`__RAW__:⚠️ ${clean}`);
      }
      parseLine(line);
    });
  });

  serverProcess.on('error', (err) => {
    serverStatus = 'offline';
    serverProcess = null;
    if (uptimeTimer) { clearInterval(uptimeTimer); uptimeTimer = null; }
    emitLog(`__RAW__:[Error] Failed to spawn Java: ${err.message}`);
    emitLog('__SERVER_STOPPED__');
  });

  serverProcess.on('close', (code) => {
    serverProcess = null;
    serverStatus = 'offline';
    if (uptimeTimer) { clearInterval(uptimeTimer); uptimeTimer = null; }
    serverUptime = 0;
    onlineCount = 0;
    tps = 'N/A';
    mspt = 'N/A';
    emitLog(`__RAW__:[Server] Process exited with code ${code}`);
    emitLog('__SERVER_STOPPED__');
  });

  return true;
}

function parseLine(line) {
  if (line.includes('Done (') && line.includes('For help')) {
    serverStatus = 'online';
    emitLog('__SERVER_ONLINE__');
  }
  const joinMatch = line.match(/(\w+) joined the game/);
  if (joinMatch) {
    onlineCount++;
    emitLog('__PLAYER_JOIN__:' + joinMatch[1]);
  }
  const leaveMatch = line.match(/(\w+) left the game/);
  if (leaveMatch) {
    onlineCount = Math.max(0, onlineCount - 1);
    emitLog('__PLAYER_LEAVE__:' + leaveMatch[1]);
  }
  const tpsMatch = line.match(/TPS from last 1m, 5m, 15m: ([\d.]+)/);
  if (tpsMatch) tps = tpsMatch[1];
  const msptMatch = line.match(/MSPT: ([\d.]+)/);
  if (msptMatch) mspt = msptMatch[1];
  const advMatch = line.match(/(\w+) has made the advancement \[(.+?)\]/);
  if (advMatch) emitLog('__ADVANCEMENT__:' + advMatch[1] + ':' + advMatch[2]);
  const chalMatch = line.match(/(\w+) has (completed the challenge|reached the goal) \[(.+?)\]/);
  if (chalMatch) emitLog('__ADVANCEMENT__:' + chalMatch[1] + ':' + chalMatch[3]);
  const deathPatterns = [
    /(\w+) was slain by/, /(\w+) drowned/, /(\w+) burned to death/,
    /(\w+) blew up/, /(\w+) fell from/, /(\w+) was shot/, /(\w+) starved/,
    /(\w+) hit the ground/, /(\w+) died/,
  ];
  for (const pat of deathPatterns) {
    const m = line.match(pat);
    if (m) { emitLog('__PLAYER_DEATH__:' + m[1] + ':' + line.trim()); break; }
  }
  const chatMatch = line.match(/<(\w+)> (.+)/);
  if (chatMatch) emitLog('__CHAT__:' + chatMatch[1] + ':' + chatMatch[2]);
}

async function stopServer() {
  if (!serverProcess) return false;
  serverStatus = 'stopping';
  sendCommand('stop');
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (serverProcess) serverProcess.kill('SIGKILL');
      resolve(true);
    }, 20000);
    const check = setInterval(() => {
      if (!serverProcess) { clearInterval(check); clearTimeout(timeout); resolve(true); }
    }, 500);
  });
}

async function restartServer(version, gamemode, seed, cracked) {
  await stopServer();
  await new Promise(r => setTimeout(r, 3000));
  return startServer(version, gamemode, seed, cracked);
}

function sendCommand(cmd) {
  if (serverProcess && serverProcess.stdin) {
    serverProcess.stdin.write(cmd + '\n');
  }
}

function deleteWorld() {
  ['world', 'world_nether', 'world_the_end'].forEach(name => {
    const d = path.join(SERVER_DIR, name);
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  });
}

function getSystemRAM() {
  try {
    const total = execSync("cat /proc/meminfo | grep MemTotal | awk '{print $2}'").toString().trim();
    const avail = execSync("cat /proc/meminfo | grep MemAvailable | awk '{print $2}'").toString().trim();
    const totalGB = (parseInt(total) / 1024 / 1024).toFixed(1);
    const usedGB = ((parseInt(total) - parseInt(avail)) / 1024 / 1024).toFixed(1);
    const pct = Math.round((parseInt(total) - parseInt(avail)) / parseInt(total) * 100);
    return { pct, used: usedGB, total: totalGB };
  } catch (e) {
    return { pct: 0, used: '?', total: '?' };
  }
}

function getDiskUsage() {
  try {
    const out = execSync("df -BG / | tail -1").toString().trim().split(/\s+/);
    const used = out[2].replace('G', '');
    const total = out[1].replace('G', '');
    const pct = Math.round(parseInt(used) / parseInt(total) * 100);
    return { pct, used, total };
  } catch (e) {
    return { pct: 0, used: '?', total: '?' };
  }
}

module.exports = {
  startServer, stopServer, restartServer, sendCommand, deleteWorld,
  setJavaPath, setNgrokUrl, getNgrokUrl,
  getStatus, getVersion, getUptime, getOnlineCount, getTPS, getMSPT,
  getSystemRAM, getDiskUsage, getProcess,
  addLogListener, removeLogListener,
  JAR_CACHE_DIR,
};
