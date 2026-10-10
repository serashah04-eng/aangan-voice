import { rulesConfig } from '../../../config/rules.config';
import type { CriterionResult, ExtractionFields } from '../../domain/types';
import { ev, known, result } from '../fields';

/** C1a — design + execution intent. */
export function evalC1a(f: ExtractionFields): CriterionResult {
  const { intent, structural_work } = f;

  if (known(intent) && (rulesConfig.intent.failIntents as readonly string[]).includes(intent.value)) {
    return result('fail', `C1a.FAIL_${intent.value.toUpperCase()}`, ev('intent', intent), {
      note: 'Not a design-and-execution project (advice, decor, Vastu, sourcing or DIY only).',
    });
  }
  if (known(structural_work) && structural_work.value === true) {
    return result(rulesConfig.intent.structuralState, 'C1a.ESCALATE_STRUCTURAL_WORK', [
      ...ev('structural_work', structural_work),
      ...ev('intent', intent),
    ], { note: 'Interiors plus wall moves or structural work.' });
  }
  if (known(intent) && intent.value === 'design_and_execution') {
    return result('pass', 'C1a.PASS_DESIGN_AND_EXECUTION', ev('intent', intent));
  }
  if (known(intent) && intent.value === 'exploring') {
    return result('unknown', 'C1a.UNKNOWN_JUST_EXPLORING', ev('intent', intent));
  }
  return result('unknown', 'C1a.UNKNOWN_NOT_STATED');
}
