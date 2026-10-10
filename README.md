# Aangan Studio — AI phone enquiry system

Answers every inbound call to Aangan Studio, 24/7, in English and Hindi. It qualifies the caller against the founder's rubric and hands qualified leads to a designer with everything already asked. It also reports its own running cost.

**Status:**

| Phase | State |
|---|---|
| 1. Rules engine | Done |
| 2. Gemini extraction | Done: 53/55 outcomes correct (96.4%). See `docs/PHASE2_EVAL.md` |
| 3. Supabase schema and integrations | Done and live-tested |
| 4. Voice (Vaani AI) | Built and tested. Goes live once the BYOL socket is reachable (see below) |
| 5. Dashboard | Done and deployed: https://aangan-phone-agent-puce.vercel.app/dashboard |

## Live links

| What | Where |
|---|---|
| Talk to the agent (web call, any hour, free) | https://aangan-phone-agent-puce.vercel.app/talk |
| Dashboard (password) | https://aangan-phone-agent-puce.vercel.app/dashboard |
| Health check | https://aangan-phone-agent-puce.vercel.app/api/health |
| Code | https://github.com/serashah04-eng/aangan-voice |

**Calling hours.** Calls that **Vaani places** (outbound) are limited by Vaani to 08:00–20:00 IST (TRAI rule). Calls that **customers make** (web call on `/talk`, or an inbound number if one is added) are not.

**Still needed for true 24/7.** The voice server (`npm run voice:server`) must be running somewhere always-on and reachable as `wss://`. For the demo it runs on a laptop behind a Cloudflare quick tunnel. Deploy it to an always-on Node host for production, then put its `wss://…/chat/stream` URL in the agent's BYOL setting.

## Voice (Phase 4)

**How a call works**

1. Vaani handles telephony, speech-to-text and the voice.
2. Every caller turn reaches **our** server through Vaani's Bring-Your-Own-LLM WebSocket (`src/voice/byol.ts`).
3. `CallSession` (`src/dialogue/session.ts`) runs exactly **one** Gemini extraction per caller turn.
4. The rules engine then decides whether to ask the next missing field or close.
5. The reply is a fixed line from config, in English or Hindi, and passes the output guard before Vaani speaks it.
6. Booking is offered only to qualified callers, and the slot is re-checked just before booking.
7. Interruptions drop the stale reply.
8. A call from the same number within 30 minutes resumes the earlier record.
9. When the call ends, `finalizeCall` writes everything and the outbox runs straight away.

**Call lifecycle events.** `call_started`, `user_picked_up_at` and `call_ended` go to the Vercel route `/api/voice/vaani/<VAANI_WEBHOOK_SECRET>`. It records the caller's number, the time to answer, and phone minutes and their cost.

**Commands**

| Command | What it does |
|---|---|
| `npm run simulate` | Chat with the agent in the terminal: real Gemini, in-memory DB, mock integrations. Add `-- --debug` to see the rules after each turn, or `-- --live` to use the real services. |
| `npm run voice:server` | The BYOL WebSocket server, on port 8090. It must be reachable as `wss://` (use a tunnel for a demo). |
| `npm run call:me -- --yes` | Vaani calls `DEMO_CALLER_NUMBER` with the agent in `VAANI_AGENT_ID` |

**Vaani settings** (the account owner enters the secret values)

- **BYOL** (Agent → Brain → LLM → *Bring your own LLM*):
  - URL: `wss://<your-tunnel-host>/chat/stream`
  - Auth Token: the `VAANI_BYOL_TOKEN` value
  - Fallback: **No fallback**, so Vaani's own LLM can never speak unguarded
- **Agent greeting:** the disclosure line from `config/rules.config.ts` (`scripts.greeting`)
- **Webhook** (Developers → Webhooks): `https://aangan-phone-agent-puce.vercel.app/api/voice/vaani/<VAANI_WEBHOOK_SECRET>`

## Dashboard (Phase 5)

- **Access:** password sign-in (`DASHBOARD_PASSWORD` in `.env.local` and Vercel) with a signed 12-hour session cookie. Everything under `/dashboard` is protected. It is read-only and loads data server-side with the service key.
- **Metrics:**
  - calls per day and the after-hours share;
  - time to answer;
  - outcome mix;
  - qualified-to-handoff time;
  - handoff-to-booking rate;
  - pricing-asked rate;
  - escalations and how they were resolved;
  - follow-up backlog;
  - rules-vs-model disagreements;
  - integration errors;
  - cost per call, per qualified lead and per month (telephony, model and notifications). Rates come from `config/cost.config.ts`.
- **Call detail page:** `/dashboard/calls/<id>`. Every designer handoff links here. It shows the transcript, the evidence for each criterion, the lead, and the status of each integration.
- **Demo data:** add it with `npm run seed:demo`; remove all of it with `npm run seed:demo -- --clear`.
- **Deploy:** run `npx vercel deploy --prod`. Environment variables are copied with `node scripts/push-vercel-env.mjs`, which never prints any values.

The phases are listed in `docs/PHASE0_PLAN.md`.

## How a call flows (Phase 3)

1. **Record first.** `finalizeCall` writes the call, its transcript, the lead (one per phone number), the evidence for each criterion and the costs to **Supabase first**. Supabase is the system of record.
2. **Queue the outside work.** Everything that touches another service is only *queued* in `integration_jobs`:
   - `hubspot_sync` for qualified, human-review and needs-more-information leads;
   - `designer_handoff` for qualified leads;
   - `escalation_alert` for human-review leads.
3. **Front-desk tasks.** Leads that need more information get a row in `followup_tasks` instead of a booking.
4. **Process the queue.** `processOutbox` (`npm run outbox`, or a cron later) works through the queued jobs:
   - Each job retries with exponential backoff.
   - Telegram falls back to email after 2 failed attempts (Q14).
   - The studio head is alerted after 3 failures (S22).
   - After 5 failures the job is marked dead and a front-desk task is opened.
   - Every failure is written to `integration_errors`. Phone numbers are redacted everywhere.
5. **Booking (qualified leads only).** `booking.ts` offers slots, re-checks the chosen slot just before confirming (S18), marks the booking failed and opens a task if the calendar errors (S16), and marks it pending if no offered slot suits the caller (S17).
6. **Dropped calls.** A call from the same number within 30 minutes resumes the earlier record (T17).

Every external service sits behind an interface with an in-memory mock (`src/adapters/*/mock.ts`):

| Kind | Interface | Real adapter(s) |
|---|---|---|
| Store | `Store` | Supabase |
| CRM | `CrmClient` | HubSpot |
| Notifications | `Notifier` | Telegram, Resend |
| Calendar | `CalendarProvider` | Cal.com, Google Calendar |
| Model | `LlmClient` | Gemini |

### Database

Migrations live in `supabase/migrations/` and run in order. The current project already has both applied.

To apply them to a new project, paste each file into the Supabase SQL Editor and run it.

Row-level security is on for every table:
- `anon` has no access.
- Signed-in dashboard users can only read, and only if their email is in `dashboard_viewers`.
- The server uses the service-role key, server-side only.

To smoke-test the live database (it uses mock HubSpot, Telegram and email, and cleans up after itself):

```bash
npm run smoke:supabase
```

## How it decides

| Layer | Does | Never does |
|---|---|---|
| LLM (Gemini Flash, Phase 2) | runs the conversation; extracts facts, each with a verbatim caller quote | decide a criterion or an outcome |
| `src/extraction/quote-validator.ts` | sets any field whose quote isn't in a caller turn to `unknown` | — |
| `src/rules/` (pure TypeScript) | computes C1a–C5, X1–X3, the outcome and the next question | read the clock, call the network |
| `src/guard/pricing-guard.ts` | filters every agent sentence before speech | — |

The outcome is decided in this order, and the first match wins:
1. `human_review_required`: any X trigger or `escalate` state.
2. `not_qualified`: any fail in C1a–C4.
3. `needs_more_information`: any unknown in C1a–C3.
4. `qualified`.

## Setup

Requirements: Node 20 or later.

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run scan:pricing
```

Phase 1 needs no environment variables. `.env.example` lists every variable the later phases will use. Secrets are read server-side only.

## Changing a rule

All thresholds, lists, aliases and script lines live in **`config/rules.config.ts`**. Nothing business-specific is hard-coded in `src/rules/`.

1. Edit the value. Every open founder question is tagged `// OPEN QUESTION Qn`.
2. Bump `RULES_CONFIG_VERSION`.
3. Run `npm test`. The acceptance suite shows exactly which CSV rows change.

Each evaluation is stamped with `rulesVersion` (the git SHA on Vercel) and `configVersion`, and both are stored with every criterion decision.

## Tests

| File | Covers |
|---|---|
| `tests/rules.acceptance.test.ts` | All 54 assertable CSV rows. For each: outcome, every non-blank criterion cell and the triggers. Also checks that every fixture quote is verbatim in a caller turn, and that every agent line passes the output guard. S20 checks that a hallucinated locality is dropped. |
| `tests/rules/criteria.unit.test.ts` | Boundaries: 41/42/139/140 days, the site window edge, 499/500/3,000/3,001 sq ft, aliases, exclusions, budget fail vs escalate, precedence, determinism |
| `tests/rules/parsers.unit.test.ts` | Budget regex (lakh, L, ₹, Rs, ranges, Indian grouping, Hindi) and date resolution (month end and start, festivals, durations) |
| `tests/rules/next-step.unit.test.ts` | Ask order, ask once, one rephrase, stop when certain, the single C5 question |
| `tests/pricing-guard.test.ts` | What gets blocked, what passes (times, dates, areas, BHK, durations, every script line), Q13/Q9 phrase removal |
| `tests/pricing-scan.test.ts` | Repo-wide scan for rupee figures and per-sq-ft rates |
| `tests/logger.test.ts` | Phone numbers redacted in logs |

Rows that are not asserted yet are the ones `expected_outcome` marks as `no_label`, `unchanged`, `per_content` or `field_unknown`: T08, S02–S05, S19, S22, and S20 except for its validator test. They belong to later phases.

### CSV label corrections

| Row | CSV | Asserted | Why |
|---|---|---|---|
| F03 | C4 `not_mentioned` | `pass_with_note` | The caller volunteered a figure. Every other volunteered-budget row is `pass_with_note`, and the outcome is unchanged. (Phase 0 K3) |

### Pricing-scan exceptions

Pricing must never appear in the repo, but a caller's own budget must be recorded word for word. So the scan allows:
- caller speech lines in `tests/fixtures/` (lines starting `C(`), and `budget_raw:` lines;
- the supplied `tests/fixtures/aangan_test_cases.csv`;
- lines tagged `pricing-scan:allow <reason>`. Today there is exactly one: the C4 threshold `fullHomeFloorInr`.

Test files themselves are not scanned, because the guard's tests need price-like inputs. `pricing.md` is in `.gitignore` and is not in this repo.

## Open founder questions (current defaults, all in `config/rules.config.ts`)

| ID | Question | Default coded |
|---|---|---|
| Q1 | Does one clear fail on C1–C4 decline the lead? | Yes |
| Q2 | Budget floor | Only the written example: residential full home with a volunteered max ≤ the configured threshold |
| Q3 | Site available more than 10 weeks after (call + buffer) | Escalate |
| Q3a | Consultation buffer | **28 days** (the brief said 7; 28 is needed to match F01, T20 and F06) |
| Q4 | Deadline 6–20 weeks out | `pass_tight`. The agent must not promise the date. |
| Q5 | Locality on neither list | Escalate |
| Q6 | Commercial outside 500–3,000 sq ft, or an unlisted type | Escalate |
| Q7 | 1BHK full home; kitchen-, bath- or wardrobe-only | Escalate |
| Q8 | Researching for someone, decider will attend | `pass_with_note` |
| Q9 | Escalation callback time | None promised (the guard removes promised times) |
| Q10 | Needs more information | Front-desk task, no booking |
| Q11 | Languages | English, Hindi; otherwise offer a callback |
| Q12 | Disclosure wording; transcript retention | Greeting in config; 90 days |
| Q13 | "Free consultation" / "no obligation" | Never said (removed by the guard) |
| Q14 | Designer notifications | Telegram first, email after 2 failed attempts |
| Q15 | Not-qualified leads | Supabase only, no HubSpot deal |
| Q16 | Calendar and designer assignment | Cal.com; front desk assigns |
| Q17 | Start date given, no completion date | Treat as no deadline |
| Q19 | Tenant with landlord consent as decider | Pass |
| Q20 | C4 fail and escalate both apply | Fail wins |
| Q21 | Other single room only (study, dining, puja) | Escalate |
| Q22 | "Flexible", "no rush", or a range | No deadline, or the range's upper bound |
| Q23 | Month-only start date in the past (≤ 6 months back) | Site available now |
| Q24 | Festival dates ("before Diwali") | Table in config. Diwali 2026 = 8 Nov. |
| Q25 | "around + number" with area or time units | Allowed by the guard |
| Q26 | Pricing-scan exceptions | Caller lines and `budget_raw` in fixtures, the CSV, tagged lines |
| Q27 | Cal.com needs an attendee email, but we never collect one on the call | Book with the studio inbox (`CALENDAR_ATTENDEE_EMAIL`); the caller's name and phone go in the booking notes |
| Q28 | HubSpot deal stage per outcome | qualified → `qualifiedtobuy`, human review → `appointmentscheduled` (default pipeline) |

(Q18 was folded into Q3a.)

## Layout

```
config/rules.config.ts      every rule, threshold, list and script line
src/domain/types.ts         Zod schemas: extraction, criterion results, outcome
src/rules/                  pure engine (criteria/, dates, budget-parse, locality, outcome, next-step)
src/guard/pricing-guard.ts  output filter for every agent utterance
src/extraction/             quote validator (the Phase 2 extractor will live here)
src/lib/logger.ts           JSON logger with phone redaction
tests/fixtures/cases/       hand-written transcript + extraction per CSV row
docs/PHASE0_PLAN.md         the Phase 0 plan: rules restated, conflicts, schema
```
