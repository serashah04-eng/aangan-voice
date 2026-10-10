import type { Notifier, OutgoingMessage } from './types';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Telegram Bot API. `to` is a chat id (e.g. the "Aangan Designers" group). */
export class TelegramNotifier implements Notifier {
  readonly channel = 'telegram' as const;
  private readonly fetch: typeof fetch;

  constructor(private readonly botToken: string, fetchImpl?: typeof fetch) {
    if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    this.fetch = fetchImpl ?? fetch;
  }

  async send(to: string, message: OutgoingMessage) {
    const res = await this.fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: to,
        text: `<b>${escapeHtml(message.subject)}</b>\n\n${escapeHtml(message.body)}`.slice(0, 4096),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id: number } };
    // Never include the bot token (it is part of the URL) in an error message.
    if (!res.ok || !json.ok) throw new Error(`telegram sendMessage → ${res.status}: ${json.description ?? 'unknown error'}`);
    return { providerMessageId: String(json.result?.message_id ?? '') };
  }
}
