/**
 * Vaani BYOL WebSocket server (Phase 4). Vaani connects here for every call and sends each caller
 * turn; we answer with the rules-driven, pricing-guarded reply. Must be reachable over wss:// —
 * locally via a tunnel (Cloudflare Tunnel / ngrok) for the demo, or any always-on Node host.
 *
 *   npm run voice:server            # listens on :8090 (PORT to override)
 *
 * Auth: Vaani sends `Authorization: Bearer <VAANI_BYOL_TOKEN>` (set the same token in the agent's
 * BYOL tab). Path: /chat/stream/<call_id> (Vaani appends the call id).
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { rulesConfig } from '../config/rules.config';
import { logger } from '../src/lib/logger';
import { buildCalendar, buildLlm, buildOutboxDeps, buildStore, loadLocalEnv } from '../src/services/container';
import { ByolConnection } from '../src/voice/byol';

loadLocalEnv();
const PORT = Number(process.env.PORT ?? 8090);
const TOKEN = (process.env.VAANI_BYOL_TOKEN ?? '').trim();
if (!TOKEN) throw new Error('Set VAANI_BYOL_TOKEN in .env.local (and the same token in Vaani → agent → BYOL → Auth Token).');

const store = buildStore();
const llm = buildLlm();
let calendar = null;
try {
  calendar = buildCalendar();
} catch (e) {
  logger.warn('voice.calendar_disabled', { message: (e as Error).message });
}
const outbox = buildOutboxDeps();

function authorised(header: string | undefined): boolean {
  const want = `Bearer ${TOKEN}`;
  return !!header && header.length === want.length && timingSafeEqual(Buffer.from(header), Buffer.from(want));
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, model: llm.model }));
    return;
  }
  res.writeHead(404).end();
});
const wss = new WebSocketServer({ noServer: true });

http.on('upgrade', (req, socket, head) => {
  const path = (req.url ?? '').split('?')[0]!;
  if (!path.startsWith('/chat/stream') || !authorised(req.headers.authorization)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, path));
});

wss.on('connection', (ws: WebSocket, path: string) => {
  const providerCallId = decodeURIComponent(path.split('/').filter(Boolean).at(-1) ?? `call-${Date.now()}`);
  const conn = new ByolConnection({ llm, store, calendar, outbox }, providerCallId, (frame) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  });
  logger.info('voice.connected', { providerCallId });
  conn.hello();
  const ping = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ response_type: 'ping_pong' })), rulesConfig.voice.pingSeconds * 1000);
  ws.on('message', (data) => void conn.onFrame(data.toString()));
  ws.on('close', () => {
    clearInterval(ping);
    logger.info('voice.closed', { providerCallId });
    void conn.onClose();
  });
});

http.listen(PORT, () => console.log(`Aangan BYOL server on :${PORT} (ws path /chat/stream/<call_id>, model ${llm.model})`));
