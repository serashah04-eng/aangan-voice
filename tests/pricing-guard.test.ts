import { describe, expect, it, vi } from 'vitest';
import { rulesConfig } from '../config/rules.config';
import { approvedPricingReply, guardAgentUtterance, pricingGuard } from '../src/guard/pricing-guard';

/**
 * NOTE: this file deliberately contains price-like strings as guard INPUTS. Test files are
 * outside the repo-wide pricing scan's scope (source, config, prompts and fixtures only).
 */
const APPROVED = rulesConfig.scripts.pricing.approved;
const quiet = { onBlock: () => {} };

describe('pricingGuard blocks', () => {
  it.each([
    ['It would be ₹12 lakh.', 'currency_amount'],
    ['Roughly Rs. 2,000 for that.', 'currency_amount'],
    ['That is 1500 rupees per day.', 'currency_amount'],
    ['Budget-wise think 8 to 10 lakh.', 'money_unit'],
    ['A full home is about 15L.', 'money_unit'],
    ['Somewhere near 50k.', 'money_unit'],
    ['It is a few lakh at most.', 'money_unit'],
    ['Something like 1.2 crore.', 'money_unit'],
    ['Our rate is 1,800 per sq ft.', 'per_area_rate'],
    ['We charge per square foot.', 'per_area_rate'],
    ['That works out to 2000/sq ft.', 'per_area_rate'],
    ['Kitchens start at 3,00,000.', 'starts_at'],
    ['Our packages start from a modest level.', 'cost_estimate'],
    ['It will be around 900000 all in.', 'approximate_figure'],
    ['A 2BHK typically costs a fair bit.', 'cost_estimate'],
    ['That would cost you more.', 'cost_estimate'],
    ['We are cheaper than most studios.', 'price_comparison'],
    ['I can email you our rate card.', 'rate_card'],
    ['The quote for the kitchen is 450000.', 'number_in_price_context'],
    ['यह 15 लाख होगा।', 'money_unit'],
    ['कुल खर्च रुपये 500000 होगा।', 'currency_amount'],
  ])('%s → %s', (text, reason) => {
    const r = pricingGuard(text, quiet);
    expect(r.blocked).toBe(true);
    expect(r.reasons).toContain(reason);
    expect(r.text).toBe(APPROVED);
  });

  it('replaces only the offending sentence and keeps the rest', () => {
    const r = pricingGuard('Thanks for that. It would be around 12 lakh. Which area of Pune is the property in?', quiet);
    expect(r.text).toBe(`Thanks for that. ${APPROVED} Which area of Pune is the property in?`);
    expect(r.blockedSentences).toEqual(['It would be around 12 lakh.']);
  });

  it('collapses several blocked sentences into one approved line', () => {
    const r = pricingGuard('It starts at ₹1,500 per sq ft. Typically costs around 10 lakh. Shall we book?', quiet);
    expect(r.text).toBe(`${APPROVED} Shall we book?`);
  });

  it('logs every block', () => {
    const onBlock = vi.fn();
    pricingGuard('That is 5 lakh.', { onBlock });
    expect(onBlock).toHaveBeenCalledWith({ reasons: ['money_unit'], blockedSentences: ['That is 5 lakh.'] });
  });
});

describe('pricingGuard lets through', () => {
  it.each([
    '10:30 AM, Saturday 4 October',
    "I've booked you for 10:30 AM, Saturday 4 October.",
    'We work from 10am to 7pm.',
    'Your 3BHK of about 1,400 sq ft in Baner sounds great.',
    'So that is roughly 6 weeks from now.',
    'Workstations for 20 people and 2 cabins, noted.',
    'Execution starts from November.',
    'The design phase takes 3 to 4 weeks.',
    'The villa is G+2, around 5,500 sq ft.',
    'The site visit starts at 11 am on 21 October.',
    'Is 2027 the year you want to move in?',
    'Which area of Pune is the property in?',
    rulesConfig.scripts.greeting,
    rulesConfig.scripts.budgetFail,
    ...Object.values(rulesConfig.scripts.questions),
    ...Object.values(rulesConfig.scripts.closing),
    approvedPricingReply({ leadQualified: true }),
    approvedPricingReply({ leadQualified: false, pushedAgain: true }),
  ])('%s', (text) => {
    const r = pricingGuard(text, quiet);
    expect(r).toMatchObject({ blocked: false, text });
  });
});

describe('approvedPricingReply', () => {
  it('adds the booking offer only for a currently qualified lead', () => {
    expect(approvedPricingReply({ leadQualified: false })).toBe(APPROVED);
    expect(approvedPricingReply({ leadQualified: true })).toBe(`${APPROVED} ${rulesConfig.scripts.pricing.bookingSuffix}`);
  });
  it('uses the push-back line when pushed again', () => {
    expect(approvedPricingReply({ leadQualified: true, pushedAgain: true })).toBe(rulesConfig.scripts.pricing.pushedAgain);
  });
});

describe('guardAgentUtterance (Q13 / Q9 phrases)', () => {
  it('removes "free consultation" / "no obligation"', () => {
    const r = guardAgentUtterance('Great. The consultation is free and there is no obligation. Shall I book it?', quiet);
    expect(r.text).toBe('Great. Shall I book it?');
    expect(r.removedForbidden).toHaveLength(1);
  });
  it('removes a promised callback time', () => {
    const r = guardAgentUtterance("I'm passing this on. Someone will call you back within 15 minutes.", quiet);
    expect(r.text).toBe("I'm passing this on.");
  });
  it('runs the pricing guard too', () => {
    expect(guardAgentUtterance('It is 5 lakh.', quiet).text).toBe(APPROVED);
  });
});
