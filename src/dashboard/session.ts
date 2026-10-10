/**
 * Dashboard session: a signed, expiring cookie (HMAC-SHA256 via Web Crypto, so it works in both
 * the Edge middleware and Node route handlers). The password and signing secret are env vars:
 * DASHBOARD_PASSWORD and DASHBOARD_SESSION_SECRET. Read-only dashboard; no user data in the cookie.
 */

export const SESSION_COOKIE = 'aangan_dash';
export const SESSION_HOURS = 12;

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSession(secret: string, now = Date.now()): Promise<string> {
  const payload = String(now + SESSION_HOURS * 3_600_000);
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifySession(token: string | undefined, secret: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !secret) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !/^\d+$/.test(payload)) return false;
  if (Number(payload) < now) return false;
  return safeEqual(sig, await hmac(secret, payload));
}
