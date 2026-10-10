import { MockLlmClient } from '../../src/adapters/llm/mock';
import { FIELD_KEYS, type DateExpr, type Extraction, type Turn } from '../../src/domain/types';
import { normaliseForQuote } from '../../src/extraction/quote-validator';

const ENUM_FIELDS = ['call_type', 'language', 'intent', 'property_category', 'residential_kind', 'scope_kind', 'caller_role'];

/** Render a domain Extraction the way the model is asked to reply. */
export function toModelReply(x: Extraction, suggested = 'qualified') {
  const fields: Record<string, unknown> = {};
  for (const k of FIELD_KEYS) {
    const f = x.fields[k];
    let value: unknown = f.value === 'unknown' ? null : f.value;
    if ((k === 'completion' || k === 'site_available') && f.value !== 'unknown') {
      const d = f.value as DateExpr;
      value = d.kind === 'festival' ? { kind: 'festival', festival: d.name, relation: d.relation } : { ...d };
    }
    if (f.value === 'unknown' && ENUM_FIELDS.includes(k)) value = 'unknown';
    fields[k] = { value, quote: f.quote, turn: f.turn };
  }
  return { fields, contradictions: x.contradictions, model_suggested_outcome: suggested };
}

/** Caller turns contained in an extractor request. */
export function callerTextsOf(user: string): string[] {
  const json = JSON.parse(user.split('<transcript format="json">')[1]!.split('</transcript>')[0]!) as Array<Turn & { turn: number }>;
  return json.filter((t) => t.speaker === 'caller').map((t) => t.text);
}

/**
 * A scripted "model" that reveals a fixture's fields only once the caller has said the quote —
 * so a live session sees knowledge build up turn by turn, like the real extractor.
 */
export function progressiveLlm(full: Extraction, overrides: (callerTexts: string[]) => Partial<Record<string, unknown>> = () => ({})) {
  return new MockLlmClient((req) => {
    const said = callerTextsOf(req.user).map(normaliseForQuote).join(' \n ');
    const fields = { ...full.fields } as Record<string, Extraction['fields'][keyof Extraction['fields']]>;
    for (const k of FIELD_KEYS) {
      const f = fields[k]!;
      if (f.value !== 'unknown' && (!f.quote || !said.includes(normaliseForQuote(f.quote)))) {
        fields[k] = { value: 'unknown', quote: null, turn: null } as typeof f;
      }
    }
    const reply = toModelReply({ ...full, fields: fields as Extraction['fields'] });
    return { ...reply, fields: { ...reply.fields, ...overrides(callerTextsOf(req.user)) } };
  });
}
