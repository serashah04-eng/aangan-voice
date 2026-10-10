import type { LeadRow } from '../domain/records';
import type { DateExpr, EvaluationResult, ExtractionFields, Outcome } from '../domain/types';
import { classifyCommercialType, projectShape } from '../rules/criteria/c1b-scope';
import { resolveDeadline, resolveStart } from '../rules/dates';
import { known } from '../rules/fields';
import { matchLocality } from '../rules/locality';

/** Everything a designer needs, derived from the validated extraction + the rules engine result. */
export type LeadSummary = {
  phone: string;
  name: string | null;
  outcome: Outcome;
  locality: string | null;
  localityMatch: string | null;
  projectType: string | null;
  scope: string | null;
  areaSqft: number | null;
  completionBy: string | null;
  completionNoDeadline: boolean;
  siteAvailableFrom: string | null;
  tightTimeline: boolean;
  budgetRaw: string | null;
  deciderNote: string | null;
  pricingAsked: boolean;
  pricingAskedCount: number;
  consultationPreference: string | null;
  /** Plain-words reasons for not_qualified / human review, from the criteria notes. */
  reasons: string[];
  /** Criteria still unknown (for the follow-up task). */
  missing: string[];
};

const ROOM_LABEL: Record<string, string> = { living: 'living room', home_office: 'home office', puja: 'puja room' };

export function summariseLead(f: ExtractionFields, r: EvaluationResult, phone: string, callDate: string): LeadSummary {
  const shape = projectShape(f);
  let projectType: string | null = null;
  let scope: string | null = null;
  if (shape.category === 'commercial') {
    projectType = known(f.commercial_type) ? `commercial — ${classifyCommercialType(f.commercial_type.value).type}` : 'commercial';
  } else if (shape.category === 'residential') {
    const kind = known(f.residential_kind) ? f.residential_kind.value.replace('_', ' ') : 'home';
    projectType = `residential — ${known(f.bhk) ? `${f.bhk.value}BHK ` : ''}${kind}`;
    if (shape.scope === 'full_home') scope = 'full home';
    else if (shape.scope === 'full_floor') scope = 'full floor';
    else if (shape.scope === 'rooms' && known(f.rooms)) scope = f.rooms.value.map((x) => ROOM_LABEL[x] ?? x).join(', ');
  }

  const deadline = known(f.completion) ? resolveDeadline(f.completion.value as DateExpr, callDate) : null;
  const site = known(f.site_available) ? resolveStart(f.site_available.value as DateExpr, callDate) : null;
  const loc = known(f.locality) ? matchLocality(f.locality.value) : null;
  const pricingCount = known(f.pricing_asked_count) ? f.pricing_asked_count.value : 0;

  const reasons = Object.values(r.criteria)
    .filter((c) => (c.state === 'fail' || c.state === 'escalate') && c.note)
    .map((c) => c.note!);
  for (const t of r.triggers) {
    reasons.push(
      t.trigger === 'X1' ? 'Existing client with a complaint or an ongoing project.' : t.trigger === 'X2' ? 'Service complaint or asked for a person.' : 'Contradictory answers on the call.',
    );
  }

  const MISSING_LABEL: Record<string, string> = { C1a: 'design + execution intent', C1b: 'project scope', C2: 'locality', C3: 'completion date' };
  const missing = (['C1a', 'C1b', 'C2', 'C3'] as const).filter((c) => r.criteria[c].state === 'unknown').map((c) => MISSING_LABEL[c]!);

  return {
    phone,
    name: known(f.caller_name) ? f.caller_name.value : null,
    outcome: r.outcome,
    locality: known(f.locality) ? f.locality.value : null,
    localityMatch: loc ? (loc.kind === 'listed' || loc.kind === 'excluded' ? `${loc.kind}:${loc.canonical}` : loc.kind) : null,
    projectType,
    scope,
    areaSqft: known(f.area_sqft) ? f.area_sqft.value : null,
    completionBy: deadline && deadline !== 'no_deadline' ? deadline : null,
    completionNoDeadline: deadline === 'no_deadline' || r.criteria.C3.ruleId === 'C3.PASS_START_ONLY_NO_DEADLINE_Q17',
    siteAvailableFrom: site,
    tightTimeline: r.criteria.C3.state === 'pass_tight',
    budgetRaw: known(f.budget_raw) && r.criteria.C4.state !== 'not_mentioned' ? f.budget_raw.value : null,
    deciderNote: r.criteria.C5.state === 'pass' ? null : (r.criteria.C5.note ?? null),
    pricingAsked: pricingCount > 0,
    pricingAskedCount: pricingCount,
    consultationPreference: known(f.consultation_preference) ? f.consultation_preference.value : null,
    reasons,
    missing,
  };
}

export function leadRowFrom(s: LeadSummary): Partial<LeadRow> & Pick<LeadRow, 'phone_e164'> {
  return {
    phone_e164: s.phone,
    name: s.name ?? undefined,
    latest_outcome: s.outcome,
    project_type: s.projectType ?? undefined,
    scope: s.scope ?? undefined,
    locality_raw: s.locality ?? undefined,
    locality_match: s.localityMatch ?? undefined,
    area_sqft: s.areaSqft ?? undefined,
    completion_by: s.completionBy ?? undefined,
    completion_no_deadline: s.completionNoDeadline,
    site_available_from: s.siteAvailableFrom ?? undefined,
    tight_timeline: s.tightTimeline,
    budget_raw: s.budgetRaw ?? undefined,
    decider_note: s.deciderNote ?? undefined,
    pricing_asked: s.pricingAsked,
    consultation_preference: s.consultationPreference ?? undefined,
  } as Partial<LeadRow> & Pick<LeadRow, 'phone_e164'>;
}

function timelineLine(s: LeadSummary): string {
  const parts: string[] = [];
  if (s.completionBy) parts.push(`complete by ${s.completionBy}`);
  else if (s.completionNoDeadline) parts.push('no fixed deadline');
  else parts.push('completion date not given');
  if (s.siteAvailableFrom) parts.push(`site available from ${s.siteAvailableFrom}`);
  if (s.tightTimeline) parts.push('⚠ TIGHT TIMELINE (6–20 weeks) — do not promise the date');
  return parts.join('; ');
}

/** The designer handoff (brief §7 Phase 3): everything already asked, nothing to re-ask. */
export function designerHandoffMessage(s: LeadSummary, recordUrl: string): { subject: string; body: string } {
  const lines = [
    `Caller: ${s.name ?? '(name not given)'} — ${s.phone}`,
    `Locality: ${s.locality ?? '—'}`,
    `Project: ${s.projectType ?? '—'}${s.scope ? ` — ${s.scope}` : ''}${s.areaSqft ? ` (~${s.areaSqft} sq ft)` : ''}`,
    `Timeline: ${timelineLine(s)}`,
    `Budget (caller's words): ${s.budgetRaw ? `"${s.budgetRaw}"` : 'not mentioned'}`,
    `Decision-maker: ${s.deciderNote ?? 'confirmed on the call'}`,
    `Asked about price: ${s.pricingAsked ? `yes (${s.pricingAskedCount}×) — given the standard reply, no figures` : 'no'}`,
    `Consultation preference: ${s.consultationPreference ?? '—'}`,
    '',
    `Full record: ${recordUrl}`,
  ];
  return { subject: `New qualified lead — ${s.name ?? s.phone}${s.locality ? `, ${s.locality}` : ''}`, body: lines.join('\n') };
}

export function escalationMessage(s: LeadSummary, recordUrl: string): { subject: string; body: string } {
  const lines = [
    `Caller: ${s.name ?? '(name not given)'} — ${s.phone}`,
    `Why: ${s.reasons.length ? s.reasons.join(' ') : 'Needs a senior review.'}`,
    `Locality: ${s.locality ?? '—'} · Project: ${s.projectType ?? '—'}${s.scope ? ` — ${s.scope}` : ''}`,
    `Timeline: ${timelineLine(s)}`,
    `Budget (caller's words): ${s.budgetRaw ? `"${s.budgetRaw}"` : 'not mentioned'}`,
    'The caller was told a senior member of the team will call back. No time was promised.',
    '',
    `Full record: ${recordUrl}`,
  ];
  return { subject: `Escalation — please call back: ${s.name ?? s.phone}`, body: lines.join('\n') };
}

export function dealDescription(s: LeadSummary): string {
  return [
    `Outcome: ${s.outcome}`,
    `Locality: ${s.locality ?? '—'}`,
    `Project: ${s.projectType ?? '—'}${s.scope ? ` — ${s.scope}` : ''}`,
    `Timeline: ${timelineLine(s)}`,
    `Budget (caller's words): ${s.budgetRaw ?? 'not mentioned'}`,
    `Decision-maker: ${s.deciderNote ?? 'confirmed'}`,
    `Consultation preference: ${s.consultationPreference ?? '—'}`,
    ...(s.reasons.length ? [`Review reasons: ${s.reasons.join(' ')}`] : []),
  ].join('\n');
}
