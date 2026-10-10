import { RULES_CONFIG_VERSION } from '../../config/rules.config';
import {
  Extraction as ExtractionSchema,
  IsoDate as IsoDateSchema,
  type AskableField,
  type CriterionId,
  type CriterionResult,
  type EvaluationResult,
  type Extraction,
  type IsoDate,
} from '../domain/types';
import { evalC1a } from './criteria/c1a-intent';
import { evalC1b } from './criteria/c1b-scope';
import { evalC2 } from './criteria/c2-area';
import { evalC3 } from './criteria/c3-timeline';
import { evalC4 } from './criteria/c4-budget';
import { evalC5 } from './criteria/c5-decider';
import { nextStep } from './next-step';
import { decideOutcome } from './outcome';
import { evalTriggers } from './overrides';
import { DEFAULT_RULES_VERSION } from './version';

export type EvaluationContext = {
  /** Date of the call (IST calendar date). All timeline rules are measured from here. */
  callDate: IsoDate;
  /** Fields the agent has already asked for on this call. */
  asked?: readonly AskableField[];
  /** Git SHA of the deployed rules; defaults to RULES_VERSION / VERCEL_GIT_COMMIT_SHA / "dev". */
  rulesVersion?: string;
};

/**
 * The deterministic rules engine. Pure: same extraction + context → same result.
 * The model's suggested outcome (if any) is ignored here by design.
 */
export function evaluate(extraction: Extraction, ctx: EvaluationContext): EvaluationResult {
  const x = ExtractionSchema.parse(extraction);
  const callDate = IsoDateSchema.parse(ctx.callDate);
  const f = x.fields;

  const criteria: Record<CriterionId, CriterionResult> = {
    C1a: evalC1a(f),
    C1b: evalC1b(f),
    C2: evalC2(f),
    C3: evalC3(f, callDate),
    C4: evalC4(f),
    C5: evalC5(f),
  };
  const triggers = evalTriggers(x);
  const { outcome, ruleId } = decideOutcome(f, criteria, triggers);

  return {
    criteria,
    triggers,
    outcome,
    outcomeRuleId: ruleId,
    next: nextStep(f, criteria, triggers, outcome, ctx.asked ?? []),
    rulesVersion: ctx.rulesVersion ?? DEFAULT_RULES_VERSION,
    configVersion: RULES_CONFIG_VERSION,
  };
}
