import { FIELD_KEYS, UNKNOWN, type Extraction, type FieldKey, type Transcript } from '../domain/types';

/** Case/whitespace/punctuation-insensitive form used to check a quote against the transcript. */
export function normaliseForQuote(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\p{L}\p{N}\s'₹-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type QuoteRejection = { field: FieldKey; quote: string | null; reason: 'missing_quote' | 'quote_not_in_transcript' };

/**
 * Rule 5: every extracted field must carry a verbatim quote from the CALLER's turns.
 * A field whose quote is missing or not found is set to unknown, and the rejection is
 * counted in validatorFailures (two on one field → X3).
 * If the quote is found in a different caller turn than claimed, the turn is corrected.
 */
export function validateQuotes(
  extraction: Extraction,
  transcript: Transcript,
): { extraction: Extraction; rejected: QuoteRejection[] } {
  const callerTurns = transcript
    .map((t, i) => ({ i, text: normaliseForQuote(t.text), speaker: t.speaker }))
    .filter((t) => t.speaker === 'caller');

  const fields = { ...extraction.fields } as Record<FieldKey, Extraction['fields'][FieldKey]>;
  const failures = { ...extraction.validatorFailures };
  const rejected: QuoteRejection[] = [];

  for (const key of FIELD_KEYS) {
    const fv = fields[key];
    if (fv.value === 'unknown') continue;

    const q = fv.quote ? normaliseForQuote(fv.quote) : '';
    if (!q) {
      rejected.push({ field: key, quote: fv.quote, reason: 'missing_quote' });
    } else {
      const claimed = callerTurns.find((t) => t.i === fv.turn && t.text.includes(q));
      const found = claimed ?? callerTurns.find((t) => t.text.includes(q));
      if (found) {
        fields[key] = { ...fv, turn: found.i } as typeof fv;
        continue;
      }
      rejected.push({ field: key, quote: fv.quote, reason: 'quote_not_in_transcript' });
    }
    fields[key] = { ...UNKNOWN } as typeof fv;
    failures[key] = (failures[key] ?? 0) + 1;
  }

  return {
    extraction: { ...extraction, fields: fields as Extraction['fields'], validatorFailures: failures },
    rejected,
  };
}
