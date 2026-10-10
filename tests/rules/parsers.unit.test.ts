import { describe, expect, it } from 'vitest';
import { parseBudget } from '../../src/rules/budget-parse';
import { resolveDeadline, resolveStart } from '../../src/rules/dates';

describe('parseBudget (deterministic C4 parser)', () => {
  it.each([
    ['1 to 1.5 lakh maximum for everything', 150_000],
    ['₹1–1.5L', 150_000],
    ['Rs 1 lakh for the whole 2BHK', 100_000],
    ['Rs. 1,50,000', 150_000],
    ['₹15–20 lakh for the full home', 2_000_000],
    ['60-80 lakhs all-in', 8_000_000],
    ['around 1.2 crore', 12_000_000],
    ['50k', 50_000],
    ['ek lakh', 100_000],
    ['dedh lakh tak', 150_000],
    ['१५ लाख', 1_500_000],
  ])('%s → %i', (raw, inr) => {
    expect(parseBudget(raw)).toEqual({ maxInr: inr, hasAmountCue: true });
  });

  it.each(['budget bhi hai', 'Prefer not to mention', 'reasonable', '2BHK with 20 people'])('%s → no figure', (raw) => {
    expect(parseBudget(raw)).toEqual({ maxInr: null, hasAmountCue: false });
  });

  it('a money word without a readable number still counts as volunteered', () => {
    expect(parseBudget('a few lakh')).toEqual({ maxInr: null, hasAmountCue: true });
  });
});

describe('date resolution', () => {
  it('month-only deadline → last day, next occurrence', () => {
    expect(resolveDeadline({ kind: 'month', month: 3 }, '2026-09-02')).toBe('2027-03-31');
    expect(resolveDeadline({ kind: 'month', month: 11 }, '2026-09-03')).toBe('2026-11-30');
    expect(resolveDeadline({ kind: 'month', month: 9 }, '2026-09-03')).toBe('2026-09-30');
    expect(resolveDeadline({ kind: 'month', month: 2, year: 2027 }, '2026-09-03')).toBe('2027-02-28');
  });
  it('month-only start → first day; recent past month → now (Q23)', () => {
    expect(resolveStart({ kind: 'month', month: 1 }, '2026-09-25')).toBe('2027-01-01');
    expect(resolveStart({ kind: 'month', month: 12 }, '2026-09-01')).toBe('2026-12-01');
    expect(resolveStart({ kind: 'month', month: 8 }, '2026-09-20')).toBe('2026-09-20');
    expect(resolveStart({ kind: 'month', month: 9 }, '2026-09-20')).toBe('2026-09-20');
  });
  it('durations', () => {
    expect(resolveDeadline({ kind: 'duration', amount: 3, unit: 'weeks' }, '2026-09-18')).toBe('2026-10-09');
    expect(resolveDeadline({ kind: 'duration', amount: 4, unit: 'months' }, '2026-09-06')).toBe('2027-01-06');
  });
  it('festivals come from config (Q24): Diwali 2026 = 8 Nov', () => {
    expect(resolveDeadline({ kind: 'festival', name: 'diwali', relation: 'before' }, '2026-09-08')).toBe('2026-11-07');
    expect(resolveStart({ kind: 'festival', name: 'Diwali', relation: 'after' }, '2026-09-08')).toBe('2026-11-09');
    expect(resolveDeadline({ kind: 'festival', name: 'holi', relation: 'by' }, '2026-09-08')).toBeNull();
  });
  it('kind mismatches are unresolvable', () => {
    expect(resolveDeadline({ kind: 'now' }, '2026-09-08')).toBeNull();
    expect(resolveStart({ kind: 'no_deadline' }, '2026-09-08')).toBeNull();
  });
});
