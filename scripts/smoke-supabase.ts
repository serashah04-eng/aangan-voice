/**
 * Live smoke test against the real Supabase project with MOCK HubSpot/Telegram/email (nothing
 * leaves the database). Finalises one fixture call, checks the phone lookup RPC, drains the
 * outbox, verifies the rows, then deletes everything it created.
 *   npm run smoke:supabase
 */
import { randomUUID } from 'node:crypto';
import { MockCrm } from '../src/adapters/crm/mock';
import { MockNotifier } from '../src/adapters/notify/mock';
import { validateQuotes } from '../src/extraction/quote-validator';
import { setLogSink } from '../src/lib/logger';
import { evaluate } from '../src/rules/engine';
import { buildStore, loadLocalEnv } from '../src/services/container';
import { finalizeCall } from '../src/services/finalize-call';
import { processOutbox } from '../src/services/outbox';
import { findResumableCall } from '../src/services/resume';
import { casesById } from '../tests/fixtures/cases';

loadLocalEnv();
setLogSink(() => {});
const store = buildStore();
const url = process.env.SUPABASE_URL!.trim().replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = async (path: string): Promise<any[]> => (await fetch(`${url}/rest/v1/${path}`, { headers: H })).json() as Promise<any[]>;
const del = (path: string) => fetch(`${url}/rest/v1/${path}`, { method: 'DELETE', headers: H });

const PHONE = '+910000000099';
const callId = randomUUID();
const fx = casesById.get('T01')!;
const check = (label: string, ok: boolean, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
let failures = 0;
const expectOk = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  check(label, ok, detail);
};

try {
  // 1. A call starts and drops → resumable.
  await store.saveCall({ id: callId, caller_phone_e164: PHONE, status: 'dropped', started_at: new Date().toISOString() });
  expectOk('dropped call is resumable via RPC', (await findResumableCall(store, PHONE, new Date()))?.id === callId);

  // 2. Finalise it with the T01 transcript.
  const { extraction } = validateQuotes(fx.extraction, fx.transcript);
  const evaluation = evaluate(extraction, { callDate: fx.callDate, asked: fx.asked, rulesVersion: 'smoke-test' });
  const r = await finalizeCall(store, {
    callId, callerPhone: PHONE, startedAt: new Date().toISOString(), endedAt: new Date(Date.now() + 240_000).toISOString(),
    callDate: fx.callDate, transcript: fx.transcript, extraction, evaluation, asked: fx.asked,
  });
  expectOk('finalizeCall outcome', evaluation.outcome === 'qualified', evaluation.outcome);

  const [call] = await get(`calls?id=eq.${callId}`);
  expectOk('calls row', call?.outcome === 'qualified' && call?.lead_id === r.leadId && call?.status === 'completed');
  const turns = await get(`transcript_turns?call_id=eq.${callId}&select=turn_index`);
  expectOk('transcript_turns rows', turns.length === fx.transcript.length, `${turns.length}`);
  const ev = await get(`criterion_evidence?call_id=eq.${callId}&select=criterion,state,rule_id`);
  expectOk('criterion_evidence rows', ev.length === 6, ev.map((e: { criterion: string; state: string }) => `${e.criterion}:${e.state}`).join(' '));
  const jobs = await get(`integration_jobs?call_id=eq.${callId}&select=kind,status`);
  expectOk('jobs queued', jobs.length === 2, jobs.map((j: { kind: string }) => j.kind).join(', '));

  // 3. Drain the outbox with mock externals (exercises the claim RPC on the real DB).
  const deps = { store, crm: new MockCrm(), telegram: new MockNotifier('telegram'), email: new MockNotifier('email'), targets: { designerChatId: 'x', studioHeadChatId: 'y', designerEmail: 'a@example.test', studioHeadEmail: 'b@example.test', appBaseUrl: 'http://localhost:3000' } };
  const report = await processOutbox(deps, 10);
  expectOk('outbox drained', report.done >= 2, JSON.stringify(report));
  const [lead] = await get(`leads?id=eq.${r.leadId}&select=hubspot_contact_id,hubspot_deal_id,latest_outcome`);
  expectOk('lead updated with CRM ids', !!lead?.hubspot_contact_id && !!lead?.hubspot_deal_id);
  const handoffs = await get(`handoffs?call_id=eq.${callId}&select=status,channel`);
  expectOk('handoff recorded', handoffs[0]?.status === 'sent', JSON.stringify(handoffs));
  expectOk('designer message built', deps.telegram.sent[0]?.message.body.includes('Kothrud') ?? false);
} finally {
  // 4. Clean up everything this run created.
  await del(`integration_jobs?call_id=eq.${callId}`);
  await del(`handoffs?call_id=eq.${callId}`);
  await del(`followup_tasks?call_id=eq.${callId}`);
  await del(`cost_events?call_id=eq.${callId}`);
  await del(`calls?id=eq.${callId}`); // cascades transcript_turns and criterion_evidence
  const leads = await (await fetch(`${url}/rest/v1/rpc/find_recent_call`, { method: 'POST', headers: H, body: JSON.stringify({ p_phone: PHONE, p_since: '2000-01-01T00:00:00Z' }) })).json();
  await fetch(`${url}/rest/v1/leads?phone_e164=eq.${encodeURIComponent(PHONE)}`, { method: 'DELETE', headers: H });
  const left = await get('leads?select=id');
  console.log(`cleanup done — calls for test number left: ${Array.isArray(leads) ? leads.length : '?'}, leads in table: ${left.length}`);
}
process.exitCode = failures ? 1 : 0;
