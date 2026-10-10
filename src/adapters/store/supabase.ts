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
import { redactPhones } from '../../lib/logger';
import type { Store } from './types';

export type SupabaseStoreOptions = {
  url: string;
  /** Service-role key. Server-side only — bypasses RLS. */
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
};

class SupabaseError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Store backed by Supabase PostgREST. Uses the service role (server-side only).
 * Phone-number lookups use POST bodies (RPC / upsert bodies) so numbers never appear in URLs.
 */
export class SupabaseStore implements Store {
  private readonly base: string;
  private readonly key: string;
  private readonly fetch: typeof fetch;

  constructor(opts: SupabaseStoreOptions) {
    if (!opts.url || !opts.serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    this.base = `${opts.url.replace(/\/+$/, '')}/rest/v1`;
    this.key = opts.serviceRoleKey;
    this.fetch = opts.fetchImpl ?? fetch;
  }

  private async req<T>(method: string, path: string, body?: unknown, prefer?: string): Promise<T> {
    const res = await this.fetch(`${this.base}/${path}`, {
      method,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new SupabaseError(res.status, `supabase ${method} ${path.split('?')[0]} → ${res.status}: ${redactPhones(text).slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  private upsert<T>(table: string, conflict: string, row: unknown): Promise<T[]> {
    return this.req<T[]>('POST', `${table}?on_conflict=${conflict}`, row, 'resolution=merge-duplicates,return=representation');
  }

  async saveCall(call: Partial<CallRow> & Pick<CallRow, 'id' | 'caller_phone_e164'>) {
    return (await this.upsert<CallRow>('calls', 'id', call))[0]!;
  }
  async getCall(id: string) {
    return (await this.req<CallRow[]>('GET', `calls?id=eq.${encodeURIComponent(id)}&limit=1`))[0] ?? null;
  }
  async findRecentCallByPhone(phone: string, since: string) {
    return (await this.req<CallRow[]>('POST', 'rpc/find_recent_call', { p_phone: phone, p_since: since }))[0] ?? null;
  }

  async saveTurns(turns: TurnRow[]) {
    if (turns.length) await this.req('POST', 'transcript_turns?on_conflict=call_id,turn_index', turns, 'resolution=merge-duplicates,return=minimal');
  }

  async getTurns(callId: string) {
    return this.req<TurnRow[]>('GET', `transcript_turns?call_id=eq.${encodeURIComponent(callId)}&select=call_id,turn_index,speaker,text&order=turn_index.asc`);
  }

  async upsertLeadByPhone(lead: Partial<LeadRow> & Pick<LeadRow, 'phone_e164'>) {
    const clean = Object.fromEntries(Object.entries(lead).filter(([k, v]) => v !== undefined && k !== 'id'));
    return (await this.upsert<LeadRow>('leads', 'phone_e164', clean))[0]!;
  }
  async updateLead(id: string, patch: Partial<LeadRow>) {
    await this.req('PATCH', `leads?id=eq.${encodeURIComponent(id)}`, patch, 'return=minimal');
  }
  async getLead(id: string) {
    return (await this.req<LeadRow[]>('GET', `leads?id=eq.${encodeURIComponent(id)}&limit=1`))[0] ?? null;
  }

  async replaceEvidence(callId: string, rows: EvidenceRow[]) {
    await this.req('DELETE', `criterion_evidence?call_id=eq.${encodeURIComponent(callId)}`, undefined, 'return=minimal');
    if (rows.length) await this.req('POST', 'criterion_evidence', rows, 'return=minimal');
  }

  async saveHandoff(row: Omit<HandoffRow, 'id'> & { id?: string }) {
    return (await this.upsert<HandoffRow>('handoffs', 'idempotency_key', row))[0]!;
  }
  async saveBooking(row: Omit<BookingRow, 'id'> & { id?: string }) {
    return (await this.upsert<BookingRow>('bookings', 'idempotency_key', row))[0]!;
  }
  async addFollowupTask(row: Omit<FollowupTaskRow, 'id' | 'status'>) {
    if (row.call_id) {
      const existing = await this.req<FollowupTaskRow[]>(
        'GET',
        `followup_tasks?call_id=eq.${encodeURIComponent(row.call_id)}&reason=eq.${row.reason}&status=eq.open&limit=1`,
      );
      if (existing[0]) return existing[0];
    }
    return (await this.req<FollowupTaskRow[]>('POST', 'followup_tasks', row, 'return=representation'))[0]!;
  }
  async addCostEvents(rows: CostEventRow[]) {
    if (rows.length) await this.req('POST', 'cost_events', rows, 'return=minimal');
  }
  async addIntegrationError(row: IntegrationErrorRow) {
    await this.req('POST', 'integration_errors', { ...row, message: row.message ? redactPhones(row.message) : null }, 'return=minimal');
  }

  async enqueueJob(job: NewJob) {
    const rows = await this.req<JobRow[]>(
      'POST',
      'integration_jobs?on_conflict=idempotency_key',
      job,
      'resolution=ignore-duplicates,return=representation',
    );
    return rows.length > 0;
  }
  async claimJobs(limit: number) {
    return this.req<JobRow[]>('POST', 'rpc/claim_integration_jobs', { p_limit: limit });
  }
  async completeJob(id: string) {
    await this.req('PATCH', `integration_jobs?id=eq.${encodeURIComponent(id)}`, { status: 'done', last_error: null, locked_at: null }, 'return=minimal');
  }
  async failJob(id: string, error: string, nextAttemptAt: string | null) {
    const patch = nextAttemptAt
      ? { status: 'pending', next_attempt_at: nextAttemptAt, last_error: redactPhones(error).slice(0, 1000), locked_at: null }
      : { status: 'dead', last_error: redactPhones(error).slice(0, 1000), locked_at: null };
    await this.req('PATCH', `integration_jobs?id=eq.${encodeURIComponent(id)}`, patch, 'return=minimal');
  }
}
