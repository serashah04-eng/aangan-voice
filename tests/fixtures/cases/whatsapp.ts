import { A, C, f, fx, month, NOW, on, rooms, S, type CaseFixture } from './_helpers';

/**
 * W-series: the 10 WhatsApp threads, re-voiced as short phone calls with the same facts
 * (the brief scopes the build to phone; these replay the content through the same engine).
 */
export const whatsappCases: CaseFixture[] = [
  fx({
    id: 'W01',
    callDate: '2026-09-03',
    transcript: [
      A(S.greeting),
      C('Hi, this is Kiran Mazumdar. I got your number from Sonali Patel. You did her flat last year in Viman Nagar. We have a 4BHK in Viman Nagar and want to do the full interiors.'),
      C('About 1,800 sq ft carpet. We have possession already, the flat is empty. Want to start as soon as possible. Design in October, execution starting November?'),
      C('Weekdays after 6pm or weekends only for us.'),
    ],
    fields: {
      caller_name: f('Kiran Mazumdar', 'Kiran Mazumdar'),
      intent: f('design_and_execution', 'want to do the full interiors'),
      property_category: f('residential', 'a 4BHK in Viman Nagar'),
      bhk: f(4, 'a 4BHK in Viman Nagar'),
      scope_kind: f('full_home', 'want to do the full interiors'),
      area_sqft: f(1800, 'About 1,800 sq ft'),
      locality: f('Viman Nagar', 'a 4BHK in Viman Nagar'),
      site_available: f(month(11), 'execution starting November'),
      consultation_preference: f('weekday evenings after 6pm or weekends', 'Weekdays after 6pm or weekends only'),
    },
    notes: 'Start given ("execution starting November"), no deadline → Q17.',
  }),

  fx({
    id: 'W02',
    callDate: '2026-09-08',
    transcript: [
      A(S.greeting),
      C('Hi, how much do you charge per sq ft for a 2BHK?'),
      A(S.pricing.approved),
      A(S.questions.intent),
    ],
    fields: {
      property_category: f('residential', 'for a 2BHK'),
      bhk: f(2, 'for a 2BHK'),
      pricing_asked_count: f(1, 'how much do you charge'),
    },
    asked: ['intent'],
    notes: 'Caller went silent after the price question.',
  }),

  fx({
    id: 'W03',
    callDate: '2026-09-12',
    transcript: [
      A(S.greeting),
      C('Namaste. Mera flat hai Pimple Nilakh mein. 3BHK. Interior design karwana hai poora ghar. Budget bhi hai.'),
      A('Project kab tak poora chahiye?'),
      C('Abhi pakka nahi pata.'),
    ],
    fields: {
      language: f('hi', 'Mera flat hai Pimple Nilakh mein'),
      intent: f('design_and_execution', 'Interior design karwana hai poora ghar'),
      property_category: f('residential', 'Mera flat hai Pimple Nilakh mein'),
      bhk: f(3, '3BHK'),
      scope_kind: f('full_home', 'poora ghar'),
      locality: f('Pimple Nilakh', 'Pimple Nilakh mein'),
      budget_raw: f('Budget bhi hai', 'Budget bhi hai'),
    },
    asked: ['completion'],
    notes: '"Budget bhi hai" ("there is a budget") carries no figure → C4 not_mentioned.',
  }),

  fx({
    id: 'W04',
    callDate: '2026-09-15',
    transcript: [
      A(S.greeting),
      C('Hello, do you take up commercial projects in Chinchwad? We have a 1,200 sq ft office space we want to fit out.'),
      C('Bare shell. Just moved in. Need workstations for 30 people, two cabins, one meeting room.'),
      A(S.questions.completion),
      C('January if possible. Is that doable?'),
      A("I've noted January as your target. The designer will go through what's realistic at the consultation."),
      C('Yes. Can you send me a calendar link?'),
    ],
    fields: {
      intent: f('design_and_execution', 'office space we want to fit out'),
      property_category: f('commercial', 'commercial projects in Chinchwad'),
      commercial_type: f('office', 'office space'),
      area_sqft: f(1200, '1,200 sq ft office'),
      locality: f('Chinchwad', 'commercial projects in Chinchwad'),
      completion: f(month(1), 'January if possible'),
      site_available: f(NOW, 'Bare shell. Just moved in'),
      consultation_preference: f('calendar link', 'Can you send me a calendar link?'),
    },
    asked: ['completion'],
  }),

  fx({
    id: 'W05',
    callDate: '2026-09-20',
    transcript: [
      A(S.greeting),
      C('Hello, I wanted to inquire about getting my home designed. 2BHK in Baner. Please let me know if you can help and what the process is.'),
    ],
    fields: {
      property_category: f('residential', 'getting my home designed'),
      bhk: f(2, '2BHK in Baner'),
      locality: f('Baner', '2BHK in Baner'),
    },
  }),

  fx({
    id: 'W06',
    callDate: '2026-09-17',
    transcript: [
      A(S.greeting),
      C("Hi, I'm Tanvi Kulkarni. Ashok Bhosale asked me to call directly. We've just bought a 3BHK in Koregaon Park, possession next month. We want end-to-end design."),
      A(S.questions.completion),
      C("Possession is on October 15th, and we'd like to start right after."),
    ],
    fields: {
      caller_name: f('Tanvi Kulkarni', 'Tanvi Kulkarni'),
      intent: f('design_and_execution', 'We want end-to-end design'),
      property_category: f('residential', 'a 3BHK in Koregaon Park'),
      bhk: f(3, 'a 3BHK in Koregaon Park'),
      scope_kind: f('full_home', 'We want end-to-end design'),
      locality: f('Koregaon Park', 'a 3BHK in Koregaon Park'),
      site_available: f(on('2026-10-15'), 'Possession is on October 15th'),
    },
    asked: ['completion'],
    notes: 'Possession date given, no deadline → Q17.',
  }),

  fx({
    id: 'W07',
    callDate: '2026-09-05',
    transcript: [
      A(S.greeting),
      C("Hi, I'm opening a gym in Kothrud. About 2,500 sq ft. Would you design the interiors? Looking for something modern and high-energy."),
    ],
    fields: {
      property_category: f('commercial', 'opening a gym'),
      commercial_type: f('gym', 'opening a gym'),
      area_sqft: f(2500, 'About 2,500 sq ft'),
      locality: f('Kothrud', 'a gym in Kothrud'),
    },
  }),

  fx({
    id: 'W08',
    callDate: '2026-09-10',
    transcript: [
      A(S.greeting),
      C('Hello, I got in touch four days ago about my flat in Aundh. No one replied. Is anyone monitoring this number?'),
      C("2BHK in Aundh. 850 sq ft. Full interiors. But now I'm not sure I want to work with a studio that doesn't reply for 4 days."),
    ],
    fields: {
      service_complaint: f(true, 'No one replied. Is anyone monitoring this number?'),
      intent: f('design_and_execution', 'Full interiors'),
      property_category: f('residential', '2BHK in Aundh'),
      bhk: f(2, '2BHK in Aundh'),
      scope_kind: f('full_home', 'Full interiors'),
      area_sqft: f(850, '850 sq ft'),
      locality: f('Aundh', '2BHK in Aundh'),
    },
  }),

  fx({
    id: 'W09',
    callDate: '2026-09-25',
    transcript: [
      A(S.greeting),
      C("Hi! I want to redo my living room in Aundh, Sunderban area. It's a 3BHK apartment. We want to start with the living room and dining area. Maybe the kitchen too."),
      A(S.questions.intent),
      C('Full execution, design, materials, furniture, all of it.'),
      A(S.questions.completion),
      C("Not sure yet, we'll see."),
      A(S.questions.completion_rephrase),
      C("Honestly I can't say right now."),
    ],
    fields: {
      intent: f('design_and_execution', 'Full execution, design, materials, furniture, all of it'),
      property_category: f('residential', "It's a 3BHK apartment"),
      residential_kind: f('apartment', '3BHK apartment'),
      bhk: f(3, '3BHK apartment'),
      scope_kind: f('rooms', 'start with the living room and dining area'),
      rooms: f(rooms('living', 'dining'), 'the living room and dining area'),
      locality: f('Aundh, Sunderban area', 'Aundh, Sunderban area'),
    },
    asked: ['intent', 'completion', 'completion_rephrase'],
  }),

  fx({
    id: 'W10',
    callDate: '2026-09-22',
    transcript: [
      A(S.greeting),
      C('Hi, wanted to explore options for my home. Do you have a brochure or portfolio?'),
      A('What kind of project are you thinking about?'),
      C("3BHK in Hinjewadi. But we're still early stage, just exploring."),
    ],
    fields: {
      intent: f('exploring', 'just exploring'),
      property_category: f('residential', '3BHK in Hinjewadi'),
      bhk: f(3, '3BHK in Hinjewadi'),
      locality: f('Hinjewadi', '3BHK in Hinjewadi'),
    },
  }),
];
