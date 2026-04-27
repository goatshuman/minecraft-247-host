const { Rcon } = require('rcon-client');
const { RCON_PORT, RCON_PASSWORD } = require('./config');

let rcon = null;

async function connect() {
  try {
    if (rcon) {
      try { await rcon.end(); } catch (e) {}
    }
    rcon = new Rcon({ host: '127.0.0.1', port: RCON_PORT, password: RCON_PASSWORD, timeout: 3000 });
    await rcon.connect();
    return true;
  } catch (e) {
    rcon = null;
    return false;
  }
}

async function run(cmd) {
  try {
    if (!rcon) {
      const ok = await connect();
      if (!ok) return null;
    }
    return await rcon.send(cmd);
  } catch (e) {
    rcon = null;
    return null;
  }
}

async function getPlayerData(name) {
  try {
    const [posRes, healthRes, foodRes] = await Promise.all([
      run(`data get entity ${name} Pos`),
      run(`data get entity ${name} Health`),
      run(`data get entity ${name} FoodLevel`),
    ]);

    let x = '?', y = '?', z = '?';
    if (posRes) {
      const m = posRes.match(/\[(-?[\d.]+)d?, (-?[\d.]+)d?, (-?[\d.]+)d?\]/);
      if (m) { x = Math.floor(parseFloat(m[1])); y = Math.floor(parseFloat(m[2])); z = Math.floor(parseFloat(m[3])); }
    }

    let health = '?';
    if (healthRes) {
      const m = healthRes.match(/([\d.]+)f/);
      if (m) health = parseFloat(m[1]).toFixed(1);
    }

    let food = '?';
    if (foodRes) {
      const m = foodRes.match(/: (\d+)/);
      if (m) food = m[1];
    }

    return { x, y, z, health, food };
  } catch (e) {
    return { x: '?', y: '?', z: '?', health: '?', food: '?' };
  }
}

async function listPlayers() {
  try {
    const res = await run('list');
    if (!res) return [];
    const m = res.match(/players online:(.*)/);
    if (!m || !m[1].trim()) return [];
    return m[1].split(',').map(p => p.trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

module.exports = { connect, run, getPlayerData, listPlayers };
