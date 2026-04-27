const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { JAR_CACHE_DIR } = require('./serverManager');

const PAPERMC_API = 'https://api.papermc.io/v2/projects/paper';
const MOJANG_MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

async function downloadFile(url, dest) {
  const response = await axios({
    url, method: 'GET', responseType: 'stream', timeout: 300000,
    headers: { 'User-Agent': 'MCDiscordBot/1.0' },
  });
  const writer = fs.createWriteStream(dest);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
    response.data.on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
  });
}

async function getPaperVersions() {
  const { data } = await axios.get(PAPERMC_API, { timeout: 15000 });
  return data.versions; // oldest to newest
}

async function getPaperJarInfo(version) {
  const { data } = await axios.get(`${PAPERMC_API}/versions/${version}/builds`, { timeout: 10000 });
  const latest = data.builds[data.builds.length - 1];
  const fileName = latest.downloads.application.name;
  return {
    url: `${PAPERMC_API}/versions/${version}/builds/${latest.build}/downloads/${fileName}`,
    filename: fileName,
  };
}

async function getVanillaJarInfo(version, manifest) {
  const meta = manifest.versions.find(v => v.id === version);
  if (!meta) return null;
  try {
    const { data } = await axios.get(meta.url, { timeout: 10000 });
    if (!data.downloads?.server) return null;
    return { url: data.downloads.server.url, filename: `minecraft_server.${version}.jar` };
  } catch (e) {
    return null;
  }
}

function isAlreadyCached(filename, existing) {
  // For paper jars, match by version embedded in filename
  return existing.has(filename);
}

async function downloadAllJars(onProgress) {
  if (!fs.existsSync(JAR_CACHE_DIR)) fs.mkdirSync(JAR_CACHE_DIR, { recursive: true });

  console.log('[DownloadAll] Fetching version lists...');
  let paperVersions, mojangManifest;

  try {
    [paperVersions, { data: mojangManifest }] = await Promise.all([
      getPaperVersions(),
      axios.get(MOJANG_MANIFEST, { timeout: 15000 }),
    ]);
  } catch (e) {
    console.error('[DownloadAll] Failed to fetch version lists:', e.message);
    return;
  }

  const paperSet = new Set(paperVersions);

  // All vanilla release versions
  const allVanillaReleases = mojangManifest.versions
    .filter(v => v.type === 'release')
    .map(v => v.id);

  // Build unified list: prefer Paper over vanilla
  const toProcess = [];
  const seen = new Set();

  // Add all Paper versions (newest first for better UX)
  for (const v of [...paperVersions].reverse()) {
    if (!seen.has(v)) { toProcess.push({ version: v, paper: true }); seen.add(v); }
  }
  // Add vanilla-only versions
  for (const v of allVanillaReleases) {
    if (!seen.has(v)) { toProcess.push({ version: v, paper: false }); seen.add(v); }
  }

  // Build set of already-cached filenames
  const existingFiles = new Set(fs.readdirSync(JAR_CACHE_DIR).filter(f => f.endsWith('.jar')));

  // Figure out which ones are missing
  // For paper jars: filename is paper-{version}-{build}.jar — check if any file contains the version
  // For vanilla jars: filename is minecraft_server.{version}.jar
  const missing = toProcess.filter(({ version, paper }) => {
    if (paper) {
      return ![...existingFiles].some(f => f.startsWith('paper-') && f.includes(`-${version}-`));
    } else {
      return !existingFiles.has(`minecraft_server.${version}.jar`);
    }
  });

  console.log(`[DownloadAll] ${toProcess.length} total versions | ${existingFiles.size} cached | ${missing.length} to download`);
  if (onProgress) onProgress(`Starting download of ${missing.length} jars...`);

  let success = 0, failed = 0, skipped = 0;

  for (const { version, paper } of missing) {
    let info;
    try {
      info = paper ? await getPaperJarInfo(version) : await getVanillaJarInfo(version, mojangManifest);
    } catch (e) {
      console.log(`[DownloadAll] Could not get URL for ${version}: ${e.message}`);
      failed++;
      continue;
    }

    if (!info) { skipped++; continue; }

    const dest = path.join(JAR_CACHE_DIR, info.filename);
    if (fs.existsSync(dest)) { skipped++; continue; }

    try {
      process.stdout.write(`[DownloadAll] ${info.filename}... `);
      await downloadFile(info.url, dest);
      const mb = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
      console.log(`✓ ${mb}MB`);
      success++;
    } catch (e) {
      console.log(`✗ ${e.message}`);
      failed++;
    }
  }

  const total = fs.readdirSync(JAR_CACHE_DIR).filter(f => f.endsWith('.jar')).length;
  const msg = `All jars ready: ${success} downloaded, ${failed} failed, ${skipped} skipped. Total: ${total} jars cached.`;
  console.log(`[DownloadAll] ${msg}`);
  if (onProgress) onProgress(msg);
}

module.exports = { downloadAllJars };

// Run standalone if called directly
if (require.main === module) {
  downloadAllJars().catch(e => console.error('[DownloadAll] Fatal:', e.message));
}
