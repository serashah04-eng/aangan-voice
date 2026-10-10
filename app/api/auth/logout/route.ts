import { SESSION_COOKIE } from '../../../../src/dashboard/session';

export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return new Response(null, {
    status: 303,
    headers: { Location: new URL('/login', req.url).toString(), 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` },
  });
}
