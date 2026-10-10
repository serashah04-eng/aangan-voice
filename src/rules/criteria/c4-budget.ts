import { rulesConfig } from '../../../config/rules.config';
import type { CriterionResult, ExtractionFields } from '../../domain/types';
import { parseBudget } from '../budget-parse';
import { ev, known, result } from '../fields';
import { isResidentialFullHome } from './c1b-scope';

/** C4 — budget. Never asked; only evaluated when the caller volunteers it. */
export function evalC4(f: ExtractionFields): CriterionResult {
  if (!known(f.budget_raw)) return result('not_mentioned', 'C4.NOT_MENTIONED');

  const evidence = [...ev('budget_raw', f.budget_raw), ...ev('budget_feasibility_asked', f.budget_feasibility_asked)];
  const parsed = parseBudget(f.budget_raw.value);
  if (!parsed.hasAmountCue) {
    // e.g. "budget bhi hai", "prefer not to mention" — no figure was volunteered.
    return result('not_mentioned', 'C4.NOT_MENTIONED_NO_FIGURE', evidence);
  }

  const failApplies =
    parsed.maxInr !== null && isResidentialFullHome(f) && parsed.maxInr <= rulesConfig.budget.fullHomeFloorInr;
  const escalateApplies = known(f.budget_feasibility_asked) && f.budget_feasibility_asked.value === true;
  const note = `Budget volunteered (verbatim): "${f.budget_raw.value}"`;
  const detail = { budgetRaw: f.budget_raw.value };

  if (failApplies && (!escalateApplies || rulesConfig.budget.failBeatsEscalate)) {
    return result('fail', 'C4.FAIL_FULL_HOME_AT_OR_BELOW_WRITTEN_EXAMPLE_Q2', evidence, { note, detail });
  }
  if (escalateApplies) return result('escalate', 'C4.ESCALATE_ASKED_IF_BUDGET_ENOUGH', evidence, { note, detail });
  return result('pass_with_note', 'C4.PASS_WITH_NOTE_VOLUNTEERED', evidence, { note, detail });
}
