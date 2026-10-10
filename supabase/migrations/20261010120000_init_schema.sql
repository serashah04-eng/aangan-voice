-- Aangan phone agent — initial schema (Phase 3).
-- Supabase is the system of record: every call is written here first; HubSpot, Telegram,
-- email and calendar writes go through the integration_jobs outbox and can never lose a call.
--
-- Security model:
--   * RLS is enabled on every table.
--   * The server uses the service_role key (bypasses RLS) — never shipped to a browser.
--   * The dashboard signs in with Supabase Auth; a signed-in user can only SELECT, and only
--     if their email is in dashboard_viewers. Nobody gets INSERT/UPDATE/DELETE via the API.
--   * anon gets nothing.
-- No pricing appears anywhere in this schema.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ helpers

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ------------------------------------------------------------------ leads

create table public.leads (
  id                      uuid primary key default gen_random_uuid(),
  phone_e164              text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  name                    text,
  latest_outcome          text check (latest_outcome in ('qualified','not_qualified','needs_more_information','human_review_required','not_applicable')),
  project_type            text,          -- residential / commercial (+ commercial type)
  scope                   text,          -- full_home / full_floor / rooms list, plain words
  locality_raw            text,
  locality_match          text,          -- listed:<name> / excluded:<name> / generic / unlisted
  area_sqft               numeric,
  completion_by           date,
  completion_no_deadline  boolean not null default false,
  site_available_from     date,
  tight_timeline          boolean not null default false,
  budget_raw              text,          -- caller's words, verbatim, only if volunteered
  decider_note            text,
  pricing_asked           boolean not null default false,
  consultation_preference text,
  hubspot_contact_id      text,
  hubspot_deal_id         text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger leads_updated_at before update on public.leads for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ calls

create table public.calls (
  id                     uuid primary key default gen_random_uuid(),
  provider               text not null default 'vaani',
  provider_call_id       text unique,
  lead_id                uuid references public.leads(id) on delete set null,
  caller_phone_e164      text not null,
  call_type              text check (call_type in ('enquiry','other')),
  language               text,
  status                 text not null default 'in_progress' check (status in ('in_progress','completed','dropped','failed')),
  started_at             timestamptz not null default now(),
  answered_at            timestamptz,
  ended_at               timestamptz,
  duration_s             integer check (duration_s >= 0),
  after_hours            boolean,       -- outside 10:00–19:00 IST, computed by the app
  end_reason             text,
  resumed_from_call_id   uuid references public.calls(id) on delete set null,
  telephony_minutes      numeric(10,2),
  outcome                text check (outcome in ('qualified','not_qualified','needs_more_information','human_review_required','not_applicable')),
  outcome_rule_id        text,
  model_suggested_outcome text,         -- logged only, never used to decide
  pricing_asked_count    integer not null default 0,
  rules_version          text,          -- git SHA
  rules_config_version   text,
  prompt_version         text,
  extractor_model        text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index calls_phone_started_idx on public.calls (caller_phone_e164, started_at desc); -- 30-min resume lookup
create index calls_started_idx on public.calls (started_at);
create index calls_lead_idx on public.calls (lead_id);
create trigger calls_updated_at before update on public.calls for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ transcript_turns

create table public.transcript_turns (
  id            bigint generated always as identity primary key,
  call_id       uuid not null references public.calls(id) on delete cascade,
  turn_index    integer not null check (turn_index >= 0),
  speaker       text not null check (speaker in ('caller','agent')),
  text          text not null,
  spoken_at     timestamptz not null default now(),
  interrupted   boolean not null default false,
  guard_blocked boolean not null default false,
  guard_reasons text[],
  purge_after   timestamptz not null default (now() + interval '90 days'),  -- Q12 retention
  unique (call_id, turn_index)
);
create index transcript_turns_purge_idx on public.transcript_turns (purge_after);

-- ------------------------------------------------------------------ criterion_evidence

create table public.criterion_evidence (
  id                      bigint generated always as identity primary key,
  call_id                 uuid not null references public.calls(id) on delete cascade,
  lead_id                 uuid references public.leads(id) on delete set null,
  criterion               text not null check (criterion in ('C1a','C1b','C2','C3','C4','C5','X1','X2','X3')),
  state                   text not null check (state in ('pass','pass_tight','pass_with_note','not_mentioned','fail','unknown','escalate','triggered')),
  rule_id                 text not null,
  evidence_quote          text,
  turn                    integer,
  follow_up_asked         boolean not null default false,
  extractor_model         text,
  prompt_version          text,
  rules_version           text not null,
  model_suggested_outcome text,
  created_at              timestamptz not null default now()
);
create index criterion_evidence_call_idx on public.criterion_evidence (call_id);

-- ------------------------------------------------------------------ handoffs

create table public.handoffs (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid references public.leads(id) on delete set null,
  call_id          uuid references public.calls(id) on delete set null,
  kind             text not null check (kind in ('designer','escalation')),
  channel          text not null check (channel in ('telegram','email')),
  status           text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts         integer not null default 0,
  idempotency_key  text not null unique,
  payload          jsonb not null,
  sent_at          timestamptz,
  resolved_at      timestamptz,   -- escalations: when a senior person closed it
  resolved_by      text,
  resolution_note  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index handoffs_lead_idx on public.handoffs (lead_id);
create trigger handoffs_updated_at before update on public.handoffs for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ bookings

create table public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid references public.leads(id) on delete set null,
  call_id             uuid references public.calls(id) on delete set null,
  provider            text not null check (provider in ('calcom','google')),
  provider_booking_id text,
  event_type_id       text,
  slot_start          timestamptz,
  slot_end            timestamptz,
  status              text not null check (status in ('offered','confirmed','pending','failed','cancelled')),
  preference          text,
  failure_reason      text,
  idempotency_key     text not null unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index bookings_lead_idx on public.bookings (lead_id);
create trigger bookings_updated_at before update on public.bookings for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ followup_tasks

create table public.followup_tasks (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid references public.leads(id) on delete set null,
  call_id        uuid references public.calls(id) on delete set null,
  reason         text not null check (reason in ('needs_more_information','booking_failed','booking_pending','unsupported_language','integration_failure')),
  missing_fields text[] not null default '{}',
  status         text not null default 'open' check (status in ('open','done','cancelled')),
  assigned_to    text,
  notes          text,
  created_at     timestamptz not null default now(),
  closed_at      timestamptz
);
create index followup_tasks_open_idx on public.followup_tasks (status, created_at);

-- ------------------------------------------------------------------ cost_events

create table public.cost_events (
  id           bigint generated always as identity primary key,
  call_id      uuid references public.calls(id) on delete set null,
  kind         text not null check (kind in ('llm','telephony','notification')),
  provider     text not null,
  model        text,
  purpose      text,
  units        jsonb not null default '{}',
  unit_rates   jsonb not null default '{}',
  rate_version text not null,
  amount_usd   numeric(14,6) not null check (amount_usd >= 0),
  occurred_on  date not null,
  created_at   timestamptz not null default now()
);
create index cost_events_occurred_idx on public.cost_events (occurred_on);
create index cost_events_call_idx on public.cost_events (call_id);

-- ------------------------------------------------------------------ integration_errors

create table public.integration_errors (
  id              bigint generated always as identity primary key,
  service         text not null,     -- hubspot / telegram / resend / calcom / google_calendar / gemini / vaani
  operation       text not null,
  idempotency_key text,
  call_id         uuid references public.calls(id) on delete set null,
  lead_id         uuid references public.leads(id) on delete set null,
  attempt         integer not null default 1,
  error_code      text,
  message         text,              -- phone numbers redacted by the app before insert
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index integration_errors_created_idx on public.integration_errors (created_at);

-- ------------------------------------------------------------------ integration_jobs (outbox)

create table public.integration_jobs (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,     -- hubspot_upsert / designer_handoff / escalation_alert / followup_notice / ...
  payload         jsonb not null,
  idempotency_key text not null unique,
  status          text not null default 'pending' check (status in ('pending','running','done','dead')),
  attempts        integer not null default 0,
  max_attempts    integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  locked_at       timestamptz,
  last_error      text,
  call_id         uuid references public.calls(id) on delete set null,
  lead_id         uuid references public.leads(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index integration_jobs_due_idx on public.integration_jobs (status, next_attempt_at);
create trigger integration_jobs_updated_at before update on public.integration_jobs for each row execute function public.set_updated_at();

-- Claim due jobs atomically (safe with concurrent workers). Stale "running" locks are reclaimed.
create or replace function public.claim_integration_jobs(p_limit integer default 10)
returns setof public.integration_jobs
language sql security definer set search_path = public as $$
  update public.integration_jobs j
     set status = 'running', locked_at = now(), attempts = j.attempts + 1
   where j.id in (
     select id from public.integration_jobs
      where (status = 'pending' and next_attempt_at <= now())
         or (status = 'running' and locked_at < now() - interval '5 minutes')
      order by next_attempt_at
      limit p_limit
      for update skip locked)
  returning j.*;
$$;

-- ------------------------------------------------------------------ dashboard access

create table public.dashboard_viewers (
  email    text primary key,
  added_at timestamptz not null default now()
);

create or replace function public.is_dashboard_viewer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dashboard_viewers v
     where lower(v.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ------------------------------------------------------------------ retention (Q12)

create or replace function public.purge_expired_transcripts() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.transcript_turns where purge_after < now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ------------------------------------------------------------------ row-level security

do $$
declare t text;
begin
  foreach t in array array[
    'leads','calls','transcript_turns','criterion_evidence','handoffs','bookings',
    'followup_tasks','cost_events','integration_errors','integration_jobs','dashboard_viewers'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;

  -- Read-only dashboard policies (dashboard_viewers itself stays service-role only).
  foreach t in array array[
    'leads','calls','transcript_turns','criterion_evidence','handoffs','bookings',
    'followup_tasks','cost_events','integration_errors','integration_jobs'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_dashboard_viewer())',
      t || '_dashboard_read', t);
  end loop;
end;
$$;

revoke all on public.dashboard_viewers from authenticated;
revoke execute on function public.claim_integration_jobs(integer) from public, anon, authenticated;
revoke execute on function public.purge_expired_transcripts() from public, anon, authenticated;
revoke execute on function public.is_dashboard_viewer() from public, anon;
grant execute on function public.is_dashboard_viewer() to authenticated;
