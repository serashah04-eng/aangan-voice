import { describe, expect, it } from 'vitest';
import { rulesConfig } from '../../config/rules.config';
import { MockCalendar } from '../../src/adapters/calendar/mock';
import { MemoryStore } from '../../src/adapters/store/memory';
import { setLogSink } from '../../src/lib/logger';
import { pickSlot } from '../../src/dialogue/session';
import { ByolConnection, latestUtterance, newCallerText, type Frame, type VaaniMessage } from '../../src/voice/byol';
import { callIdFor } from '../../src/voice/ids';
import { handleVaaniEvent } from '../../src/voice/webhook';
import { casesById } from '../fixtures/cases';
import { progressiveLlm } from '../helpers/model-reply';

setLogSink(() => {});
const S = rulesConfig.scripts;

describe('Vaani BYOL protocol', () => {
  function connection(id = 'room-abc') {
    const store = new MemoryStore();
    const frames: Frame[] = [];
    const conn = new ByolConnection({ llm: progressiveLlm(casesById.get('T03')!.extraction), store, calendar: new MockCalendar() }, id, (f) => frames.push(f));
    return { conn, frames, store };
  }
  const req = (id: number, transcript: VaaniMessage[], req_body: unknown = { contact_number: '+919800000003' }) => ({
    interaction_type: 'response_required', response_id: id, call_id: 'room-abc', transcript, req_body,
  });
  const sys: VaaniMessage = { role: 'system', content: 'agent prompt' };

  it('sends the two handshake frames on connect', () => {
    const { conn, frames } = connection();
    conn.hello();
    expect(frames).toEqual([
      { interaction_type: 'config', content: 'Aangan agent ready' },
      { interaction_type: 'greeting', content: 'Hello' },
    ]);
  });

  it('answers a turn with the rules-driven line, echoing response_id, and ends the call when closing', async () => {
    const { conn, frames, store } = connection();
    const said = casesById.get('T03')!.transcript[1]!.text;
    await conn.onFrame(JSON.stringify(req(1, [sys, { role: 'assistant', content: 'Hello' }, { role: 'user', content: said }])));
    expect(frames.at(-1)).toEqual({
      response_type: 'response', response_id: 1, content_complete: true, end_call: true,
      content: `${S.closing.notQualified} Nashik is outside Pune and PCMC, where our vendor network works.`,
    });
    await conn.onClose();
    const call = await store.getCall(callIdFor('room-abc'));
    expect(call).toMatchObject({ outcome: 'not_qualified', caller_phone_e164: '+919800000003', provider_call_id: 'room-abc' });
  });

  it('barge-in: a newer turn arriving mid-processing makes the older reply stale (dropped)', async () => {
    const { conn, frames } = connection();
    const p1 = conn.onFrame(req(1, [sys, { role: 'user', content: 'Hello' }]));
    const p2 = conn.onFrame(req(2, [sys, { role: 'user', content: 'Hello' }, { role: 'user', content: 'Hello? I want to redo my home office and study.' }]));
    await Promise.all([p1, p2]);
    const responses = frames.filter((f) => f.response_type === 'response');
    expect(responses.map((f) => f.response_id)).toEqual([2]);
  });

  it('ignores keep-alive echoes and garbage', async () => {
    const { conn, frames } = connection();
    await conn.onFrame(JSON.stringify({ response_type: 'ping_pong' }));
    await conn.onFrame('not json');
    expect(frames).toEqual([]);
  });

  it("Vaani's flattened-prompt delivery: only the final 'User: …' line is the caller's speech", () => {
    const blob = [
      '### Sentiment Adaptation\n- **Active Listening**: be concise. Say yes to first-time callers.',
      '[16:54:03] USER: We would like it done by March.\n\n[16:54:19] AGENT: I have three slots: first, second or third?',
      'User: The second one please.\nAssistant:',
    ].join('\n\n');
    expect(latestUtterance(blob)).toBe('The second one please.');
    expect(newCallerText([sys, { role: 'user', content: blob }]).text).toBe('The second one please.');
    // Several "User:" lines in the history: only the last one (right before "Assistant:") counts.
    expect(latestUtterance('User: first thing\nAssistant: ok\nUser: the real latest\nAssistant:')).toBe('the real latest');
    // The slot picker must see only that sentence, not the prompt's stray "yes" / "first".
    expect(pickSlot(latestUtterance(blob), [{ start: 'a', end: 'a' }, { start: 'b', end: 'b' }, { start: 'c', end: 'c' }])).toBe(1);
  });

  it('a plain short user message passes through unchanged', () => {
    expect(latestUtterance('I want to redo my flat.')).toBe('I want to redo my flat.');
  });

  it('extracts only what the caller said since the agent last spoke (de-duplicated)', () => {
    expect(newCallerText([sys, { role: 'assistant', content: 'Hi' }, { role: 'user', content: 'What is this call regarding?' }, { role: 'user', content: 'What is this call regarding?' }]).text).toBe('What is this call regarding?');
    expect(newCallerText([sys, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }, { role: 'user', content: 'd' }]).text).toBe('c d');
  });

  it('voice mode: a CUMULATIVE list of user messages yields only the new speech each turn', () => {
    const u = (content: string): VaaniMessage => ({ role: 'user', content });
    let seen: string[] = [];
    const turn = (msgs: VaaniMessage[]) => {
      const r = newCallerText([sys, ...msgs], seen);
      seen = r.seen;
      return r.text;
    };
    expect(turn([u('My name is Sarah, 3BHK in Kalyani Nagar.')])).toBe('My name is Sarah, 3BHK in Kalyani Nagar.');
    expect(turn([u('My name is Sarah, 3BHK in Kalyani Nagar.'), u('Getting possession next week.')])).toBe('Getting possession next week.');
    expect(turn([u('My name is Sarah, 3BHK in Kalyani Nagar.'), u('Getting possession next week.'), u('Yes, execution too.'), u('Yes, execution too.')])).toBe('Yes, execution too.');
    // Flattened chat mode must still accept a repeated sentence ("Yes" twice).
    seen = [];
    expect(turn([u('x\nUser: Yes\nAssistant:')])).toBe('Yes');
    expect(turn([u('y\nUser: Yes\nAssistant:')])).toBe('Yes');
  });
});

describe('Vaani webhook events', () => {
  it('call_started records the caller number; picked-up sets answer time; call_ended adds minutes + one telephony cost', async () => {
    const store = new MemoryStore();
    const t0 = new Date('2026-10-10T10:00:00Z');
    await handleVaaniEvent(store, { event: 'call_started', room_name: 'room-1', phone_number: '+919800000004', status: 'dialing' } as never, t0);
    await handleVaaniEvent(store, { event: 'user_picked_up_at', room_name: 'room-1' }, new Date('2026-10-10T10:00:02Z'));
    await handleVaaniEvent(store, { event: 'call_ended', room_name: 'room-1', call_duration: 125, end_reason: 'AGENT_REQUESTED_DISCONNECT' }, new Date('2026-10-10T10:02:07Z'));
    await handleVaaniEvent(store, { event: 'call_ended', room_name: 'room-1', call_duration: 125 }, new Date('2026-10-10T10:02:08Z')); // retry
    const call = await store.getCall(callIdFor('room-1'));
    expect(call).toMatchObject({ caller_phone_e164: '+919800000004', answered_at: '2026-10-10T10:00:02.000Z', telephony_minutes: 2.08, end_reason: 'AGENT_REQUESTED_DISCONNECT' });
    expect(store.costs).toHaveLength(1);
    expect(store.costs[0]).toMatchObject({ kind: 'telephony', provider: 'vaani' });
  });

  it('postprocessing and unknown events are acknowledged and ignored', async () => {
    const store = new MemoryStore();
    expect(await handleVaaniEvent(store, { event: 'call_postprocessing', call_id: 'room-2', data: { room_name: 'room-2' } })).toMatchObject({ handled: false });
    expect(await handleVaaniEvent(store, { event: 'nonsense' } as never)).toMatchObject({ handled: false });
  });

  it('BYOL server and webhook agree on the call id', () => {
    expect(callIdFor('room-1')).toBe(callIdFor('room-1'));
    expect(callIdFor('room-1')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(callIdFor('room-1')).not.toBe(callIdFor('room-2'));
  });
});
