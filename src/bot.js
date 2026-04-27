const {
  Client, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ChannelType, Events, InteractionType, MessageFlags,
} = require('discord.js');

const config = require('./config');
const { loadState, saveState } = require('./state');
const server = require('./serverManager');
const rcon = require('./rcon');
const { startTunnel, stopTunnel } = require('./ngrokManager');
const { buildControlEmbed, buildControlButtons, buildPlayerEmbed } = require('./embed');
const { ensureJava } = require('./java');
const { getAllVersions } = require('./versions');
const { downloadAllJars } = require('./downloadAll');

// ─── State ───────────────────────────────────────────────────────────────────
let state = loadState();
let controlMessage = null;
let embedUpdateInterval = null;
let playerEmbedIntervals = {};
let playerEmbedMessages = {};
let logChannel = null;
let controlChannel = null;
let isResendingEmbed = false;

// ─── Client ──────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isAllowed(userId) {
  return userId === config.ALLOWED_USER_ID;
}

async function log(title, description, color = 0x555555) {
  try {
    if (!logChannel) return;
    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description || '\u200b')
      .setTimestamp();
    await logChannel.send({ embeds: [embed] });
  } catch (e) {
    console.error('[Log] Failed:', e.message);
  }
}

async function sendControlEmbed() {
  if (!controlChannel || isResendingEmbed) return;
  isResendingEmbed = true;
  try {
    const embed = buildControlEmbed(state);
    const components = buildControlButtons(state);
    controlMessage = await controlChannel.send({ embeds: [embed], components });
    state.controlMessageId = controlMessage.id;
    saveState(state);
    console.log('[Bot] Control embed sent, id:', controlMessage.id);
  } catch (e) {
    console.error('[Bot] Could not send control embed:', e.message);
  } finally {
    isResendingEmbed = false;
  }
}

async function updateControlEmbed() {
  try {
    if (!controlMessage) return;
    const embed = buildControlEmbed(state);
    const components = buildControlButtons(state);
    await controlMessage.edit({ embeds: [embed], components });
  } catch (e) {
    // Message was deleted — resend
    if (e.code === 10008 || e.message?.includes('Unknown Message')) {
      controlMessage = null;
      state.controlMessageId = null;
      saveState(state);
      await sendControlEmbed();
    }
  }
}

function startEmbedUpdater() {
  if (embedUpdateInterval) clearInterval(embedUpdateInterval);
  embedUpdateInterval = setInterval(updateControlEmbed, 1000);
}

// ─── Player channel management ────────────────────────────────────────────────
async function createPlayerChannel(playerName) {
  try {
    const guild = client.guilds.cache.get(config.GUILD_ID);
    if (!guild) return null;

    if (state.playerChannels[playerName]) {
      const existing = guild.channels.cache.get(state.playerChannels[playerName]);
      if (existing) return existing;
    }

    const channel = await guild.channels.create({
      name: playerName.toLowerCase(),
      type: ChannelType.GuildText,
      parent: config.PLAYER_CATEGORY_ID,
      topic: `Player tracking for ${playerName}`,
    });

    state.playerChannels[playerName] = channel.id;
    if (!state.playerAdvancements[playerName]) state.playerAdvancements[playerName] = [];
    saveState(state);
    return channel;
  } catch (e) {
    console.error('[PlayerChannel] Error creating channel:', e.message);
    return null;
  }
}

async function deletePlayerChannel(playerName) {
  try {
    const guild = client.guilds.cache.get(config.GUILD_ID);
    if (!guild) return;

    const channelId = state.playerChannels[playerName];
    if (channelId) {
      const channel = guild.channels.cache.get(channelId);
      if (channel) await channel.delete().catch(() => {});
    }

    delete state.playerChannels[playerName];
    delete state.playerAdvancements[playerName];
    if (playerEmbedIntervals[playerName]) {
      clearInterval(playerEmbedIntervals[playerName]);
      delete playerEmbedIntervals[playerName];
    }
    delete playerEmbedMessages[playerName];
    saveState(state);
  } catch (e) {
    console.error('[PlayerChannel] Error deleting channel:', e.message);
  }
}

async function deleteAllPlayerChannels() {
  for (const player of Object.keys(state.playerChannels)) {
    await deletePlayerChannel(player);
  }
}

async function startPlayerTracking(playerName, channel) {
  if (playerEmbedIntervals[playerName]) clearInterval(playerEmbedIntervals[playerName]);

  const initialData = { x: '...', y: '...', z: '...', health: '...', food: '...' };
  const adv = state.playerAdvancements[playerName] || [];
  try {
    const msg = await channel.send({ embeds: [buildPlayerEmbed(playerName, initialData, adv)] });
    playerEmbedMessages[playerName] = msg;
  } catch (e) {
    console.error('[PlayerTracking] Could not send initial embed:', e.message);
  }

  playerEmbedIntervals[playerName] = setInterval(async () => {
    try {
      const data = await rcon.getPlayerData(playerName);
      const adv = state.playerAdvancements[playerName] || [];
      const embed = buildPlayerEmbed(playerName, data, adv);
      if (playerEmbedMessages[playerName]) {
        await playerEmbedMessages[playerName].edit({ embeds: [embed] });
      }
    } catch (e) {}
  }, 1000);
}

// ─── Server log handling ──────────────────────────────────────────────────────
server.addLogListener(async (line) => {
  if (line === '__SERVER_ONLINE__') {
    const url = await startTunnel();
    server.setNgrokUrl(url);
    const ip = url ? url.replace('tcp://', '') : 'Unknown';
    await log('🟢 Server Online!', `🌐 **Connect**\n\`${ip}\``, 0x00ff00);
    setTimeout(() => rcon.connect(), 5000);
    return;
  }

  if (line === '__SERVER_STOPPED__') {
    await stopTunnel().catch(() => {});
    server.setNgrokUrl(null);
    await log('⬛ Server Stopped', '\u200b', 0x555555);
    return;
  }

  if (line.startsWith('__PLAYER_JOIN__:')) {
    const playerName = line.split(':')[1];
    await log(`✅ ${playerName} joined the server.`, '\u200b', 0x00cc00);
    const channel = await createPlayerChannel(playerName);
    if (channel) await startPlayerTracking(playerName, channel);
    return;
  }

  if (line.startsWith('__PLAYER_LEAVE__:')) {
    const playerName = line.split(':')[1];
    await log(`🚪 ${playerName} left the server.`, '\u200b', 0xffaa00);
    if (playerEmbedIntervals[playerName]) {
      clearInterval(playerEmbedIntervals[playerName]);
      delete playerEmbedIntervals[playerName];
    }
    return;
  }

  if (line.startsWith('__ADVANCEMENT__:')) {
    const parts = line.split(':');
    const playerName = parts[1];
    const advName = parts.slice(2).join(':');
    if (!state.playerAdvancements[playerName]) state.playerAdvancements[playerName] = [];
    state.playerAdvancements[playerName].push({ name: advName, timestamp: Math.floor(Date.now() / 1000) });
    saveState(state);
    await log(`🏆 ${playerName} earned: **${advName}**`, '\u200b', 0xffcc00);
    return;
  }

  if (line.startsWith('__PLAYER_DEATH__:')) {
    const parts = line.split(':');
    const playerName = parts[1];
    const deathMsg = parts.slice(2).join(':');
    await log(`💀 ${playerName} died`, deathMsg, 0xff4400);
    return;
  }

  if (line.startsWith('__CHAT__:')) {
    const parts = line.split(':');
    const playerName = parts[1];
    const msg = parts.slice(2).join(':');
    await log(`💬 **${playerName}**: ${msg}`, '\u200b', 0x888888);
    return;
  }

  if (line.startsWith('__RAW__:')) {
    const text = line.slice(8);
    await log('📋 Server Log', text, 0x333333);
    return;
  }
});

// ─── Interaction handler ──────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  // Modal submit
  if (interaction.type === InteractionType.ModalSubmit) {
    if (!isAllowed(interaction.user.id)) {
      return interaction.reply({ content: '❌ Not authorized.', flags: MessageFlags.Ephemeral });
    }
    if (interaction.customId === 'modal_seed') {
      const seed = interaction.fields.getTextInputValue('seed_input').trim();
      state.worldConfig.seed = seed;
      saveState(state);
      await interaction.reply({ content: `✅ Seed set to: \`${seed || 'Random'}\``, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  // Select menus
  if (interaction.isStringSelectMenu()) {
    if (!isAllowed(interaction.user.id)) {
      return interaction.reply({ content: '❌ Not authorized.', flags: MessageFlags.Ephemeral });
    }

    if (interaction.customId === 'select_gamemode') {
      const gm = interaction.values[0];
      state.worldConfig.gamemode = gm;
      state.worldConfig.worldExists = true;
      saveState(state);
      await interaction.update({ content: `✅ Gamemode set to **${gm}**. Starting server...`, components: [] });
      await log('⚙️ Server Starting...', `Version: \`${state.worldConfig.version}\` | Mode: \`${gm}\``, 0xffaa00);
      const ok = await server.startServer(state.worldConfig.version, gm, state.worldConfig.seed, state.crackMode);
      if (!ok) await interaction.followUp({ content: '❌ Server already running!', flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.customId === 'select_version') {
      const version = interaction.values[0];
      state.worldConfig.version = version;
      saveState(state);
      await interaction.update({ content: `✅ Version switched to **${version}**`, components: [] });
      return;
    }
    return;
  }

  if (!interaction.isButton()) return;
  if (!isAllowed(interaction.user.id)) {
    return interaction.reply({ content: '❌ You are not authorized.', flags: MessageFlags.Ephemeral });
  }

  const id = interaction.customId;

  // ── START ──
  if (id === 'mc_start') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (server.getStatus() !== 'offline') {
      return interaction.editReply({ content: '⚠️ Server is already running or starting!' });
    }

    // If world exists, use existing config
    if (state.worldConfig.worldExists && state.worldConfig.gamemode) {
      await interaction.editReply({ content: `🟢 Starting **${state.worldConfig.gamemode}** world (${state.worldConfig.version})...` });
      await log('⚙️ Server Starting...', `Version: \`${state.worldConfig.version}\` | Mode: \`${state.worldConfig.gamemode}\``, 0xffaa00);
      await server.startServer(state.worldConfig.version, state.worldConfig.gamemode, state.worldConfig.seed, state.crackMode);
      return;
    }

    // Ask gamemode for new world
    const select = new StringSelectMenuBuilder()
      .setCustomId('select_gamemode')
      .setPlaceholder('Choose world type')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Survival').setValue('survival').setEmoji('⚔️').setDescription('Classic survival gameplay'),
        new StringSelectMenuOptionBuilder().setLabel('Creative').setValue('creative').setEmoji('🎨').setDescription('Unlimited resources'),
        new StringSelectMenuOptionBuilder().setLabel('Hardcore').setValue('hardcore').setEmoji('💀').setDescription('One life — death deletes world'),
      );

    await interaction.editReply({ content: '🌍 **New world!** Choose gamemode:', components: [new ActionRowBuilder().addComponents(select)] });
    return;
  }

  // ── STOP ──
  if (id === 'mc_stop') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (server.getStatus() === 'offline') return interaction.editReply({ content: '⚠️ Server is already offline.' });
    await log('⬛ Server Stopping...', 'Stop command received.', 0x555555);
    server.sendCommand('say Server stopping in 5 seconds...');
    await new Promise(r => setTimeout(r, 3000));
    await server.stopServer();
    await stopTunnel().catch(() => {});
    server.setNgrokUrl(null);
    return interaction.editReply({ content: '🛑 Server stopped.' });
  }

  // ── RESTART ──
  if (id === 'mc_restart') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (server.getStatus() === 'offline') return interaction.editReply({ content: '⚠️ Server is offline, use Start.' });
    await log('🔄 Server Restarting...', '\u200b', 0xffaa00);
    server.sendCommand('say Restarting server...');
    await new Promise(r => setTimeout(r, 2000));
    await server.restartServer(state.worldConfig.version, state.worldConfig.gamemode || 'survival', state.worldConfig.seed, state.crackMode);
    return interaction.editReply({ content: '🔄 Server restarting...' });
  }

  // ── DELETE WORLD ──
  if (id === 'mc_delete_world') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (server.getStatus() !== 'offline') {
      server.sendCommand('say World is being deleted! Server stopping...');
      await new Promise(r => setTimeout(r, 2000));
      await log('⬛ Server Stopping...', '\u200b', 0x555555);
      await server.stopServer();
      await stopTunnel().catch(() => {});
      server.setNgrokUrl(null);
    }

    await log('🗑️ Deleting World...', `Wiping \`${state.worldConfig.version}\` + seed + player logs`, 0xff4400);
    server.deleteWorld();
    await deleteAllPlayerChannels();

    state.worldConfig.gamemode = null;
    state.worldConfig.seed = '';
    state.worldConfig.worldExists = false;
    state.playerChannels = {};
    state.playerAdvancements = {};
    saveState(state);

    return interaction.editReply({ content: '🗑️ World deleted! All player channels removed. Click Start to create a new world.' });
  }

  // ── CRACK TOGGLE ──
  if (id === 'mc_crack_toggle') {
    if (server.getStatus() !== 'offline') {
      return interaction.reply({ content: '⚠️ Stop the server first to toggle crack mode.', flags: MessageFlags.Ephemeral });
    }
    state.crackMode = !state.crackMode;
    saveState(state);
    return interaction.reply({ content: `🔓 Cracked mode is now **${state.crackMode ? 'ON' : 'OFF'}**`, flags: MessageFlags.Ephemeral });
  }

  // ── CUSTOM SEED ──
  if (id === 'mc_custom_seed') {
    const modal = new ModalBuilder().setCustomId('modal_seed').setTitle('Set Custom Seed');
    const seedInput = new TextInputBuilder()
      .setCustomId('seed_input')
      .setLabel('Enter seed (blank = random)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('e.g. 12345678 or leave blank for random')
      .setValue(state.worldConfig.seed || '');
    modal.addComponents(new ActionRowBuilder().addComponents(seedInput));
    return interaction.showModal(modal);
  }

  // ── SWITCH VERSION ──
  if (id === 'mc_switch_version') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let versions;
    try {
      versions = await getAllVersions();
    } catch (e) {
      versions = ['1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.9'];
    }
    const top = versions.slice(0, 25);
    const options = top.map(v =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`Minecraft ${v}`)
        .setValue(v)
        .setDefault(v === state.worldConfig.version)
    );
    const select = new StringSelectMenuBuilder()
      .setCustomId('select_version')
      .setPlaceholder('Select Minecraft version')
      .addOptions(options);
    return interaction.editReply({ content: '🔀 Choose a version (the world will reset on version change):', components: [new ActionRowBuilder().addComponents(select)] });
  }
});

// ─── Message commands ─────────────────────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!isAllowed(message.author.id)) return;

  if (message.content === '!delete') {
    try {
      const controlMsgId = state.controlMessageId;
      let totalDeleted = 0;
      let keepDeleting = true;

      while (keepDeleting) {
        const msgs = await message.channel.messages.fetch({ limit: 100 });
        // Filter out the control embed message
        const toDelete = msgs.filter(m => m.id !== controlMsgId);
        if (toDelete.size === 0) { keepDeleting = false; break; }

        // bulkDelete only works for messages < 14 days old
        const recent = toDelete.filter(m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
        if (recent.size > 1) {
          const deleted = await message.channel.bulkDelete(recent, true);
          totalDeleted += deleted.size;
          if (deleted.size < 2) keepDeleting = false;
        } else if (recent.size === 1) {
          await recent.first().delete().catch(() => {});
          totalDeleted++;
          keepDeleting = false;
        } else {
          keepDeleting = false;
        }

        if (keepDeleting) await new Promise(r => setTimeout(r, 500));
      }

      console.log(`[!delete] Deleted ${totalDeleted} messages`);
    } catch (e) {
      console.error('[!delete]', e.message);
    }
    return;
  }
});

// ─── Message delete — recreate control embed ──────────────────────────────────
client.on(Events.MessageDelete, async (message) => {
  if (message.id === state.controlMessageId) {
    console.log('[Bot] Control embed was deleted — resending...');
    controlMessage = null;
    state.controlMessageId = null;
    saveState(state);
    // Small delay then resend
    await new Promise(r => setTimeout(r, 1000));
    await sendControlEmbed();
  }
});

// ─── Ready ────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);

  const guild = client.guilds.cache.get(config.GUILD_ID);
  if (!guild) { console.error('[Bot] Guild not found!'); return; }

  try { await guild.channels.fetch(); } catch (e) {}

  logChannel = guild.channels.cache.get(config.LOGS_CHANNEL_ID);
  controlChannel = guild.channels.cache.get(config.CONTROL_CHANNEL_ID);

  if (!logChannel) console.error('[Bot] Log channel not found:', config.LOGS_CHANNEL_ID);
  if (!controlChannel) console.error('[Bot] Control channel not found:', config.CONTROL_CHANNEL_ID);

  // Recover or send control embed
  if (state.controlMessageId && controlChannel) {
    try {
      controlMessage = await controlChannel.messages.fetch(state.controlMessageId);
      console.log('[Bot] Recovered control message');
    } catch (e) {
      controlMessage = null;
    }
  }

  if (!controlMessage) {
    await sendControlEmbed();
  }

  startEmbedUpdater();

  // Install Java in background
  ensureJava().then(javaPath => {
    server.setJavaPath(javaPath);
    console.log('[Bot] Java ready:', javaPath);
  }).catch(e => {
    console.error('[Bot] Java setup failed:', e.message);
  });

  // Pre-download all version jars in background so every version starts instantly
  downloadAllJars((msg) => {
    console.log('[DownloadAll]', msg);
  }).catch(e => {
    console.error('[DownloadAll] Error:', e.message);
  });

  await log('🤖 Bot Online', 'Minecraft server bot is ready! Use the control panel to start the server.\n📦 Pre-downloading all version jars in background...', 0x00aaff);
  console.log('[Bot] Ready!');
});

client.on('error', (e) => console.error('[Client Error]', e.message));
process.on('unhandledRejection', (e) => console.error('[Unhandled Rejection]', e?.message || e));
process.on('uncaughtException', (e) => console.error('[Uncaught Exception]', e.message));

client.login(config.DISCORD_TOKEN).catch(e => {
  console.error('[Bot] Login failed:', e.message);
  process.exit(1);
});
