import { rulesConfig } from '../../../config/rules.config';
import type { CriterionResult, ExtractionFields, IsoDate } from '../../domain/types';
import { addDays, diffDays, resolveDeadline, resolveStart } from '../dates';
import { ev, known, result } from '../fields';

const t = rulesConfig.timeline;

/** C3 — realistic timeline, measured from the call date. */
export function evalC3(f: ExtractionFields, callDate: IsoDate): CriterionResult {
  const evidence = [...ev('completion', f.completion), ...ev('site_available', f.site_available)];

  const deadline = known(f.completion) ? resolveDeadline(f.completion.value, callDate) : null;
  const siteFrom = known(f.site_available) ? resolveStart(f.site_available.value, callDate) : null;
  const siteLimit = addDays(callDate, t.consultationBufferDays + t.siteWindowDays);
  const detail: Record<string, unknown> = { callDate, deadline, siteFrom, siteLimit };

  if (deadline && deadline !== 'no_deadline') {
    const days = diffDays(callDate, deadline);
    detail.daysToDeadline = days;
    if (days < t.failBelowDays) {
      return result('fail', 'C3.FAIL_DEADLINE_UNDER_6_WEEKS', evidence, {
        note: 'The completion date is less than six weeks away, which is too short for design and execution.',
        detail,
      });
    }
  }

  if (siteFrom && siteFrom > siteLimit) {
    return result(t.siteLateState, 'C3.ESCALATE_SITE_AVAILABLE_LATE', evidence, {
      note: `Site not available for execution until ${siteFrom} (Q3).`,
      detail,
    });
  }

  if (deadline === 'no_deadline') return result('pass', 'C3.PASS_NO_DEADLINE', evidence, { detail });
  if (deadline) {
    const days = detail.daysToDeadline as number;
    if (days < t.passFromDays) {
      return result(t.tightState, 'C3.PASS_TIGHT_6_TO_20_WEEKS', evidence, {
        note: 'Tight timeline (6–20 weeks). The agent must not promise the date is achievable.',
        detail,
      });
    }
    return result('pass', 'C3.PASS_20_WEEKS_PLUS', evidence, { detail });
  }

  if (siteFrom && t.startOnlyImpliesNoDeadline) {
    return result('pass', 'C3.PASS_START_ONLY_NO_DEADLINE_Q17', evidence, { detail });
  }

  return result('unknown', 'C3.UNKNOWN_NO_COMPLETION_INFO', evidence, { detail });
}
