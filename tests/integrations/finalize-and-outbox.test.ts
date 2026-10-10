import { describe, expect, it } from 'vitest';
import { backoffSeconds, processOutbox } from '../../src/services/outbox';
import { isAfterHours } from '../../src/services/finalize-call';
import { findResumableCall } from '../../src/services/resume';
import { finalizeFixture, PHONE, world } from './helpers';

describe('finalizeCall: Supabase is written first, external work only queued', () => {
  it('qualified (T01): call, turns, lead, evidence; queues HubSpot + designer handoff', async () => {
    const { store } = world();
    const r = await finalizeFixture(store, 'T01');
    expect(r.evaluation.outcome).toBe('qualified');
    const call = await store.getCall(r.callId);
    expect(call).toMatchObject({ outcome: 'qualified', lead_id: r.leadId, status: 'completed', duration_s: 300, rules_version: 'test-sha' });
    expect(store.turns.size).toBe(casesById_len('T01'));
    expect(store.leads.get(r.leadId!)).toMatchObject({ phone_e164: PHONE, name: 'Priya', latest_outcome: 'qualified', locality_raw: 'Kothrud, Dahanukar Colony' });
    expect(store.evidence.filter((e) => e.call_id === r.callId).map((e) => e.criterion)).toEqual(['C1a', 'C1b', 'C2', 'C3', 'C4', 'C5']);
    expect(store.evidence.find((e) => e.criterion === 'C3')).toMatchObject({ state: 'pass', follow_up_asked: true, evidence_quote: 'done by March' });
    expect(r.jobsQueued).toEqual(['hubspot_sync', 'designer_handoff']);
    expect(store.followups).toEqual([]);
  });

  it('human review (T09): evidence includes the X trigger; queues HubSpot + escalation alert', async () => {
    const { store } = world();
    const r = await finalizeFixture(store, 'T09');
    expect(r.jobsQueued).toEqual(['hubspot_sync', 'escalation_alert']);
    expect(store.evidence.filter((e) => e.state === 'triggered').map((e) => e.criterion)).toContain('X1');
  });

  it('needs more information (T13): HubSpot contact only + a front-desk task listing what is missing', async () => {
    const { store } = world();
    const r = await finalizeFixture(store, 'T13');
    expect(r.jobsQueued).toEqual(['hubspot_sync']);
    expect(store.followups).toHaveLength(1);
    expect(store.followups[0]).toMatchObject({ reason: 'needs_more_information', missing_fields: ['completion date'] });
  });

  it('not qualified (T03): stays in Supabase only — nothing queued (Q15)', async () => {
    const { store } = world();
    const r = await finalizeFixture(store, 'T03');
    expect(r.evaluation.outcome).toBe('not_qualified');
    expect(r.jobsQueued).toEqual([]);
    expect(store.jobs.size).toBe(0);
    expect(store.leads.size).toBe(1);
  });

  it('is idempotent: finalising the same call twice duplicates nothing', async () => {
    const { store } = world();
    await finalizeFixture(store, 'T01', { callId: '11111111-1111-4111-8111-111111111111' });
    const again = await finalizeFixture(store, 'T01', { callId: '11111111-1111-4111-8111-111111111111' });
    expect(again.jobsQueued).toEqual([]);
    expect(store.jobs.size).toBe(2);
    expect(store.evidence).toHaveLength(6);
    expect(store.leads.size).toBe(1);
  });

  it('one lead per phone number across calls', async () => {
    const { store } = world();
    await finalizeFixture(store, 'T13', { callId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    await finalizeFixture(store, 'T01', { callId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    expect(store.leads.size).toBe(1);
    expect([...store.leads.values()][0]!.latest_outcome).toBe('qualified');
  });

  it('after-hours flag uses IST studio hours', () => {
    expect(isAfterHours('2026-10-10T04:29:00Z')).toBe(true); // 09:59 IST
    expect(isAfterHours('2026-10-10T04:30:00Z')).toBe(false); // 10:00 IST
    expect(isAfterHours('2026-10-10T13:29:00Z')).toBe(false); // 18:59 IST
    expect(isAfterHours('2026-10-10T13:30:00Z')).toBe(true); // 19:00 IST
  });
});

describe('outbox processing', () => {
  it('qualified lead: HubSpot contact + deal at the mapped stage, designer gets the full handoff on Telegram', async () => {
    const { store, deps } = world();
    const r = await finalizeFixture(store, 'T02');
    const report = await processOutbox(deps);
    expect(report).toEqual({ claimed: 2, done: 2, retried: 0, dead: 0 });

    const lead = store.leads.get(r.leadId!)!;
    expect(lead.hubspot_contact_id).toBeTruthy();
    const deal = deps.crm.deals.get(lead.hubspot_deal_id!)!;
    expect(deal).toMatchObject({ stage: 'qualifiedtobuy', pipeline: 'default', contactId: lead.hubspot_contact_id });

    expect(deps.telegram.sent).toHaveLength(1);
    const { to, message } = deps.telegram.sent[0]!;
    expect(to).toBe('designers');
    for (const must of [PHONE, 'Wakad', 'residential — 2BHK', 'full home', 'TIGHT TIMELINE', 'Asked about price: yes (2×)', 'Budget (caller\'s words): not mentioned', `/dashboard/calls/${r.callId}`]) {
      expect(message.body).toContain(must);
    }
    expect([...store.handoffs.values()][0]).toMatchObject({ kind: 'designer', channel: 'telegram', status: 'sent' });
  });

  it('volunteered budget is passed to the designer verbatim (F05)', async () => {
    const { store, deps } = world();
    await finalizeFixture(store, 'F05');
    await processOutbox(deps);
    expect(deps.telegram.sent[0]!.message.body).toContain('"₹60–80 lakh all-in, including furniture"');
  });

  it('escalation goes to the studio head and promises no callback time (Q9)', async () => {
    const { store, deps } = world();
    await finalizeFixture(store, 'T10');
    await processOutbox(deps);
    const msg = deps.telegram.sent.find((s) => s.to === 'studio-head')!.message;
    expect(msg.subject).toMatch(/^Escalation/);
    expect(msg.body).toContain('No time was promised');
    expect(msg.body).toMatch(/Kharadi.*neither list/);
  });

  it('Q14: Telegram fails twice → the third attempt goes by email', async () => {
    const { store, deps, clock } = world();
    await finalizeFixture(store, 'T01');
    deps.telegram.failNext = 2;
    await processOutbox(deps); // attempt 1 fails (hubspot ok)
    clock.advance(backoffSeconds(1));
    await processOutbox(deps); // attempt 2 fails
    clock.advance(backoffSeconds(2));
    const r3 = await processOutbox(deps); // attempt 3 → email
    expect(r3.done).toBe(1);
    expect(deps.email.sent).toHaveLength(1);
    expect(deps.email.sent[0]!.to).toBe('designer@example.test');
    expect([...store.handoffs.values()][0]).toMatchObject({ channel: 'email', status: 'sent', attempts: 3 });
    expect(store.errors.filter((e) => e.service === 'telegram')).toHaveLength(2);
  });

  it('S22: HubSpot down → retries with backoff, alert after 3 failures, Supabase record intact', async () => {
    const { store, deps, clock } = world();
    const r = await finalizeFixture(store, 'T01');
    deps.crm.failNext = 99;

    const due = () => [...store.jobs.values()].find((j) => j.kind === 'hubspot_sync')!;
    await processOutbox(deps);
    expect(due()).toMatchObject({ status: 'pending', attempts: 1 });
    expect(new Date(due().next_attempt_at).getTime() - clock.now().getTime()).toBe(backoffSeconds(1) * 1000);

    // Not due yet → not retried.
    expect((await processOutbox(deps)).claimed).toBe(0);

    for (let i = 2; i <= 5; i++) {
      clock.advance(backoffSeconds(i - 1));
      await processOutbox(deps);
    }
    expect(due()).toMatchObject({ status: 'dead', attempts: 5 });
    expect(store.errors.filter((e) => e.service === 'hubspot')).toHaveLength(5);

    // One alert to the studio head after the 3rd failure, delivered on the next run.
    const alerts = [...store.jobs.values()].filter((j) => j.kind === 'integration_alert');
    expect(alerts).toHaveLength(1);
    expect(deps.telegram.sent.some((s) => s.to === 'studio-head' && s.message.subject === 'Integration failing: hubspot_sync')).toBe(true);

    // Dead job → manual task; the call record and lead are untouched.
    expect(store.followups.some((f) => f.reason === 'integration_failure')).toBe(true);
    expect(await store.getCall(r.callId)).toMatchObject({ outcome: 'qualified', status: 'completed' });
    expect(store.leads.get(r.leadId!)!.hubspot_contact_id).toBeNull();
  });

  it('a retried HubSpot sync updates the same contact and deal (idempotent)', async () => {
    const { store, deps } = world();
    await finalizeFixture(store, 'T01', { callId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
    await processOutbox(deps);
    await finalizeFixture(store, 'T02', { callId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }); // same phone, new call
    await processOutbox(deps);
    expect(deps.crm.contacts.size).toBe(1);
    expect(deps.crm.deals.size).toBe(1);
  });

  it('error messages stored in integration_errors never contain a full phone number', async () => {
    const { store, deps } = world();
    await finalizeFixture(store, 'T01');
    deps.crm.upsertContactByPhone = async () => {
      throw new Error(`contact ${PHONE} rejected`);
    };
    await processOutbox(deps);
    expect(store.errors[0]!.message).not.toContain('9800000001');
    expect(store.errors[0]!.message).toContain('••••0001');
  });
});

describe('dropped-call resume (T17)', () => {
  it('finds an unfinished call from the same number within 30 minutes', async () => {
    const { store, clock } = world('2026-09-22T08:44:00.000Z');
    await store.saveCall({ id: 'first', caller_phone_e164: PHONE, status: 'dropped', started_at: clock.now().toISOString() });
    clock.advance(2 * 60);
    expect((await findResumableCall(store, PHONE, clock.now()))?.id).toBe('first');
    clock.advance(29 * 60);
    expect(await findResumableCall(store, PHONE, clock.now())).toBeNull();
  });
  it('does not resume a call that completed normally', async () => {
    const { store, clock } = world();
    await store.saveCall({ id: 'done', caller_phone_e164: PHONE, status: 'completed', started_at: clock.now().toISOString() });
    expect(await findResumableCall(store, PHONE, clock.now())).toBeNull();
  });
});

import { casesById } from '../fixtures/cases';
function casesById_len(id: string) {
  return casesById.get(id)!.transcript.length;
}
