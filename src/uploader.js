const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const USER = 'goatshuman';
const REPO = 'minecraft-247-host';

// ─── GitHub API ───────────────────────────────────────────────────────────────
function apiRequest(method, endpoint, body) {
  const TOKEN = process.env.GITHUB_TOKEN;
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method,
      headers: {
        Authorization: `token ${TOKEN}`,
        'User-Agent': 'MCDiscordBot/1.0',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch (e) { resolve({ status: res.statusCode, data: b }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getFileSha(repoPath) {
  const res = await apiRequest('GET', `/repos/${USER}/${REPO}/contents/${encodeURI(repoPath)}`);
  if (res.status === 200 && res.data.sha) return res.data.sha;
  return null;
}

async function uploadFileToGitHub(localPath, repoPath) {
  try {
    const stat = fs.statSync(localPath);
    if (stat.size > 49 * 1024 * 1024) return false; // skip >49MB
    const content = fs.readFileSync(localPath).toString('base64');
    const sha = await getFileSha(repoPath);
    const body = {
      message: sha ? `Update ${repoPath}` : `Add ${repoPath}`,
      content,
      ...(sha ? { sha } : {}),
    };
    const res = await apiRequest('PUT', `/repos/${USER}/${REPO}/contents/${encodeURI(repoPath)}`, body);
    return res.status === 200 || res.status === 201;
  } catch (e) {
    return false;
  }
}

function collectFiles(dir, base = '', skipDirs = new Set()) {
  const files = [];
  let items;
  try { items = fs.readdirSync(dir); } catch { return files; }
  for (const item of items) {
    if (item.startsWith('.') && item !== '.env.example' && item !== '.gitignore') continue;
    const full = path.join(dir, item);
    const rel = base ? `${base}/${item}` : item;
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      if (skipDirs.has(item)) continue;
      files.push(...collectFiles(full, rel, skipDirs));
    } else {
      if (stat.size > 49 * 1024 * 1024) continue;
      files.push({ local: full, repo: rel });
    }
  }
  return files;
}

async function pushAllToGitHub(onProgress) {
  const botDir = path.join(__dirname, '..');
  const SKIP = new Set(['node_modules', '.git', 'data', 'server', 'java']);
  const files = collectFiles(botDir, '', SKIP);
  if (onProgress) onProgress(`📁 Pushing ${files.length} files to GitHub...`);
  let ok = 0, fail = 0;
  for (const { local, repo } of files) {
    const success = await uploadFileToGitHub(local, repo);
    success ? ok++ : fail++;
  }
  if (onProgress) onProgress(`✅ GitHub: ${ok} uploaded, ${fail} skipped`);
  return { ok, fail };
}

async function pushEverythingToGitHub(onProgress) {
  const botDir = path.join(__dirname, '..');
  // Include jars but skip node_modules, java binary (too large), .git
  const SKIP = new Set(['node_modules', '.git', 'java', 'data', 'server']);
  const files = [];

  // Source files (no skip)
  const srcFiles = collectFiles(path.join(botDir, 'src'), 'src', new Set());
  files.push(...srcFiles);

  // Root files
  for (const item of fs.readdirSync(botDir)) {
    const full = path.join(botDir, item);
    if (item.startsWith('.') && item !== '.gitignore' && item !== '.env.example') continue;
    try {
      const stat = fs.statSync(full);
      if (!stat.isDirectory() && stat.size < 49 * 1024 * 1024) {
        files.push({ local: full, repo: item });
      }
    } catch {}
  }

  // Jars directory — include all .jar files
  const jarsDir = path.join(botDir, 'jars');
  if (fs.existsSync(jarsDir)) {
    const jars = collectFiles(jarsDir, 'jars', new Set());
    files.push(...jars);
    if (onProgress) onProgress(`📦 Found ${jars.length} jars to upload...`);
  }

  if (onProgress) onProgress(`📁 Pushing ${files.length} total files to GitHub...`);
  let ok = 0, fail = 0;
  for (const { local, repo } of files) {
    const success = await uploadFileToGitHub(local, repo);
    if (success) {
      ok++;
      if (onProgress && ok % 10 === 0) onProgress(`✅ ${ok} files uploaded...`);
    } else {
      fail++;
    }
  }
  if (onProgress) onProgress(`✅ GitHub complete: ${ok} uploaded, ${fail} skipped`);
  return { ok, fail };
}

// ─── Render deploy hook ───────────────────────────────────────────────────────
async function triggerRenderDeploy(onProgress) {
  const hook = process.env.RENDER_DEPLOY_HOOK;
  if (!hook) {
    if (onProgress) onProgress('⚠️ No RENDER_DEPLOY_HOOK configured');
    return false;
  }
  return new Promise((resolve) => {
    const url = new URL(hook);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      { hostname: url.hostname, path: url.pathname + url.search, method: 'POST' },
      (res) => {
        if (onProgress) onProgress(`🚀 Render deploy triggered (${res.statusCode})`);
        resolve(true);
      }
    );
    req.on('error', (e) => {
      if (onProgress) onProgress(`❌ Render deploy: ${e.message}`);
      resolve(false);
    });
    req.end();
  });
}

// ─── Extract zip (pure JS via adm-zip) ───────────────────────────────────────
function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
}

// ─── Download file from URL ───────────────────────────────────────────────────
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    const doGet = (u) => {
      mod.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          return doGet(res.headers.location);
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    };
    doGet(url);
  });
}

// ─── Install world from zip ───────────────────────────────────────────────────
async function handleWorldUpload(zipPath, onProgress) {
  const worldDir = path.join(__dirname, '..', 'server', 'world');
  const tmpExtract = path.join(__dirname, '..', 'data', 'world_extract');

  if (fs.existsSync(tmpExtract)) fs.rmSync(tmpExtract, { recursive: true, force: true });

  onProgress('📦 Extracting world zip...');
  extractZip(zipPath, tmpExtract);

  // Find world root (containing level.dat)
  let worldSource = tmpExtract;
  function findLevelDat(dir) {
    if (fs.existsSync(path.join(dir, 'level.dat'))) return dir;
    try {
      for (const entry of fs.readdirSync(dir)) {
        const sub = path.join(dir, entry);
        if (fs.statSync(sub).isDirectory()) {
          const found = findLevelDat(sub);
          if (found) return found;
        }
      }
    } catch {}
    return null;
  }
  const found = findLevelDat(tmpExtract);
  if (found) worldSource = found;

  onProgress('🌍 Installing world...');
  if (fs.existsSync(worldDir)) fs.rmSync(worldDir, { recursive: true, force: true });
  fs.cpSync(worldSource, worldDir, { recursive: true });
  fs.rmSync(tmpExtract, { recursive: true, force: true });
  onProgress('✅ World installed!');
  return true;
}

// ─── Install mods from zip ────────────────────────────────────────────────────
async function handleModsUpload(zipPath, onProgress) {
  const modsDir = path.join(__dirname, '..', 'server', 'mods');
  const tmpExtract = path.join(__dirname, '..', 'data', 'mods_extract');

  if (fs.existsSync(tmpExtract)) fs.rmSync(tmpExtract, { recursive: true, force: true });

  onProgress('📦 Extracting mods zip...');
  extractZip(zipPath, tmpExtract);

  onProgress('🔧 Installing mods...');
  if (fs.existsSync(modsDir)) fs.rmSync(modsDir, { recursive: true, force: true });
  fs.mkdirSync(modsDir, { recursive: true });

  // Find all .jar files
  function findJars(dir) {
    const jars = [];
    try {
      for (const item of fs.readdirSync(dir)) {
        const full = path.join(dir, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) jars.push(...findJars(full));
        else if (item.endsWith('.jar')) jars.push(full);
      }
    } catch {}
    return jars;
  }

  // Check for mods/ subfolder first
  let modsSource = null;
  try {
    for (const entry of fs.readdirSync(tmpExtract)) {
      const full = path.join(tmpExtract, entry);
      if (fs.statSync(full).isDirectory()) {
        if (entry.toLowerCase() === 'mods') { modsSource = full; break; }
        const inner = path.join(full, 'mods');
        if (fs.existsSync(inner)) { modsSource = inner; break; }
      }
    }
  } catch {}

  if (modsSource) {
    fs.cpSync(modsSource, modsDir, { recursive: true });
  } else {
    const jars = findJars(tmpExtract);
    if (jars.length > 0) {
      for (const jar of jars) fs.copyFileSync(jar, path.join(modsDir, path.basename(jar)));
    } else {
      fs.cpSync(tmpExtract, modsDir, { recursive: true });
    }
  }

  fs.rmSync(tmpExtract, { recursive: true, force: true });
  const count = fs.readdirSync(modsDir).length;
  onProgress(`✅ ${count} mod file(s) installed!`);
  return true;
}

module.exports = {
  handleWorldUpload,
  handleModsUpload,
  pushAllToGitHub,
  pushEverythingToGitHub,
  triggerRenderDeploy,
};
