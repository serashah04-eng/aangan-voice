import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from './src/dashboard/session';

/** Everything under /dashboard requires a valid session; otherwise redirect to /login. */
export async function middleware(req: NextRequest) {
  const ok = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.DASHBOARD_SESSION_SECRET);
  if (ok) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/dashboard/:path*'] };
