import { CallerRole, Intent, Room, type FieldKey } from '../domain/types';

/**
 * One table describes every extracted field: its value type and the extraction guidance the
 * model sees. The JSON schema sent to Gemini, the field guide in the prompt and the parser of the
 * model's reply are all generated from it, so they cannot drift apart.
 *
 * Guidance describes WHAT TO RECORD, never what it means for qualification — the model does not
 * decide criteria or outcomes.
 */

export type ValueKind =
  | { t: 'enum'; values: readonly string[] }
  | { t: 'number' }
  | { t: 'integer' }
  | { t: 'boolean' }
  | { t: 'string' }
  | { t: 'rooms' }
  | { t: 'date'; allow: 'deadline' | 'start' };

export type FieldSpec = { kind: ValueKind; guide: string };

export const FIELD_SPECS: Record<FieldKey, FieldSpec> = {
  call_type: {
    kind: { t: 'enum', values: ['enquiry', 'other'] },
    guide: '"other" for vendors, job seekers, sales calls, wrong numbers. "enquiry" for anyone asking about a project, including existing clients and complainants.',
  },
  caller_name: { kind: { t: 'string' }, guide: "The caller's own name, as they said it. Not a referrer's name." },
  language: { kind: { t: 'enum', values: ['en', 'hi', 'other'] }, guide: 'Main language the caller speaks (Hinglish counts as "hi" if mostly Hindi).' },
  intent: {
    kind: { t: 'enum', values: Intent.options },
    guide: [
      'design_and_execution: the caller wants spaces designed AND the work carried out — e.g. "redo the whole thing", "full interiors", "end-to-end", "complete redesign", "fit out the office", "full execution", listing rooms they want done, "poora ghar karwana hai". Also when they describe what must be built in a bare/empty space (e.g. an office shell needing workstations, cabins and a meeting room).',
      'advice_only: wants ideas, suggestions, a consultation or second opinion only. If they ask only for ideas/suggestions AND say "just exploring", choose advice_only (the request is what matters). diy_execution: will get the work done themselves. decor_only: styling, colours, rearranging furniture only. vastu_only: standalone Vastu. sourcing_only: wants furniture/material sourcing without a design project.',
      'exploring: says they are "just exploring", "early stage", or only wants a brochure — with no commitment to a project.',
      'unknown: they mention a property or want "a design" / "proper design" without saying the work would be carried out, or say nothing about it.',
    ].join(' '),
  },
  structural_work: {
    kind: { t: 'boolean' },
    guide: 'true only if the caller wants walls moved/removed/broken or other structural changes. false if they explicitly say no structural changes. Otherwise unknown.',
  },
  property_category: { kind: { t: 'enum', values: ['residential', 'commercial'] }, guide: 'Homes (flat, apartment, house, villa) are residential. Offices, clinics, studios, shops, restaurants, gyms, coworking etc. are commercial.' },
  residential_kind: { kind: { t: 'enum', values: ['apartment', 'independent_house', 'villa'] }, guide: 'Only if stated.' },
  commercial_type: { kind: { t: 'string' }, guide: 'The kind of commercial space in the caller\'s words, e.g. "office", "dental clinic", "coworking pod", "restaurant", "gym".' },
  scope_kind: {
    kind: { t: 'enum', values: ['full_home', 'full_floor', 'rooms'] },
    guide: 'full_home: the whole home ("whole flat", "full interiors", "full home", "everything", "poora ghar"). full_floor: an entire floor. rooms: specific rooms listed. unknown if they only mention the BHK size without saying what they want done.',
  },
  bhk: { kind: { t: 'integer' }, guide: 'Number of bedrooms from "nBHK".' },
  rooms: {
    kind: { t: 'rooms' },
    guide: `Rooms the caller wants worked on, one entry per room (${Room.options.join(', ')}). "both bedrooms" → bedroom twice. Wardrobes → wardrobe. Dining area → dining. Home office / workspace → home_office. Only when they list rooms.`,
  },
  area_sqft: { kind: { t: 'number' }, guide: 'Carpet/built-up area in square feet, as a number.' },
  locality: {
    kind: { t: 'string' },
    guide: 'Where THIS project\'s property is — the area/locality as said (e.g. "Kothrud, Dahanukar Colony", "Hinjewadi Phase 1", "Talegaon Dabhade, near Pune"). If they only say "Pune", record "Pune". Never use a referrer\'s or past project\'s location.',
  },
  completion: {
    kind: { t: 'date', allow: 'deadline' },
    guide: [
      'When the project must be COMPLETE — move-in, ready-by, operational-by, guests arriving, festival deadline.',
      'Use month (+ year only if stated or "next year" = call year + 1), exact date, duration ("in 3 weeks" → duration 3 weeks; a range "3–4 months" → the upper bound), or festival ("before Diwali" → festival diwali, relation before).',
      '"flexible", "no rush", "no deadline", "whenever" with no firm date → no_deadline. A firm date plus "no rush" → the firm date.',
      '"ASAP", "soon", "not sure" → unknown. If the caller withdraws a date and does not give a new one, → unknown (this is not a contradiction). Asking "what if I start after <the date> instead?" withdraws the original deadline without setting a new one → unknown.',
    ].join(' '),
  },
  site_available: {
    kind: { t: 'date', allow: 'start' },
    guide: [
      'When the site can be worked on / execution can start: "now", "start immediately", "flat is empty", "bare shell", "we have moved out" → now; "possession on 15 October" → that date; "execution starting November" / "a January start" → that month; "possession in August" → month 8.',
      'Do NOT record hypothetical questions ("what if I start after Diwali?") or descriptions with no timing ("new possession").',
    ].join(' '),
  },
  budget_raw: {
    kind: { t: 'string' },
    guide: 'Only if the CALLER volunteers anything about their budget: copy their words about money exactly as spoken, figure and all (or e.g. "budget bhi hai" when no figure is given). Never ask, infer, convert or summarise.',
  },
  budget_feasibility_asked: { kind: { t: 'boolean' }, guide: 'true if the caller asks whether their budget is enough / possible with the studio.' },
  caller_role: {
    kind: { t: 'enum', values: CallerRole.options },
    guide: [
      'Only from an explicit statement about ownership or decision-making — "my flat" / "our home" alone is NOT enough (→ unknown).',
      'owner: the caller says they own the property or will decide. co_owner_with_consent: a joint owner who says the other owner agrees / will attend / "we both own it". founder: founder/owner of the business. authorised_rep: explicitly authorised to decide for the owner.',
      'tenant_with_landlord_consent: a tenant whose landlord agrees. researching_for_other: enquiring on behalf of someone else who will decide (parents, in-laws, boss). other: a role is stated but not authority (e.g. "Operations Head"). unknown if not stated.',
    ].join(' '),
  },
  decider_attends: { kind: { t: 'boolean' }, guide: 'Only when the caller is researching for someone else: true if they say the decision-maker will attend the consultation; false if they say not.' },
  existing_client_complaint: { kind: { t: 'boolean' }, guide: 'true if the caller is an existing client with an ongoing Aangan project complaining about it.' },
  names_ongoing_project_or_designer: {
    kind: { t: 'boolean' },
    guide: 'true if the caller names THEIR designer or ongoing Aangan project. A referrer, a friend of the founder, or a past client who recommended the studio does not count.',
  },
  service_complaint: { kind: { t: 'boolean' }, guide: 'true if the caller complains about the studio\'s service, e.g. nobody replied or called back.' },
  human_requested: {
    kind: { t: 'boolean' },
    guide: 'true only if the caller asks to speak to a person / senior / manager / the founder NOW or to be called back by one instead of continuing with the assistant. Wanting a particular designer (e.g. the principal designer) at the consultation or site visit is a consultation_preference, not a request for a human.',
  },
  pricing_asked_count: { kind: { t: 'integer' }, guide: 'How many separate times the caller asked about price, cost, rates, a range or a price list. Quote the first ask.' },
  consultation_preference: { kind: { t: 'string' }, guide: 'Any stated preference for the consultation: site visit, days, times, who should attend.' },
};
