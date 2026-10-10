/**
 * One-off LIVE integration test (run only with the owner's OK): sends one clearly-labelled TEST
 * call through the real pipeline — Supabase → outbox → HubSpot (contact + deal) → Telegram
 * (designer handoff). Uses a dummy number. Afterwards removes the Supabase rows and prints the
 * HubSpot ids so the test contact/deal can be deleted.
 *   npx tsx scripts/live-integration-test.ts
 */
import { randomUUID } from 'node:crypto';
import { validateQuotes } from '../src/extraction/quote-validator';
import { setLogSink } from '../src/lib/logger';
import { evaluate } from '../src/rules/engine';
import { buildOutboxDeps, loadLocalEnv } from '../src/services/container';
import { finalizeCall } from '../src/services/finalize-call';
import { processOutbox } from '../src/services/outbox';
import { casesById } from '../tests/fixtures/cases';
import { C } from '../tests/fixtures/cases/_helpers';

loadLocalEnv();
setLogSink((l) => {
  if (/"level":"(warn|error)"/.test(l)) console.log(l);
});

const PHONE = '+910000000099';
const NAME = 'TEST — Aangan smoke';
const callId = randomUUID();
const deps = buildOutboxDeps();
const url = process.env.SUPABASE_URL!.trim().replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const del = (path: string) => fetch(`${url}/rest/v1/${path}`, { method: 'DELETE', headers: H });

// T01 (qualified) with a TEST caller name added to the transcript.
const fx = casesById.get('T01')!;
const transcript = [...fx.transcript, C(`This is a ${NAME} call, please ignore.`)];
const fields = { ...fx.extraction.fields, caller_name: { value: NAME, quote: NAME, turn: null } };
const { extraction, rejected } = validateQuotes({ ...fx.extraction, fields }, transcript);
if (rejected.length) throw new Error(`fixture quotes rejected: ${JSON.stringify(rejected)}`);
const evaluation = evaluate(extraction, { callDate: fx.callDate, asked: fx.asked, rulesVersion: 'live-test' });

let leadId: string | null = null;
try {
  const r = await finalizeCall(deps.store, {
    callId, callerPhone: PHONE, startedAt: new Date().toISOString(), endedAt: new Date(Date.now() + 240_000).toISOString(),
    callDate: fx.callDate, transcript, extraction, evaluation, asked: fx.asked,
  });
  leadId = r.leadId;
  console.log(`call finalised: outcome=${evaluation.outcome}, queued=${r.jobsQueued.join(', ')}`);

  const report = await processOutbox(deps, 10);
  console.log(`outbox: ${JSON.stringify(report)}`);

  const lead = leadId ? await deps.store.getLead(leadId) : null;
  console.log(`HubSpot contact id: ${lead?.hubspot_contact_id ?? '(none)'}`);
  console.log(`HubSpot deal id:    ${lead?.hubspot_deal_id ?? '(none)'}`);
  const errs = await (await fetch(`${url}/rest/v1/integration_errors?call_id=eq.${callId}&select=service,operation,message`, { headers: H })).json();
  console.log(`integration errors: ${JSON.stringify(errs)}`);
} finally {
  await del(`integration_errors?call_id=eq.${callId}`);
  await del(`integration_jobs?call_id=eq.${callId}`);
  await del(`handoffs?call_id=eq.${callId}`);
  await del(`followup_tasks?call_id=eq.${callId}`);
  await del(`cost_events?call_id=eq.${callId}`);
  await del(`calls?id=eq.${callId}`);
  if (leadId) await del(`leads?id=eq.${leadId}`);
  console.log('Supabase test rows removed.');
}
