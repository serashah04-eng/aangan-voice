import { timingSafeEqual } from 'node:crypto';
import { buildStore } from '../../../../../src/services/container';
import { handleVaaniEvent, type VaaniEvent } from '../../../../../src/voice/webhook';
import { logger } from '../../../../../src/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Vaani webhook receiver. Vaani documents no request signing, so the URL carries a long random
 * secret (VAANI_WEBHOOK_SECRET): /api/voice/vaani/<secret>. Anything else gets 404.
 */
export async function POST(req: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  const want = (process.env.VAANI_WEBHOOK_SECRET ?? '').trim();
  if (!want || secret.length !== want.length || !timingSafeEqual(Buffer.from(secret), Buffer.from(want))) {
    return new Response('not found', { status: 404 });
  }
  let body: VaaniEvent;
  try {
    body = (await req.json()) as VaaniEvent;
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  try {
    const r = await handleVaaniEvent(buildStore(), body);
    return Response.json({ ok: true, ...r });
  } catch (e) {
    logger.error('vaani.webhook_failed', { event: body?.event, message: (e as Error).message });
    // 500 makes Vaani retry; the handler is idempotent.
    return Response.json({ ok: false }, { status: 500 });
  }
}
