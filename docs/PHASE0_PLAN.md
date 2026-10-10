# Aangan Studio phone agent: Phase 0 plan

Status: draft for review. No code has been written yet.
Sources read: build brief, `aangan_test_cases.csv` (the two CSVs you attached are byte-identical), `qualified.md`, `services.md`, `Aangan_Sep 2026_Enquiries.pdf` (all 40 enquiries), the problem statement PDF, and the components map.
`pricing.md` was inside the Drive zip. I did **not** open it, and it will never be copied into the repo.

---

## 1. The rules, restated

**What the system is.** It answers inbound phone calls 24/7 in English and Hindi. It collects a small, fixed set of facts and hands qualified leads to a designer with nothing left to re-ask. It escalates anything sensitive to a senior person. It records its own cost.

**Division of labour.**
- **LLM (Gemini Flash):** does two jobs only. It (a) runs the conversation and (b) extracts structured facts, each with a verbatim quote and a turn number. It never computes a criterion state or an outcome. Its own suggested outcome is logged for the disagreement metric and is never used.
- **Code:** a deterministic TypeScript rules engine computes every criterion state, the override triggers, the outcome, and the next conversational step. Its version is pinned to the git SHA.
- **Code also handles every judgement that can be made deterministically:** locality matching against the lists and aliases, budget parsing (regex), and turning date expressions into dates. The model only supplies the quoted raw text.

**Hard rules.**
1. No pricing, ever, in any form: no figure, range, rate, estimate, comparison, or confirming or denying a guess. There is one approved deflection line, plus one follow-up line if the caller pushes. The "I can book that for you right now" suffix is added only when the engine says the lead is *currently* Qualified. Asking about price never disqualifies.
2. Missing information stays `unknown`. It is never a fail.
3. Budget is never asked. If the caller volunteers it, it is kept verbatim.
4. Any extracted field whose quote isn't found in the transcript (after normalising case and whitespace) becomes `unknown`.
5. Every rule I had to invent goes in `config/rules.config.ts` with `// OPEN QUESTION Qn` and a default.

**Criteria (in short).** Day counts are measured from the *call date*, in IST.

| Criterion | pass | fail | unknown (ask once) | escalate |
|---|---|---|---|---|
| C1a intent | design + execution | advice / DIY / decor / Vastu-only / sourcing-only | not stated or "just exploring" | interiors + walls or structural work |
| C1b scope | resi: ≥2BHK full home, full floor, 2+ rooms, single bedroom or living room. comm: office, clinic or studio of 500–3,000 sq ft | restaurant, hotel, retail, gym | commercial with no area given | 1BHK full home; kitchen-, bath- or wardrobe-only (Q7); comm outside 500–3,000 or unlisted type (Q6) |
| C2 area | locality on the Pune/PCMC list (substring + aliases) | Talegaon, Lonavala, Nashik, Mumbai, any other city | nothing given, or "Pune" alone | named locality on neither list (Q5) |
| C3 timeline | deadline ≥140 days away, or `no_deadline` | deadline <42 days away | no completion info | site available > call + buffer + 70 days (Q3) |
| | `pass_tight` = 42–139 days (Q4) | | | |
| C4 budget | `not_mentioned` (default); `pass_with_note` if a figure is volunteered | full-home resi with a volunteered max ≤ the Q2 threshold | — | figure volunteered **and** caller asks if it's enough |
| C5 decider | owner, co-owner, founder, authorised rep | — | not stated (treated as passing, never asked) | researching for someone and can't say the decider will attend |
| | `pass_with_note` = decider will attend (Q8) | | | |

**Overrides.** X1 = existing client complaint, or the caller names an ongoing project or designer. X2 = service complaint or an explicit request for a human. X3 = contradictory answers, or the quote validator failing twice on the same field.

**Outcome (first match wins).**
1. `human_review_required`: any X trigger or any `escalate`.
2. `not_qualified`: any `fail` in C1a–C4.
3. `needs_more_information`: any `unknown` in C1a, C1b, C2 or C3 after the single follow-up.
4. `qualified`.

Calls from vendors, job seekers or wrong numbers get `call_type=other` and outcome `not_applicable`, and are excluded from lead metrics.

---

## 2. CSV vs. rules: conflicts I found by working every row

I worked every assertable row (54 of 62) by hand against the rules above. Most match. These don't, or only match under an interpretation the brief doesn't state:

| # | Rows | Literal rule says | CSV says | Why |
|---|---|---|---|---|
| **K1** | F01, T20 | C3 `escalate` | `pass` | F01: execution "starting December" = 1 Dec. That is later than call + 7 + 70 days (17 Nov). T20: "January start" = 1 Jan, later than 11 Dec. F06 (Feb 2027) is labelled `escalate`, so the labeller's window is somewhere between 98 and 139 days, not 77. |
| **K2** | T15, W06, T20, F10, W01 | C3 `unknown` (no completion date given) | `pass` | Only a start or possession date was given, e.g. "start immediately" or "possession Oct 15". The labeller treats "start date given, no deadline" as `no_deadline`. |
| **K3** | F03 | C4 `pass_with_note` (₹ figure volunteered) | `not_mentioned` | The other rows with a volunteered budget (F05, F06, F08, F10) are `pass_with_note`. This looks like a label error. The outcome is unaffected. |
| **K4** | F03 | C3 `pass_tight` ("3–4 months" = 17 weeks) | `pass` | Only works if "flexible" is read as `no_deadline`. |
| **K5** | F09 | C3 `escalate` if "possession in August" resolves to Aug 2027 | `pass` | Works only if a past month-only start date resolves to "already available". |
| **K6** | T11 | C5: tenant isn't in the pass list | `pass` | A tenant with the landlord's consent is treated as the decider. |
| **K7** | T07 | "before Diwali" | C3 `unknown` | The transcript says Diwali is "three weeks away". Diwali 2026 is 8 Nov, which is 61 days from 8 Sep and so `pass_tight`. Either way the caller withdrew the date, so `unknown` holds. I need a rule that a **revision is not a contradiction** (not X3). |
| **K8** | T03 vs T07/T10 | — | C1a `unknown` for "redo my home office and study", but `pass` for "redo my living room and kitchen" | The phrasing is nearly identical. This won't break Phase 1, because fixtures are hand-written. It will show up as a Phase 2 eval disagreement. |

**Proposed defaults.** All are in config and tagged.
- K1: `consultation_buffer_days = 28`, i.e. the design phase. That makes 98 days pass and F06's 140 escalate, which matches every row. It is a change from your stated default of 7 → **decision needed**.
- K2: a new rule, Q17. If completion is unknown but a site-available or start date was stated, treat completion as `no_deadline`. The site rule still applies → **decision needed**.
- K3: assert `pass_with_note` for F03 and record that the CSV label was corrected.
- K4: "flexible", "no rush" or "whenever" → `no_deadline` (Q22). A bare range resolves to its upper bound.
- K5: a month-only *start* date in the past (within 6 months) → `now` (Q23).
- K6: add `tenant_with_landlord_consent` to the C5 pass roles (Q19).
- K7: the extractor reports the *latest* value. A value that is withdrawn and not replaced → `unknown`. X3 fires only when two incompatible values both still stand after one clarifying question.

---

## 3. Other ambiguities (default in brackets)

1. **Pricing scan vs. legitimate figures.** The fixtures must contain the budgets callers volunteered (T10, S14, F03 and others), quoted verbatim. The C4 rule needs a threshold number, and the cost dashboard needs telephony and model rates. [The scan blocks currency-adjacent numbers everywhere except caller-speaker turns in fixtures and lines marked `// pricing-scan:allow <reason>`. System-cost rates are stored as plain numbers, with the unit in the key name (e.g. `telephonyPerMinute`), not next to ₹.] → **decision needed**
2. **The enquiry transcripts contain front-desk lines our agent must never say.** Examples: "the consultation is free", a cost multiple, a remark that the caller's figure "would be significantly below", "callback within 15 minutes". [The Phase 2 eval transcripts keep caller lines verbatim and replace front-desk lines with our scripted agent questions.] The problem statement's "average project value" figure will not appear anywhere.
3. **Unlisted single rooms** (study alone, dining alone, puja room). [`escalate`, grouped with Q7 as Q21.]
4. **C4 fail and escalate together** (full home, ≤ threshold, and "is that enough?"). [`fail` wins inside C4, so the founder's misalignment line is said. Q20.]
5. **"About 4 months" alongside "by February"** (T05). [A named month beats an approximate duration. This is not a contradiction.]
6. **Is "2BHK" alone a full-home scope?** (W02, W05, T14 are labelled C1b `pass`.) [Yes. A stated BHK with no narrower scope = full home.]
7. **What counts as a "room".** [Kitchen, dining area and study each count as a room for "2+ rooms". So T10's kitchen + bedroom is a pass, not "1BHK full home".]
8. **Who resolves dates.** The brief says the extractor resolves relative dates. [The extractor returns a typed date expression with its quote: exact date, month, month + year, duration, named festival, or `now` / `no_deadline`. Code resolves it, using a festival table in config (Diwali 2026 = 8 Nov; Q24). This keeps the result deterministic and testable.]
9. **Pricing guard false positives.** "around 1,400 sq ft" or "around 6 weeks" would be blocked by an "around X" rule. [Block "around/about/roughly/approximately + number" only when a currency word, a rate word or a bare number follows. Areas and durations with units pass. The agent never needs to restate a size with "around" anyway. Q25.]
10. **Hindi pricing patterns.** [The guard also covers रुपये/रु/₹, लाख, करोड़, हज़ार, "lakh/lac" in Roman script, and Devanagari digits.]
11. **Boundary inclusivity.** [Commercial 500 and 3,000 sq ft are inclusive. Exactly 42 days → `pass_tight`. Exactly 140 days → `pass`. Escalate when the start date is strictly later than call + buffer + 70.]
12. **Operations Head on behalf of a company** (F05 is labelled C5 `unknown`). [A job title alone ≠ an authorised rep. Stays `unknown`, which is treated as passing with a note.]
13. **Retry queue (S22).** The brief lists 9 tables. Retries on serverless need durable state. [Add a 10th table, `integration_jobs` (outbox). Vercel Cron drains it with backoff. After the 3rd failure → `integration_errors` row + alert.]
14. **Supabase vs. Neon.** The components map says "Supabase/Neon". [Supabase, per the brief.]
15. **Gemini model ID.** [I'll confirm the current Flash model ID and token rates at the start of Phase 2. Both go in config.]

---

## 4. Repo structure

```
aangan-phone-agent/
├─ config/
│  ├─ rules.config.ts        # every threshold, list, alias, script line, festival date; Q-tags
│  └─ cost.config.ts         # telephony / model / notification rates (no studio pricing)
├─ src/
│  ├─ domain/                # Zod schemas: FieldValue<T>, Extraction, CriterionResult, Outcome, CallRecord
│  ├─ rules/                 # PURE. No I/O, no Date.now()
│  │  ├─ engine.ts           # evaluate(extraction, ctx) → criteria + triggers + outcome + next
│  │  ├─ criteria/{c1a,c1b,c2,c3,c4,c5}.ts
│  │  ├─ overrides.ts        # X1–X3
│  │  ├─ outcome.ts          # first-match precedence
│  │  ├─ next-step.ts        # {next:'ask',field} | {next:'close',outcome}
│  │  ├─ locality.ts         # normalise + alias + list match
│  │  ├─ budget-parse.ts     # lakh / L / ₹ / Rs regex → max INR
│  │  └─ dates.ts            # date-expression → ISO date (month-end / month-start / festival)
│  ├─ guard/pricing-guard.ts # every agent utterance passes through here
│  ├─ extraction/            # Phase 2: Gemini prompt, Zod parse, quote validator
│  ├─ dialogue/              # Phase 2/4: turn manager driven by engine.next
│  ├─ adapters/              # one interface + one in-memory mock each
│  │  ├─ voice/   VoiceProvider · simulator (terminal) · vaani (Phase 4)
│  │  ├─ llm/     LlmClient · gemini · scripted mock
│  │  ├─ crm/     CrmClient · hubspot · mock
│  │  ├─ notify/  Notifier · telegram · resend · fallback(composite)
│  │  ├─ calendar/CalendarProvider · calcom · google · mock
│  │  └─ store/   Repository · supabase · in-memory
│  ├─ services/              # call orchestrator, handoff, booking, follow-up, cost meter, outbox
│  └─ lib/                   # logger (phone redaction), retry/backoff, idempotency keys, clock
├─ app/                      # Next.js App Router
│  ├─ api/voice/[provider]/route.ts
│  ├─ api/cron/{outbox,retention}/route.ts
│  └─ dashboard/…            # Phase 5, auth-protected, read-only
├─ supabase/migrations/
├─ scripts/{simulate.ts, eval-extraction.ts}
├─ tests/
│  ├─ fixtures/aangan_test_cases.csv
│  ├─ fixtures/cases/T01.ts … S21.ts   # hand-written extraction + mini transcript per row
│  ├─ rules.acceptance.test.ts         # every row × every non-blank CSV cell
│  ├─ rules/*.unit.test.ts             # boundaries: 41/42/139/140 days, 499/500/3000/3001 sq ft…
│  ├─ pricing-guard.test.ts
│  └─ pricing-scan.test.ts             # repo-wide
├─ .env.example
└─ README.md
```

**Module boundaries.**
- `rules/` imports only `domain/` and `config/`.
- `guard/` imports only `config/`.
- Nothing in `rules/` or `guard/` may import an adapter. A lint rule (`no-restricted-imports`) enforces this.
- Channels plug in at `adapters/voice`. WhatsApp and the web form would later be new input adapters that produce the same `Transcript` and feed the same extractor and engine.

**Key contract.**
```ts
type FieldValue<T> = { value: T | 'unknown'; quote: string | null; turn: number | null };
evaluate(extraction: Extraction, ctx: { callDate: 'YYYY-MM-DD'; followUpsAsked: FieldKey[] })
  → { criteria: Record<C, {state, ruleId, evidence}>, triggers: X[], outcome, next, rulesVersion }
```
The extraction fields are: call_type, caller_name, intent, structural_work, property_category, residential_kind, commercial_type, scope_kind, bhk, rooms[], area_sqft, locality_raw, completion_expr, site_available_expr, budget_raw, budget_feasibility_asked, caller_role, decider_attends, existing_client, names_ongoing_project_or_designer, service_complaint, human_requested, pricing_asked_count, consultation_preference, language, contradictions[], model_suggested_outcome.

---

## 5. Supabase schema (Phase 3, sketched now)

All tables have RLS enabled. Writes happen only server-side, through the service role. The dashboard reads through an `authenticated` SELECT-only policy limited to emails in `dashboard_viewers`.

| Table | Key columns |
|---|---|
| `calls` | id, provider_call_id (unique), caller_phone_e164, started_at, answered_at, ended_at, duration_s, after_hours (IST), language, call_type, outcome, resumed_from_call_id, lead_id, telephony_minutes, end_reason, rules_version, prompt_version, extractor_model |
| `transcript_turns` | call_id, turn_index, speaker, text, at, interrupted, guard_blocked; `purge_after` (90 days, Q12) |
| `leads` | phone_e164 (unique), name, latest outcome, project_type, scope, locality_raw, locality_match, area_sqft, completion_by, site_available_from, tight_timeline, budget_raw, decider_note, pricing_asked, consultation_pref, hubspot_contact_id, hubspot_deal_id |
| `criterion_evidence` | call_id, lead_id, criterion, state, rule_id, evidence_quote, turn, follow_up_asked, extractor_model, prompt_version, rules_version, model_suggested_outcome |
| `handoffs` | lead_id, kind (designer / escalation), channel, status, attempts, idempotency_key (unique), payload jsonb, sent_at, resolved_at, resolution_note |
| `bookings` | lead_id, provider, provider_booking_id, slot_start, status (pending / confirmed / failed / cancelled), preference, idempotency_key |
| `followup_tasks` | lead_id, call_id, reason, missing_fields[], status, closed_at |
| `cost_events` | call_id, kind (telephony / llm / notification), provider, units, unit_type, unit_rate, rate_version, amount |
| `integration_errors` | service, operation, idempotency_key, attempt, error_code, message (redacted), resolved_at |
| `integration_jobs` *(proposed)* | outbox: kind, payload, idempotency_key, attempts, next_attempt_at, status |
| `dashboard_viewers` *(proposed)* | email |

Every external write goes into `integration_jobs` in the same transaction as the call record. That guarantees a HubSpot or Telegram failure can never lose a call.

---

## 6. Phase 1 test plan

- **54 assertable rows.** That is 62 minus T08 (`no_label`), S02–S05 and S22 (`unchanged`), S19 (`per_content`) and S20 (`field_unknown`). Each row × outcome × every non-blank criterion cell is checked. Blank cells (e.g. T09, S09) are not asserted.
- **Synthetic S-rows** get short hand-written transcripts so every quote validates.
- **Boundary unit tests** for each threshold, the budget regex (ranges, lakh / L / ₹ / Rs forms, Indian digit grouping, Hindi number words) and the date resolver.
- **`pricingGuard`.** It blocks currency or amount patterns, per-sq-ft rates, "starts at" / "around X" / "typically costs", and the Hindi forms, and logs each block. It passes "10:30 AM, Saturday 4 October", "3BHK", "1,400 sq ft" and "6 weeks".
- **Repo-wide scan** over `src/`, `config/`, `app/`, `scripts/`, prompts and `tests/fixtures`, using the allowlist in §3.1.

---

## 7. Open questions register

Q1–Q16 are coded exactly as given in the brief. New questions, numbered after them so Q1–Q16 keep their IDs:

| ID | Question | Default |
|---|---|---|
| Q3a | Consultation buffer for the site-availability window | 28 days (needed to match F01 / T20) |
| Q17 | Start date given, no completion date | treat as `no_deadline` |
| Q19 | Tenant with landlord consent as decider | pass |
| Q20 | C4 fail + escalate together | fail wins |
| Q21 | Unlisted single room (study, dining, puja) | escalate |
| Q22 | "flexible" / "no rush" / range | `no_deadline` / upper bound |
| Q23 | Past month-only start date | `now` |
| Q24 | Festival dates for "before Diwali" etc. | table in config, Diwali 2026 = 8 Nov |
| Q25 | Guard: "around + number" with area/time units | allowed |
| Q26 | Pricing-scan allowlist for caller budgets and the C4 threshold | caller turns + `pricing-scan:allow` lines |
