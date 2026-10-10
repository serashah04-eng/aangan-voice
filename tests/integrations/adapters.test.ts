import { describe, expect, it } from 'vitest';
import { CalcomCalendar } from '../../src/adapters/calendar/calcom';
import { HubSpotCrm } from '../../src/adapters/crm/hubspot';
import { ResendNotifier } from '../../src/adapters/notify/resend';
import { escapeHtml, TelegramNotifier } from '../../src/adapters/notify/telegram';
import { SupabaseStore } from '../../src/adapters/store/supabase';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** Fake fetch: records requests and answers from a queue of responses. */
function fakeFetch(responses: Array<{ status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const r = responses.shift() ?? { json: {} };
    const status = r.status ?? 200;
    return new Response(JSON.stringify(r.json), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('HubSpot adapter', () => {
  it('creates a contact when the phone search finds none', async () => {
    const f = fakeFetch([{ json: { results: [] } }, { json: { id: 'c1' } }]);
    const id = await new HubSpotCrm('pat-test', f.impl).upsertContactByPhone({ phoneE164: '+919800000001', name: 'Priya' });
    expect(id).toBe('c1');
    expect(f.calls[0]).toMatchObject({ method: 'POST', url: 'https://api.hubapi.com/crm/v3/objects/contacts/search' });
    expect((f.calls[0]!.body as any).filterGroups[0].filters[0]).toEqual({ propertyName: 'phone', operator: 'EQ', value: '+919800000001' });
    expect(f.calls[1]).toMatchObject({ method: 'POST', body: { properties: { phone: '+919800000001', firstname: 'Priya' } } });
    expect(f.calls[0]!.headers.Authorization).toBe('Bearer pat-test');
  });

  it('updates the existing contact instead of creating a duplicate', async () => {
    const f = fakeFetch([{ json: { results: [{ id: 'c9' }] } }, { json: {} }]);
    expect(await new HubSpotCrm('pat-test', f.impl).upsertContactByPhone({ phoneE164: '+919800000001' })).toBe('c9');
    expect(f.calls[1]).toMatchObject({ method: 'PATCH', url: 'https://api.hubapi.com/crm/v3/objects/contacts/c9' });
  });

  it('creates a deal associated with the contact; updates it when the id is known', async () => {
    const f = fakeFetch([{ json: { id: 'd1' } }, { json: {} }]);
    const crm = new HubSpotCrm('pat-test', f.impl);
    const input = { contactId: 'c1', name: 'Aangan — Priya', stage: 'qualifiedtobuy', pipeline: 'default', description: 'x' };
    expect(await crm.upsertDeal(input)).toBe('d1');
    expect((f.calls[0]!.body as any).associations[0]).toEqual({ to: { id: 'c1' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] });
    expect(await crm.upsertDeal({ ...input, dealId: 'd1' })).toBe('d1');
    expect(f.calls[1]).toMatchObject({ method: 'PATCH', url: 'https://api.hubapi.com/crm/v3/objects/deals/d1' });
  });

  it('errors carry the status and never the phone number', async () => {
    const f = fakeFetch([{ status: 401, json: { message: 'bad token for +919800000001' } }]);
    await expect(new HubSpotCrm('pat-test', f.impl).upsertContactByPhone({ phoneE164: '+919800000001' })).rejects.toThrow(/401.*••••0001/);
  });
});

describe('Telegram adapter', () => {
  it('sends HTML-escaped text to the chat', async () => {
    const f = fakeFetch([{ json: { ok: true, result: { message_id: 7 } } }]);
    const r = await new TelegramNotifier('123:abc', f.impl).send('-100', { subject: 'Lead <new>', body: 'A & B' });
    expect(r.providerMessageId).toBe('7');
    expect(f.calls[0]!.body).toMatchObject({ chat_id: '-100', parse_mode: 'HTML', text: '<b>Lead &lt;new&gt;</b>\n\nA &amp; B' });
  });
  it('throws without leaking the bot token', async () => {
    const f = fakeFetch([{ status: 400, json: { ok: false, description: 'chat not found' } }]);
    await expect(new TelegramNotifier('123:SECRET', f.impl).send('-1', { subject: 's', body: 'b' })).rejects.toThrow(/^telegram sendMessage → 400: chat not found$/);
  });
  it('escapes HTML', () => expect(escapeHtml('<a&b>')).toBe('&lt;a&amp;b&gt;'));
});

describe('Resend adapter', () => {
  it('sends a plain-text email', async () => {
    const f = fakeFetch([{ json: { id: 'em1' } }]);
    await new ResendNotifier('re_test', 'onboarding@resend.dev', f.impl).send('designer@example.test', { subject: 'S', body: 'B' });
    expect(f.calls[0]!.body).toEqual({ from: 'onboarding@resend.dev', to: ['designer@example.test'], subject: 'S', text: 'B' });
  });
});

describe('Cal.com adapter', () => {
  const opts = (impl: typeof fetch) => ({ apiKey: 'cal_test', eventTypeId: '7424426', attendeeEmail: 'studio@example.test', timeZone: 'Asia/Kolkata', fetchImpl: impl });

  it('lists slots (range format) sorted', async () => {
    const f = fakeFetch([{ json: { status: 'success', data: { '2026-10-13': [{ start: '2026-10-13T11:00:00.000+05:30', end: '2026-10-13T12:00:00.000+05:30' }], '2026-10-12': [{ start: '2026-10-12T10:00:00.000+05:30', end: '2026-10-12T11:00:00.000+05:30' }] } } }]);
    const slots = await new CalcomCalendar(opts(f.impl)).listSlots('2026-10-12T00:00:00Z', '2026-10-14T00:00:00Z');
    expect(slots).toEqual([
      { start: '2026-10-12T04:30:00.000Z', end: '2026-10-12T05:30:00.000Z' },
      { start: '2026-10-13T05:30:00.000Z', end: '2026-10-13T06:30:00.000Z' },
    ]);
    expect(f.calls[0]!.url).toContain('eventTypeId=7424426');
    expect(f.calls[0]!.headers['cal-api-version']).toBe('2024-09-04');
  });

  it('books with the studio inbox as attendee email and the phone in notes (Q27)', async () => {
    const f = fakeFetch([{ json: { status: 'success', data: { uid: 'bk_1' } } }]);
    const r = await new CalcomCalendar(opts(f.impl)).book({ slot: { start: '2026-10-12T04:30:00.000Z', end: '2026-10-12T05:30:00.000Z' }, attendeeName: 'Priya', attendeePhone: '+919800000001', notes: 'Caller Priya, +919800000001.', idempotencyKey: 'booking:call-1' });
    expect(r.bookingId).toBe('bk_1');
    expect(f.calls[0]!.body).toMatchObject({ eventTypeId: 7424426, attendee: { name: 'Priya', email: 'studio@example.test', phoneNumber: '+919800000001' } });
  });
});

describe('Supabase store', () => {
  const store = (impl: typeof fetch) => new SupabaseStore({ url: 'https://ref.supabase.co/', serviceRoleKey: 'svc', fetchImpl: impl });

  it('looks calls up by phone through an RPC body, never the URL', async () => {
    const f = fakeFetch([{ json: [] }]);
    await store(f.impl).findRecentCallByPhone('+919800000001', '2026-10-10T00:00:00Z');
    expect(f.calls[0]!.url).toBe('https://ref.supabase.co/rest/v1/rpc/find_recent_call');
    expect(f.calls[0]!.url).not.toContain('9800000001');
    expect(f.calls[0]!.body).toEqual({ p_phone: '+919800000001', p_since: '2026-10-10T00:00:00Z' });
  });

  it('upserts leads on phone via the request body', async () => {
    const f = fakeFetch([{ json: [{ id: 'l1', phone_e164: '+919800000001' }] }]);
    await store(f.impl).upsertLeadByPhone({ phone_e164: '+919800000001', name: 'Priya' });
    expect(f.calls[0]!.url).toBe('https://ref.supabase.co/rest/v1/leads?on_conflict=phone_e164');
    expect(f.calls[0]!.headers.Prefer).toBe('resolution=merge-duplicates,return=representation');
  });

  it('enqueue ignores duplicate idempotency keys', async () => {
    const f = fakeFetch([{ json: [] }]);
    expect(await store(f.impl).enqueueJob({ kind: 'hubspot_sync', payload: {}, idempotency_key: 'k' })).toBe(false);
    expect(f.calls[0]!.headers.Prefer).toBe('resolution=ignore-duplicates,return=representation');
  });

  it('redacts phone numbers in stored error messages', async () => {
    const f = fakeFetch([{ json: null }]);
    await store(f.impl).addIntegrationError({ service: 'hubspot', operation: 'x', idempotency_key: null, call_id: null, lead_id: null, attempt: 1, error_code: null, message: 'failed for +919800000001' });
    expect((f.calls[0]!.body as any).message).toBe('failed for [phone ••••0001]');
  });
});
