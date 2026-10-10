import { randomUUID } from 'node:crypto';
import type {
  BookingRow,
  CallRow,
  CostEventRow,
  EvidenceRow,
  FollowupTaskRow,
  HandoffRow,
  IntegrationErrorRow,
  JobRow,
  LeadRow,
  NewJob,
  TurnRow,
} from '../../domain/records';
import type { Store } from './types';

const CALL_DEFAULTS: Omit<CallRow, 'id' | 'caller_phone_e164' | 'started_at'> = {
  provider: 'vaani', provider_call_id: null, lead_id: null, call_type: null, language: null, status: 'in_progress',
  answered_at: null, ended_at: null, duration_s: null, after_hours: null, end_reason: null, resumed_from_call_id: null,
  telephony_minutes: null, outcome: null, outcome_rule_id: null, model_suggested_outcome: null, pricing_asked_count: 0,
  rules_version: null, rules_config_version: null, prompt_version: null, extractor_model: null,
};

const LEAD_DEFAULTS: Omit<LeadRow, 'id' | 'phone_e164'> = {
  name: null, latest_outcome: null, project_type: null, scope: null, locality_raw: null, locality_match: null,
  area_sqft: null, completion_by: null, completion_no_deadline: false, site_available_from: null, tight_timeline: false,
  budget_raw: null, decider_note: null, pricing_asked: false, consultation_preference: null,
  hubspot_contact_id: null, hubspot_deal_id: null,
};

/** In-memory Store for tests and the offline simulator. `now` is injectable for deterministic tests. */
export class MemoryStore implements Store {
  calls = new Map<string, CallRow>();
  turns = new Map<string, TurnRow>();
  leads = new Map<string, LeadRow>();
  evidence: EvidenceRow[] = [];
  handoffs = new Map<string, HandoffRow>();
  bookings = new Map<string, BookingRow>();
  followups: FollowupTaskRow[] = [];
  costs: CostEventRow[] = [];
  errors: IntegrationErrorRow[] = [];
  jobs = new Map<string, JobRow>();
  /** Set to make every write throw (simulates Supabase being down). */
  failWrites = false;

  constructor(public now: () => Date = () => new Date()) {}

  private guard() {
    if (this.failWrites) throw new Error('store unavailable');
  }

  async saveCall(call: Partial<CallRow> & Pick<CallRow, 'id' | 'caller_phone_e164'>): Promise<CallRow> {
    this.guard();
    const prev = this.calls.get(call.id);
    const row: CallRow = { ...CALL_DEFAULTS, started_at: this.now().toISOString(), ...prev, ...call } as CallRow;
    this.calls.set(row.id, row);
    return row;
  }
  async getCall(id: string) {
    return this.calls.get(id) ?? null;
  }
  async findRecentCallByPhone(phone: string, since: string) {
    return (
      [...this.calls.values()]
        .filter((c) => c.caller_phone_e164 === phone && c.started_at >= since)
        .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0] ?? null
    );
  }

  async saveTurns(turns: TurnRow[]) {
    this.guard();
    for (const t of turns) this.turns.set(`${t.call_id}:${t.turn_index}`, { ...t });
  }

  async getTurns(callId: string) {
    return [...this.turns.values()].filter((t) => t.call_id === callId).sort((a, b) => a.turn_index - b.turn_index);
  }

  async upsertLeadByPhone(lead: Partial<LeadRow> & Pick<LeadRow, 'phone_e164'>) {
    this.guard();
    const prev = [...this.leads.values()].find((l) => l.phone_e164 === lead.phone_e164);
    const row: LeadRow = { ...LEAD_DEFAULTS, id: prev?.id ?? randomUUID(), ...prev, ...stripUndefined(lead) } as LeadRow;
    this.leads.set(row.id, row);
    return row;
  }
  async updateLead(id: string, patch: Partial<LeadRow>) {
    this.guard();
    const prev = this.leads.get(id);
    if (prev) this.leads.set(id, { ...prev, ...patch });
  }
  async getLead(id: string) {
    return this.leads.get(id) ?? null;
  }

  async replaceEvidence(callId: string, rows: EvidenceRow[]) {
    this.guard();
    this.evidence = [...this.evidence.filter((e) => e.call_id !== callId), ...rows];
  }

  async saveHandoff(row: Omit<HandoffRow, 'id'> & { id?: string }) {
    this.guard();
    const prev = [...this.handoffs.values()].find((h) => h.idempotency_key === row.idempotency_key);
    const saved: HandoffRow = { ...prev, ...row, id: prev?.id ?? row.id ?? randomUUID() } as HandoffRow;
    this.handoffs.set(saved.id, saved);
    return saved;
  }
  async saveBooking(row: Omit<BookingRow, 'id'> & { id?: string }) {
    this.guard();
    const prev = [...this.bookings.values()].find((b) => b.idempotency_key === row.idempotency_key);
    const saved: BookingRow = { ...prev, ...row, id: prev?.id ?? row.id ?? randomUUID() } as BookingRow;
    this.bookings.set(saved.id, saved);
    return saved;
  }
  async addFollowupTask(row: Omit<FollowupTaskRow, 'id' | 'status'>) {
    this.guard();
    const existing = this.followups.find((f) => f.call_id === row.call_id && f.reason === row.reason && f.status === 'open');
    if (existing) return existing;
    const saved: FollowupTaskRow = { ...row, id: randomUUID(), status: 'open' };
    this.followups.push(saved);
    return saved;
  }
  async addCostEvents(rows: CostEventRow[]) {
    this.guard();
    this.costs.push(...rows);
  }
  async addIntegrationError(row: IntegrationErrorRow) {
    this.errors.push(row);
  }

  async enqueueJob(job: NewJob) {
    this.guard();
    if ([...this.jobs.values()].some((j) => j.idempotency_key === job.idempotency_key)) return false;
    const row: JobRow = {
      id: randomUUID(), status: 'pending', attempts: 0, max_attempts: job.max_attempts ?? 5,
      next_attempt_at: this.now().toISOString(), last_error: null, call_id: job.call_id ?? null, lead_id: job.lead_id ?? null,
      kind: job.kind, payload: job.payload, idempotency_key: job.idempotency_key,
    };
    this.jobs.set(row.id, row);
    return true;
  }
  async claimJobs(limit: number) {
    const now = this.now().toISOString();
    const due = [...this.jobs.values()]
      .filter((j) => j.status === 'pending' && j.next_attempt_at <= now)
      .sort((a, b) => (a.next_attempt_at < b.next_attempt_at ? -1 : 1))
      .slice(0, limit);
    for (const j of due) {
      j.status = 'running';
      j.attempts += 1;
    }
    return due.map((j) => ({ ...j }));
  }
  async completeJob(id: string) {
    const j = this.jobs.get(id);
    if (j) Object.assign(j, { status: 'done', last_error: null });
  }
  async failJob(id: string, error: string, nextAttemptAt: string | null) {
    const j = this.jobs.get(id);
    if (j) Object.assign(j, nextAttemptAt ? { status: 'pending', next_attempt_at: nextAttemptAt, last_error: error } : { status: 'dead', last_error: error });
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
