import { createHash } from 'node:crypto';

/**
 * Our call UUID for a Vaani call id (room name). Deterministic, so the BYOL socket server and the
 * Vercel webhook — two separate processes — write to the same `calls` row without coordinating.
 */
export function callIdFor(providerCallId: string): string {
  const h = createHash('sha256').update(`vaani:${providerCallId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
