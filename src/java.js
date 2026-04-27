const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { JAVA_DIR } = require('./config');

const JAVA_BIN = path.join(JAVA_DIR, 'bin', 'java');

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const request = (u) => {
      https.get(u, { headers: { 'User-Agent': 'MCDiscordBot/1.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${u}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }).on('error', reject);
    };
    request(url);
  });
}

function getJavaVersion(javaBin) {
  try {
    const out = execSync(`"${javaBin}" -version 2>&1`).toString();
    const m = out.match(/version "(\d+)/);
    return m ? parseInt(m[1]) : 0;
  } catch (e) {
    return 0;
  }
}

async function ensureJava() {
  // Check our previously installed java first
  if (fs.existsSync(JAVA_BIN)) {
    const ver = getJavaVersion(JAVA_BIN);
    if (ver >= 25) {
      console.log(`[Java] Local Java ${ver} found at ${JAVA_BIN}`);
      return JAVA_BIN;
    }
    // Old java installed — wipe and reinstall
    console.log(`[Java] Local Java ${ver} is too old (need 25), reinstalling...`);
    fs.rmSync(JAVA_DIR, { recursive: true, force: true });
  }

  // Check system java
  try {
    const sysJava = execSync('which java 2>/dev/null').toString().trim();
    if (sysJava) {
      const ver = getJavaVersion(sysJava);
      if (ver >= 25) {
        console.log(`[Java] System Java ${ver} found`);
        return sysJava;
      }
    }
  } catch (e) {}

  // Download Java 25 via Adoptium API
  console.log('[Java] Downloading Java 25...');
  if (!fs.existsSync(JAVA_DIR)) fs.mkdirSync(JAVA_DIR, { recursive: true });

  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';

  if (platform !== 'linux') {
    console.log('[Java] Non-Linux platform — trying system java anyway');
    return 'java';
  }

  // Use Adoptium API to get latest Java 25 binary URL directly
  const apiUrl = `https://api.adoptium.net/v3/binary/latest/25/ga/linux/${arch}/jdk/hotspot/normal/eclipse`;
  const tarPath = path.join(JAVA_DIR, 'java25.tar.gz');

  try {
    console.log(`[Java] Fetching Java 25 from Adoptium API (arch: ${arch})...`);
    await downloadFile(apiUrl, tarPath);

    const stat = fs.statSync(tarPath);
    if (stat.size < 1000000) {
      throw new Error(`Downloaded file too small (${stat.size} bytes) — API may have failed`);
    }

    console.log('[Java] Extracting Java 25...');
    execSync(`tar -xzf "${tarPath}" -C "${JAVA_DIR}" --strip-components=1`, { timeout: 120000 });
    fs.unlinkSync(tarPath);

    const ver = getJavaVersion(JAVA_BIN);
    if (ver < 25) throw new Error(`Extracted Java version is ${ver}, expected 25+`);

    console.log(`[Java] Java ${ver} installed successfully at ${JAVA_BIN}`);
    return JAVA_BIN;
  } catch (e) {
    console.error('[Java] Adoptium download failed:', e.message);
    // Clean up failed download
    if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);

    // Fallback: try Oracle JDK 25 EA builds
    console.log('[Java] Trying Oracle JDK 25 fallback...');
    try {
      // Oracle JDK 25 GA (released Sep 2025)
      const oracleUrl = arch === 'x64'
        ? 'https://download.oracle.com/java/25/latest/jdk-25_linux-x64_bin.tar.gz'
        : 'https://download.oracle.com/java/25/latest/jdk-25_linux-aarch64_bin.tar.gz';

      await downloadFile(oracleUrl, tarPath);
      execSync(`tar -xzf "${tarPath}" -C "${JAVA_DIR}" --strip-components=1`, { timeout: 120000 });
      fs.unlinkSync(tarPath);

      const ver = getJavaVersion(JAVA_BIN);
      console.log(`[Java] Oracle Java ${ver} installed successfully`);
      return JAVA_BIN;
    } catch (e2) {
      console.error('[Java] Oracle fallback also failed:', e2.message);
      if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);
      console.log('[Java] Falling back to system java — server may fail for newer versions');
      return 'java';
    }
  }
}

module.exports = { ensureJava };
