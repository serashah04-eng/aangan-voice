import type { BookingRequest, CalendarProvider, Slot } from './types';

/** In-memory calendar. Configure free slots; simulate errors and races. */
export class MockCalendar implements CalendarProvider {
  readonly provider = 'calcom' as const;
  booked: (BookingRequest & { bookingId: string })[] = [];
  /** Every call throws (S16: calendar API errors). */
  failAll = false;
  /** Slots that disappear between listing and confirming (S18). */
  takenOnRecheck = new Set<string>();

  constructor(public free: Slot[] = []) {}

  private check() {
    if (this.failAll) throw new Error('calendar API error (mock)');
  }

  async listSlots(fromIso: string, toIso: string) {
    this.check();
    return this.free.filter((s) => s.start >= fromIso && s.end <= toIso && !this.booked.some((b) => b.slot.start === s.start));
  }
  async isAvailable(slot: Slot) {
    this.check();
    return !this.takenOnRecheck.has(slot.start) && this.free.some((s) => s.start === slot.start) && !this.booked.some((b) => b.slot.start === slot.start);
  }
  async book(req: BookingRequest) {
    this.check();
    const existing = this.booked.find((b) => b.idempotencyKey === req.idempotencyKey);
    if (existing) return { bookingId: existing.bookingId };
    const bookingId = `bk-${this.booked.length + 1}`;
    this.booked.push({ ...req, bookingId });
    return { bookingId };
  }
}
