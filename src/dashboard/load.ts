import type { DashData } from './metrics';

/**
 * Server-side data loading for the dashboard (service-role key, never sent to the browser).
 * Selects only the columns the metrics need — no transcripts or budgets on the overview.
 */
async function rest<T>(path: string): Promise<T[]> {
  const url = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) throw new Error('Supabase is not configured');
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' });
  if (!res.ok) throw new Error(`dashboard query failed (${res.status})`);
  return (await res.json()) as T[];
}

export async function loadDashboardData(fromIso: string): Promise<DashData> {
  const since = encodeURIComponent(fromIso);
  const [calls, handoffs, bookings, openFollowups, costs, errors] = await Promise.all([
    rest<DashData['calls'][number]>(`calls?select=id,started_at,answered_at,ended_at,after_hours,call_type,outcome,model_suggested_outcome,pricing_asked_count,telephony_minutes,caller_phone_e164&started_at=gte.${since}&order=started_at.asc&limit=10000`),
    rest<DashData['handoffs'][number]>(`handoffs?select=call_id,kind,status,channel,sent_at,resolved_at,created_at&created_at=gte.${since}&limit=10000`),
    rest<DashData['bookings'][number]>(`bookings?select=call_id,status,created_at&created_at=gte.${since}&limit=10000`),
    rest<DashData['openFollowups'][number]>(`followup_tasks?select=reason,status,created_at&status=eq.open&limit=10000`),
    rest<DashData['costs'][number]>(`cost_events?select=call_id,kind,amount_usd,occurred_on&occurred_on=gte.${since.slice(0, 10)}&limit=20000`),
    rest<DashData['errors'][number]>(`integration_errors?select=service,operation,message,created_at,resolved_at&created_at=gte.${since}&order=created_at.asc&limit=2000`),
  ]);
  return { calls, handoffs, bookings, openFollowups, costs, errors };
}

export type CallDetail = {
  call: Record<string, unknown> | null;
  turns: Array<{ turn_index: number; speaker: string; text: string }>;
  evidence: Array<{ criterion: string; state: string; rule_id: string; evidence_quote: string | null; follow_up_asked: boolean }>;
  lead: Record<string, unknown> | null;
  handoffs: Array<{ kind: string; channel: string; status: string; sent_at: string | null; attempts: number }>;
  bookings: Array<{ status: string; slot_start: string | null; preference: string | null }>;
  jobs: Array<{ kind: string; status: string; attempts: number; last_error: string | null }>;
};

export async function loadCallDetail(id: string): Promise<CallDetail> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { call: null, turns: [], evidence: [], lead: null, handoffs: [], bookings: [], jobs: [] };
  const [call] = await rest<Record<string, unknown>>(`calls?id=eq.${id}&limit=1`);
  const [turns, evidence, handoffs, bookings, jobs] = await Promise.all([
    rest<CallDetail['turns'][number]>(`transcript_turns?select=turn_index,speaker,text&call_id=eq.${id}&order=turn_index.asc`),
    rest<CallDetail['evidence'][number]>(`criterion_evidence?select=criterion,state,rule_id,evidence_quote,follow_up_asked&call_id=eq.${id}&order=id.asc`),
    rest<CallDetail['handoffs'][number]>(`handoffs?select=kind,channel,status,sent_at,attempts&call_id=eq.${id}`),
    rest<CallDetail['bookings'][number]>(`bookings?select=status,slot_start,preference&call_id=eq.${id}`),
    rest<CallDetail['jobs'][number]>(`integration_jobs?select=kind,status,attempts,last_error&call_id=eq.${id}`),
  ]);
  const leadId = call?.lead_id as string | undefined;
  const lead = leadId ? (await rest<Record<string, unknown>>(`leads?id=eq.${leadId}&limit=1`))[0] ?? null : null;
  return { call: call ?? null, turns, evidence, lead, handoffs, bookings, jobs };
}
