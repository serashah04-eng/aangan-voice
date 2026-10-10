import { describe, expect, it } from 'vitest';
import { validateQuotes } from '../src/extraction/quote-validator';
import { guardAgentUtterance } from '../src/guard/pricing-guard';
import { evaluate } from '../src/rules/engine';
import { casesById, s20 } from './fixtures/cases';
import { loadTestCases } from './fixtures/csv';
import { CRITERION_COLUMNS, LABEL_CORRECTIONS, SKIP_OUTCOMES } from './fixtures/label-corrections';

/**
 * Acceptance: every labelled row of aangan_test_cases.csv. For each row we check the
 * final outcome, every NON-BLANK per-criterion cell, and the X triggers.
 * Rows whose expected_outcome is no_label / unchanged / field_unknown / per_content belong
 * to later phases (brief §7) and are skipped here.
 */


const rows = loadTestCases();
const assertable = rows.filter((r) => !SKIP_OUTCOMES.has(r.expected_outcome!));

describe('CSV coverage', () => {
  it('has 62 rows, 54 of them outcome-assertable', () => {
    expect(rows).toHaveLength(62);
    expect(assertable).toHaveLength(54);
  });

  it('has a fixture for every assertable row', () => {
    const missing = assertable.map((r) => r.case_id!).filter((id) => !casesById.has(id));
    expect(missing).toEqual([]);
  });

  it('only has fixtures for rows that exist in the CSV', () => {
    const ids = new Set(rows.map((r) => r.case_id));
    expect([...casesById.keys()].filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe.each(assertable.map((r) => [r.case_id!, r] as const))('%s', (id, row) => {
  const fixture = casesById.get(id)!;

  it('fixture call date matches the CSV enquiry date', () => {
    expect(fixture.callDate).toBe(row.enquiry_date);
  });

  it('every extracted field quote is verbatim in a caller turn', () => {
    const { rejected } = validateQuotes(fixture.extraction, fixture.transcript);
    expect(rejected).toEqual([]);
  });

  it('every agent line passes the output guard unchanged', () => {
    for (const t of fixture.transcript.filter((t) => t.speaker === 'agent')) {
      const g = guardAgentUtterance(t.text, { onBlock: () => {} });
      expect({ line: t.text, blocked: g.blocked, removed: g.removedForbidden }).toEqual({
        line: t.text,
        blocked: false,
        removed: [],
      });
    }
  });

  const run = () => {
    const { extraction } = validateQuotes(fixture.extraction, fixture.transcript);
    return evaluate(extraction, { callDate: fixture.callDate, asked: fixture.asked });
  };

  it(`outcome = ${row.expected_outcome}`, () => {
    expect(run().outcome).toBe(row.expected_outcome);
  });

  for (const [column, criterion] of Object.entries(CRITERION_COLUMNS)) {
    const labelled = row[column];
    if (!labelled) continue;
    const correction = LABEL_CORRECTIONS[id]?.[criterion];
    const expected = correction?.state ?? labelled;
    it(`${criterion} = ${expected}${correction ? ` (CSV says ${labelled}; ${correction.why})` : ''}`, () => {
      const r = run().criteria[criterion];
      expect({ state: r.state, rule: r.ruleId }).toMatchObject({ state: expected });
    });
  }

  it(`triggers include ${row.x_triggers || 'none'}`, () => {
    const got = run().triggers.map((t) => t.trigger);
    const want = row.x_triggers ? row.x_triggers.split(/[;,]/).map((s) => s.trim().slice(0, 2)) : [];
    if (want.length === 0) expect(got).toEqual([]);
    else for (const w of want) expect(got).toContain(w);
  });
});

describe('S20 — hallucinated field is rejected by the quote validator', () => {
  it('drops the locality the caller never said and leaves C2 unknown', () => {
    const { extraction, rejected } = validateQuotes(s20.extraction, s20.transcript);
    expect(rejected).toEqual([{ field: 'locality', quote: 'Baner', reason: 'quote_not_in_transcript' }]);
    expect(extraction.fields.locality.value).toBe('unknown');
    expect(extraction.validatorFailures.locality).toBe(1);
    const r = evaluate(extraction, { callDate: s20.callDate });
    expect(r.criteria.C2.state).toBe('unknown');
    expect(r.outcome).toBe('needs_more_information');
    expect(r.next).toEqual({ next: 'ask', field: 'locality' });
  });
});
