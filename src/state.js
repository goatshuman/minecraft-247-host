const fs = require('fs');
const path = require('path');
const { DATA_FILE } = require('./config');

const dataDir = path.dirname(DATA_FILE);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const DEFAULT_STATE = {
  worldConfig: {
    gamemode: null,
    seed: '',
    version: '1.21.4',
    worldExists: false,
  },
  crackMode: true,
  controlMessageId: null,
  playerChannels: {},
  playerAdvancements: {},
};

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
    }
  } catch (e) {}
  return { ...DEFAULT_STATE };
}

function saveState(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

module.exports = { loadState, saveState };
