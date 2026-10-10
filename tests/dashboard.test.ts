import { describe, expect, it } from 'vitest';
import { computeDashboard, istDate, type DashData } from '../src/dashboard/metrics';
import { createSession, safeEqual, verifySession } from '../src/dashboard/session';

const call = (id: string, started: string, extra: Partial<DashData['calls'][number]> = {}): DashData['calls'][number] => ({
  id, started_at: started, answered_at: new Date(new Date(started).getTime() + 2000).toISOString(), ended_at: new Date(new Date(started).getTime() + 300_000).toISOString(),
  after_hours: false, call_type: 'enquiry', outcome: 'qualified', model_suggested_outcome: 'qualified', pricing_asked_count: 0, telephony_minutes: 5,
  caller_phone_e164: '+919800000001', ...extra,
});

const NOW = new Date('2026-10-10T12:00:00Z');
const OPTS = { from: '2026-10-04T00:00:00.000Z', to: NOW.toISOString(), now: NOW };

function data(): DashData {
  return {
    calls: [
      call('a', '2026-10-05T05:00:00Z'),
      call('b', '2026-10-05T16:00:00Z', { after_hours: true, outcome: 'needs_more_information', model_suggested_outcome: 'qualified', pricing_asked_count: 2 }),
      call('c', '2026-10-06T06:00:00Z', { outcome: 'human_review_required', model_suggested_outcome: 'human_review_required' }),
      call('d', '2026-10-07T06:00:00Z', { call_type: 'other', outcome: 'not_applicable', model_suggested_outcome: null }),
      call('old', '2026-09-01T06:00:00Z'),
    ],
    handoffs: [
      { call_id: 'a', kind: 'designer', status: 'sent', channel: 'telegram', sent_at: '2026-10-05T05:07:00Z', resolved_at: null, created_at: '2026-10-05T05:06:00Z' },
      { call_id: 'c', kind: 'escalation', status: 'sent', channel: 'telegram', sent_at: '2026-10-06T06:06:00Z', resolved_at: '2026-10-06T10:06:00Z', created_at: '2026-10-06T06:06:00Z' },
    ],
    bookings: [{ call_id: 'a', status: 'confirmed', created_at: '2026-10-05T05:05:00Z' }],
    openFollowups: [{ reason: 'needs_more_information', status: 'open', created_at: '2026-10-05T16:06:00Z' }],
    costs: [
      { call_id: 'a', kind: 'llm', amount_usd: 0.01, occurred_on: '2026-10-05' },
      { call_id: 'b', kind: 'llm', amount_usd: 0.01, occurred_on: '2026-10-05' },
    ],
    errors: [{ service: 'hubspot', operation: 'hubspot_sync', message: 'x', created_at: '2026-10-06T06:10:00Z', resolved_at: null }],
  };
}

describe('dashboard metrics (brief §7 Phase 5)', () => {
  const m = computeDashboard(data(), OPTS);

  it('calls per day and after-hours share, windowed, in IST', () => {
    expect(m.volume).toMatchObject({ calls: 4, enquiries: 3, other: 1, afterHours: 1, afterHoursShare: 0.25 });
    expect(m.volume.perDay.find((d) => d.date === '2026-10-05')).toEqual({ date: '2026-10-05', inHours: 1, afterHours: 1 });
    expect(m.volume.perDay.length).toBe(7);
  });
  it('time to answer', () => expect(m.answer.medianSec).toBe(2));
  it('outcome mix counts enquiries only', () => {
    expect(Object.fromEntries(m.outcomes.mix.map((o) => [o.outcome, o.count]))).toEqual({ qualified: 1, needs_more_information: 1, human_review_required: 1, not_qualified: 0 });
  });
  it('qualified → handoff minutes (from call end) and handoff → booking rate', () => {
    expect(m.handoff.medianMinutes).toBe(2);
    expect(m.booking.rate).toBe(1);
  });
  it('pricing-asked rate', () => expect(m.pricing.rate).toBeCloseTo(1 / 3));
  it('escalations and resolution time', () => expect(m.escalations).toMatchObject({ total: 1, resolved: 1, open: 0, medianResolutionHours: 4 }));
  it('follow-up backlog', () => expect(m.followups).toMatchObject({ open: 1, byReason: [['needs_more_information', 1]] }));
  it('rules vs model disagreements', () => expect(m.disagreements).toMatchObject({ compared: 3, count: 1 }));
  it('integration errors by service', () => expect(m.errors.byService).toEqual([['hubspot', 1]]));
  it('cost: model + telephony (minutes × configured rate) per call and per qualified lead', () => {
    const telUsd = (4 * 5 * 0.65) / 88;
    expect(m.cost.window.llm).toBeCloseTo(0.02);
    expect(m.cost.window.telephony).toBeCloseTo(telUsd);
    expect(m.cost.perCall).toBeCloseTo((0.02 + telUsd) / 4);
    expect(m.cost.perQualified).toBeCloseTo(0.02 + telUsd);
  });
  it('IST date boundaries', () => {
    expect(istDate('2026-10-05T18:29:00Z')).toBe('2026-10-05');
    expect(istDate('2026-10-05T18:30:00Z')).toBe('2026-10-06');
  });
});

describe('dashboard session', () => {
  it('accepts a fresh token and rejects tampered, expired or unsigned ones', async () => {
    const t = await createSession('s3cret', 1_000);
    expect(await verifySession(t, 's3cret', 2_000)).toBe(true);
    expect(await verifySession(t, 'other', 2_000)).toBe(false);
    expect(await verifySession(t.replace(/^\d+/, '99999999999999'), 's3cret', 2_000)).toBe(false);
    expect(await verifySession(t, 's3cret', 1_000 + 13 * 3_600_000)).toBe(false);
    expect(await verifySession(undefined, 's3cret')).toBe(false);
    expect(await verifySession(t, undefined)).toBe(false);
  });
  it('constant-time compare', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
  });
});
