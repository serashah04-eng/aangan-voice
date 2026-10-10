import { rulesConfig } from '../../../config/rules.config';
import type { CriterionResult, ExtractionFields } from '../../domain/types';
import { ev, known, result } from '../fields';

/** C5 — decision-maker on the call or represented. Never pushed. */
export function evalC5(f: ExtractionFields): CriterionResult {
  const evidence = [...ev('caller_role', f.caller_role), ...ev('decider_attends', f.decider_attends)];

  if (!known(f.caller_role)) {
    return result('unknown', 'C5.UNKNOWN_NOT_STATED', evidence, {
      note: 'Decision-maker not confirmed on the call (not asked, treated as passing).',
    });
  }
  const role = f.caller_role.value;
  if ((rulesConfig.decider.passRoles as readonly string[]).includes(role)) {
    return result('pass', `C5.PASS_${role.toUpperCase()}`, evidence);
  }
  if (role === 'researching_for_other') {
    if (known(f.decider_attends) && f.decider_attends.value === true) {
      return result(rulesConfig.decider.deciderAttendsState, 'C5.PASS_WITH_NOTE_DECIDER_WILL_ATTEND_Q8', evidence, {
        note: 'Caller is researching for someone else; the decision-maker will attend the consultation.',
      });
    }
    return result('escalate', 'C5.ESCALATE_DECIDER_NOT_CONFIRMED', evidence, {
      note: "Caller is researching for someone else and couldn't say the decision-maker will attend.",
    });
  }
  return result('unknown', 'C5.UNKNOWN_ROLE_WITHOUT_AUTHORITY', evidence, {
    note: 'Caller stated a role but not that they can decide (treated as passing, with a note).',
  });
}
