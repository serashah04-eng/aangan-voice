// Connects to the BYOL server like Vaani does and checks the handshake + auth. Sends no caller turns.
// Usage: node scripts/byol-check.mjs wss://<host>
import WebSocket from 'ws';

process.loadEnvFile('.env.local');
const base = process.argv[2].replace(/^https:/, 'wss:').replace(/\/+$/, '');
const token = process.env.VAANI_BYOL_TOKEN.trim();

function tryConnect(auth) {
  return new Promise((resolve) => {
    const frames = [];
    const ws = new WebSocket(`${base}/chat/stream/byol-check-${Date.now()}`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
    ws.on('message', (d) => {
      frames.push(JSON.parse(d.toString()).interaction_type);
      if (frames.length === 2) ws.close();
    });
    ws.on('close', () => resolve({ ok: true, frames }));
    ws.on('unexpected-response', (_req, res) => resolve({ ok: false, status: res.statusCode }));
    ws.on('error', (e) => resolve({ ok: false, error: e.message }));
    setTimeout(() => { ws.terminate(); resolve({ ok: false, error: 'timeout', frames }); }, 15000);
  });
}

console.log('with correct token →', JSON.stringify(await tryConnect(token)));
console.log('with wrong token   →', JSON.stringify(await tryConnect('wrong-token')));
console.log('with no token      →', JSON.stringify(await tryConnect(null)));
