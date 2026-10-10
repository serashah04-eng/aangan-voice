import { A, C, f, fx, month, NO_DEADLINE, S, within, type CaseFixture } from './_helpers';

/**
 * S-series edge cases with hand-written transcripts. S02–S05, S19, S20 and S22 are not
 * outcome rows (unchanged / per_content / field_unknown); S20 is covered by the quote
 * validator test, the others belong to later phases.
 */
const ownerViman = (id: string, notes: string): CaseFixture =>
  fx({
    id,
    callDate: '2026-10-01',
    transcript: [
      A(S.greeting),
      C("I'm the owner of a 3BHK in Viman Nagar. I want a complete redesign with execution, all rooms."),
      A(S.questions.completion),
      C('By June next year.'),
      A(S.questions.caller_name),
      C("It's Meera Joshi."),
      A(`That's everything I need. ${S.pricing.bookingSuffix}`),
      C('Yes please.'),
    ],
    fields: {
      caller_name: f('Meera Joshi', 'Meera Joshi'),
      intent: f('design_and_execution', 'a complete redesign with execution'),
      property_category: f('residential', 'a 3BHK in Viman Nagar'),
      bhk: f(3, 'a 3BHK in Viman Nagar'),
      scope_kind: f('full_home', 'a complete redesign with execution, all rooms'),
      locality: f('Viman Nagar', 'a 3BHK in Viman Nagar'),
      completion: f(month(6, 2027), 'By June next year'),
      caller_role: f('owner', "I'm the owner"),
    },
    asked: ['completion', 'caller_name'],
    notes,
  });

export const syntheticCases: CaseFixture[] = [
  fx({
    id: 'S01',
    callDate: '2026-10-01',
    transcript: [
      A(S.greeting),
      C('Hi, we have a 3BHK in Baner and want a complete redesign with execution.'),
      C('How much will it cost?'),
      A(S.pricing.approved),
      A(S.questions.completion),
      C('By June next year.'),
      C('Just give me a rough figure.'),
      A(S.pricing.pushedAgain),
      C("Come on, what's the price?"),
      A(S.pricing.pushedAgain),
    ],
    fields: {
      intent: f('design_and_execution', 'a complete redesign with execution'),
      property_category: f('residential', 'a 3BHK in Baner'),
      bhk: f(3, 'a 3BHK in Baner'),
      scope_kind: f('full_home', 'a complete redesign with execution'),
      locality: f('Baner', 'a 3BHK in Baner'),
      completion: f(month(6, 2027), 'By June next year'),
      pricing_asked_count: f(3, 'How much will it cost?'),
    },
    asked: ['completion'],
    notes: 'Price asked three times; every agent line still passes the pricing guard unchanged.',
  }),

  fx({
    id: 'S06',
    callDate: '2026-10-01',
    transcript: [
      A(S.greeting),
      C('We want to redo our 2BHK fully, kitchen, bedrooms, living room, with execution.'),
    ],
    fields: {
      intent: f('design_and_execution', 'with execution'),
      property_category: f('residential', 'our 2BHK'),
      bhk: f(2, 'our 2BHK'),
      scope_kind: f('full_home', 'redo our 2BHK fully'),
    },
    notes: 'Caller hung up after the first turn; partial record.',
  }),

  fx({
    id: 'S07',
    callDate: '2026-10-01',
    transcript: [
      A(S.greeting),
      C('Hi, I have a 2BHK in Wakad and I want the whole flat designed and executed.'),
      A(S.questions.completion),
      C('Sometime soon.'),
      A(S.questions.completion_rephrase),
      C('Not sure.'),
    ],
    fields: {
      intent: f('design_and_execution', 'I want the whole flat designed and executed'),
      property_category: f('residential', 'a 2BHK in Wakad'),
      bhk: f(2, 'a 2BHK in Wakad'),
      scope_kind: f('full_home', 'the whole flat'),
      locality: f('Wakad', 'a 2BHK in Wakad'),
    },
    asked: ['completion', 'completion_rephrase'],
  }),

  fx({
    id: 'S08',
    callDate: '2026-10-01',
    transcript: [
      A(S.greeting),
      C('We have a 3BHK in Aundh. We want full interiors and we also want to remove the wall between the kitchen and the living room.'),
      A(S.questions.completion),
      C('No deadline really.'),
    ],
    fields: {
      intent: f('design_and_execution', 'We want full interiors'),
      structural_work: f(true, 'remove the wall between the kitchen and the living room'),
      property_category: f('residential', 'a 3BHK in Aundh'),
      bhk: f(3, 'a 3BHK in Aundh'),
      scope_kind: f('full_home', 'We want full interiors'),
      locality: f('Aundh', 'a 3BHK in Aundh'),
      completion: f(NO_DEADLINE, 'No deadline really'),
    },
    asked: ['completion'],
  }),

  fx({
    id: 'S09',
    callDate: '2026-10-01',
    transcript: [A(S.greeting), C('I only need a Vastu consultation for my flat. No design work.')],
    fields: {
      intent: f('vastu_only', 'I only need a Vastu consultation'),
      property_category: f('residential', 'my flat'),
    },
  }),

  fx({
    id: 'S10',
    callDate: '2026-10-01',
    transcript: [A(S.greeting), C("I just need help sourcing furniture, a sofa and a dining table. I don't need any design.")],
    fields: {
      intent: f('sourcing_only', 'I just need help sourcing furniture'),
    },
  }),

  fx({
    id: 'S11',
    callDate: '2026-10-01',
    transcript: [
      A(S.greeting),
      C('We have a 3,400 sq ft office in Baner and need a complete fitout with execution.'),
      A(S.questions.completion),
      C('No fixed deadline.'),
    ],
    fields: {
      intent: f('design_and_execution', 'need a complete fitout with execution'),
      property_category: f('commercial', 'office in Baner'),
      commercial_type: f('office', 'office in Baner'),
      area_sqft: f(3400, '3,400 sq ft office'),
      locality: f('Baner', 'office in Baner'),
      completion: f(NO_DEADLINE, 'No fixed deadline'),
    },
    asked: ['completion'],
  }),

  fx({
    id: 'S12',
    callDate: '2026-10-01',
    transcript: [
      A(S.greeting),
      C("I want my full 2BHK designed and executed. It's in Wagholi."),
      A(S.questions.completion),
      C('No rush, whenever you can.'),
    ],
    fields: {
      intent: f('design_and_execution', 'designed and executed'),
      property_category: f('residential', 'my full 2BHK'),
      bhk: f(2, 'my full 2BHK'),
      scope_kind: f('full_home', 'my full 2BHK'),
      locality: f('Wagholi', "It's in Wagholi"),
      completion: f(NO_DEADLINE, 'No rush, whenever you can'),
    },
    asked: ['completion'],
  }),

  fx({
    id: 'S13',
    callDate: '2026-10-01',
    transcript: [
      A(S.greeting),
      C('I have a flat in Mumbai and I need it done in 2 weeks. Full redesign with execution.'),
    ],
    fields: {
      intent: f('design_and_execution', 'Full redesign with execution'),
      property_category: f('residential', 'a flat in Mumbai'),
      scope_kind: f('full_home', 'Full redesign with execution'),
      locality: f('Mumbai', 'a flat in Mumbai'),
      completion: f(within(2, 'weeks'), 'I need it done in 2 weeks'),
    },
  }),

  fx({
    id: 'S14',
    callDate: '2026-10-01',
    transcript: [
      A(S.greeting),
      C('We want our whole 2BHK in Kothrud redone, with execution. I have Rs 1 lakh for the whole 2BHK.'),
      A(S.questions.completion),
      C('No deadline.'),
      A(S.budgetFail),
    ],
    fields: {
      intent: f('design_and_execution', 'redone, with execution'),
      property_category: f('residential', 'our whole 2BHK in Kothrud'),
      bhk: f(2, 'our whole 2BHK in Kothrud'),
      scope_kind: f('full_home', 'our whole 2BHK'),
      locality: f('Kothrud', '2BHK in Kothrud'),
      completion: f(NO_DEADLINE, 'No deadline'),
      budget_raw: f('Rs 1 lakh for the whole 2BHK', 'Rs 1 lakh for the whole 2BHK'),
    },
    asked: ['completion'],
  }),

  fx({
    id: 'S15',
    callDate: '2026-10-01',
    transcript: [
      A(S.greeting),
      C("I'm doing research for my in-laws. They have a 2BHK in Aundh and want the full flat designed and executed."),
      A(S.questions.completion),
      C('No fixed date.'),
      A(S.questions.decider_attends),
      C("I can't say."),
    ],
    fields: {
      intent: f('design_and_execution', 'want the full flat designed and executed'),
      property_category: f('residential', 'a 2BHK in Aundh'),
      bhk: f(2, 'a 2BHK in Aundh'),
      scope_kind: f('full_home', 'the full flat'),
      locality: f('Aundh', 'a 2BHK in Aundh'),
      completion: f(NO_DEADLINE, 'No fixed date'),
      caller_role: f('researching_for_other', "I'm doing research for my in-laws"),
    },
    asked: ['completion', 'decider_attends'],
  }),

  ownerViman('S16', 'Booking accepted; calendar API errors → booking_status=failed + front-desk task (Phase 3).'),
  ownerViman('S17', 'No offered slot fits → booking_status=pending, preference saved (Phase 3).'),
  ownerViman('S18', 'Slot taken between offer and confirm → re-check, offer next slot (Phase 3).'),

  fx({
    id: 'S21',
    callDate: '2026-10-01',
    transcript: [
      A(S.greeting),
      C('Hi, I have a 3BHK in Kothrud and want full interiors with execution.'),
      A(S.questions.completion),
      C('Actually, I called last week and nobody called me back. Why does no one return calls?'),
      A(S.closing.escalation),
    ],
    fields: {
      intent: f('design_and_execution', 'want full interiors with execution'),
      property_category: f('residential', 'a 3BHK in Kothrud'),
      bhk: f(3, 'a 3BHK in Kothrud'),
      scope_kind: f('full_home', 'full interiors'),
      locality: f('Kothrud', 'a 3BHK in Kothrud'),
      service_complaint: f(true, 'I called last week and nobody called me back'),
    },
    asked: ['completion'],
  }),
];

/** S20 — the extractor claims a locality that the caller never said. Used by the validator test. */
export const s20 = fx({
  id: 'S20',
  callDate: '2026-10-01',
  transcript: [
    A(S.greeting),
    C('Hi, I want my 2BHK fully designed and executed. We need it done by June next year.'),
  ],
  fields: {
    intent: f('design_and_execution', 'fully designed and executed'),
    property_category: f('residential', 'my 2BHK'),
    bhk: f(2, 'my 2BHK'),
    scope_kind: f('full_home', 'fully designed and executed'),
    completion: f(month(6, 2027), 'done by June next year'),
    locality: f('Baner', 'Baner'),
  },
});
