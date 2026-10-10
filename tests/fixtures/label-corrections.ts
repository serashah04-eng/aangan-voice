import type { CriterionId, CriterionState } from '../../src/domain/types';

/**
 * Documented corrections to CSV labels that contradict the brief's own rules
 * (docs/PHASE0_PLAN.md §2), approved in Phase 0. Used by the acceptance tests and the eval.
 */
export const LABEL_CORRECTIONS: Record<string, Partial<Record<CriterionId, { state: CriterionState; why: string }>>> = {
  F03: {
    C4: {
      state: 'pass_with_note',
      why: 'K3: the caller volunteered a figure; every other volunteered-budget row is pass_with_note.',
    },
  },
};

export const SKIP_OUTCOMES = new Set(['no_label', 'unchanged', 'field_unknown', 'per_content']);

export const CRITERION_COLUMNS: Record<string, CriterionId> = {
  C1a_intent: 'C1a',
  C1b_scope: 'C1b',
  C2_area: 'C2',
  C3_timeline: 'C3',
  C4_budget: 'C4',
  C5_decider: 'C5',
};
