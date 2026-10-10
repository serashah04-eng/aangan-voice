import { rulesConfig } from '../../config/rules.config';
import type { CriterionId, CriterionResult, ExtractionFields, Outcome, TriggerResult } from '../domain/types';
import { known } from './fields';

const FAIL_SCOPE: CriterionId[] = ['C1a', 'C1b', 'C2', 'C3', 'C4'];
const UNKNOWN_SCOPE: CriterionId[] = ['C1a', 'C1b', 'C2', 'C3'];

/** First match wins (brief §4). */
export function decideOutcome(
  fields: ExtractionFields,
  criteria: Record<CriterionId, CriterionResult>,
  triggers: TriggerResult[],
): { outcome: Outcome; ruleId: string } {
  if (known(fields.call_type) && fields.call_type.value === 'other') {
    return { outcome: 'not_applicable', ruleId: 'OUTCOME.NOT_AN_ENQUIRY' };
  }

  const states = Object.values(criteria);
  if (triggers.length) return { outcome: 'human_review_required', ruleId: 'OUTCOME.1_OVERRIDE_TRIGGER' };
  if (states.some((c) => c.state === 'escalate')) return { outcome: 'human_review_required', ruleId: 'OUTCOME.1_ESCALATE_STATE' };

  const fails = FAIL_SCOPE.filter((id) => criteria[id].state === 'fail');
  if (fails.length >= (rulesConfig.outcome.declineOnSingleFail ? 1 : 2)) {
    return { outcome: 'not_qualified', ruleId: 'OUTCOME.2_FAIL' };
  }
  if (fails.length) return { outcome: 'human_review_required', ruleId: 'OUTCOME.1_SINGLE_FAIL_Q1' };

  if (UNKNOWN_SCOPE.some((id) => criteria[id].state === 'unknown')) {
    return { outcome: 'needs_more_information', ruleId: 'OUTCOME.3_UNKNOWN' };
  }
  return { outcome: 'qualified', ruleId: 'OUTCOME.4_QUALIFIED' };
}
