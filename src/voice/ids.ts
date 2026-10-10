import { createHash } from 'node:crypto';

/**
 * Our call UUID for a Vaani call id (room name). Deterministic, so the BYOL socket server and the
 * Vercel webhook — two separate processes — write to the same `calls` row without coordinating.
 */
/**
 * Placeholder number for a call that arrives with no caller number (browser/chat tests, or an
 * inbound call whose webhook hasn't landed yet). It satisfies the leads table's E.164 check but
 * uses the unassigned "+999" country code, so it can never be mistaken for a real number.
 */
export function placeholderPhoneFor(providerCallId: string): string {
  const digits = BigInt(`0x${createHash('sha256').update(`phone:${providerCallId}`).digest('hex').slice(0, 12)}`) % 1_000_000_000n;
  return `+999${digits.toString().padStart(9, '0')}`;
}

export function callIdFor(providerCallId: string): string {
  const h = createHash('sha256').update(`vaani:${providerCallId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
