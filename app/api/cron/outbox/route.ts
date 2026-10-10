import { timingSafeEqual } from 'node:crypto';
import { buildOutboxDeps } from '../../../../src/services/container';
import { processOutbox } from '../../../../src/services/outbox';
import { logger } from '../../../../src/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? '').trim();
  const got = req.headers.get('authorization') ?? '';
  const want = `Bearer ${secret}`;
  if (!secret || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/**
 * Drains the integration_jobs outbox (HubSpot sync, designer handoffs, escalation alerts).
 * Called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`; anything else gets 401.
 */
export async function GET(req: Request) {
  if (!authorised(req)) return new Response('unauthorised', { status: 401 });
  try {
    const report = await processOutbox(buildOutboxDeps(), 25);
    return Response.json(report);
  } catch (e) {
    logger.error('cron.outbox_failed', { message: (e as Error).message });
    return Response.json({ error: 'outbox run failed' }, { status: 500 });
  }
}
