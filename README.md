# Minecraft 24/7 Discord Bot Host

A fully-featured Discord bot that hosts and manages a Minecraft server directly from Discord — **no extra tools needed**.

## Features

- **Control Panel** — Discord embed with live status (updates every second)
- **One-click start/stop/restart** — full server lifecycle management
- **Version switching** — supports every Minecraft version from 1.2.5 to latest
- **Upload World** — send a `.zip` of your world and it gets installed instantly
- **Upload Mods** — send a `.zip` of your mods folder and it gets installed instantly
- **Auto GitHub sync** — every upload auto-commits and pushes to this repo
- **Auto Render deploy** — triggers redeployment after every upload
- **ngrok TCP tunnel** — India region, auto-generates a public IP
- **Java 25 auto-install** — downloads and installs Temurin 25 automatically
- **Cracked mode** — toggle online/offline mode
- **Custom seeds** — set any world seed
- **Per-player tracking** — coords, health, food, advancements (updates every second)
- **Keep-alive web server** — prevents hosting platforms from sleeping

## Setup

### Environment Variables

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Your Discord bot token |
| `NGROK_AUTH_TOKEN` | ngrok auth token |
| `GITHUB_TOKEN` | GitHub personal access token (repo scope) |
| `GUILD_ID` | Your Discord server ID |
| `LOGS_CHANNEL_ID` | Channel ID for server logs |
| `CONTROL_CHANNEL_ID` | Channel ID for the control embed |
| `PLAYER_CATEGORY_ID` | Category ID for per-player channels |
| `ALLOWED_USER_ID` | Discord user ID allowed to control the bot |
| `RENDER_DEPLOY_HOOK` | *(optional)* Render deploy hook URL for auto-redeploy |

### Running Locally

```bash
npm install
node src/bot.js
```

### Keep-alive Server

```bash
node keep_alive.js
```

### Deploying to Render

- **Root directory**: `mc-bot/`
- **Build command**: `npm install`
- **Start command**: `node src/bot.js`
- Set all environment variables in Render dashboard

## How to Upload Your World / Mods

1. Click **📁 Upload World** or **🔧 Upload Mods** in the Discord control embed
2. The bot will ask you to send a `.zip` file
3. Drag and drop your zip into Discord and send it
4. The bot extracts it, installs it, pushes to GitHub, and triggers a Render redeploy automatically

## File Structure

```
mc-bot/
├── src/
│   ├── bot.js           # Main Discord bot + interaction handler
│   ├── serverManager.js # Minecraft server lifecycle
│   ├── ngrokManager.js  # ngrok TCP tunnel
│   ├── java.js          # Java 25 auto-installer
│   ├── embed.js         # Discord embed + buttons builder
│   ├── uploader.js      # World/mods upload + GitHub push + Render deploy
│   ├── rcon.js          # RCON connection for player data
│   ├── downloadAll.js   # Pre-downloads all version jars
│   ├── versions.js      # Minecraft version list
│   ├── config.js        # Environment variable config
│   └── state.js         # Persistent state (save/load)
├── keep_alive.js        # HTTP keep-alive server
├── render.yaml          # Render deployment config
└── package.json
```

> **Note:** `jars/`, `java/`, `server/`, and `node_modules/` are excluded from git (auto-generated at runtime).
