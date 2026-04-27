const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');

const USER = 'goatshuman';
const REPO = 'minecraft-247-host';

const SKIP_DIRS = new Set(['node_modules', 'jars', 'java', 'server', 'data', '.git']);
const SKIP_EXTS = new Set(['.tar.gz', '.gz', '.zip', '.jar']);
const SKIP_FILES = new Set(['push_to_github.js']);

// ─── GitHub API helpers ───────────────────────────────────────────────────────
function apiRequest(method, endpoint, body) {
  const TOKEN = process.env.GITHUB_TOKEN;
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method,
      headers: {
        'Authorization': `token ${TOKEN}`,
        'User-Agent': 'MCDiscordBot/1.0',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let b = '';
      res.on('data', c => b += c);
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
  const res = await apiRequest('GET', `/repos/${USER}/${REPO}/contents/${repoPath}`);
  if (res.status === 200 && res.data.sha) return res.data.sha;
  return null;
}

async function uploadFileToGitHub(localPath, repoPath, onProgress) {
  const content = fs.readFileSync(localPath);
  const encoded = content.toString('base64');
  const sha = await getFileSha(repoPath);

  const body = {
    message: sha ? `Update ${repoPath}` : `Add ${repoPath}`,
    content: encoded,
    ...(sha ? { sha } : {}),
  };

  const res = await apiRequest('PUT', `/repos/${USER}/${REPO}/contents/${encodeURI(repoPath)}`, body);
  if (res.status === 200 || res.status === 201) {
    if (onProgress) onProgress(`✅ ${repoPath}`);
    return true;
  } else {
    if (onProgress) onProgress(`❌ ${repoPath}: ${res.status} ${res.data?.message || ''}`);
    return false;
  }
}

function collectFiles(dir, base = '') {
  const files = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    if (item.startsWith('.') && item !== '.env.example' && item !== '.gitignore') continue;
    const full = path.join(dir, item);
    const rel = base ? `${base}/${item}` : item;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(item)) continue;
      files.push(...collectFiles(full, rel));
    } else {
      if (SKIP_FILES.has(item)) continue;
      if (SKIP_EXTS.has(path.extname(item))) continue;
      if (stat.size > 50 * 1024 * 1024) continue;
      files.push({ local: full, repo: rel });
    }
  }
  return files;
}

// Push all bot source files to GitHub
async function pushAllToGitHub(onProgress) {
  const botDir = path.join(__dirname, '..');
  const files = collectFiles(botDir);
  if (onProgress) onProgress(`📁 Pushing ${files.length} files to GitHub...`);
  let ok = 0, fail = 0;
  for (const { local, repo } of files) {
    try {
      const success = await uploadFileToGitHub(local, repo, onProgress);
      success ? ok++ : fail++;
    } catch (e) {
      if (onProgress) onProgress(`❌ ${repo}: ${e.message}`);
      fail++;
    }
  }
  if (onProgress) onProgress(`✅ GitHub push done — ${ok} uploaded, ${fail} failed`);
  return { ok, fail };
}

// ─── Render deploy hook ───────────────────────────────────────────────────────
async function triggerRenderDeploy(onProgress) {
  const hook = process.env.RENDER_DEPLOY_HOOK;
  if (!hook) {
    if (onProgress) onProgress('⚠️ No RENDER_DEPLOY_HOOK set — skipping auto-deploy');
    return false;
  }

  return new Promise((resolve) => {
    const url = new URL(hook);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST' }, (res) => {
      if (onProgress) onProgress(`🚀 Render deploy triggered (${res.statusCode})`);
      resolve(res.statusCode === 200 || res.statusCode === 201);
    });
    req.on('error', (e) => {
      if (onProgress) onProgress(`❌ Render deploy failed: ${e.message}`);
      resolve(false);
    });
    req.end();
  });
}

// ─── Download a Discord attachment ────────────────────────────────────────────
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    mod.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

// ─── Extract zip using unzip system command ───────────────────────────────────
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    // Ensure dest exists
    fs.mkdirSync(destDir, { recursive: true });
    exec(`unzip -o "${zipPath}" -d "${destDir}"`, (err, stdout, stderr) => {
      if (err) {
        // Fallback: try using node's built-in method
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

// ─── Handle World upload ──────────────────────────────────────────────────────
async function handleWorldUpload(attachment, onProgress) {
  const tmpZip = path.join(__dirname, '..', 'data', 'upload_world.zip');
  const worldDir = path.join(__dirname, '..', 'server', 'world');
  const tmpExtract = path.join(__dirname, '..', 'data', 'world_extract');

  fs.mkdirSync(path.dirname(tmpZip), { recursive: true });

  onProgress('⬇️ Downloading world zip...');
  await downloadFile(attachment.url, tmpZip);

  onProgress('📦 Extracting world...');
  await extractZip(tmpZip, tmpExtract);

  // Find the actual world folder inside (might be nested)
  const entries = fs.readdirSync(tmpExtract);
  let worldSource = tmpExtract;

  // If there's a single folder inside that looks like a world, use it
  if (entries.length === 1) {
    const single = path.join(tmpExtract, entries[0]);
    if (fs.statSync(single).isDirectory()) {
      worldSource = single;
    }
  }

  // Check if it's a valid world (has level.dat)
  const hasLevelDat = fs.existsSync(path.join(worldSource, 'level.dat'));
  if (!hasLevelDat) {
    // Try one level deeper
    for (const e of fs.readdirSync(worldSource)) {
      const sub = path.join(worldSource, e);
      if (fs.statSync(sub).isDirectory() && fs.existsSync(path.join(sub, 'level.dat'))) {
        worldSource = sub;
        break;
      }
    }
  }

  onProgress('🌍 Installing world to server...');
  // Remove old world
  if (fs.existsSync(worldDir)) {
    fs.rmSync(worldDir, { recursive: true, force: true });
  }
  // Copy new world
  fs.cpSync(worldSource, worldDir, { recursive: true });

  // Cleanup
  fs.unlinkSync(tmpZip);
  fs.rmSync(tmpExtract, { recursive: true, force: true });

  onProgress('✅ World installed!');
  return true;
}

// ─── Handle Mods upload ───────────────────────────────────────────────────────
async function handleModsUpload(attachment, onProgress) {
  const tmpZip = path.join(__dirname, '..', 'data', 'upload_mods.zip');
  const modsDir = path.join(__dirname, '..', 'server', 'mods');
  const tmpExtract = path.join(__dirname, '..', 'data', 'mods_extract');

  fs.mkdirSync(path.dirname(tmpZip), { recursive: true });

  onProgress('⬇️ Downloading mods zip...');
  await downloadFile(attachment.url, tmpZip);

  onProgress('📦 Extracting mods...');
  await extractZip(tmpZip, tmpExtract);

  onProgress('🔧 Installing mods...');
  // Clear old mods
  if (fs.existsSync(modsDir)) {
    fs.rmSync(modsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(modsDir, { recursive: true });

  // Find .jar files anywhere in the extracted content and put them in mods/
  function findJars(dir) {
    const jars = [];
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) jars.push(...findJars(full));
      else if (item.endsWith('.jar')) jars.push(full);
    }
    return jars;
  }

  // First check if there's a mods/ folder inside extracted dir
  let modsSource = null;
  for (const entry of fs.readdirSync(tmpExtract)) {
    const full = path.join(tmpExtract, entry);
    if (fs.statSync(full).isDirectory() && entry.toLowerCase() === 'mods') {
      modsSource = full;
      break;
    }
    if (fs.statSync(full).isDirectory()) {
      const inner = path.join(full, 'mods');
      if (fs.existsSync(inner)) { modsSource = inner; break; }
    }
  }

  if (modsSource) {
    fs.cpSync(modsSource, modsDir, { recursive: true });
  } else {
    // Just copy all .jar files found
    const jars = findJars(tmpExtract);
    for (const jar of jars) {
      fs.copyFileSync(jar, path.join(modsDir, path.basename(jar)));
    }
    if (jars.length === 0) {
      // Copy everything as-is
      fs.cpSync(tmpExtract, modsDir, { recursive: true });
    }
  }

  // Cleanup
  fs.unlinkSync(tmpZip);
  fs.rmSync(tmpExtract, { recursive: true, force: true });

  const installed = fs.readdirSync(modsDir).length;
  onProgress(`✅ ${installed} mod(s) installed!`);
  return true;
}

module.exports = {
  handleWorldUpload,
  handleModsUpload,
  pushAllToGitHub,
  triggerRenderDeploy,
};
