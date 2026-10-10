import type { Extraction, TriggerResult } from '../domain/types';
import { ev, known } from './fields';

/** X1–X3 override triggers. Any one routes the call to human review. */
export function evalTriggers(x: Extraction): TriggerResult[] {
  const f = x.fields;
  const out: TriggerResult[] = [];

  const x1 = [
    ...(known(f.existing_client_complaint) && f.existing_client_complaint.value ? ev('existing_client_complaint', f.existing_client_complaint) : []),
    ...(known(f.names_ongoing_project_or_designer) && f.names_ongoing_project_or_designer.value
      ? ev('names_ongoing_project_or_designer', f.names_ongoing_project_or_designer)
      : []),
  ];
  if (x1.length) out.push({ trigger: 'X1', ruleId: 'X1.EXISTING_CLIENT_OR_ONGOING_PROJECT', evidence: x1 });

  const x2 = [
    ...(known(f.service_complaint) && f.service_complaint.value ? ev('service_complaint', f.service_complaint) : []),
    ...(known(f.human_requested) && f.human_requested.value ? ev('human_requested', f.human_requested) : []),
  ];
  if (x2.length) out.push({ trigger: 'X2', ruleId: 'X2.SERVICE_COMPLAINT_OR_HUMAN_REQUESTED', evidence: x2 });

  const repeatedRejections = Object.entries(x.validatorFailures).filter(([, n]) => (n ?? 0) >= 2);
  if (x.contradictions.length) {
    out.push({
      trigger: 'X3',
      ruleId: 'X3.CONTRADICTORY_ANSWERS',
      evidence: x.contradictions.flatMap((c) => c.quotes.map((quote) => ({ field: c.field, quote, turn: null }))),
    });
  } else if (repeatedRejections.length) {
    out.push({ trigger: 'X3', ruleId: 'X3.QUOTE_VALIDATOR_FAILED_TWICE', evidence: [] });
  }
  return out;
}
