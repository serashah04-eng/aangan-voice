import type { AskableField, CriterionId, CriterionResult, ExtractionFields, NextStep, Outcome, TriggerResult } from '../domain/types';
import { known } from './fields';
import { projectShape } from './criteria/c1b-scope';

/**
 * After every caller turn: ask for the next missing field, or close.
 * Each field is asked at most once (completion may be rephrased once). Stops asking as soon
 * as the outcome is certain.
 */
export function nextStep(
  fields: ExtractionFields,
  criteria: Record<CriterionId, CriterionResult>,
  triggers: TriggerResult[],
  outcome: Outcome,
  asked: readonly AskableField[],
): NextStep {
  const notAsked = (f: AskableField) => !asked.includes(f);
  const close: NextStep = { next: 'close', outcome };

  if (outcome === 'not_applicable' || outcome === 'not_qualified') return close;

  if (outcome === 'human_review_required') {
    // The only open escalation is C5 and its one permitted question hasn't been asked yet.
    const onlyC5 =
      triggers.length === 0 &&
      Object.entries(criteria).every(([id, c]) => (id === 'C5' ? c.state === 'escalate' : c.state !== 'escalate'));
    if (onlyC5 && !known(fields.decider_attends) && notAsked('decider_attends')) {
      return { next: 'ask', field: 'decider_attends' };
    }
    return close;
  }

  if (criteria.C1a.state === 'unknown' && notAsked('intent')) return { next: 'ask', field: 'intent' };

  if (criteria.C1b.state === 'unknown') {
    const shape = projectShape(fields);
    const field: AskableField =
      shape.category === 'commercial' && known(fields.commercial_type) && !known(fields.area_sqft) ? 'area_sqft' : 'scope';
    if (notAsked(field)) return { next: 'ask', field };
  }

  if (criteria.C2.state === 'unknown' && notAsked('locality')) return { next: 'ask', field: 'locality' };

  if (criteria.C3.state === 'unknown') {
    if (notAsked('completion')) return { next: 'ask', field: 'completion' };
    if (notAsked('completion_rephrase')) return { next: 'ask', field: 'completion_rephrase' };
  }

  if (!known(fields.caller_name) && notAsked('caller_name')) return { next: 'ask', field: 'caller_name' };

  return close;
}
