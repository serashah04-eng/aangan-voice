import { describe, expect, it } from 'vitest';
import type { AskableField } from '../../src/domain/types';
import { evaluate } from '../../src/rules/engine';
import { casesById } from '../fixtures/cases';
import { CALL, ext, qualifiedLead } from './builders';

const next = (x: ReturnType<typeof ext>, asked: AskableField[] = []) => evaluate(x, { callDate: CALL, asked }).next;

describe('next step: ask only what is missing, in order, once', () => {
  it('asks scope (C1) before locality (C2) before completion (C3) before name', () => {
    const x = ext({});
    expect(next(x)).toEqual({ next: 'ask', field: 'intent' });
    expect(next(x, ['intent'])).toEqual({ next: 'ask', field: 'scope' });
    expect(next(x, ['intent', 'scope'])).toEqual({ next: 'ask', field: 'locality' });
    expect(next(x, ['intent', 'scope', 'locality'])).toEqual({ next: 'ask', field: 'completion' });
    expect(next(x, ['intent', 'scope', 'locality', 'completion'])).toEqual({ next: 'ask', field: 'completion_rephrase' });
    expect(next(x, ['intent', 'scope', 'locality', 'completion', 'completion_rephrase'])).toEqual({ next: 'ask', field: 'caller_name' });
    expect(next(x, ['intent', 'scope', 'locality', 'completion', 'completion_rephrase', 'caller_name'])).toEqual({
      next: 'close',
      outcome: 'needs_more_information',
    });
  });

  it('never re-asks a filled field', () => {
    expect(next(qualifiedLead())).toEqual({ next: 'close', outcome: 'qualified' });
  });

  it('asks commercial area when the type is known but the size is not', () => {
    expect(next(ext({ intent: 'design_and_execution', property_category: 'commercial', commercial_type: 'office' }))).toEqual({
      next: 'ask',
      field: 'area_sqft',
    });
  });

  it('stops asking as soon as the outcome is certain', () => {
    expect(next(ext({ locality: 'Nashik' }))).toEqual({ next: 'close', outcome: 'not_qualified' });
    expect(next(ext({ service_complaint: true }))).toEqual({ next: 'close', outcome: 'human_review_required' });
    expect(next(ext({ locality: 'Kharadi' }))).toEqual({ next: 'close', outcome: 'human_review_required' });
  });

  it('asks the one permitted decider question before escalating on C5 alone', () => {
    const x = qualifiedLead({ caller_role: 'researching_for_other' });
    expect(next(x)).toEqual({ next: 'ask', field: 'decider_attends' });
    expect(next(x, ['decider_attends'])).toEqual({ next: 'close', outcome: 'human_review_required' });
  });
});

describe('next step on the fixture calls', () => {
  it.each([
    ['T03', { next: 'close', outcome: 'not_qualified' }],
    ['T09', { next: 'close', outcome: 'human_review_required' }],
    ['S06', { next: 'ask', field: 'locality' }],
    ['S07', { next: 'ask', field: 'caller_name' }],
    ['T13', { next: 'ask', field: 'caller_name' }],
    ['T01', { next: 'close', outcome: 'qualified' }],
  ] as const)('%s → %j', (id, want) => {
    const c = casesById.get(id)!;
    expect(evaluate(c.extraction, { callDate: c.callDate, asked: c.asked }).next).toEqual(want);
  });
});
