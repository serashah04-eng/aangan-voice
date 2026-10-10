import { redactPhones } from '../../lib/logger';
import type { Notifier, OutgoingMessage } from './types';

/** Resend email (fallback channel). `to` is an email address. */
export class ResendNotifier implements Notifier {
  readonly channel = 'email' as const;
  private readonly fetch: typeof fetch;

  constructor(private readonly apiKey: string, private readonly from: string, fetchImpl?: typeof fetch) {
    if (!apiKey || !from) throw new Error('RESEND_API_KEY and RESEND_FROM are required');
    this.fetch = fetchImpl ?? fetch;
  }

  async send(to: string, message: OutgoingMessage) {
    const res = await this.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [to], subject: message.subject, text: message.body }),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !json.id) throw new Error(`resend → ${res.status}: ${redactPhones(json.message ?? 'unknown error')}`);
    return { providerMessageId: json.id };
  }
}
