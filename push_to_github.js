const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GITHUB_TOKEN_NEW || process.env.GITHUB_TOKEN;
const USER = 'goatshuman';
const REPO = 'minecraft-247-host';

const SKIP_DIRS = new Set(['node_modules', 'jars', 'java', 'server', 'data', '.git']);
const SKIP_EXTS = new Set(['.tar.gz', '.gz', '.zip', '.jar']);
const SKIP_FILES = new Set(['push_to_github.js']);

function apiRequest(method, endpoint, body) {
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
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function createRepo() {
  const res = await apiRequest('POST', '/user/repos', {
    name: REPO,
    description: 'Minecraft 24/7 Discord Bot Host',
    private: false,
    auto_init: false,
  });
  if (res.status === 201) console.log('✅ Repo created:', res.data.html_url);
  else if (res.status === 422) console.log('ℹ️ Repo already exists');
  else console.log('Repo create status:', res.status, res.data.message || '');
}

async function getFileSha(filePath) {
  const res = await apiRequest('GET', `/repos/${USER}/${REPO}/contents/${filePath}`);
  if (res.status === 200) return res.data.sha;
  return null;
}

async function uploadFile(localPath, repoPath) {
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
    console.log(`✅ ${repoPath}`);
  } else {
    console.log(`❌ ${repoPath}: ${res.status} ${res.data?.message || ''}`);
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
      if (stat.size > 50 * 1024 * 1024) { console.log(`⏭️ Skipping large file: ${rel} (${(stat.size/1024/1024).toFixed(1)}MB)`); continue; }
      files.push({ local: full, repo: rel });
    }
  }
  return files;
}

async function main() {
  console.log('🚀 Pushing to GitHub...');
  await createRepo();
  await new Promise(r => setTimeout(r, 2000));

  const botDir = __dirname;
  const files = collectFiles(botDir);
  console.log(`📁 Found ${files.length} files to upload`);

  for (const { local, repo } of files) {
    try {
      await uploadFile(local, repo);
    } catch (e) {
      console.log(`❌ ${repo}: ${e.message}`);
    }
  }

  console.log(`\n✅ Done! Repo: https://github.com/${USER}/${REPO}`);
}

main().catch(console.error);
