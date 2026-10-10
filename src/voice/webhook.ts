import { costConfig } from '../../config/cost.config';
import type { Store } from '../adapters/store/types';
import { callIdFor, placeholderPhoneFor } from './ids';

/**
 * Vaani call-lifecycle webhooks (docs: guides/webhook-setup). Stored against the same calls row
 * the BYOL server writes (deterministic id from the Vaani room name).
 *   call_started       → create the row with the caller's number (inbound: our only source of it)
 *   user_picked_up_at  → answered_at (time-to-answer metric)
 *   call_ended         → duration → telephony minutes + a telephony cost event (once)
 */
export type VaaniEvent = {
  event: string;
  room_name?: string;
  call_id?: string;
  phone_number?: string;
  call_duration?: number;
  end_reason?: string;
  data?: { room_name?: string; call_id?: string };
};

export type WebhookResult = { handled: boolean; callId?: string; note?: string };

export async function handleVaaniEvent(store: Store, ev: VaaniEvent, now: Date = new Date()): Promise<WebhookResult> {
  const room = ev.room_name ?? ev.data?.room_name ?? ev.call_id ?? ev.data?.call_id;
  if (!room || typeof ev.event !== 'string') return { handled: false, note: 'no room/call id' };
  const id = callIdFor(room);
  const existing = await store.getCall(id);
  const phone = existing?.caller_phone_e164 ?? (ev.phone_number?.trim() || placeholderPhoneFor(room));

  switch (ev.event) {
    case 'call_started':
      if (!existing) {
        await store.saveCall({ id, provider: 'vaani', provider_call_id: room, caller_phone_e164: phone, status: 'in_progress', started_at: now.toISOString() });
      } else if (existing.caller_phone_e164.startsWith('+999') && ev.phone_number) {
        await store.saveCall({ id, caller_phone_e164: ev.phone_number.trim() });
      }
      return { handled: true, callId: id };

    case 'user_picked_up_at':
      if (!existing?.answered_at) await store.saveCall({ id, provider_call_id: room, caller_phone_e164: phone, answered_at: now.toISOString() });
      return { handled: true, callId: id };

    case 'call_ended': {
      const seconds = Number(ev.call_duration ?? 0);
      const minutes = Math.round((Math.max(0, seconds) / 60) * 100) / 100;
      const firstTime = existing?.telephony_minutes == null;
      await store.saveCall({ id, provider_call_id: room, caller_phone_e164: phone, telephony_minutes: minutes, end_reason: existing?.end_reason ?? ev.end_reason ?? null });
      if (firstTime && minutes > 0) {
        await store.addCostEvents([{
          call_id: id, kind: 'telephony', provider: 'vaani', model: null, purpose: 'call',
          units: { minutes }, unit_rates: { inrPerMinute: costConfig.telephonyInrPerMinute },
          rate_version: 'vaani-observed-2026-10-10',
          amount_usd: (minutes * costConfig.telephonyInrPerMinute) / costConfig.usdToInrFx,
          occurred_on: now.toISOString().slice(0, 10),
        }]);
      }
      return { handled: true, callId: id };
    }

    default:
      return { handled: false, callId: id, note: `ignored ${ev.event}` };
  }
}
