import { describe, expect, it } from 'vitest';
import { confirmBooking, offerSlots, recordNoSuitableSlot } from '../../src/services/booking';
import { world } from './helpers';

const slot = (iso: string) => ({ start: iso, end: new Date(new Date(iso).getTime() + 3_600_000).toISOString() });
const SLOTS = [slot('2026-10-12T05:30:00.000Z'), slot('2026-10-12T07:30:00.000Z'), slot('2026-10-13T05:30:00.000Z'), slot('2026-10-14T05:30:00.000Z')];
const ctx = { leadId: 'lead-1', callId: 'call-1', attendeeName: 'Meera Joshi', attendeePhone: '+919800000001', preference: 'weekday mornings' };

describe('booking (only for Qualified leads, only after a yes)', () => {
  it('offers the first three free slots', async () => {
    const { store, calendar, clock } = world();
    calendar.free = SLOTS;
    const r = await offerSlots({ store, calendar, now: clock.now });
    expect(r).toEqual({ ok: true, slots: SLOTS.slice(0, 3) });
  });

  it('happy path: re-checks, books, stores confirmed', async () => {
    const { store, calendar } = world();
    calendar.free = SLOTS;
    const r = await confirmBooking({ store, calendar }, ctx, SLOTS[0]!);
    expect(r).toMatchObject({ status: 'confirmed', bookingId: 'bk-1' });
    expect([...store.bookings.values()][0]).toMatchObject({ status: 'confirmed', slot_start: SLOTS[0]!.start, provider_booking_id: 'bk-1' });
    expect(calendar.booked[0]!.notes).toContain('+919800000001');
  });

  it('S16: calendar API error → booking failed + front-desk task', async () => {
    const { store, calendar } = world();
    calendar.free = SLOTS;
    calendar.failAll = true;
    const r = await confirmBooking({ store, calendar }, ctx, SLOTS[0]!);
    expect(r).toEqual({ status: 'failed' });
    expect([...store.bookings.values()][0]).toMatchObject({ status: 'failed' });
    expect(store.followups).toMatchObject([{ reason: 'booking_failed' }]);
    expect(store.errors).toMatchObject([{ service: 'calcom', operation: 'book' }]);
  });

  it('S16: offering slots when the calendar is down reports an error instead of throwing', async () => {
    const { store, calendar } = world();
    calendar.failAll = true;
    expect((await offerSlots({ store, calendar })).ok).toBe(false);
  });

  it('S17: no offered slot fits → booking pending, preference saved, front-desk task', async () => {
    const { store, calendar } = world();
    await recordNoSuitableSlot({ store, calendar }, ctx);
    expect([...store.bookings.values()][0]).toMatchObject({ status: 'pending', preference: 'weekday mornings', slot_start: null });
    expect(store.followups).toMatchObject([{ reason: 'booking_pending' }]);
  });

  it('S18: slot taken between offer and confirm → no booking, next slot offered', async () => {
    const { store, calendar } = world();
    calendar.free = SLOTS;
    calendar.takenOnRecheck.add(SLOTS[0]!.start);
    const r = await confirmBooking({ store, calendar }, ctx, SLOTS[0]!);
    expect(r).toEqual({ status: 'slot_taken', alternative: SLOTS[1] });
    expect(calendar.booked).toEqual([]);
    // Caller accepts the alternative.
    const r2 = await confirmBooking({ store, calendar }, ctx, SLOTS[1]!);
    expect(r2.status).toBe('confirmed');
    expect(store.bookings.size).toBe(1); // same idempotency key → one booking row
  });
});
