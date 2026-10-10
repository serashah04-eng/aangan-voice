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

/**
 * The system of record. Implemented by Supabase (production) and in memory (tests, simulator).
 * Every write is idempotent on its natural key so a retried request never duplicates data.
 */
export interface Store {
  /** Insert or update a call by id. */
  saveCall(call: Partial<CallRow> & Pick<CallRow, 'id' | 'caller_phone_e164'>): Promise<CallRow>;
  getCall(id: string): Promise<CallRow | null>;
  /** Most recent call from this number that started at or after `since` (dropped-call resume). */
  findRecentCallByPhone(phone: string, since: string): Promise<CallRow | null>;

  /** Upsert by (call_id, turn_index). */
  saveTurns(turns: TurnRow[]): Promise<void>;
  /** All turns of a call in order (dropped-call resume). */
  getTurns(callId: string): Promise<TurnRow[]>;

  /** Upsert by phone; returns the stored lead (existing HubSpot ids are kept unless overwritten). */
  upsertLeadByPhone(lead: Partial<LeadRow> & Pick<LeadRow, 'phone_e164'>): Promise<LeadRow>;
  updateLead(id: string, patch: Partial<LeadRow>): Promise<void>;
  getLead(id: string): Promise<LeadRow | null>;

  /** Replace this call's evidence rows (re-finalising a call never duplicates them). */
  replaceEvidence(callId: string, rows: EvidenceRow[]): Promise<void>;

  saveHandoff(row: Omit<HandoffRow, 'id'> & { id?: string }): Promise<HandoffRow>;
  saveBooking(row: Omit<BookingRow, 'id'> & { id?: string }): Promise<BookingRow>;
  /** Insert unless an open task for the same call and reason exists. */
  addFollowupTask(row: Omit<FollowupTaskRow, 'id' | 'status'>): Promise<FollowupTaskRow>;
  addCostEvents(rows: CostEventRow[]): Promise<void>;
  addIntegrationError(row: IntegrationErrorRow): Promise<void>;

  /** Insert a job; a duplicate idempotency_key is ignored. Returns true if newly inserted. */
  enqueueJob(job: NewJob): Promise<boolean>;
  /** Atomically mark up to `limit` due jobs as running (attempts += 1) and return them. */
  claimJobs(limit: number): Promise<JobRow[]>;
  completeJob(id: string): Promise<void>;
  failJob(id: string, error: string, nextAttemptAt: string | null): Promise<void>;
}
