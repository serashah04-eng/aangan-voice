/**
 * Remove ALL test data created while building: Vaani test calls (+ their Cal.com bookings and HubSpot
 * contacts/deals), the earlier "TEST — Aangan smoke" HubSpot records, and the seeded demo calls.
 * HubSpot deletes are ARCHIVES (recoverable from HubSpot's recycle bin for 90 days).
 *   npm run cleanup:test -- --yes
 */
import { loadLocalEnv } from '../src/services/container';

loadLocalEnv();
if (!process.argv.includes('--yes')) {
  console.log('Deletes test calls, leads, Cal.com test bookings and HubSpot test records. Re-run with --yes.');
  process.exit(0);
}
const env = (n: string) => (process.env[n] ?? '').trim();
const U = env('SUPABASE_URL');
const H = { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' };
const sb = async <T>(method: string, path: string): Promise<T> => {
  const r = await fetch(`${U}/rest/v1/${path}`, { method, headers: H });
  return (r.status === 204 ? [] : await r.json()) as T;
};
const HS = { Authorization: `Bearer ${env('HUBSPOT_PRIVATE_APP_TOKEN')}` };
const hubspotDelete = async (kind: 'contacts' | 'deals', id: string) => (await fetch(`https://api.hubapi.com/crm/v3/objects/${kind}/${id}`, { method: 'DELETE', headers: HS })).status;

type Call = { id: string; lead_id: string | null; provider: string };
const calls = await sb<Call[]>('GET', 'calls?provider=in.(vaani,demo,sample)&select=id,lead_id,provider');
const leadIds = [...new Set(calls.map((c) => c.lead_id).filter(Boolean))] as string[];

// 1. HubSpot ids stored on the test leads, plus the earlier live smoke-test records.
const leads = leadIds.length ? await sb<Array<{ hubspot_contact_id: string | null; hubspot_deal_id: string | null; provider?: string }>>('GET', `leads?id=in.(${leadIds.join(',')})&select=hubspot_contact_id,hubspot_deal_id`) : [];
const contacts = new Set<string>(['567343412931', ...leads.map((l) => l.hubspot_contact_id).filter(Boolean) as string[]]);
const deals = new Set<string>(['353669051077', ...leads.map((l) => l.hubspot_deal_id).filter(Boolean) as string[]]);
// Safety: only archive contacts that are clearly test data (dummy/placeholder number or the smoke-test name).
const isTest = async (id: string) => {
  const r = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${id}?properties=phone,firstname`, { headers: HS });
  if (!r.ok) return false;
  const p = ((await r.json()) as { properties: { phone?: string; firstname?: string } }).properties;
  return /^\+(999|91000|9190000)/.test(p.phone ?? '') || /TEST/i.test(p.firstname ?? '') || p.phone === env('DEMO_CALLER_NUMBER');
};
let hsDeals = 0, hsContacts = 0, skipped = 0;
for (const d of deals) if ((await hubspotDelete('deals', d)) < 300) hsDeals++;
for (const c of contacts) {
  if (await isTest(c)) {
    if ((await hubspotDelete('contacts', c)) < 300) hsContacts++;
  } else skipped++;
}

// 2. Cal.com bookings made by test calls.
let cancelled = 0;
for (const c of calls.filter((x) => x.provider === 'vaani')) {
  for (const b of await sb<Array<{ provider_booking_id: string | null }>>('GET', `bookings?call_id=eq.${c.id}&status=eq.confirmed&select=provider_booking_id`)) {
    if (!b.provider_booking_id) continue;
    const r = await fetch(`https://api.cal.com/v2/bookings/${b.provider_booking_id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('CALCOM_API_KEY')}`, 'cal-api-version': '2024-08-13', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancellationReason: 'Automated test booking' }),
    });
    if (r.ok) cancelled++;
  }
}

// 3. Supabase rows (children first; calls cascade transcript turns and evidence).
const ids = calls.map((c) => c.id);
for (let i = 0; i < ids.length; i += 40) {
  const list = `in.(${ids.slice(i, i + 40).join(',')})`;
  for (const t of ['integration_errors', 'integration_jobs', 'handoffs', 'bookings', 'followup_tasks', 'cost_events']) await sb('DELETE', `${t}?call_id=${list}`);
  await sb('DELETE', `calls?id=${list}`);
}
if (leadIds.length) for (let i = 0; i < leadIds.length; i += 40) await sb('DELETE', `leads?id=in.(${leadIds.slice(i, i + 40).join(',')})`);
await sb('DELETE', `leads?phone_e164=like.${encodeURIComponent('+9190000*')}`);

const left = await sb<unknown[]>('GET', 'calls?select=id');
console.log(`Supabase: removed ${ids.length} calls, ${leadIds.length} leads · calls left: ${left.length}`);
console.log(`Cal.com bookings cancelled: ${cancelled}`);
console.log(`HubSpot: archived ${hsContacts} contacts and ${hsDeals} deals (recoverable 90 days); left alone as not-clearly-test: ${skipped}`);
