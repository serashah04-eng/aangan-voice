import { costConfig } from '../../config/cost.config';
import type { Outcome } from '../domain/types';

/** Minimal row shapes the dashboard reads (no transcripts, no budgets). */
export type DashCall = {
  id: string;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  after_hours: boolean | null;
  call_type: 'enquiry' | 'other' | null;
  outcome: Outcome | null;
  model_suggested_outcome: string | null;
  pricing_asked_count: number;
  telephony_minutes: number | null;
  caller_phone_e164: string;
};
export type DashHandoff = { call_id: string | null; kind: 'designer' | 'escalation'; status: string; channel: string; sent_at: string | null; resolved_at: string | null; created_at: string };
export type DashBooking = { call_id: string | null; status: string; created_at: string };
export type DashFollowup = { reason: string; status: string; created_at: string };
export type DashCost = { call_id: string | null; kind: 'llm' | 'telephony' | 'notification'; amount_usd: number; occurred_on: string };
export type DashError = { service: string; operation: string; message: string | null; created_at: string; resolved_at: string | null };

export type DashData = {
  calls: DashCall[];
  handoffs: DashHandoff[];
  bookings: DashBooking[];
  /** All OPEN follow-up tasks (backlog is not windowed). */
  openFollowups: DashFollowup[];
  costs: DashCost[];
  errors: DashError[];
};

const IST_MS = 330 * 60_000;
export const istDate = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);

function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}
const ratio = (a: number, b: number) => (b ? a / b : null);

export const OUTCOME_ORDER: Outcome[] = ['qualified', 'needs_more_information', 'human_review_required', 'not_qualified', 'not_applicable'];
export const OUTCOME_LABEL: Record<string, string> = {
  qualified: 'Qualified',
  needs_more_information: 'Needs more info',
  human_review_required: 'Human review',
  not_qualified: 'Not qualified',
  not_applicable: 'Not an enquiry',
};

export type Dashboard = ReturnType<typeof computeDashboard>;

/**
 * Every metric in brief §7 Phase 5. `from`/`to` bound the window (ISO); `now` anchors
 * month-to-date. Cost rates come from config/cost.config.ts.
 */
export function computeDashboard(d: DashData, opts: { from: string; to: string; now: Date }) {
  const inWindow = (iso: string | null) => !!iso && iso >= opts.from && iso <= opts.to;
  const calls = d.calls.filter((c) => inWindow(c.started_at));
  const callIds = new Set(calls.map((c) => c.id));
  const enquiries = calls.filter((c) => c.call_type !== 'other');
  const fx = costConfig.usdToInrFx;

  // Calls per day (IST) and after-hours share.
  const days: string[] = [];
  for (let t = new Date(istDate(opts.from)).getTime(); t <= new Date(istDate(opts.to)).getTime(); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  const perDay = days.map((date) => {
    const dayCalls = calls.filter((c) => istDate(c.started_at) === date);
    const after = dayCalls.filter((c) => c.after_hours).length;
    return { date, inHours: dayCalls.length - after, afterHours: after };
  });
  const afterHours = calls.filter((c) => c.after_hours).length;

  // Time to answer.
  const answerSecs = calls.filter((c) => c.answered_at).map((c) => (new Date(c.answered_at!).getTime() - new Date(c.started_at).getTime()) / 1000);

  // Outcome mix (enquiries only).
  const outcomeMix = OUTCOME_ORDER.filter((o) => o !== 'not_applicable').map((o) => ({ outcome: o, label: OUTCOME_LABEL[o]!, count: enquiries.filter((c) => c.outcome === o).length }));
  const qualified = enquiries.filter((c) => c.outcome === 'qualified');

  // Qualified → handoff time, handoff → booking rate.
  const callById = new Map(calls.map((c) => [c.id, c]));
  const designerSent = d.handoffs.filter((h) => h.kind === 'designer' && h.status === 'sent' && h.call_id && callIds.has(h.call_id));
  const handoffMins = designerSent
    .map((h) => {
      const c = callById.get(h.call_id!);
      const base = c?.ended_at ?? c?.started_at;
      return base && h.sent_at ? (new Date(h.sent_at).getTime() - new Date(base).getTime()) / 60_000 : null;
    })
    .filter((x): x is number => x !== null && x >= 0);
  const bookedCalls = new Set(d.bookings.filter((b) => b.status === 'confirmed' && b.call_id).map((b) => b.call_id!));
  const handedOffAndBooked = designerSent.filter((h) => bookedCalls.has(h.call_id!)).length;
  const pendingBookings = d.bookings.filter((b) => b.call_id && callIds.has(b.call_id) && (b.status === 'pending' || b.status === 'failed')).length;

  // Escalations and their resolution.
  const escalations = d.handoffs.filter((h) => h.kind === 'escalation' && h.call_id && callIds.has(h.call_id));
  const escalationCalls = enquiries.filter((c) => c.outcome === 'human_review_required');
  const resolved = escalations.filter((h) => h.resolved_at);
  const resolutionHours = resolved.map((h) => (new Date(h.resolved_at!).getTime() - new Date(h.created_at).getTime()) / 3_600_000);

  // Follow-up backlog (all open tasks).
  const backlogByReason = Object.entries(
    d.openFollowups.reduce<Record<string, number>>((acc, f) => ((acc[f.reason] = (acc[f.reason] ?? 0) + 1), acc), {}),
  ).sort((a, b) => b[1] - a[1]);
  const oldestOpenDays = d.openFollowups.length
    ? Math.max(...d.openFollowups.map((f) => (opts.now.getTime() - new Date(f.created_at).getTime()) / 86_400_000))
    : null;

  // Rules vs model disagreements.
  const withSuggestion = enquiries.filter((c) => c.model_suggested_outcome && c.outcome);
  const disagreements = withSuggestion.filter((c) => c.model_suggested_outcome !== c.outcome);

  // Integration errors.
  const errors = d.errors.filter((e) => inWindow(e.created_at));
  const errorsByService = Object.entries(errors.reduce<Record<string, number>>((acc, e) => ((acc[e.service] = (acc[e.service] ?? 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]);

  // Cost: model + telephony + notifications. Telephony uses cost events when present, otherwise
  // call minutes × the configured per-minute rate.
  const costFor = (cs: DashCost[], cl: DashCall[]) => {
    const llm = cs.filter((c) => c.kind === 'llm').reduce((a, c) => a + Number(c.amount_usd), 0);
    const notify = cs.filter((c) => c.kind === 'notification').reduce((a, c) => a + Number(c.amount_usd), 0);
    const telEvents = cs.filter((c) => c.kind === 'telephony');
    const telephony = telEvents.length
      ? telEvents.reduce((a, c) => a + Number(c.amount_usd), 0)
      : cl.reduce((a, c) => a + (c.telephony_minutes ?? 0), 0) * (costConfig.telephonyInrPerMinute / fx);
    return { llm, telephony, notify, total: llm + telephony + notify };
  };
  const windowCost = costFor(d.costs.filter((c) => (c.call_id ? callIds.has(c.call_id) : inWindow(`${c.occurred_on}T12:00:00Z`))), calls);

  const monthStart = `${istDate(opts.now.toISOString()).slice(0, 8)}01`;
  const monthCalls = d.calls.filter((c) => istDate(c.started_at) >= monthStart);
  const monthCallIds = new Set(monthCalls.map((c) => c.id));
  const mtd = costFor(d.costs.filter((c) => (c.call_id ? monthCallIds.has(c.call_id) : c.occurred_on >= monthStart)), monthCalls);
  const todayIst = istDate(opts.now.toISOString());
  const dayOfMonth = Number(todayIst.slice(8, 10));
  const [yy, mm] = todayIst.split('-').map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();

  return {
    window: { from: opts.from, to: opts.to, days: days.length },
    volume: { calls: calls.length, enquiries: enquiries.length, other: calls.length - enquiries.length, afterHours, afterHoursShare: ratio(afterHours, calls.length), perDay },
    answer: { answered: answerSecs.length, medianSec: quantile(answerSecs, 0.5), p90Sec: quantile(answerSecs, 0.9) },
    outcomes: { mix: outcomeMix, qualified: qualified.length },
    handoff: { sent: designerSent.length, medianMinutes: quantile(handoffMins, 0.5), p90Minutes: quantile(handoffMins, 0.9) },
    booking: { booked: handedOffAndBooked, rate: ratio(handedOffAndBooked, designerSent.length), pendingOrFailed: pendingBookings },
    pricing: { asked: enquiries.filter((c) => c.pricing_asked_count > 0).length, rate: ratio(enquiries.filter((c) => c.pricing_asked_count > 0).length, enquiries.length) },
    escalations: { total: escalationCalls.length, alerted: escalations.filter((h) => h.status === 'sent').length, resolved: resolved.length, open: escalations.length - resolved.length, medianResolutionHours: quantile(resolutionHours, 0.5) },
    followups: { open: d.openFollowups.length, byReason: backlogByReason, oldestOpenDays },
    disagreements: {
      compared: withSuggestion.length,
      count: disagreements.length,
      rate: ratio(disagreements.length, withSuggestion.length),
      recent: disagreements.slice(-10).reverse().map((c) => ({ id: c.id, at: c.started_at, rules: c.outcome!, model: c.model_suggested_outcome! })),
    },
    errors: { total: errors.length, unresolved: errors.filter((e) => !e.resolved_at).length, byService: errorsByService, recent: errors.slice(-8).reverse() },
    cost: {
      fx,
      window: windowCost,
      perCall: ratio(windowCost.total, calls.length),
      perQualified: ratio(windowCost.total, qualified.length),
      monthToDate: mtd.total,
      projectedMonth: dayOfMonth ? (mtd.total / dayOfMonth) * daysInMonth : null,
      telephonyInrPerMinute: costConfig.telephonyInrPerMinute,
    },
  };
}
