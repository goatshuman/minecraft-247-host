const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const server = require('./serverManager');

function progressBar(pct, length = 12) {
  const filled = Math.round((pct / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function formatUptime(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function buildControlEmbed(state) {
  const status = server.getStatus();
  const isOnline = status === 'online';
  const isStarting = status === 'starting';
  const isStopping = status === 'stopping';

  const statusEmoji = isOnline ? '🟢' : (isStarting || isStopping) ? '🟡' : '🔴';
  const statusText = isOnline ? 'ONLINE' : isStarting ? 'STARTING...' : isStopping ? 'STOPPING...' : 'OFFLINE';

  const ngrokUrl = server.getNgrokUrl();
  const serverIP = isOnline && ngrokUrl
    ? ngrokUrl.replace('tcp://', '')
    : 'Not started';

  const ram = server.getSystemRAM();
  const disk = server.getDiskUsage();
  const uptime = server.getUptime();
  const players = server.getOnlineCount();
  const tps = server.getTPS();
  const mspt = server.getMSPT();
  const version = state.worldConfig.version || '1.21.4';
  const cracked = state.crackMode;
  const gamemode = state.worldConfig.gamemode || 'N/A';

  const embed = new EmbedBuilder()
    .setColor(isOnline ? 0x00ff00 : isStarting || isStopping ? 0xffaa00 : 0xff0000)
    .setTitle(`${statusEmoji} MINECRAFT SERVER — ${statusText}`)
    .addFields(
      { name: '🏷️ Version', value: version, inline: true },
      { name: '👥 Players', value: players, inline: true },
      { name: '⏱️ Uptime', value: isOnline ? formatUptime(uptime) : '0s', inline: true },
      { name: '🌐 Server IP', value: `\`\`\`${serverIP}\`\`\``, inline: false },
      { name: `📶 Ping`, value: isOnline ? `${progressBar(70)} Online` : `${progressBar(0)} Offline`, inline: false },
      { name: '⚡ TPS / MSPT', value: tps === 'N/A' ? 'N/A' : `${tps} TPS / ${mspt}ms`, inline: false },
      { name: '🖥️ System RAM', value: `${progressBar(ram.pct)} **${ram.pct}%** (${ram.used}G / ${ram.total}G)`, inline: false },
      { name: '🎮 Server RAM', value: '~2G allocated', inline: true },
      { name: '💾 Storage', value: `${progressBar(disk.pct)} **${disk.pct}%** (${disk.used}G / ${disk.total}G)`, inline: true },
      { name: '🔑 Mode', value: cracked ? 'Cracked (Offline)' : 'Premium (Online)', inline: true },
      { name: '🌍 Gamemode', value: gamemode.charAt(0).toUpperCase() + gamemode.slice(1), inline: true },
      { name: '🌱 Seed', value: state.worldConfig.seed || 'Random', inline: true },
    )
    .setFooter({ text: `🔴 Live • ngrok • Java 21 • ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` })
    .setTimestamp();

  return embed;
}

function buildControlButtons(state) {
  const status = server.getStatus();
  const isOffline = status === 'offline';
  const isOnline = status === 'online';
  const isBusy = status === 'starting' || status === 'stopping';

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mc_start')
      .setLabel('Start')
      .setEmoji('🟢')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!isOffline || isBusy),
    new ButtonBuilder()
      .setCustomId('mc_stop')
      .setLabel('Stop')
      .setEmoji('🔴')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isOffline || isBusy),
    new ButtonBuilder()
      .setCustomId('mc_restart')
      .setLabel('Restart')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isOffline || isBusy),
    new ButtonBuilder()
      .setCustomId('mc_delete_world')
      .setLabel('Delete World')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isBusy),
    new ButtonBuilder()
      .setCustomId('mc_crack_toggle')
      .setLabel(`Crack: ${state.crackMode ? 'ON' : 'OFF'}`)
      .setEmoji('🔓')
      .setStyle(state.crackMode ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(isOnline || isBusy),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mc_switch_version')
      .setLabel('Switch Version')
      .setEmoji('🔀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isOnline || isBusy),
    new ButtonBuilder()
      .setCustomId('mc_custom_seed')
      .setLabel('Custom Seed')
      .setEmoji('🌱')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isOnline || isBusy),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mc_upload_world')
      .setLabel('Upload World')
      .setEmoji('📁')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isOnline || isBusy),
    new ButtonBuilder()
      .setCustomId('mc_upload_mods')
      .setLabel('Upload Mods')
      .setEmoji('🔧')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isOnline || isBusy),
  );

  return [row1, row2, row3];
}

function buildPlayerEmbed(playerName, data, advancements) {
  const heartBar = (hp) => {
    const hearts = Math.ceil(parseFloat(hp) / 2);
    const total = 10;
    return '❤️'.repeat(Math.min(hearts, total)) + '🖤'.repeat(Math.max(0, total - Math.min(hearts, total)));
  };

  const foodBar = (food) => {
    const drumsticks = Math.ceil(parseInt(food) / 2);
    const total = 10;
    return '🍗'.repeat(Math.min(drumsticks, total)) + '🦴'.repeat(Math.max(0, total - Math.min(drumsticks, total)));
  };

  const advancementList = advancements && advancements.length > 0
    ? advancements.slice(-10).map(a => `• **${a.name}** — <t:${a.timestamp}:f>`).join('\n')
    : 'No advancements yet';

  const embed = new EmbedBuilder()
    .setColor(0x00aaff)
    .setTitle(`👤 ${playerName}`)
    .addFields(
      {
        name: '📍 Coordinates',
        value: data.x === '?' ? 'Unknown' : `X: **${data.x}** | Y: **${data.y}** | Z: **${data.z}**`,
        inline: false
      },
      {
        name: '❤️ Health',
        value: data.health === '?' ? 'Unknown' : `${heartBar(data.health)}\n${data.health} / 20 HP`,
        inline: true
      },
      {
        name: '🍗 Food',
        value: data.food === '?' ? 'Unknown' : `${foodBar(data.food)}\n${data.food} / 20`,
        inline: true
      },
      {
        name: '🏆 Advancements',
        value: advancementList,
        inline: false
      },
    )
    .setFooter({ text: `Updated every second • ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` })
    .setTimestamp();

  return embed;
}

module.exports = { buildControlEmbed, buildControlButtons, buildPlayerEmbed };
