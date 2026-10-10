export type Slot = { start: string; end: string };

export type BookingRequest = {
  slot: Slot;
  attendeeName: string;
  /** Kept in booking notes so the designer can call; the attendee email is the studio inbox (Q27). */
  attendeePhone: string;
  notes: string;
  idempotencyKey: string;
};

/** Calendar behind an interface: Cal.com first, Google Calendar second, in-memory mock for tests. */
export interface CalendarProvider {
  readonly provider: 'calcom' | 'google';
  /** Free consultation slots between two instants. */
  listSlots(fromIso: string, toIso: string): Promise<Slot[]>;
  /** Re-check one slot immediately before confirming (S18). */
  isAvailable(slot: Slot): Promise<boolean>;
  book(req: BookingRequest): Promise<{ bookingId: string }>;
}
