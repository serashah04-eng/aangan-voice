import { createSession, SESSION_COOKIE, SESSION_HOURS, safeEqual } from '../../../../src/dashboard/session';

export const dynamic = 'force-dynamic';

const attempts = new Map<string, { n: number; until: number }>();

/** Password sign-in for the read-only dashboard. Basic per-IP throttle against guessing. */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const a = attempts.get(ip);
  if (a && a.n >= 5 && a.until > Date.now()) return new Response('Too many attempts — try again in a few minutes.', { status: 429 });

  const form = await req.formData();
  const password = String(form.get('password') ?? '');
  const next = String(form.get('next') ?? '/dashboard');
  const expected = process.env.DASHBOARD_PASSWORD ?? '';
  const secret = process.env.DASHBOARD_SESSION_SECRET ?? '';
  const safeNext = next.startsWith('/dashboard') ? next : '/dashboard';

  if (!expected || !secret || !safeEqual(password, expected)) {
    attempts.set(ip, { n: (a?.n ?? 0) + 1, until: Date.now() + 5 * 60_000 });
    return Response.redirect(new URL(`/login?error=1&next=${encodeURIComponent(safeNext)}`, req.url), 303);
  }
  attempts.delete(ip);
  const token = await createSession(secret);
  const res = Response.redirect(new URL(safeNext, req.url), 303);
  const headers = new Headers(res.headers);
  headers.append('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`);
  return new Response(null, { status: 303, headers });
}
