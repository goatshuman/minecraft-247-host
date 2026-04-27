const axios = require('axios');

const MOJANG_MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const PAPERMC_API = 'https://api.papermc.io/v2/projects/paper';

let cachedVersions = null;
let cachedPaperVersions = null;

async function getVanillaVersions() {
  if (cachedVersions) return cachedVersions;
  try {
    const { data } = await axios.get(MOJANG_MANIFEST, { timeout: 10000 });
    cachedVersions = data.versions
      .filter(v => v.type === 'release')
      .map(v => v.id);
    return cachedVersions;
  } catch (e) {
    return ['1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.17.1', '1.16.5', '1.12.2', '1.8.9'];
  }
}

async function getPaperVersions() {
  if (cachedPaperVersions) return cachedPaperVersions;
  try {
    const { data } = await axios.get(PAPERMC_API, { timeout: 10000 });
    cachedPaperVersions = data.versions.reverse();
    return cachedPaperVersions;
  } catch (e) {
    return ['1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4'];
  }
}

async function getDownloadUrl(version) {
  // Try PaperMC first
  try {
    const buildsUrl = `${PAPERMC_API}/versions/${version}/builds`;
    const { data } = await axios.get(buildsUrl, { timeout: 10000 });
    const builds = data.builds;
    if (builds && builds.length > 0) {
      const latest = builds[builds.length - 1];
      const build = latest.build;
      const fileName = latest.downloads.application.name;
      return {
        url: `${PAPERMC_API}/versions/${version}/builds/${build}/downloads/${fileName}`,
        type: 'paper',
        filename: `paper-${version}-${build}.jar`
      };
    }
  } catch (e) {}

  // Fall back to vanilla
  try {
    const { data: manifest } = await axios.get(MOJANG_MANIFEST, { timeout: 10000 });
    const versionMeta = manifest.versions.find(v => v.id === version);
    if (versionMeta) {
      const { data: meta } = await axios.get(versionMeta.url, { timeout: 10000 });
      return {
        url: meta.downloads.server.url,
        type: 'vanilla',
        filename: `minecraft_server.${version}.jar`
      };
    }
  } catch (e) {}

  throw new Error(`Cannot find download for version ${version}`);
}

async function getAllVersions() {
  const [paper, vanilla] = await Promise.all([getPaperVersions(), getVanillaVersions()]);
  // Merge: paper versions first (they have all vanilla releases too essentially)
  const all = [...new Set([...paper, ...vanilla])];
  return all.sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    }
    return 0;
  });
}

module.exports = { getDownloadUrl, getAllVersions, getPaperVersions, getVanillaVersions };
