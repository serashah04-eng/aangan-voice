import { createSign } from 'node:crypto';
import { rulesConfig } from '../../../config/rules.config';
import type { BookingRequest, CalendarProvider, Slot } from './types';

export type GoogleCalendarOptions = {
  calendarId: string;
  /** Service-account JSON (client_email, private_key). The calendar must be shared with that account. */
  serviceAccountJson: string;
  slotMinutes?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

const SCOPE = 'https://www.googleapis.com/auth/calendar';
const JWT_ALG = 'RS256'; // pricing-scan:allow JWT signing algorithm name, not a rupee amount
const IST_OFFSET_MIN = 330;

/**
 * Google Calendar (second adapter, brief §6). Slots are generated inside studio hours
 * (Mon–Sat, config.hours, IST) and filtered by the calendar's free/busy.
 */
export class GoogleCalendar implements CalendarProvider {
  readonly provider = 'google' as const;
  private readonly fetch: typeof fetch;
  private readonly sa: { client_email: string; private_key: string };
  private token: { value: string; exp: number } | null = null;

  constructor(private readonly o: GoogleCalendarOptions) {
    if (!o.calendarId || !o.serviceAccountJson) throw new Error('GOOGLE_CALENDAR_ID and GOOGLE_SERVICE_ACCOUNT_JSON are required');
    this.sa = JSON.parse(o.serviceAccountJson);
    this.fetch = o.fetchImpl ?? fetch;
  }

  private now() {
    return (this.o.now ?? (() => new Date()))();
  }

  private async accessToken(): Promise<string> {
    const nowS = Math.floor(this.now().getTime() / 1000);
    if (this.token && this.token.exp - 60 > nowS) return this.token.value;
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: JWT_ALG, typ: 'JWT' })}.${b64({ iss: this.sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: nowS, exp: nowS + 3600 })}`;
    const sig = createSign('RSA-SHA256').update(unsigned).sign(this.sa.private_key).toString('base64url');
    const res = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !json.access_token) throw new Error(`google oauth → ${res.status}: ${json.error ?? 'unknown'}`);
    this.token = { value: json.access_token, exp: nowS + (json.expires_in ?? 3600) };
    return json.access_token;
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetch(`https://www.googleapis.com/calendar/v3${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`google calendar ${method} ${path.split('?')[0]} → ${res.status}: ${json.error?.message ?? 'unknown'}`);
    return json;
  }

  private async busy(fromIso: string, toIso: string): Promise<Array<{ start: string; end: string }>> {
    const r = await this.api<{ calendars: Record<string, { busy: Array<{ start: string; end: string }> }> }>('POST', '/freeBusy', {
      timeMin: fromIso,
      timeMax: toIso,
      items: [{ id: this.o.calendarId }],
    });
    return r.calendars[this.o.calendarId]?.busy ?? [];
  }

  /** Candidate slots in studio hours (IST), Monday–Saturday. */
  private candidates(fromIso: string, toIso: string): Slot[] {
    const minutes = this.o.slotMinutes ?? 60;
    const out: Slot[] = [];
    const from = new Date(fromIso).getTime();
    const to = new Date(toIso).getTime();
    const startDay = new Date(from + IST_OFFSET_MIN * 60_000);
    startDay.setUTCHours(0, 0, 0, 0);
    for (let day = startDay.getTime(); day <= to + IST_OFFSET_MIN * 60_000; day += 86_400_000) {
      if (new Date(day).getUTCDay() === 0) continue; // Sunday
      for (let h = rulesConfig.hours.openHour; h + minutes / 60 <= rulesConfig.hours.closeHour; h += minutes / 60) {
        const startUtc = day + h * 3_600_000 - IST_OFFSET_MIN * 60_000;
        const endUtc = startUtc + minutes * 60_000;
        if (startUtc >= from && endUtc <= to) out.push({ start: new Date(startUtc).toISOString(), end: new Date(endUtc).toISOString() });
      }
    }
    return out;
  }

  async listSlots(fromIso: string, toIso: string): Promise<Slot[]> {
    const busy = await this.busy(fromIso, toIso);
    return this.candidates(fromIso, toIso).filter((s) => !busy.some((b) => s.start < b.end && b.start < s.end));
  }

  async isAvailable(slot: Slot): Promise<boolean> {
    const busy = await this.busy(slot.start, slot.end);
    return !busy.some((b) => slot.start < b.end && b.start < slot.end);
  }

  async book(req: BookingRequest) {
    const ev = await this.api<{ id: string }>('POST', `/calendars/${encodeURIComponent(this.o.calendarId)}/events`, {
      summary: `Design consultation — ${req.attendeeName}`,
      description: req.notes,
      start: { dateTime: req.slot.start },
      end: { dateTime: req.slot.end },
      extendedProperties: { private: { idempotencyKey: req.idempotencyKey } },
    });
    return { bookingId: ev.id };
  }
}
