import { z } from 'zod';

/* ------------------------------------------------------------------ primitives */

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export type IsoDate = z.infer<typeof IsoDate>;

/**
 * A date as the caller expressed it. The extractor emits one of these plus the quote;
 * src/rules/dates.ts turns it into a calendar date deterministically.
 */
export const DateExpr = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('date'), date: IsoDate }),
  z.object({ kind: z.literal('month'), month: z.number().int().min(1).max(12), year: z.number().int().optional() }),
  z.object({ kind: z.literal('duration'), amount: z.number().positive(), unit: z.enum(['days', 'weeks', 'months']) }),
  z.object({ kind: z.literal('festival'), name: z.string(), relation: z.enum(['before', 'by', 'after']) }),
  /** Start only: the site is available now. */
  z.object({ kind: z.literal('now') }),
  /** Completion only: the caller has no deadline. */
  z.object({ kind: z.literal('no_deadline') }),
]);
export type DateExpr = z.infer<typeof DateExpr>;

/** Every extracted field carries the verbatim caller quote it came from. */
export const fieldValue = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    value: z.union([inner, z.literal('unknown')]),
    quote: z.string().min(1).nullable(),
    turn: z.number().int().nonnegative().nullable(),
  });

export type FieldValue<T> = { value: T | 'unknown'; quote: string | null; turn: number | null };
export type KnownField<T> = { value: T; quote: string; turn: number | null };

export const UNKNOWN: FieldValue<never> = Object.freeze({ value: 'unknown', quote: null, turn: null }) as FieldValue<never>;

/* ------------------------------------------------------------------ enums */

export const Intent = z.enum([
  'design_and_execution',
  'advice_only',
  'diy_execution',
  'decor_only',
  'vastu_only',
  'sourcing_only',
  'exploring',
]);
export type Intent = z.infer<typeof Intent>;

export const Room = z.enum([
  'bedroom',
  'living',
  'kitchen',
  'bathroom',
  'wardrobe',
  'dining',
  'study',
  'home_office',
  'puja',
  'balcony',
  'other',
]);
export type Room = z.infer<typeof Room>;

export const CallerRole = z.enum([
  'owner',
  'co_owner_with_consent',
  'founder',
  'authorised_rep',
  'tenant_with_landlord_consent',
  'researching_for_other',
  'other',
]);
export type CallerRole = z.infer<typeof CallerRole>;

export const CriterionId = z.enum(['C1a', 'C1b', 'C2', 'C3', 'C4', 'C5']);
export type CriterionId = z.infer<typeof CriterionId>;

export const CriterionState = z.enum([
  'pass',
  'pass_tight',
  'pass_with_note',
  'not_mentioned',
  'fail',
  'unknown',
  'escalate',
]);
export type CriterionState = z.infer<typeof CriterionState>;

export const Outcome = z.enum([
  'qualified',
  'not_qualified',
  'needs_more_information',
  'human_review_required',
  'not_applicable',
]);
export type Outcome = z.infer<typeof Outcome>;

export const Trigger = z.enum(['X1', 'X2', 'X3']);
export type Trigger = z.infer<typeof Trigger>;

/* ------------------------------------------------------------------ extraction */

export const ExtractionFields = z.object({
  call_type: fieldValue(z.enum(['enquiry', 'other'])),
  caller_name: fieldValue(z.string()),
  language: fieldValue(z.enum(['en', 'hi', 'other'])),
  intent: fieldValue(Intent),
  structural_work: fieldValue(z.boolean()),
  property_category: fieldValue(z.enum(['residential', 'commercial'])),
  residential_kind: fieldValue(z.enum(['apartment', 'independent_house', 'villa'])),
  commercial_type: fieldValue(z.string()),
  scope_kind: fieldValue(z.enum(['full_home', 'full_floor', 'rooms'])),
  bhk: fieldValue(z.number().int().positive()),
  rooms: fieldValue(z.array(Room).min(1)),
  area_sqft: fieldValue(z.number().positive()),
  locality: fieldValue(z.string()),
  completion: fieldValue(DateExpr),
  site_available: fieldValue(DateExpr),
  budget_raw: fieldValue(z.string()),
  budget_feasibility_asked: fieldValue(z.boolean()),
  caller_role: fieldValue(CallerRole),
  decider_attends: fieldValue(z.boolean()),
  existing_client_complaint: fieldValue(z.boolean()),
  names_ongoing_project_or_designer: fieldValue(z.boolean()),
  service_complaint: fieldValue(z.boolean()),
  human_requested: fieldValue(z.boolean()),
  pricing_asked_count: fieldValue(z.number().int().nonnegative()),
  consultation_preference: fieldValue(z.string()),
});
export type ExtractionFields = z.infer<typeof ExtractionFields>;

export const FieldKey = ExtractionFields.keyof();
export type FieldKey = z.infer<typeof FieldKey>;
export const FIELD_KEYS = FieldKey.options;

/** Value type of a field once known. */
export type FieldType<K extends FieldKey> = Exclude<ExtractionFields[K]['value'], 'unknown'>;

export const Extraction = z.object({
  fields: ExtractionFields,
  /** Two incompatible values for one field that both still stand after one clarifying question (X3). */
  contradictions: z.array(z.object({ field: FieldKey, quotes: z.array(z.string()).min(2) })).default([]),
  /** Number of times the quote validator rejected each field during the call (X3 at 2). */
  validatorFailures: z.record(FieldKey, z.number().int().nonnegative()).default({}),
  /** Logged for the rules-vs-model disagreement metric. NEVER used to decide anything. */
  modelSuggestedOutcome: Outcome.optional(),
});
export type Extraction = z.infer<typeof Extraction>;

export function emptyFields(): ExtractionFields {
  const out = {} as Record<FieldKey, FieldValue<unknown>>;
  for (const k of FIELD_KEYS) out[k] = { ...UNKNOWN };
  return out as ExtractionFields;
}

/* ------------------------------------------------------------------ transcript */

export const Turn = z.object({
  speaker: z.enum(['caller', 'agent']),
  text: z.string(),
});
export type Turn = z.infer<typeof Turn>;
export type Transcript = Turn[];

/* ------------------------------------------------------------------ engine output */

export type Evidence = { field: FieldKey; quote: string; turn: number | null };

export type CriterionResult = {
  state: CriterionState;
  /** Stable identifier of the rule that produced the state, stored in criterion_evidence.rule_id. */
  ruleId: string;
  evidence: Evidence[];
  /** Plain-words note for the designer handoff / closing reason. */
  note?: string;
  detail?: Record<string, unknown>;
};

export type AskableField =
  | 'intent'
  | 'scope'
  | 'area_sqft'
  | 'locality'
  | 'completion'
  | 'completion_rephrase'
  | 'decider_attends'
  | 'caller_name';

export type NextStep = { next: 'ask'; field: AskableField } | { next: 'close'; outcome: Outcome };

export type TriggerResult = { trigger: Trigger; ruleId: string; evidence: Evidence[] };

export type EvaluationResult = {
  criteria: Record<CriterionId, CriterionResult>;
  triggers: TriggerResult[];
  outcome: Outcome;
  outcomeRuleId: string;
  next: NextStep;
  rulesVersion: string;
  configVersion: string;
};
