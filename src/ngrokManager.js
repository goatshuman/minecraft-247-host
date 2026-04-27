const ngrok = require('@ngrok/ngrok');
const { NGROK_AUTH_TOKEN, MC_PORT } = require('./config');

let currentListener = null;

async function startTunnel() {
  try {
    if (currentListener) {
      try { await currentListener.close(); } catch (e) {}
      currentListener = null;
    }
    currentListener = await ngrok.connect({
      proto: 'tcp',
      addr: MC_PORT,
      authtoken: NGROK_AUTH_TOKEN,
      region: 'in',
    });
    const url = currentListener.url();
    console.log('[ngrok] Tunnel started (India):', url);
    return url;
  } catch (e) {
    console.error('[ngrok] Failed to start tunnel:', e.message);
    // Retry without region if India fails
    try {
      currentListener = await ngrok.connect({
        proto: 'tcp',
        addr: MC_PORT,
        authtoken: NGROK_AUTH_TOKEN,
      });
      const url = currentListener.url();
      console.log('[ngrok] Tunnel started (fallback):', url);
      return url;
    } catch (e2) {
      console.error('[ngrok] Fallback also failed:', e2.message);
      return null;
    }
  }
}

async function stopTunnel() {
  try {
    if (currentListener) {
      await currentListener.close();
      currentListener = null;
    }
    await ngrok.disconnect().catch(() => {});
  } catch (e) {}
}

module.exports = { startTunnel, stopTunnel };
