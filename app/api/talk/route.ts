import { logger } from '../../../src/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * "Talk to Aangan" web call: asks Vaani for a WebRTC session (the agent speaks through our BYOL
 * server, so every reply goes through the rules engine and pricing guard) and returns only the
 * short-lived token and connection URL. The Vaani API key never leaves the server.
 *
 * Abuse protection (each session costs telephony minutes): per-IP and global limits, per instance.
 */
const perIp = new Map<string, number[]>();
let day = '';
let dayCount = 0;
const IP_LIMIT = 4; // sessions
const IP_WINDOW_MS = 10 * 60_000;
const DAILY_LIMIT = Number(process.env.TALK_DAILY_LIMIT ?? 60);

export async function POST(req: Request) {
  const key = (process.env.VAANI_API_KEY ?? '').trim();
  const agentId = (process.env.VAANI_AGENT_ID ?? '').trim();
  if (!key || !agentId) return Response.json({ error: 'Voice agent is not configured.' }, { status: 503 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const now = Date.now();
  const recent = (perIp.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  const today = new Date().toISOString().slice(0, 10);
  if (day !== today) {
    day = today;
    dayCount = 0;
  }
  if (recent.length >= IP_LIMIT || dayCount >= DAILY_LIMIT) {
    return Response.json({ error: 'Too many calls right now — please try again a little later.' }, { status: 429 });
  }
  perIp.set(ip, [...recent, now]);
  dayCount++;

  let body: { language?: string } = {};
  try {
    body = (await req.json()) as { language?: string };
  } catch {
    /* no body is fine */
  }

  try {
    const res = await fetch('https://api.vaanivoice.ai/api/trigger-call/', {
      method: 'POST',
      headers: { 'X-API-Key': key, 'X-Agent-Id': 'aangan-web-call', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentId,
        medium: 'webrtc',
        primary_language: body.language === 'hi' ? 'hi' : 'en',
        secondary_language: 'en',
        // Spoken by Vaani at connect; identical to the greeting configured on the agent.
        welcome_interruptible: false,
      }),
    });
    const data = (await res.json()) as { token?: string; connection_url?: string; room_name?: string; message?: string };
    if (!res.ok || !data.token || !data.connection_url) {
      logger.warn('talk.vaani_refused', { status: res.status, message: String(data.message ?? '').slice(0, 160) });
      return Response.json({ error: 'The voice line is unavailable right now. Please try again shortly.' }, { status: 502 });
    }
    return Response.json({ token: data.token, url: data.connection_url, room: data.room_name });
  } catch (e) {
    logger.error('talk.failed', { message: (e as Error).message });
    return Response.json({ error: 'Could not reach the voice service.' }, { status: 502 });
  }
}
