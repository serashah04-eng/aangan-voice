import type { CriterionResult, CriterionState, Evidence, FieldKey, FieldValue, KnownField } from '../domain/types';

export function known<T>(f: FieldValue<T> | undefined): f is KnownField<T> {
  return !!f && f.value !== 'unknown' && f.quote !== null;
}

export function ev(field: FieldKey, f: FieldValue<unknown>): Evidence[] {
  return known(f) ? [{ field, quote: f.quote, turn: f.turn }] : [];
}

export function result(
  state: CriterionState,
  ruleId: string,
  evidence: Evidence[] = [],
  extra: Pick<CriterionResult, 'note' | 'detail'> = {},
): CriterionResult {
  return { state, ruleId, evidence, ...extra };
}

/** Lowercase, straighten quotes/dashes, collapse whitespace. Shared by locality and keyword matching. */
export function normaliseText(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word (or whole-phrase) match on normalised text. */
export function hasTerm(normalisedText: string, term: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normaliseText(term))}($|[^a-z0-9])`).test(normalisedText);
}
