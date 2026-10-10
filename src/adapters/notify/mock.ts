import type { Notifier, NotifyChannel, OutgoingMessage } from './types';

/** Records sent messages; `failNext` makes the next N sends throw. */
export class MockNotifier implements Notifier {
  sent: { to: string; message: OutgoingMessage }[] = [];
  failNext = 0;
  constructor(readonly channel: NotifyChannel) {}

  async send(to: string, message: OutgoingMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error(`${this.channel} unavailable (mock)`);
    }
    this.sent.push({ to, message });
    return { providerMessageId: `${this.channel}-${this.sent.length}` };
  }
}
