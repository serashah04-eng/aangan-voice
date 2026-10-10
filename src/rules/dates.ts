import { rulesConfig } from '../../config/rules.config';
import type { DateExpr, IsoDate } from '../domain/types';

/**
 * Deterministic date arithmetic on calendar dates (no time zone, no Date.now()).
 * All "days from the call" values are measured from the call date passed in.
 */

const DAY_MS = 86_400_000;

function toUtc(d: IsoDate): number {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return fromUtc(toUtc(d) + n * DAY_MS);
}

export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

function parts(d: IsoDate): { y: number; m: number; day: number } {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return { y, m, day };
}

function iso(y: number, m: number, day: number): IsoDate {
  return fromUtc(Date.UTC(y, m - 1, day));
}

function lastDayOfMonth(y: number, m: number): IsoDate {
  return fromUtc(Date.UTC(y, m, 0));
}

export function addMonths(d: IsoDate, n: number): IsoDate {
  const { y, m, day } = parts(d);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  const last = parts(lastDayOfMonth(ty, tm)).day;
  return iso(ty, tm, Math.min(day, last));
}

function festivalOnOrAfter(name: string, callDate: IsoDate): IsoDate | null {
  const dates = rulesConfig.festivals[name.toLowerCase()];
  if (!dates) return null;
  const next = [...dates].sort().find((d) => d >= callDate);
  return next ?? null;
}

/**
 * Completion deadline. Month-only resolves to the LAST day of the month; with no year it is the
 * next occurrence on or after the call month. Returns 'no_deadline' or null (unresolvable).
 */
export function resolveDeadline(expr: DateExpr, callDate: IsoDate): IsoDate | 'no_deadline' | null {
  switch (expr.kind) {
    case 'no_deadline':
      return 'no_deadline';
    case 'now':
      return null;
    case 'date':
      return expr.date;
    case 'month': {
      const c = parts(callDate);
      const year = expr.year ?? (expr.month >= c.m ? c.y : c.y + 1);
      return lastDayOfMonth(year, expr.month);
    }
    case 'duration':
      return durationFrom(callDate, expr.amount, expr.unit);
    case 'festival': {
      const f = festivalOnOrAfter(expr.name, callDate);
      if (!f) return null;
      return expr.relation === 'before' ? addDays(f, -1) : expr.relation === 'by' ? f : addDays(f, 1);
    }
  }
}

/**
 * Site-available / execution-start date. Month-only resolves to the FIRST day of the month.
 * A month-only start in the recent past (Q23) or the current month means the site is available now.
 */
export function resolveStart(expr: DateExpr, callDate: IsoDate): IsoDate | null {
  switch (expr.kind) {
    case 'now':
      return callDate;
    case 'no_deadline':
      return null;
    case 'date':
      return expr.date < callDate ? callDate : expr.date;
    case 'month': {
      const c = parts(callDate);
      if (expr.year !== undefined) {
        const d = iso(expr.year, expr.month, 1);
        return d < callDate ? callDate : d;
      }
      const monthsBack = (c.m - expr.month + 12) % 12;
      if (monthsBack === 0 || monthsBack <= rulesConfig.timeline.pastStartLookbackMonths) return callDate;
      const year = expr.month > c.m ? c.y : c.y + 1;
      return iso(year, expr.month, 1);
    }
    case 'duration':
      return durationFrom(callDate, expr.amount, expr.unit);
    case 'festival': {
      const f = festivalOnOrAfter(expr.name, callDate);
      if (!f) return null;
      return expr.relation === 'after' ? addDays(f, 1) : f;
    }
  }
}

function durationFrom(callDate: IsoDate, amount: number, unit: 'days' | 'weeks' | 'months'): IsoDate {
  if (unit === 'days') return addDays(callDate, Math.round(amount));
  if (unit === 'weeks') return addDays(callDate, Math.round(amount * 7));
  const whole = Math.floor(amount);
  const base = addMonths(callDate, whole);
  return amount === whole ? base : addDays(base, Math.round((amount - whole) * 30));
}
