import { redactPhones } from '../../lib/logger';
import type { BookingRequest, CalendarProvider, Slot } from './types';

export type CalcomOptions = {
  apiKey: string;
  eventTypeId: string;
  /** Studio inbox used as the booking attendee email (we never collect email on the call — Q27). */
  attendeeEmail: string;
  timeZone: string;
  fetchImpl?: typeof fetch;
};

/** Cal.com API v2. */
export class CalcomCalendar implements CalendarProvider {
  readonly provider = 'calcom' as const;
  private readonly fetch: typeof fetch;
  private readonly base = 'https://api.cal.com/v2';

  constructor(private readonly o: CalcomOptions) {
    if (!o.apiKey || !o.eventTypeId) throw new Error('CALCOM_API_KEY and CALCOM_EVENT_TYPE_ID are required');
    if (!o.attendeeEmail) throw new Error('CALENDAR_ATTENDEE_EMAIL is required for Cal.com bookings (Q27)');
    this.fetch = o.fetchImpl ?? fetch;
  }

  private async req<T>(method: string, path: string, apiVersion: string, body?: unknown): Promise<T> {
    const res = await this.fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.o.apiKey}`, 'cal-api-version': apiVersion, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { status?: string; data?: unknown; error?: { message?: string } };
    if (!res.ok || json.status === 'error') {
      throw new Error(`cal.com ${method} ${path.split('?')[0]} → ${res.status}: ${redactPhones(json.error?.message ?? 'unknown error')}`);
    }
    return json.data as T;
  }

  async listSlots(fromIso: string, toIso: string): Promise<Slot[]> {
    const q = new URLSearchParams({ eventTypeId: this.o.eventTypeId, start: fromIso, end: toIso, timeZone: this.o.timeZone, format: 'range' });
    const data = await this.req<Record<string, Array<{ start: string; end?: string }>>>('GET', `/slots?${q}`, '2024-09-04');
    return Object.values(data ?? {})
      .flat()
      .filter((s) => s.start && s.end)
      .map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end!).toISOString() }))
      .sort((a, b) => (a.start < b.start ? -1 : 1));
  }

  async isAvailable(slot: Slot): Promise<boolean> {
    const day = slot.start.slice(0, 10);
    const slots = await this.listSlots(`${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`);
    return slots.some((s) => s.start === new Date(slot.start).toISOString());
  }

  async book(req: BookingRequest) {
    const data = await this.req<{ uid?: string; id?: number }>('POST', '/bookings', '2024-08-13', {
      start: new Date(req.slot.start).toISOString(),
      eventTypeId: Number(this.o.eventTypeId),
      attendee: { name: req.attendeeName, email: this.o.attendeeEmail, timeZone: this.o.timeZone, phoneNumber: req.attendeePhone, language: 'en' },
      bookingFieldsResponses: { notes: req.notes.slice(0, 1000) },
      metadata: { idempotencyKey: req.idempotencyKey.slice(0, 40) },
    });
    return { bookingId: String(data?.uid ?? data?.id ?? '') };
  }
}
