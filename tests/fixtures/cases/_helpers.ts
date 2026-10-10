import {
  emptyFields,
  type AskableField,
  type DateExpr,
  type Extraction,
  type Room,
  type FieldKey,
  type FieldType,
  type Transcript,
  type Turn,
} from '../../../src/domain/types';
import { normaliseForQuote } from '../../../src/extraction/quote-validator';
import { rulesConfig } from '../../../config/rules.config';

/**
 * Fixture helpers. A fixture is a hand-written stand-in for what the Phase 2 extractor
 * should produce: a short spoken-style transcript plus structured fields, each carrying a
 * verbatim caller quote. Turn numbers are filled in automatically from the quote; a quote
 * that is not in a caller turn gets turn=null and is then rejected by the quote validator,
 * which fails the acceptance test loudly.
 *
 * Convention (relied on by the repo-wide pricing scan): caller speech is written on a single
 * line starting with `C(`, and volunteered budgets only appear in caller lines and `budget_raw:`.
 */

export const S = rulesConfig.scripts;
export const A = (text: string): Turn => ({ speaker: 'agent', text });
export const C = (text: string): Turn => ({ speaker: 'caller', text });

type Spec = { [K in FieldKey]?: { value: FieldType<K>; quote: string } };

export const f = <const T>(value: T, quote: string) => ({ value, quote });

export const rooms = (...r: Room[]): Room[] => r;
export const month = (m: number, year?: number): DateExpr =>
  year === undefined ? { kind: 'month', month: m } : { kind: 'month', month: m, year };
export const on = (date: string): DateExpr => ({ kind: 'date', date });
export const within = (amount: number, unit: 'days' | 'weeks' | 'months'): DateExpr => ({ kind: 'duration', amount, unit });
export const NOW: DateExpr = { kind: 'now' };
export const NO_DEADLINE: DateExpr = { kind: 'no_deadline' };

export type CaseFixture = {
  id: string;
  callDate: string;
  transcript: Transcript;
  extraction: Extraction;
  /** Fields the agent asked during the call (used by next-step tests). */
  asked: AskableField[];
  /** Why this fixture reads the transcript the way it does, where it isn't obvious. */
  notes?: string;
};

export function fx(def: {
  id: string;
  callDate: string;
  transcript: Transcript;
  fields: Spec;
  asked?: AskableField[];
  contradictions?: Extraction['contradictions'];
  notes?: string;
}): CaseFixture {
  const fields = emptyFields() as Record<FieldKey, { value: unknown; quote: string | null; turn: number | null }>;
  const callerTurns = def.transcript
    .map((t, i) => ({ i, t }))
    .filter(({ t }) => t.speaker === 'caller')
    .map(({ i, t }) => ({ i, text: normaliseForQuote(t.text) }));

  for (const [k, spec] of Object.entries(def.fields) as [FieldKey, { value: unknown; quote: string }][]) {
    const q = normaliseForQuote(spec.quote);
    const turn = callerTurns.find((t) => t.text.includes(q))?.i ?? null;
    fields[k] = { value: spec.value, quote: spec.quote, turn };
  }

  return {
    id: def.id,
    callDate: def.callDate,
    transcript: def.transcript,
    extraction: {
      fields: fields as Extraction['fields'],
      contradictions: def.contradictions ?? [],
      validatorFailures: {},
    },
    asked: def.asked ?? [],
    notes: def.notes,
  };
}
