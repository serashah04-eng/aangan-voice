/**
 * Debug the Cal.com booking path with a REAL slot: list → isAvailable → book. If the booking
 * succeeds it is cancelled immediately. Prints only error text (phone redacted by the adapter).
 *   npx tsx scripts/calcom-debug.ts
 */
import { buildCalendar, loadLocalEnv } from '../src/services/container';

loadLocalEnv();
const cal = buildCalendar();
const from = new Date(Date.now() + 3 * 86_400_000).toISOString();
const to = new Date(Date.now() + 9 * 86_400_000).toISOString();
const slots = await cal.listSlots(from, to);
console.log(`slots: ${slots.length}, first: ${slots[0]?.start}`);
const slot = slots[0]!;
try {
  console.log('isAvailable:', await cal.isAvailable(slot));
} catch (e) {
  console.log('isAvailable ERROR:', (e as Error).message);
}
try {
  const r = await cal.book({ slot, attendeeName: 'TEST Aangan debug', attendeePhone: '+910000000099', notes: 'Debug booking — will be cancelled.', idempotencyKey: `debug:${Date.now()}` });
  console.log('book OK:', r.bookingId);
  const key = (process.env.CALCOM_API_KEY ?? '').trim();
  const c = await fetch(`https://api.cal.com/v2/bookings/${r.bookingId}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'cal-api-version': '2024-08-13', 'Content-Type': 'application/json' },
    body: JSON.stringify({ cancellationReason: 'Automated test booking' }),
  });
  console.log('cancel:', c.status);
} catch (e) {
  console.log('book ERROR:', (e as Error).message);
}
