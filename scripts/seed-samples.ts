/**
 * Load the 40 sample enquiries (T01–T20, W01–W10, F01–F10) into the dashboard from the backend.
 * Each call is replayed with its ORIGINAL date and time (IST), its transcript, and the real Gemini
 * extraction cached by the eval (falling back to the hand-written fixture), then run through the
 * real rules engine and finalizeCall → Supabase. HubSpot, Telegram, email and the calendar are
 * MOCKED, so nothing is sent anywhere. Rows are tagged provider='sample' (dummy +9190000… numbers).
 *
 *   npm run seed:samples             # load
 *   npm run cleanup:test -- --yes    # remove them (and any other test data)
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { costConfig } from '../config/cost.config';
import { EXTRACTOR_PROMPT_VERSION } from '../src/extraction/prompt';
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
import { casesById } from '../tests/fixtures/cases';
import { loadTestCases } from '../tests/fixtures/csv';

loadLocalEnv();
setLogSink(() => {});

/** id → [day in Sept 2026, "HH:MM" IST, duration seconds]. Phone calls use the durations in the enquiry log. */
const SLOTS: Record<string, [number, string, number]> = {
  T01: [2, '10:23', 252], T02: [3, '14:41', 308], T03: [3, '16:15', 160], T04: [4, '11:07', 202], T05: [5, '10:52', 404],
  T06: [5, '15:28', 301], T07: [8, '09:44', 195], T08: [9, '22:47', 18], T09: [10, '11:32', 352], T10: [11, '14:04', 220],
  T11: [12, '10:18', 382], T12: [15, '10:05', 450], T13: [16, '12:19', 368], T14: [17, '11:41', 295], T15: [18, '15:12', 344],
  T16: [19, '10:38', 318], T17: [22, '14:16', 270], T18: [23, '11:55', 182], T19: [24, '16:02', 170], T20: [25, '09:15', 284],
  W01: [3, '19:14', 240], W02: [8, '14:31', 75], W03: [12, '10:45', 190], W04: [15, '15:18', 260], W05: [20, '18:44', 120],
  W06: [17, '11:22', 215], W07: [5, '16:52', 110], W08: [10, '08:44', 280], W09: [25, '15:18', 230], W10: [22, '18:12', 150],
  F01: [1, '09:44', 270], F02: [4, '19:12', 235], F03: [6, '11:18', 205], F04: [9, '14:37', 95], F05: [11, '10:05', 330],
  F06: [14, '20:52', 360], F07: [16, '15:11', 60], F08: [18, '18:44', 190], F09: [20, '11:30', 250], F10: [26, '16:22', 275],
};

const url = process.env.SUPABASE_URL!.trim().replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${url}/rest/v1/${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path.split('?')[0]} → ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};

/** IST wall-clock → UTC ISO. */
const istToUtc = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(2026, 8, day, h, m) - 330 * 60_000);
};

// Deterministic pseudo-random for answer times and booking decisions.
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

const store = buildStore();
const crm = new MockCrm();
const tel = new MockNotifier('telegram');
const mail = new MockNotifier('email');
const csv = loadTestCases();
const cache = (id: string) => {
  const p = `eval/cache/gemini-3.1-flash-lite/${EXTRACTOR_PROMPT_VERSION}/${id}.json`;
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as { extraction: import('../src/domain/types').Extraction; cost: import('../src/lib/cost').CostEvent; model: string; promptVersion: string; modelSuggestedOutcome?: string }) : null;
};

const ids = Object.keys(SLOTS).sort();
let n = 0;
let usedCache = 0;
for (const id of ids) {
  n++;
  const phone = `+9190000${String(10000 + n).slice(-5)}`;
  const [day, hhmm, durationS] = SLOTS[id]!;
  const started = istToUtc(day, hhmm);
  const startedAt = started.toISOString();
  const endedAt = new Date(started.getTime() + durationS * 1000).toISOString();
  const callId = randomUUID();
  const row = csv.find((r) => r.case_id === id)!;
  const callDate = row.enquiry_date!;

  if (id === 'T08') {
    // The real log: a missed call at 10:47 pm, no voicemail. With this system it is answered; here it is
    // recorded as an after-hours call with no content (not a lead).
    await api('POST', 'calls?on_conflict=id', { id: callId, provider: 'sample', caller_phone_e164: phone, call_type: 'other', status: 'dropped', started_at: startedAt, answered_at: new Date(started.getTime() + 1500).toISOString(), ended_at: endedAt, duration_s: durationS, after_hours: true, end_reason: 'no_speech', outcome: 'not_applicable', telephony_minutes: Math.max(0.3, durationS / 60) });
    continue;
  }

  const fx = casesById.get(id);
  if (!fx) throw new Error(`no fixture for ${id}`);
  const cached = cache(id);
  if (cached) usedCache++;
  const source = cached?.extraction ?? validateQuotes(fx.extraction, fx.transcript).extraction;
  const evaluation = evaluate(source, { callDate, asked: fx.asked, rulesVersion: 'sample-load' });
  const cost = cached?.cost ?? llmCostEvent('gemini-3.1-flash-lite', { inputTokens: 2273, outputTokens: 956, thinkingTokens: 966 }, callDate, 'extraction');
  const minutes = Math.round((durationS / 60) * 100) / 100;

  await api('POST', 'calls?on_conflict=id', { id: callId, provider: 'sample', caller_phone_e164: phone, status: 'in_progress', started_at: startedAt });
  const r = await finalizeCall(store, {
    callId, callerPhone: phone, startedAt, endedAt, callDate, transcript: fx.transcript, extraction: source, evaluation, asked: fx.asked,
    run: { model: cached?.model ?? 'gemini-3.1-flash-lite', promptVersion: cached?.promptVersion ?? EXTRACTOR_PROMPT_VERSION, cost, modelSuggestedOutcome: cached?.modelSuggestedOutcome },
    extraCosts: [{ kind: 'telephony', provider: 'vaani', units: { minutes }, unitRates: { inrPerMinute: costConfig.telephonyInrPerMinute }, rateVersion: 'config', amountUsd: (minutes * costConfig.telephonyInrPerMinute) / costConfig.usdToInrFx, occurredOn: callDate, purpose: 'call' }],
    telephonyMinutes: minutes,
  });
  await api('PATCH', `calls?id=eq.${callId}`, { answered_at: new Date(started.getTime() + 800 + Math.floor(rand() * 2200)).toISOString() });

  if (evaluation.outcome === 'qualified' && r.leadId) {
    const slotStart = new Date(started.getTime() + 3 * 86_400_000).toISOString();
    const cal = new MockCalendar([{ start: slotStart, end: new Date(started.getTime() + 3 * 86_400_000 + 3_600_000).toISOString() }]);
    const ctx = { leadId: r.leadId, callId, attendeeName: r.summary?.name ?? 'Caller', attendeePhone: phone, preference: r.summary?.consultationPreference ?? null };
    if (rand() < 0.8) await confirmBooking({ store, calendar: cal }, ctx, cal.free[0]!);
    else await recordNoSuitableSlot({ store, calendar: cal }, ctx);
  }
}

// Deliver the queued jobs with MOCK externals, then backdate handoff times to just after each call.
let delivered = 0;
for (;;) {
  const rep = await processOutbox({ store, crm, telegram: tel, email: mail, targets: { designerChatId: 'sample', studioHeadChatId: 'sample', designerEmail: 'sample@example.test', studioHeadEmail: 'sample@example.test', appBaseUrl: process.env.APP_BASE_URL ?? '' } }, 25);
  delivered += rep.done;
  if (!rep.claimed) break;
}
const calls = (await api('GET', 'calls?provider=eq.sample&select=id,ended_at')) as { id: string; ended_at: string }[];
const endById = new Map(calls.map((c) => [c.id, c.ended_at]));
const hs = (await api('GET', `handoffs?call_id=in.(${calls.map((c) => c.id).join(',')})&select=id,call_id,kind`)) as { id: string; call_id: string; kind: string }[];
for (const h of hs) {
  const ended = new Date(endById.get(h.call_id)!).getTime();
  const sent = new Date(ended + (40 + Math.floor(rand() * 140)) * 1000).toISOString();
  const patch: Record<string, unknown> = { sent_at: sent, created_at: sent };
  if (h.kind === 'escalation' && rand() < 0.65) patch.resolved_at = new Date(ended + (1 + rand() * 20) * 3_600_000).toISOString();
  await api('PATCH', `handoffs?id=eq.${h.id}`, patch);
}
console.log(`loaded ${n} sample calls (${usedCache} with real cached Gemini extractions) · ${delivered} integration jobs delivered (mock) · ${hs.length} handoffs`);
