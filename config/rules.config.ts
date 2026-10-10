/**
 * Every business threshold, list, alias and script line used by the rules engine,
 * the pricing guard and (later) the dialogue manager.
 *
 * To change a rule: edit the value here, bump RULES_CONFIG_VERSION, run `npm test`.
 * Founder decisions that are still open are tagged `// OPEN QUESTION Qn` with the
 * default currently coded. Q1–Q16 come from the build brief; Q17+ were found in Phase 0
 * (see docs/PHASE0_PLAN.md §2–§3).
 *
 * This file contains NO studio pricing. The single currency-like value (the C4 budget
 * floor) is a threshold for a caller-volunteered figure and carries the pricing-scan allow tag.
 */

export const RULES_CONFIG_VERSION = '1.0.0';

export const rulesConfig = {
  outcome: {
    // OPEN QUESTION Q1 — one clear fail on C1–C4 declines the lead. Default: true.
    // If set to false, a single fail routes to human review and two or more fails decline.
    declineOnSingleFail: true,
  },

  intent: {
    /** C1a fail intents (services.md "What we don't do"). */
    failIntents: ['advice_only', 'diy_execution', 'decor_only', 'vastu_only', 'sourcing_only'] as const,
    /** Interiors plus wall moves / structural work. */
    structuralState: 'escalate' as const,
  },

  residential: {
    /** Full home must be at least this many BHK to pass. */
    minFullHomeBhk: 2,
    // OPEN QUESTION Q7 — 1BHK full home → escalate. Default: escalate.
    belowMinFullHomeState: 'escalate' as const,
    /** A single one of these rooms passes on its own (services.md "Single room"). */
    singleRoomPass: ['bedroom', 'living'] as const,
    // OPEN QUESTION Q7 — kitchen-only, bathroom-only, wardrobe-only → escalate. Default: escalate.
    singleRoomQ7: ['kitchen', 'bathroom', 'wardrobe'] as const,
    singleRoomQ7State: 'escalate' as const,
    // OPEN QUESTION Q21 — any other single room alone (study, dining, puja, home office) → escalate.
    otherSingleRoomState: 'escalate' as const,
    /** Items that are part of a scope but are not a "room" when counting "2+ rooms". */
    nonRoomItems: ['wardrobe'] as const,
    /** A stated BHK with no narrower scope is treated as a full-home enquiry (W02, W05, T14). */
    bhkImpliesFullHome: true,
  },

  commercial: {
    passTypes: ['office', 'clinic', 'studio'] as const,
    failTypes: ['restaurant', 'hotel', 'retail', 'gym'] as const,
    /** Keywords mapped onto the canonical types above (checked as whole words). */
    typeKeywords: {
      restaurant: ['restaurant', 'cafe', 'café', 'bar', 'pub', 'eatery', 'cloud kitchen'],
      hotel: ['hotel', 'hospitality', 'resort', 'guest house', 'homestay', 'lodge'],
      retail: ['retail', 'shop', 'store', 'boutique', 'outlet'],
      gym: ['gym', 'fitness', 'crossfit'],
      office: ['office', 'workspace', 'corporate'],
      clinic: ['clinic', 'dental', 'dentist', 'physiotherapy'],
      studio: ['studio'],
    } as Record<string, readonly string[]>,
    /** Named commercial types that are explicitly NOT on either list (checked before passTypes). */
    unlistedKeywords: ['coworking', 'co-working', 'co working', 'salon', 'spa', 'showroom', 'school', 'hospital', 'warehouse'],
    minSqft: 500,
    maxSqft: 3000,
    // OPEN QUESTION Q6 — commercial outside 500–3,000 sq ft, or an unlisted type → escalate.
    outOfRangeState: 'escalate' as const,
    unlistedTypeState: 'escalate' as const,
  },

  serviceArea: {
    pune: [
      'kothrud', 'baner', 'aundh', 'wakad', 'koregaon park', 'kalyani nagar', 'viman nagar',
      'hadapsar', 'magarpatta', 'nibm', 'kondhwa', 'undri', 'shivane', 'warje', 'erandwane', 'deccan',
    ],
    pcmc: ['pimpri', 'chinchwad', 'pimple saudagar', 'pimple nilakh', 'ravet', 'hinjewadi'],
    /** alias (normalised, whole-word) → canonical listed locality. */
    aliases: {
      kp: 'koregaon park',
      'koregaon pk': 'koregaon park',
      kalyaninagar: 'kalyani nagar',
      vimannagar: 'viman nagar',
      hinjawadi: 'hinjewadi',
      hinjewadi: 'hinjewadi',
      'hinjewadi phase 1': 'hinjewadi',
      'hinjewadi phase 2': 'hinjewadi',
      'hinjewadi phase 3': 'hinjewadi',
      'pimple saudagar': 'pimple saudagar',
      'nibm road': 'nibm',
      'deccan gymkhana': 'deccan',
      'magarpatta city': 'magarpatta',
      kondwa: 'kondhwa',
    } as Record<string, string>,
    /** Named exclusions (services.md, qualified.md) → fail. */
    excluded: ['talegaon', 'lonavala', 'lonavla', 'nashik', 'mumbai', 'thane', 'navi mumbai'],
    /** Any other named city → fail ("or another named city"). */
    otherCities: [
      'bangalore', 'bengaluru', 'hyderabad', 'delhi', 'new delhi', 'gurgaon', 'gurugram', 'noida', 'chennai',
      'kolkata', 'ahmedabad', 'surat', 'nagpur', 'aurangabad', 'kolhapur', 'satara', 'sangli', 'solapur',
      'goa', 'indore', 'jaipur', 'nashik road', 'ahmednagar', 'baramati',
    ],
    /** Text made only of these words is "Pune only" → unknown, ask once. */
    genericWords: [
      'pune', 'pcmc', 'pimpri chinchwad', 'city', 'in', 'near', 'the', 'area', 'side', 'somewhere',
      'around', 'district', 'maharashtra', 'india', 'its', 'it', 'is', 'we', 'are', 'im', "i'm", 'i', 'am',
      'a', 'my', 'our', 'at', 'from', 'located', 'flat', 'apartment', 'home', 'house', 'villa', 'property',
      'office', 'bhk',
    ],
    // OPEN QUESTION Q5 — a named locality on neither list (e.g. Kharadi, Wagholi, Nanded City) → escalate.
    unlistedLocalityState: 'escalate' as const,
  },

  timeline: {
    /** Completion needed < 6 weeks after the call → fail (services.md minimum lead time). */
    failBelowDays: 42,
    // OPEN QUESTION Q4 — completion 6–20 weeks out → pass_tight (agent must not promise achievability).
    passFromDays: 140,
    tightState: 'pass_tight' as const,
    // OPEN QUESTION Q3 — site available more than 10 weeks after (call + buffer) → escalate.
    siteWindowDays: 70,
    siteLateState: 'escalate' as const,
    // OPEN QUESTION Q3a — consultation buffer. The brief's default was 7 days; 28 days (≈ design phase)
    // is the smallest value consistent with the CSV labels for F01, T20 (pass) and F06 (escalate).
    consultationBufferDays: 28,
    // OPEN QUESTION Q17 — a stated start / site-available time with no completion date → treat
    // completion as no_deadline (T15, W06, W01, T20, F10). Default: true.
    startOnlyImpliesNoDeadline: true,
    // OPEN QUESTION Q22 — "flexible", "no rush", "whenever" → no_deadline; a range → its upper bound.
    // (Extraction guidance; the extractor emits {kind:'no_deadline'} or the upper bound.)
    flexibleMeansNoDeadline: true,
    // OPEN QUESTION Q23 — a month-only START in the past (up to this many months back) → "now" (F09).
    pastStartLookbackMonths: 6,
  },

  // OPEN QUESTION Q24 — festival dates for relative-date resolution ("before Diwali").
  // Diwali 2026 = 8 Nov (Lakshmi Puja). Verify each year with the studio calendar.
  festivals: {
    diwali: ['2026-11-08', '2027-10-29'],
    ganesh_chaturthi: ['2026-09-14', '2027-09-04'],
  } as Record<string, readonly string[]>,

  budget: {
    // OPEN QUESTION Q2 — the ONLY budget fail is the founder's written example: a residential
    // full-home redesign with a volunteered maximum at or below this figure.
    fullHomeFloorInr: 150_000, // pricing-scan:allow Q2 threshold for a caller-volunteered figure, not a studio price
    // OPEN QUESTION Q20 — if C4 fail and C4 escalate both apply, fail wins (founder: address it on the call).
    failBeatsEscalate: true,
  },

  decider: {
    passRoles: ['owner', 'co_owner_with_consent', 'founder', 'authorised_rep', 'tenant_with_landlord_consent'] as const,
    // OPEN QUESTION Q19 — tenant with landlord consent counts as the decider (T11). Included above.
    // OPEN QUESTION Q8 — researching for someone else but the decider will attend → pass_with_note.
    deciderAttendsState: 'pass_with_note' as const,
  },

  dialogue: {
    /** Ask-only-what-is-missing order (brief §5). */
    askOrder: ['intent', 'scope', 'area_sqft', 'locality', 'completion', 'completion_rephrase', 'decider_attends', 'caller_name'] as const,
    // OPEN QUESTION Q11 — supported languages; anything else → offer a callback.
    languages: ['en', 'hi'] as const,
    // OPEN QUESTION Q10 — needs_more_information → front-desk follow-up task, no booking.
    needsMoreInfoBooking: false,
    /** Same number calling back within this window resumes the same record. */
    resumeWindowMinutes: 30,
  },

  escalation: {
    // OPEN QUESTION Q9 — no callback time is ever promised.
    slaPromise: null as string | null,
  },

  privacy: {
    // OPEN QUESTION Q12 — transcript retention.
    transcriptRetentionDays: 90,
  },

  integrations: {
    // OPEN QUESTION Q14 — Telegram primary, email fallback after this many failed attempts.
    notifyPrimary: 'telegram' as const,
    notifyFallback: 'email' as const,
    notifyFallbackAfterAttempts: 2,
    // OPEN QUESTION Q15 — not-qualified callers stay in Supabase only (no HubSpot contact or deal).
    // needs_more_information gets a contact (so the front desk can find them) but no deal.
    hubspotContactOutcomes: ['qualified', 'human_review_required', 'needs_more_information'] as const,
    hubspotDealOutcomes: ['qualified', 'human_review_required'] as const,
    // OPEN QUESTION Q28 — HubSpot deal stage per outcome (default sales pipeline stage IDs).
    hubspotPipeline: 'default',
    hubspotDealStage: {
      qualified: 'qualifiedtobuy',
      human_review_required: 'appointmentscheduled',
    } as Record<string, string>,
    // OPEN QUESTION Q16 — calendar provider and designer assignment.
    calendarProvider: 'calcom' as const,
    designerAssignment: 'front_desk' as const,
  },

  calendar: {
    timeZone: 'Asia/Kolkata',
    /** How far ahead to look for consultation slots, and how many to offer on the call. */
    lookaheadDays: 14,
    slotsToOffer: 3,
    // OPEN QUESTION Q27 — Cal.com requires an attendee email, but the agent never collects email
    // on the call (brief §8). Default: book with the studio front-desk inbox (env
    // CALENDAR_ATTENDEE_EMAIL) and put the caller's name and phone in the booking notes.
  },

  outbox: {
    maxAttempts: 5,
    /** Exponential backoff: base × 2^(attempt−1), capped. */
    backoffBaseSeconds: 60,
    backoffMaxSeconds: 3600,
    /** S22: alert the studio head once an integration has failed this many times for one job. */
    alertAfterFailures: 3,
  },

  hours: {
    /** Front-desk hours (IST) — used for the after-hours share on the dashboard. */
    openHour: 10,
    closeHour: 19,
  },

  scripts: {
    // OPEN QUESTION Q12 — disclosure wording.
    greeting:
      "Hello, Aangan Studio. I'm the studio's virtual assistant — this call is recorded so our designers have your details. How can I help?",
    pricing: {
      approved:
        'Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation.',
      /** Appended ONLY when the lead is currently Qualified. */
      bookingSuffix: "I can book that for you right now if you'd like.",
      pushedAgain:
        "I understand. I'm not able to give a figure — any number without seeing the site wouldn't be accurate. The designer will cover it properly.",
    },
    budgetFail:
      "Thank you for being upfront. For a full redesign with execution, that's well below what a project like this involves with us, and I wouldn't want to waste your time with a consultation.",
    questions: {
      intent: 'Are you looking for us to design and carry out the work?',
      scope: 'Which rooms or spaces would you like us to work on?',
      area_sqft: 'Roughly how large is the space, in square feet?',
      locality: 'Which area of Pune is the property in?',
      completion: 'When would you need the project complete?',
      completion_rephrase:
        'Would that be within the next three months, within six months, or is there no fixed date?',
      decider_attends: 'Will the person deciding on the project be able to attend the consultation?',
      caller_name: 'May I have your name, please?',
    },
    closing: {
      notQualified:
        'This sounds like it may not be the right fit for us right now — but please do reach out if your timeline or scope changes.',
      needsMoreInfo: 'No problem — someone from our team will be in touch to fill in the rest. Is this number best?',
      escalation:
        "I'm sorry about this. I'm passing it to a senior member of the team now, and they'll call you back.",
      unsupportedLanguage:
        "I'm sorry, I can only help in English or Hindi on this line. Someone from our team will call you back.",
    },
    booking: {
      offer: 'I can book a consultation with one of our designers. I have {slots}. Would any of those work?',
      confirmed: "You're booked for {slot}. Our designer will see you then.",
      slotTaken: 'That time was just taken — the next one I have is {slot}. Would that work?',
      failed: "I wasn't able to lock that in just now — someone from our team will confirm a time with you.",
      pending: "No problem — I've noted your preference, and our team will be in touch to find a time that suits you.",
      whichOne: 'Which of those suits you best — the first, second or third?',
    },
    conversation: {
      ack: 'Got it.',
      retry: 'Sorry, could you say that again?',
      goodbye: 'Thank you for calling Aangan Studio. Goodbye!',
      notApplicable: "Thanks for calling Aangan Studio — I'll pass your message on to the team.",
      resume: "Welcome back — let's pick up where we left off.",
      technicalTrouble: "I'm sorry, I'm having a little technical trouble. Someone from our team will call you back.",
    },
    // OPEN QUESTION Q13 — phrases the agent must never say. Enforced by the output guard.
    neverSay: ['free consultation', 'consultation is free', 'no obligation', 'free of cost', 'free of charge'],
  },

  voice: {
    /** Max consecutive model failures in one call before closing gracefully. */
    maxModelFailuresPerCall: 2,
    /** Keep-alive ping interval on the Vaani BYOL socket. */
    pingSeconds: 20,
    /** Answer the caller in Hindi when the extractor says the caller speaks Hindi (Q11). */
    replyInHindi: true,
  },
} as const;

/**
 * Hindi versions of every spoken line (Q11: English and Hindi). Same keys as `rulesConfig.scripts`
 * (minus `neverSay`). Reviewed for meaning, not legal wording — have a native speaker check before launch.
 */
export const scriptsHi = {
  greeting:
    'नमस्ते, आँगन स्टूडियो। मैं स्टूडियो की वर्चुअल असिस्टेंट हूँ — यह कॉल रिकॉर्ड हो रही है ताकि हमारे डिज़ाइनर्स के पास आपकी जानकारी रहे। मैं आपकी कैसे मदद कर सकती हूँ?',
  pricing: {
    approved: 'कीमत साइट, आपके चुने हुए मटीरियल और काम के दायरे पर निर्भर करती है — कंसल्टेशन में आपके डिज़ाइनर आपको इसकी पूरी जानकारी देंगे।',
    bookingSuffix: 'अगर आप चाहें तो मैं अभी कंसल्टेशन बुक कर सकती हूँ।',
    pushedAgain: 'मैं समझती हूँ। मैं कोई आँकड़ा नहीं बता सकती — साइट देखे बिना कोई भी संख्या सही नहीं होगी। डिज़ाइनर इसे ठीक से समझाएँगे।',
  },
  budgetFail:
    'खुलकर बताने के लिए धन्यवाद। पूरे रीडिज़ाइन और काम के लिए यह हमारे यहाँ ऐसे प्रोजेक्ट से काफ़ी कम है, और मैं नहीं चाहूँगी कि कंसल्टेशन में आपका समय बर्बाद हो।',
  questions: {
    intent: 'क्या आप चाहते हैं कि हम डिज़ाइन करें और काम भी पूरा करवाएँ?',
    scope: 'आप किन कमरों या जगहों पर काम करवाना चाहते हैं?',
    area_sqft: 'जगह लगभग कितने स्क्वेयर फ़ीट की है?',
    locality: 'प्रॉपर्टी पुणे के किस इलाके में है?',
    completion: 'आपको प्रोजेक्ट कब तक पूरा चाहिए?',
    completion_rephrase: 'क्या यह अगले तीन महीनों में, छह महीनों में, या कोई तय तारीख नहीं है?',
    decider_attends: 'क्या प्रोजेक्ट का फ़ैसला लेने वाले व्यक्ति कंसल्टेशन में आ पाएँगे?',
    caller_name: 'क्या मैं आपका नाम जान सकती हूँ?',
  },
  closing: {
    notQualified: 'लगता है कि अभी यह हमारे लिए सही प्रोजेक्ट नहीं है — लेकिन अगर आपका समय या काम का दायरा बदले तो ज़रूर संपर्क करें।',
    needsMoreInfo: 'कोई बात नहीं — हमारी टीम से कोई बाकी जानकारी के लिए आपसे संपर्क करेगा। क्या यही नंबर ठीक है?',
    escalation: 'मुझे इसके लिए खेद है। मैं इसे अभी टीम के एक वरिष्ठ सदस्य को दे रही हूँ, और वे आपको वापस कॉल करेंगे।',
    unsupportedLanguage: "I'm sorry, I can only help in English or Hindi on this line. Someone from our team will call you back.",
  },
  booking: {
    offer: 'मैं हमारे डिज़ाइनर के साथ कंसल्टेशन बुक कर सकती हूँ। मेरे पास {slots} हैं। क्या इनमें से कोई समय ठीक रहेगा?',
    confirmed: 'आपका कंसल्टेशन {slot} के लिए बुक हो गया है।',
    slotTaken: 'वह समय अभी-अभी बुक हो गया — अगला समय {slot} है। क्या यह ठीक रहेगा?',
    failed: 'मैं अभी यह बुक नहीं कर पाई — हमारी टीम से कोई आपके साथ समय तय करेगा।',
    pending: 'कोई बात नहीं — मैंने आपकी पसंद नोट कर ली है, और हमारी टीम आपके लिए सही समय तय करने के लिए संपर्क करेगी।',
    whichOne: 'इनमें से कौन सा समय आपके लिए सबसे ठीक है — पहला, दूसरा या तीसरा?',
  },
  conversation: {
    ack: 'ठीक है।',
    retry: 'माफ़ कीजिए, क्या आप फिर से बता सकते हैं?',
    goodbye: 'आँगन स्टूडियो को कॉल करने के लिए धन्यवाद। नमस्ते!',
    notApplicable: 'कॉल करने के लिए धन्यवाद। मैं आपका संदेश टीम तक पहुँचा दूँगी।',
    resume: 'फिर से स्वागत है — चलिए वहीं से आगे बढ़ते हैं।',
    technicalTrouble: 'माफ़ कीजिए, अभी मुझे थोड़ी तकनीकी दिक्कत हो रही है। हमारी टीम से कोई आपको वापस कॉल करेगा।',
  },
} as const;

export type ScriptSet = Omit<typeof rulesConfig.scripts, 'neverSay'>;

export type RulesConfig = typeof rulesConfig;
