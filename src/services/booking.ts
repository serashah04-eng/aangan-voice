import { rulesConfig } from '../../config/rules.config';
import type { CalendarProvider, Slot } from '../adapters/calendar/types';
import type { Store } from '../adapters/store/types';
import { logger, redactPhones } from '../lib/logger';

export type BookingDeps = { store: Store; calendar: CalendarProvider; now?: () => Date };

export type BookingContext = {
  leadId: string;
  callId: string;
  attendeeName: string;
  attendeePhone: string;
  /** Caller's stated preference, e.g. "weekday evenings", "site visit". */
  preference?: string | null;
};

export type OfferResult = { ok: true; slots: Slot[] } | { ok: false; error: string };

export type ConfirmResult =
  | { status: 'confirmed'; slot: Slot; bookingId: string }
  | { status: 'slot_taken'; alternative: Slot | null }
  | { status: 'failed' };

const key = (callId: string) => `booking:${callId}`;

/** Offer the first few free consultation slots (only ever called for a Qualified lead). */
export async function offerSlots(deps: BookingDeps, fromIso?: string): Promise<OfferResult> {
  const now = deps.now?.() ?? new Date();
  const from = fromIso ?? new Date(now.getTime() + 2 * 3_600_000).toISOString();
  const to = new Date(new Date(from).getTime() + rulesConfig.calendar.lookaheadDays * 86_400_000).toISOString();
  try {
    const slots = await deps.calendar.listSlots(from, to);
    return { ok: true, slots: slots.slice(0, rulesConfig.calendar.slotsToOffer) };
  } catch (e) {
    return { ok: false, error: redactPhones((e as Error).message) };
  }
}

/**
 * Book only after the caller said yes AND the calendar confirms the slot (brief §5):
 *  - re-check availability first; if it was taken meanwhile, offer the next free slot (S18);
 *  - on an API error → booking_status=failed + front-desk task; the agent says the team will
 *    confirm a time (S16).
 */
export async function confirmBooking(deps: BookingDeps, ctx: BookingContext, slot: Slot): Promise<ConfirmResult> {
  const row = {
    lead_id: ctx.leadId, call_id: ctx.callId, provider: deps.calendar.provider, event_type_id: null,
    preference: ctx.preference ?? null, idempotency_key: key(ctx.callId),
  };
  try {
    if (!(await deps.calendar.isAvailable(slot))) {
      const later = await deps.calendar.listSlots(slot.end, new Date(new Date(slot.start).getTime() + rulesConfig.calendar.lookaheadDays * 86_400_000).toISOString());
      const alternative = later.find((s) => s.start !== slot.start) ?? null;
      await deps.store.saveBooking({ ...row, provider_booking_id: null, slot_start: alternative?.start ?? null, slot_end: alternative?.end ?? null, status: 'offered', failure_reason: 'slot taken before confirmation' });
      return { status: 'slot_taken', alternative };
    }
    const { bookingId } = await deps.calendar.book({
      slot,
      attendeeName: ctx.attendeeName,
      attendeePhone: ctx.attendeePhone,
      notes: `Caller ${ctx.attendeeName}, ${ctx.attendeePhone}.${ctx.preference ? ` Preference: ${ctx.preference}.` : ''} Booked by the Aangan phone agent.`,
      idempotencyKey: key(ctx.callId),
    });
    await deps.store.saveBooking({ ...row, provider_booking_id: bookingId, slot_start: slot.start, slot_end: slot.end, status: 'confirmed', failure_reason: null });
    return { status: 'confirmed', slot, bookingId };
  } catch (e) {
    const reason = redactPhones((e as Error).message).slice(0, 500);
    logger.warn('booking.failed', { callId: ctx.callId, reason });
    await deps.store.saveBooking({ ...row, provider_booking_id: null, slot_start: slot.start, slot_end: slot.end, status: 'failed', failure_reason: reason });
    await deps.store.addIntegrationError({ service: deps.calendar.provider, operation: 'book', idempotency_key: key(ctx.callId), call_id: ctx.callId, lead_id: ctx.leadId, attempt: 1, error_code: null, message: reason });
    await deps.store.addFollowupTask({ lead_id: ctx.leadId, call_id: ctx.callId, reason: 'booking_failed', missing_fields: [], notes: 'Calendar error during booking — please confirm a consultation time with the caller.' });
    return { status: 'failed' };
  }
}

/** Outcome of a live booking attempt, decided during the call and persisted at the end (needs the lead id). */
export type LiveBookingOutcome =
  | { status: 'confirmed'; slot: Slot; bookingId: string; provider: 'calcom' | 'google'; preference: string | null }
  | { status: 'failed'; slot: Slot | null; reason: string; provider: 'calcom' | 'google'; preference: string | null }
  | { status: 'pending'; provider: 'calcom' | 'google'; preference: string | null };

/** Write a live booking outcome once the lead exists: booking row + front-desk task where needed. */
export async function persistBookingOutcome(store: Store, leadId: string, callId: string, o: LiveBookingOutcome): Promise<void> {
  const base = { lead_id: leadId, call_id: callId, provider: o.provider, event_type_id: null, preference: o.preference, idempotency_key: key(callId) };
  if (o.status === 'confirmed') {
    await store.saveBooking({ ...base, provider_booking_id: o.bookingId, slot_start: o.slot.start, slot_end: o.slot.end, status: 'confirmed', failure_reason: null });
    return;
  }
  if (o.status === 'failed') {
    await store.saveBooking({ ...base, provider_booking_id: null, slot_start: o.slot?.start ?? null, slot_end: o.slot?.end ?? null, status: 'failed', failure_reason: o.reason });
    await store.addIntegrationError({ service: o.provider, operation: 'book', idempotency_key: key(callId), call_id: callId, lead_id: leadId, attempt: 1, error_code: null, message: o.reason });
    await store.addFollowupTask({ lead_id: leadId, call_id: callId, reason: 'booking_failed', missing_fields: [], notes: 'Calendar error during booking — please confirm a consultation time with the caller.' });
    return;
  }
  await store.saveBooking({ ...base, provider_booking_id: null, slot_start: null, slot_end: null, status: 'pending', failure_reason: null });
  await store.addFollowupTask({ lead_id: leadId, call_id: callId, reason: 'booking_pending', missing_fields: [], notes: `No offered slot suited the caller.${o.preference ? ` Preference: ${o.preference}.` : ''} Please arrange a time.` });
}

/** S17: none of the offered slots suit the caller → booking pending, preference saved, front desk follows up. */
export async function recordNoSuitableSlot(deps: BookingDeps, ctx: BookingContext): Promise<void> {
  await deps.store.saveBooking({
    lead_id: ctx.leadId, call_id: ctx.callId, provider: deps.calendar.provider, event_type_id: null, provider_booking_id: null,
    slot_start: null, slot_end: null, status: 'pending', preference: ctx.preference ?? null, failure_reason: null, idempotency_key: key(ctx.callId),
  });
  await deps.store.addFollowupTask({
    lead_id: ctx.leadId, call_id: ctx.callId, reason: 'booking_pending', missing_fields: [],
    notes: `No offered slot suited the caller.${ctx.preference ? ` Preference: ${ctx.preference}.` : ''} Please arrange a time.`,
  });
}
