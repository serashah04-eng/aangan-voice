import { rulesConfig, RULES_CONFIG_VERSION } from '../../config/rules.config';
import type { Store } from '../adapters/store/types';
import type { EvidenceRow } from '../domain/records';
import type { AskableField, CriterionId, EvaluationResult, Extraction, Transcript } from '../domain/types';
import type { ExtractionRun } from '../extraction/extractor';
import type { CostEvent } from '../lib/cost';
import { logger } from '../lib/logger';
import { known } from '../rules/fields';
import { leadRowFrom, summariseLead, type LeadSummary } from './lead-summary';

export type FinalizeInput = {
  callId: string;
  callerPhone: string;
  providerCallId?: string | null;
  startedAt: string;
  endedAt?: string | null;
  /** IST calendar date of the call — the date the rules engine measured from. */
  callDate: string;
  status?: 'completed' | 'dropped';
  endReason?: string | null;
  resumedFromCallId?: string | null;
  transcript: Transcript;
  extraction: Extraction;
  evaluation: EvaluationResult;
  asked: readonly AskableField[];
  run?: Pick<ExtractionRun, 'model' | 'promptVersion' | 'cost' | 'modelSuggestedOutcome'> | null;
  extraCosts?: CostEvent[];
  telephonyMinutes?: number | null;
};

export type FinalizeResult = { leadId: string | null; summary: LeadSummary | null; jobsQueued: string[]; followupTaskId: string | null };

const FOLLOW_UP_FIELDS: Record<CriterionId, AskableField[]> = {
  C1a: ['intent'],
  C1b: ['scope', 'area_sqft'],
  C2: ['locality'],
  C3: ['completion', 'completion_rephrase'],
  C4: [],
  C5: ['decider_attends'],
};

/** Calls outside 10:00–19:00 IST count as after-hours (dashboard). */
export function isAfterHours(iso: string): boolean {
  const istHour = new Date(new Date(iso).getTime() + 330 * 60_000).getUTCHours(); // IST = UTC+05:30
  return istHour < rulesConfig.hours.openHour || istHour >= rulesConfig.hours.closeHour;
}

/**
 * End-of-call persistence. Supabase is written FIRST (call, transcript, lead, evidence, costs);
 * every external effect (HubSpot, Telegram/email) is only *queued* in the outbox, so an outage
 * there can never lose the call record. Safe to run twice for the same call (idempotent).
 */
export async function finalizeCall(store: Store, input: FinalizeInput): Promise<FinalizeResult> {
  const { evaluation: ev, extraction: x } = input;
  const f = x.fields;
  const isEnquiry = !(known(f.call_type) && f.call_type.value === 'other');
  const startedMs = new Date(input.startedAt).getTime();
  const endedMs = input.endedAt ? new Date(input.endedAt).getTime() : null;

  // 1. Call + transcript — the record that must never be lost.
  await store.saveCall({
    id: input.callId,
    caller_phone_e164: input.callerPhone,
    provider_call_id: input.providerCallId ?? null,
    call_type: isEnquiry ? 'enquiry' : 'other',
    language: known(f.language) ? f.language.value : null,
    status: input.status ?? 'completed',
    started_at: input.startedAt,
    ended_at: input.endedAt ?? null,
    duration_s: endedMs ? Math.max(0, Math.round((endedMs - startedMs) / 1000)) : null,
    after_hours: isAfterHours(input.startedAt),
    end_reason: input.endReason ?? null,
    resumed_from_call_id: input.resumedFromCallId ?? null,
    telephony_minutes: input.telephonyMinutes ?? null,
    outcome: ev.outcome,
    outcome_rule_id: ev.outcomeRuleId,
    model_suggested_outcome: input.run?.modelSuggestedOutcome ?? x.modelSuggestedOutcome ?? null,
    pricing_asked_count: known(f.pricing_asked_count) ? f.pricing_asked_count.value : 0,
    rules_version: ev.rulesVersion,
    rules_config_version: RULES_CONFIG_VERSION,
    prompt_version: input.run?.promptVersion ?? null,
    extractor_model: input.run?.model ?? null,
  });
  await store.saveTurns(input.transcript.map((t, i) => ({ call_id: input.callId, turn_index: i, speaker: t.speaker, text: t.text })));

  const costs = [...(input.run?.cost ? [input.run.cost] : []), ...(input.extraCosts ?? [])];
  await store.addCostEvents(
    costs.map((c) => ({
      call_id: input.callId, kind: c.kind, provider: c.provider, model: c.model ?? null, purpose: c.purpose,
      units: c.units, unit_rates: c.unitRates, rate_version: c.rateVersion, amount_usd: c.amountUsd, occurred_on: c.occurredOn,
    })),
  );

  // Vendors / job seekers / wrong numbers: recorded, but no lead and no lead metrics.
  if (!isEnquiry) {
    await store.replaceEvidence(input.callId, evidenceRows(input, null));
    return { leadId: null, summary: null, jobsQueued: [], followupTaskId: null };
  }

  // 2. Lead (one per phone number) + criterion evidence.
  const summary = summariseLead(f, ev, input.callerPhone, input.callDate);
  const lead = await store.upsertLeadByPhone(leadRowFrom(summary));
  await store.saveCall({ id: input.callId, caller_phone_e164: input.callerPhone, lead_id: lead.id });
  await store.replaceEvidence(input.callId, evidenceRows(input, lead.id));

  // 3. Queue external work; create the front-desk task for incomplete leads.
  const jobsQueued: string[] = [];
  const queue = async (kind: 'hubspot_sync' | 'designer_handoff' | 'escalation_alert') => {
    const inserted = await store.enqueueJob({
      kind,
      idempotency_key: `${kind}:${input.callId}`,
      payload: { leadId: lead.id, callId: input.callId, outcome: ev.outcome, summary },
      call_id: input.callId,
      lead_id: lead.id,
      max_attempts: rulesConfig.outbox.maxAttempts,
    });
    if (inserted) jobsQueued.push(kind);
  };

  if ((rulesConfig.integrations.hubspotContactOutcomes as readonly string[]).includes(ev.outcome)) await queue('hubspot_sync');
  if (ev.outcome === 'qualified') await queue('designer_handoff');
  if (ev.outcome === 'human_review_required') await queue('escalation_alert');

  let followupTaskId: string | null = null;
  if (ev.outcome === 'needs_more_information') {
    const task = await store.addFollowupTask({
      lead_id: lead.id,
      call_id: input.callId,
      reason: 'needs_more_information',
      missing_fields: summary.missing,
      notes: `Call back to ask: ${summary.missing.join(', ') || 'remaining details'}. No booking until complete (Q10).`,
    });
    followupTaskId = task.id;
  }

  logger.info('call.finalized', { callId: input.callId, outcome: ev.outcome, leadId: lead.id, jobsQueued });
  return { leadId: lead.id, summary, jobsQueued, followupTaskId };
}

function evidenceRows(input: FinalizeInput, leadId: string | null): EvidenceRow[] {
  const ev = input.evaluation;
  const base = {
    call_id: input.callId,
    lead_id: leadId,
    extractor_model: input.run?.model ?? null,
    prompt_version: input.run?.promptVersion ?? null,
    rules_version: ev.rulesVersion,
    model_suggested_outcome: input.run?.modelSuggestedOutcome ?? input.extraction.modelSuggestedOutcome ?? null,
  };
  const rows: EvidenceRow[] = (Object.entries(ev.criteria) as [CriterionId, EvaluationResult['criteria'][CriterionId]][]).map(([id, c]) => ({
    ...base,
    criterion: id,
    state: c.state,
    rule_id: c.ruleId,
    evidence_quote: c.evidence.map((e) => e.quote).join(' | ') || null,
    turn: c.evidence[0]?.turn ?? null,
    follow_up_asked: FOLLOW_UP_FIELDS[id].some((fld) => input.asked.includes(fld)),
  }));
  for (const t of ev.triggers) {
    rows.push({
      ...base,
      criterion: t.trigger,
      state: 'triggered',
      rule_id: t.ruleId,
      evidence_quote: t.evidence.map((e) => e.quote).join(' | ') || null,
      turn: t.evidence[0]?.turn ?? null,
      follow_up_asked: false,
    });
  }
  return rows;
}
