export type NotifyChannel = 'telegram' | 'email';

export type OutgoingMessage = {
  /** Plain-text subject / first line. */
  subject: string;
  /** Plain-text body (Telegram adapter escapes it for HTML). */
  body: string;
};

/** One delivery channel. Throws on failure so the outbox can retry / fall back. */
export interface Notifier {
  readonly channel: NotifyChannel;
  send(to: string, message: OutgoingMessage): Promise<{ providerMessageId: string }>;
}
