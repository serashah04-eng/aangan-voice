/**
 * Chat with the phone agent in the terminal (brief §6). You type what the caller says; the agent
 * answers exactly as it would on a call — Gemini extraction + rules engine + scripted, guarded lines.
 *
 *   npm run simulate                 # in-memory DB, mock HubSpot/Telegram/email/calendar (safe)
 *   npm run simulate -- --debug      # also show the criteria after every turn
 *   npm run simulate -- --live       # real Supabase + real HubSpot/Telegram/email + Cal.com (asks first)
 *
 * Type /quit to hang up mid-call (treated as a dropped call).
 */
import { createInterface } from 'node:readline';
import { MockCalendar } from '../src/adapters/calendar/mock';
import { MockCrm } from '../src/adapters/crm/mock';
import { MockNotifier } from '../src/adapters/notify/mock';
import { MemoryStore } from '../src/adapters/store/memory';
import { CallSession, type SessionDeps } from '../src/dialogue/session';
import { setLogSink } from '../src/lib/logger';
import { buildCalendar, buildLlm, buildOutboxDeps, buildStore, loadLocalEnv } from '../src/services/container';
import type { OutboxDeps } from '../src/services/outbox';

loadLocalEnv();
const args = new Set(process.argv.slice(2));
const live = args.has('--live');
const debug = args.has('--debug');
setLogSink((l) => {
  if (debug && /"level":"(warn|error)"/.test(l)) console.log(`  [log] ${l}`);
});

const rl = createInterface({ input: process.stdin, terminal: !!process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
/** Works for typing and for piped input (scripted demos). Returns null at end of input. */
async function ask(prompt: string): Promise<string | null> {
  process.stdout.write(prompt);
  const r = await lines.next();
  if (r.done) return null;
  if (!process.stdin.isTTY) process.stdout.write(`${r.value}\n`);
  return r.value;
}
const phone = (process.env.DEMO_CALLER_NUMBER ?? '+910000000042').trim();

let deps: SessionDeps;
let mocks: { crm: MockCrm; telegram: MockNotifier; email: MockNotifier } | null = null;
if (live) {
  const ok = ((await ask('LIVE mode writes to Supabase, HubSpot, Telegram and may book a real Cal.com slot. Continue? (yes/no) ')) ?? '').trim().toLowerCase();
  if (ok !== 'yes') process.exit(0);
  deps = { llm: buildLlm(), store: buildStore(), calendar: buildCalendar(), outbox: buildOutboxDeps() };
} else {
  const store = new MemoryStore();
  const day = (n: number, h: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    d.setUTCHours(h - 5, 30, 0, 0); // h:00 IST
    return { start: d.toISOString(), end: new Date(d.getTime() + 3_600_000).toISOString() };
  };
  mocks = { crm: new MockCrm(), telegram: new MockNotifier('telegram'), email: new MockNotifier('email') };
  const outbox: OutboxDeps = {
    store, ...mocks,
    targets: { designerChatId: 'designers', studioHeadChatId: 'studio-head', designerEmail: 'designer@example.test', studioHeadEmail: 'head@example.test', appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000' },
  };
  deps = { llm: buildLlm(), store, calendar: new MockCalendar([day(1, 11), day(1, 15), day(2, 11), day(3, 16)]), outbox };
}

console.log(`\n— Aangan phone agent simulator (${live ? 'LIVE' : 'safe: in-memory + mocks'}) · model ${(deps.llm as { model: string }).model} —`);
console.log('You are the caller. Type /quit to hang up.\n');

const { session, opening } = await CallSession.start(deps, { callId: crypto.randomUUID(), callerPhone: phone });
console.log(`Agent: ${opening}\n`);

for (;;) {
  const line = await ask('You:   ');
  if (line === null) break;
  const said = line.trim();
  if (said === '/quit') break;
  if (!said) continue;
  const t0 = Date.now();
  const reply = await session.onCallerTurn(said);
  console.log(`Agent: ${reply.say}   (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  if (debug && session.lastEval) {
    const c = session.lastEval.criteria;
    console.log(`  [rules] outcome so far: ${session.lastEval.outcome} · next: ${JSON.stringify(session.lastEval.next)}`);
    console.log(`  [rules] ${Object.entries(c).map(([k, v]) => `${k}=${v.state}`).join('  ')}\n`);
  }
  if (reply.endCall) break;
}
rl.close();

const result = await session.finish();
console.log('— call ended —');
if (!result) {
  console.log('Nothing was understood, so only the partial call record was kept.');
} else {
  const ev = session.lastEval!;
  console.log(`Outcome: ${ev.outcome}  (rule ${ev.outcomeRuleId})`);
  for (const [k, v] of Object.entries(ev.criteria)) console.log(`  ${k.padEnd(4)} ${v.state.padEnd(15)} ${v.ruleId}${v.evidence[0] ? `  ← "${v.evidence[0].quote}"` : ''}`);
  if (ev.triggers.length) console.log(`  triggers: ${ev.triggers.map((t) => t.trigger).join(', ')}`);
  console.log(`Queued/sent: ${result.jobsQueued.join(', ') || 'nothing external (Supabase only)'}`);
  if (session.booking) console.log(`Booking: ${session.booking.status}`);
  if (mocks?.telegram.sent.length) console.log(`\n[mock Telegram → ${mocks.telegram.sent[0]!.to}]\n${mocks.telegram.sent[0]!.message.subject}\n${mocks.telegram.sent[0]!.message.body}`);
}
process.exit(0);
