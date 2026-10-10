import type { CriterionState, Outcome } from './types';

/** Row shapes for the Supabase tables (snake_case, as stored). Ids are UUID strings. */

export type CallRow = {
  id: string;
  provider: string;
  provider_call_id: string | null;
  lead_id: string | null;
  caller_phone_e164: string;
  call_type: 'enquiry' | 'other' | null;
  language: string | null;
  status: 'in_progress' | 'completed' | 'dropped' | 'failed';
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_s: number | null;
  after_hours: boolean | null;
  end_reason: string | null;
  resumed_from_call_id: string | null;
  telephony_minutes: number | null;
  outcome: Outcome | null;
  outcome_rule_id: string | null;
  model_suggested_outcome: string | null;
  pricing_asked_count: number;
  rules_version: string | null;
  rules_config_version: string | null;
  prompt_version: string | null;
  extractor_model: string | null;
};

export type TurnRow = {
  call_id: string;
  turn_index: number;
  speaker: 'caller' | 'agent';
  text: string;
  spoken_at?: string;
  interrupted?: boolean;
  guard_blocked?: boolean;
  guard_reasons?: string[] | null;
};

export type LeadRow = {
  id: string;
  phone_e164: string;
  name: string | null;
  latest_outcome: Outcome | null;
  project_type: string | null;
  scope: string | null;
  locality_raw: string | null;
  locality_match: string | null;
  area_sqft: number | null;
  completion_by: string | null;
  completion_no_deadline: boolean;
  site_available_from: string | null;
  tight_timeline: boolean;
  budget_raw: string | null;
  decider_note: string | null;
  pricing_asked: boolean;
  consultation_preference: string | null;
  hubspot_contact_id: string | null;
  hubspot_deal_id: string | null;
};

export type EvidenceRow = {
  call_id: string;
  lead_id: string | null;
  criterion: 'C1a' | 'C1b' | 'C2' | 'C3' | 'C4' | 'C5' | 'X1' | 'X2' | 'X3';
  state: CriterionState | 'triggered';
  rule_id: string;
  evidence_quote: string | null;
  turn: number | null;
  follow_up_asked: boolean;
  extractor_model: string | null;
  prompt_version: string | null;
  rules_version: string;
  model_suggested_outcome: string | null;
};

export type HandoffRow = {
  id: string;
  lead_id: string | null;
  call_id: string | null;
  kind: 'designer' | 'escalation';
  channel: 'telegram' | 'email';
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  idempotency_key: string;
  payload: unknown;
  sent_at: string | null;
};

export type BookingRow = {
  id: string;
  lead_id: string | null;
  call_id: string | null;
  provider: 'calcom' | 'google';
  provider_booking_id: string | null;
  event_type_id: string | null;
  slot_start: string | null;
  slot_end: string | null;
  status: 'offered' | 'confirmed' | 'pending' | 'failed' | 'cancelled';
  preference: string | null;
  failure_reason: string | null;
  idempotency_key: string;
};

export type FollowupTaskRow = {
  id: string;
  lead_id: string | null;
  call_id: string | null;
  reason: 'needs_more_information' | 'booking_failed' | 'booking_pending' | 'unsupported_language' | 'integration_failure';
  missing_fields: string[];
  status: 'open' | 'done' | 'cancelled';
  notes: string | null;
};

export type CostEventRow = {
  call_id: string | null;
  kind: 'llm' | 'telephony' | 'notification';
  provider: string;
  model: string | null;
  purpose: string | null;
  units: Record<string, number>;
  unit_rates: Record<string, number>;
  rate_version: string;
  amount_usd: number;
  occurred_on: string;
};

export type IntegrationErrorRow = {
  service: string;
  operation: string;
  idempotency_key: string | null;
  call_id: string | null;
  lead_id: string | null;
  attempt: number;
  error_code: string | null;
  message: string | null;
};

export type JobKind = 'hubspot_sync' | 'designer_handoff' | 'escalation_alert' | 'integration_alert';

export type JobRow = {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: 'pending' | 'running' | 'done' | 'dead';
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  call_id: string | null;
  lead_id: string | null;
};

export type NewJob = Pick<JobRow, 'kind' | 'payload' | 'idempotency_key'> & Partial<Pick<JobRow, 'call_id' | 'lead_id' | 'max_attempts'>>;
