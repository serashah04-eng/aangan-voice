import { MockCalendar } from '../../src/adapters/calendar/mock';
import { MockCrm } from '../../src/adapters/crm/mock';
import { MockNotifier } from '../../src/adapters/notify/mock';
import { MemoryStore } from '../../src/adapters/store/memory';
import { validateQuotes } from '../../src/extraction/quote-validator';
import { setLogSink } from '../../src/lib/logger';
import { evaluate } from '../../src/rules/engine';
import { finalizeCall } from '../../src/services/finalize-call';
import type { OutboxDeps } from '../../src/services/outbox';
import { casesById } from '../fixtures/cases';

setLogSink(() => {});

export const PHONE = '+919800000001';

/** A controllable clock. */
export function clock(start = '2026-10-10T06:00:00.000Z') {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), advance: (seconds: number) => (t += seconds * 1000) };
}

export function world(start?: string) {
  const c = clock(start);
  const store = new MemoryStore(c.now);
  const deps: OutboxDeps & { crm: MockCrm; telegram: MockNotifier; email: MockNotifier } = {
    store,
    crm: new MockCrm(),
    telegram: new MockNotifier('telegram'),
    email: new MockNotifier('email'),
    targets: { designerChatId: 'designers', studioHeadChatId: 'studio-head', designerEmail: 'designer@example.test', studioHeadEmail: 'head@example.test', appBaseUrl: 'https://app.example.test' },
    now: c.now,
  };
  return { clock: c, store, deps, calendar: new MockCalendar() };
}

/** Run a CSV fixture through validator + engine + finalizeCall. */
export async function finalizeFixture(store: MemoryStore, id: string, opts: { callId?: string; phone?: string } = {}) {
  const fx = casesById.get(id)!;
  const { extraction } = validateQuotes(fx.extraction, fx.transcript);
  const evaluation = evaluate(extraction, { callDate: fx.callDate, asked: fx.asked, rulesVersion: 'test-sha' });
  const callId = opts.callId ?? `00000000-0000-4000-8000-${id.padStart(12, '0').replace(/[^0-9a-f]/gi, '0')}`;
  const result = await finalizeCall(store, {
    callId,
    callerPhone: opts.phone ?? PHONE,
    startedAt: `${fx.callDate}T06:00:00.000Z`,
    endedAt: `${fx.callDate}T06:05:00.000Z`,
    callDate: fx.callDate,
    transcript: fx.transcript,
    extraction,
    evaluation,
    asked: fx.asked,
  });
  return { ...result, callId, evaluation };
}
