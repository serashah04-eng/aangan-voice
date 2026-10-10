import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/rules/engine';
import { addDays } from '../../src/rules/dates';
import { CALL, ext, qualifiedLead } from './builders';

const ev = (x: ReturnType<typeof ext>) => evaluate(x, { callDate: CALL });

describe('C1a intent', () => {
  it.each(['advice_only', 'diy_execution', 'decor_only', 'vastu_only', 'sourcing_only'] as const)('%s → fail', (intent) => {
    expect(ev(qualifiedLead({ intent })).criteria.C1a.state).toBe('fail');
  });
  it('structural work → escalate', () => {
    expect(ev(qualifiedLead({ structural_work: true })).criteria.C1a.state).toBe('escalate');
  });
  it('explicit "no structural changes" does not escalate', () => {
    expect(ev(qualifiedLead({ structural_work: false })).criteria.C1a.state).toBe('pass');
  });
  it('"just exploring" and not stated → unknown', () => {
    expect(ev(qualifiedLead({ intent: 'exploring' })).criteria.C1a.state).toBe('unknown');
    expect(ev(ext({ bhk: 2 })).criteria.C1a.state).toBe('unknown');
  });
});

describe('C1b scope', () => {
  const res = (o: Parameters<typeof qualifiedLead>[0]) => ev(qualifiedLead(o)).criteria.C1b;

  it('full home 2BHK+ passes; 1BHK full home escalates (Q7)', () => {
    expect(res({ bhk: 2 }).state).toBe('pass');
    expect(res({ bhk: 1 }).state).toBe('escalate');
  });
  it('full floor passes', () => {
    expect(res({ scope_kind: 'full_floor' }).state).toBe('pass');
  });
  it('two or more rooms pass, wardrobes do not count as a room', () => {
    expect(res({ scope_kind: 'rooms', rooms: ['kitchen', 'bedroom'] }).state).toBe('pass');
    expect(res({ scope_kind: 'rooms', rooms: ['kitchen', 'wardrobe'] }).state).toBe('escalate');
  });
  it('single bedroom or living room passes', () => {
    expect(res({ scope_kind: 'rooms', rooms: ['bedroom'] }).state).toBe('pass');
    expect(res({ scope_kind: 'rooms', rooms: ['living'] }).state).toBe('pass');
  });
  it.each(['kitchen', 'bathroom', 'wardrobe'] as const)('%s only → escalate (Q7)', (room) => {
    expect(res({ scope_kind: 'rooms', rooms: [room] }).state).toBe('escalate');
  });
  it('other single room → escalate (Q21)', () => {
    expect(res({ scope_kind: 'rooms', rooms: ['study'] })).toMatchObject({ state: 'escalate', ruleId: 'C1b.ESCALATE_OTHER_SINGLE_ROOM' });
  });
  it('BHK with no narrower scope is treated as full home', () => {
    expect(ev(ext({ bhk: 2 })).criteria.C1b).toMatchObject({ state: 'pass', ruleId: 'C1b.PASS_FULL_HOME_FROM_BHK' });
  });
  it('nothing about the project → unknown', () => {
    expect(ev(ext({})).criteria.C1b.state).toBe('unknown');
  });

  describe('commercial', () => {
    const com = (commercial_type: string, area_sqft?: number) =>
      ev(ext({ property_category: 'commercial', commercial_type, ...(area_sqft ? { area_sqft } : {}) })).criteria.C1b;

    it.each([
      [499, 'escalate'],
      [500, 'pass'],
      [3000, 'pass'],
      [3001, 'escalate'],
    ] as const)('office of %i sq ft → %s', (area, state) => {
      expect(com('office', area).state).toBe(state);
    });
    it('clinic and studio pass in range', () => {
      expect(com('dental clinic', 900).state).toBe('pass');
      expect(com('photography studio', 1200).state).toBe('pass');
    });
    it('area not stated → unknown', () => {
      expect(com('office').state).toBe('unknown');
    });
    it.each(['restaurant', 'hotel', 'retail store', 'gym', 'cafe'])('%s → fail', (t) => {
      expect(com(t, 1500).state).toBe('fail');
    });
    it.each(['coworking space', 'salon', 'showroom', 'warehouse'])('%s → escalate (Q6)', (t) => {
      expect(com(t, 1500).state).toBe('escalate');
    });
  });
});

describe('C2 service area', () => {
  const c2 = (locality: string) => ev(qualifiedLead({ locality })).criteria.C2.state;

  it.each(['Kothrud', 'koregaon park', 'KP', 'Hinjewadi Phase 1', 'NIBM Road', 'Pimple Saudagar', 'Magarpatta, Cybercity area', 'Aundh, Sunderban area'])(
    '%s → pass',
    (l) => expect(c2(l)).toBe('pass'),
  );
  it.each(['Talegaon Dabhade, near Pune', 'Lonavala', 'Nashik', 'Mumbai', 'Bangalore'])('%s → fail', (l) =>
    expect(c2(l)).toBe('fail'),
  );
  it.each(['Pune', 'Pune city', 'somewhere in Pune', 'PCMC', 'a 3BHK in Pune'])('%s → unknown (ask once)', (l) =>
    expect(c2(l)).toBe('unknown'),
  );
  it.each(['Kharadi', 'Wagholi', 'Nanded City'])('%s → escalate (Q5)', (l) => expect(c2(l)).toBe('escalate'));
  it('"KP" only matches as a whole word', () => {
    expect(c2('Kpcl colony')).toBe('escalate');
  });
});

describe('C3 timeline (days from the call date)', () => {
  const c3 = (completion: object, site?: object) =>
    ev(qualifiedLead({ completion: completion as never, ...(site ? { site_available: site as never } : {}) })).criteria.C3;
  const deadlineIn = (days: number) => ({ kind: 'date', date: addDays(CALL, days) });

  it.each([
    [41, 'fail'],
    [42, 'pass_tight'],
    [139, 'pass_tight'],
    [140, 'pass'],
  ] as const)('deadline in %i days → %s', (days, state) => {
    expect(c3(deadlineIn(days)).state).toBe(state);
  });
  it('no deadline → pass', () => {
    expect(c3({ kind: 'no_deadline' }).state).toBe('pass');
  });
  it('site available at the window edge passes; one day later escalates (Q3, buffer 28 + 70)', () => {
    expect(c3({ kind: 'no_deadline' }, { kind: 'date', date: addDays(CALL, 98) }).state).toBe('pass');
    expect(c3({ kind: 'no_deadline' }, { kind: 'date', date: addDays(CALL, 99) }).state).toBe('escalate');
  });
  it('start only, no completion → pass via Q17', () => {
    const x = qualifiedLead({ site_available: { kind: 'now' } });
    x.fields.completion = { value: 'unknown', quote: null, turn: null };
    const r = ev(x).criteria.C3;
    expect(r).toMatchObject({ state: 'pass', ruleId: 'C3.PASS_START_ONLY_NO_DEADLINE_Q17' });
  });
  it('nothing about timing → unknown', () => {
    const x = qualifiedLead();
    x.fields.completion = { value: 'unknown', quote: null, turn: null };
    expect(ev(x).criteria.C3.state).toBe('unknown');
  });
  it('a too-short deadline fails even if the site is late', () => {
    expect(c3(deadlineIn(20), { kind: 'date', date: addDays(CALL, 200) }).state).toBe('fail');
  });
});

describe('C4 budget', () => {
  const c4 = (budget_raw?: string, more: Parameters<typeof qualifiedLead>[0] = {}) =>
    ev(qualifiedLead({ ...(budget_raw ? { budget_raw } : {}), ...more })).criteria.C4;

  it('not mentioned by default', () => expect(c4().state).toBe('not_mentioned'));
  it('no figure in the words → not_mentioned', () => expect(c4('budget bhi hai').state).toBe('not_mentioned'));
  it('full home at or below the written example → fail (Q2)', () => {
    expect(c4('Rs 1 lakh for the whole flat').state).toBe('fail');
    expect(c4('1 to 1.5 lakh maximum').state).toBe('fail');
    expect(c4('dedh lakh').state).toBe('fail');
  });
  it('just above the written example → pass_with_note', () => {
    expect(c4('1.6 lakh').state).toBe('pass_with_note');
  });
  it('same figure on a partial scope is not a fail', () => {
    expect(c4('1 lakh', { scope_kind: 'rooms', rooms: ['kitchen', 'bedroom'] }).state).toBe('pass_with_note');
  });
  it('volunteered + "is that enough?" → escalate', () => {
    expect(c4('20 lakh', { budget_feasibility_asked: true }).state).toBe('escalate');
  });
  it('fail beats escalate when both apply (Q20)', () => {
    expect(c4('1 lakh', { budget_feasibility_asked: true }).state).toBe('fail');
  });
  it('carries the figure verbatim in the note', () => {
    expect(c4('around 25 lakh, flexible').note).toContain('around 25 lakh, flexible');
  });
});

describe('C5 decider', () => {
  const c5 = (o: Parameters<typeof qualifiedLead>[0]) => ev(qualifiedLead(o)).criteria.C5.state;
  it.each(['owner', 'co_owner_with_consent', 'founder', 'authorised_rep', 'tenant_with_landlord_consent'] as const)('%s → pass', (r) =>
    expect(c5({ caller_role: r })).toBe('pass'),
  );
  it('researching and the decider will attend → pass_with_note (Q8)', () => {
    expect(c5({ caller_role: 'researching_for_other', decider_attends: true })).toBe('pass_with_note');
  });
  it('researching and cannot say → escalate', () => {
    expect(c5({ caller_role: 'researching_for_other' })).toBe('escalate');
    expect(c5({ caller_role: 'researching_for_other', decider_attends: false })).toBe('escalate');
  });
  it('not stated → unknown, and the lead still qualifies', () => {
    const r = ev(qualifiedLead());
    expect(r.criteria.C5.state).toBe('unknown');
    expect(r.outcome).toBe('qualified');
  });
});

describe('overrides and outcome precedence', () => {
  it('X1 existing client complaint → human review even if everything passes', () => {
    const r = ev(qualifiedLead({ existing_client_complaint: true }));
    expect(r.triggers.map((t) => t.trigger)).toEqual(['X1']);
    expect(r.outcome).toBe('human_review_required');
  });
  it('X2 explicit request for a human', () => {
    expect(ev(qualifiedLead({ human_requested: true })).outcome).toBe('human_review_required');
  });
  it('X3 contradiction', () => {
    const x = qualifiedLead();
    x.contradictions = [{ field: 'locality', quotes: ['in Baner', 'in Wakad'] }];
    expect(ev(x).triggers.map((t) => t.trigger)).toEqual(['X3']);
  });
  it('X3 when the quote validator failed twice on one field', () => {
    const x = qualifiedLead();
    x.validatorFailures = { locality: 2 };
    expect(ev(x)).toMatchObject({ outcome: 'human_review_required', triggers: [{ trigger: 'X3' }] });
  });
  it('escalate outranks fail', () => {
    expect(ev(qualifiedLead({ locality: 'Mumbai', structural_work: true })).outcome).toBe('human_review_required');
  });
  it('fail outranks unknown', () => {
    expect(ev(ext({ locality: 'Nashik' })).outcome).toBe('not_qualified');
  });
  it('non-enquiry calls are not_applicable', () => {
    expect(ev(ext({ call_type: 'other' })).outcome).toBe('not_applicable');
  });
  it('the model suggested outcome is ignored', () => {
    const x = qualifiedLead({ locality: 'Nashik' });
    x.modelSuggestedOutcome = 'qualified';
    expect(ev(x).outcome).toBe('not_qualified');
  });
  it('is deterministic and stamps versions', () => {
    const a = evaluate(qualifiedLead(), { callDate: CALL, rulesVersion: 'abc123' });
    const b = evaluate(qualifiedLead(), { callDate: CALL, rulesVersion: 'abc123' });
    expect(a).toEqual(b);
    expect(a.rulesVersion).toBe('abc123');
    expect(a.configVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
