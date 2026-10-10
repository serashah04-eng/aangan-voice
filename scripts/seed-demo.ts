/**
 * Demo data for the dashboard: replays every labelled fixture as a call spread over the last 14
 * days, through the REAL finalizeCall → Supabase path, with MOCK HubSpot/Telegram/email/calendar
 * (nothing leaves the database). Every row is marked provider='demo' and uses dummy numbers
 * (+9190000xxxxx), so it is easy to remove.
 *   npm run seed:demo            # add demo calls
 *   npm run seed:demo -- --clear # remove all demo data
 */
import { randomUUID } from 'node:crypto';
import { costConfig } from '../config/cost.config';
import { MockCalendar } from '../src/adapters/calendar/mock';
import { MockCrm } from '../src/adapters/crm/mock';
import { MockNotifier } from '../src/adapters/notify/mock';
import { validateQuotes } from '../src/extraction/quote-validator';
import { llmCostEvent } from '../src/lib/cost';
import { setLogSink } from '../src/lib/logger';
import { evaluate } from '../src/rules/engine';
import { confirmBooking, recordNoSuitableSlot } from '../src/services/booking';
import { buildStore, loadLocalEnv } from '../src/services/container';
import { finalizeCall } from '../src/services/finalize-call';
import { processOutbox } from '../src/services/outbox';
import { allCases } from '../tests/fixtures/cases';

loadLocalEnv();
setLogSink(() => {});
const url = process.env.SUPABASE_URL!.trim().replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${url}/rest/v1/${path}`, { method, headers: { ...H, Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path.split('?')[0]} → ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};

async function clear() {
  const demo = (await api('GET', 'calls?provider=eq.demo&select=id,lead_id')) as { id: string; lead_id: string | null }[];
  const ids = demo.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 50) {
    const list = `in.(${ids.slice(i, i + 50).join(',')})`;
    for (const t of ['integration_errors', 'integration_jobs', 'handoffs', 'bookings', 'followup_tasks', 'cost_events']) await api('DELETE', `${t}?call_id=${list}`);
    await api('DELETE', `calls?id=${list}`);
  }
  await api('DELETE', `leads?phone_e164=like.${encodeURIComponent('+9190000*')}`);
  console.log(`removed ${ids.length} demo calls and their leads`);
}

/** Deterministic pseudo-random so the demo looks the same each time. */
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

async function seedDemo() {
  const store = buildStore();
  const crm = new MockCrm();
  const tel = new MockNotifier('telegram');
  const mail = new MockNotifier('email');
  const now = Date.now();
  const assistedOutcome: Record<string, string> = { T03: 'not_qualified', T12: 'human_review_required', T11: 'qualified', W10: 'not_qualified' };
  let n = 0;

  for (const fx of allCases) {
    n++;
    const callId = randomUUID();
    const phone = `+9190000${String(10000 + n).slice(-5)}`;
    // Spread over 14 days; ~1/3 after hours (IST 19:00–10:00).
    const dayOffset = Math.floor(rand() * 14);
    const afterHours = rand() < 0.34;
    const istHour = afterHours ? (rand() < 0.5 ? 7 + Math.floor(rand() * 3) : 19 + Math.floor(rand() * 4)) : 10 + Math.floor(rand() * 9);
    const day = new Date(now - dayOffset * 86_400_000);
    const startedMs = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), istHour, Math.floor(rand() * 60)) - 330 * 60_000;
    if (startedMs > now) continue;
    const durationS = 90 + Math.floor(rand() * 300);
    const startedAt = new Date(startedMs).toISOString();
    const endedAt = new Date(startedMs + durationS * 1000).toISOString();

    const { extraction } = validateQuotes(fx.extraction, fx.transcript);
    const evaluation = evaluate(extraction, { callDate: fx.callDate, asked: fx.asked, rulesVersion: 'demo' });
    const cost = llmCostEvent('gemini-3.1-flash-lite', { inputTokens: 2272, outputTokens: 951, thinkingTokens: 1121 }, startedAt.slice(0, 10), 'extraction');
    const telephonyMinutes = Math.ceil(durationS / 60);

    await store.saveCall({ id: callId, caller_phone_e164: phone, provider: 'demo', started_at: startedAt });
    const r = await finalizeCall(store, {
      callId, callerPhone: phone, startedAt, endedAt, callDate: fx.callDate, transcript: fx.transcript, extraction, evaluation, asked: fx.asked,
      run: { model: 'gemini-3.1-flash-lite', promptVersion: 'extractor-v3', cost, modelSuggestedOutcome: assistedOutcome[fx.id] ?? evaluation.outcome },
      extraCosts: [{ kind: 'telephony', provider: 'vaani', units: { minutes: telephonyMinutes }, unitRates: { inrPerMinute: costConfig.telephonyInrPerMinute }, rateVersion: 'observed-2026-10-10', amountUsd: (telephonyMinutes * costConfig.telephonyInrPerMinute) / costConfig.usdToInrFx, occurredOn: startedAt.slice(0, 10), purpose: 'call' }],
      telephonyMinutes,
    });
    await api('PATCH', `calls?id=eq.${callId}`, { answered_at: new Date(startedMs + 800 + Math.floor(rand() * 2200)).toISOString() });

    // Bookings for most qualified leads (mock calendar), so handoff → booking rate is meaningful.
    if (evaluation.outcome === 'qualified' && r.leadId) {
      const slotStart = new Date(startedMs + 3 * 86_400_000).toISOString();
      const cal = new MockCalendar([{ start: slotStart, end: new Date(startedMs + 3 * 86_400_000 + 3_600_000).toISOString() }]);
      const ctx = { leadId: r.leadId, callId, attendeeName: r.summary?.name ?? 'Caller', attendeePhone: phone, preference: r.summary?.consultationPreference ?? null };
      if (rand() < 0.75) await confirmBooking({ store, calendar: cal }, ctx, cal.free[0]!);
      else await recordNoSuitableSlot({ store, calendar: cal }, ctx);
    }
  }

  // Deliver queued jobs with mock externals; handoffs land a minute or two after each call.
  let total = 0;
  for (;;) {
    const rep = await processOutbox({ store, crm, telegram: tel, email: mail, targets: { designerChatId: 'demo', studioHeadChatId: 'demo', designerEmail: 'demo@example.test', studioHeadEmail: 'demo@example.test', appBaseUrl: process.env.APP_BASE_URL ?? '' } }, 25);
    total += rep.done;
    if (!rep.claimed) break;
  }
  const demoCalls = (await api('GET', 'calls?provider=eq.demo&select=id,ended_at')) as { id: string; ended_at: string }[];
  const endById = new Map(demoCalls.map((c) => [c.id, c.ended_at]));
  const hs = (await api('GET', `handoffs?call_id=in.(${demoCalls.map((c) => c.id).join(',')})&select=id,call_id,kind`)) as { id: string; call_id: string; kind: string }[];
  for (const h of hs) {
    const ended = new Date(endById.get(h.call_id)!).getTime();
    const sent = new Date(ended + (40 + Math.floor(rand() * 140)) * 1000).toISOString();
    const patch: Record<string, unknown> = { sent_at: sent, created_at: sent };
    if (h.kind === 'escalation' && rand() < 0.6) patch.resolved_at = new Date(ended + (1 + rand() * 20) * 3_600_000).toISOString();
    await api('PATCH', `handoffs?id=eq.${h.id}`, patch);
  }
  console.log(`seeded ${n} demo calls · ${total} outbox jobs delivered (mock) · ${hs.length} handoffs`);
}

if (process.argv.includes('--clear')) await clear();
else await seedDemo();
