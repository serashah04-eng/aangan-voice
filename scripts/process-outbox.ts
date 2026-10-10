/**
 * Drain the integration_jobs outbox once (HubSpot sync, designer handoffs, escalation alerts).
 * In production a Vercel Cron route calls processOutbox every minute; this script does the same
 * on demand:  npm run outbox
 */
import { buildOutboxDeps, loadLocalEnv } from '../src/services/container';
import { processOutbox } from '../src/services/outbox';

loadLocalEnv();
const report = await processOutbox(buildOutboxDeps(), Number(process.argv[2] ?? 20));
console.log(JSON.stringify(report));
