import { emptyFields, type Extraction, type FieldKey, type FieldType } from '../../src/domain/types';

/** Build an Extraction directly (no transcript) for unit tests of the engine. */
export function ext(
  fields: { [K in FieldKey]?: FieldType<K> },
  extra: Partial<Pick<Extraction, 'contradictions' | 'validatorFailures'>> = {},
): Extraction {
  const base = emptyFields() as Record<FieldKey, { value: unknown; quote: string | null; turn: number | null }>;
  for (const [k, v] of Object.entries(fields)) base[k as FieldKey] = { value: v, quote: `quote for ${k}`, turn: 1 };
  return {
    fields: base as Extraction['fields'],
    contradictions: extra.contradictions ?? [],
    validatorFailures: extra.validatorFailures ?? {},
  };
}

/** A fully qualified residential lead; override fields per test. */
export function qualifiedLead(overrides: { [K in FieldKey]?: FieldType<K> } = {}): Extraction {
  return ext({
    caller_name: 'Test Caller',
    intent: 'design_and_execution',
    property_category: 'residential',
    bhk: 3,
    scope_kind: 'full_home',
    locality: 'Baner',
    completion: { kind: 'no_deadline' },
    ...overrides,
  });
}

export const CALL = '2026-10-01';
