import type { Store } from '../adapters/store/types';
import { CallSession, type SessionDeps } from '../dialogue/session';
import { logger } from '../lib/logger';
import { callIdFor, placeholderPhoneFor } from './ids';

/**
 * Vaani "Bring Your Own LLM" protocol, one instance per call/WebSocket (docs: guides/byol).
 *   on connect → send {interaction_type:"config"} and {interaction_type:"greeting"}
 *   Vaani → {interaction_type:"response_required", response_id, call_id, transcript[], req_body}
 *   us    → {response_type:"response", response_id, content, content_complete:true, end_call?}
 * Turns are processed strictly in order. If the caller barges in (a newer response_id arrives
 * while we are still working on an older one), the stale reply is dropped and only the newest is
 * answered — Vaani has already stopped speaking.
 */

export type VaaniMessage = { role: 'system' | 'assistant' | 'user'; content: string };
export type VaaniTurnRequest = {
  interaction_type: 'response_required';
  response_id: number;
  call_id?: string;
  transcript: VaaniMessage[];
  req_body?: { contact_number?: string; name?: string } | null;
};
export type Frame = Record<string, unknown>;

/**
 * Vaani can deliver the turn as ONE big `user` message: its whole system prompt, the running
 * chat history, and the newest line as `User: <what they said>\nAssistant:` at the very end.
 * Only that final line is the caller's new speech; everything else is prompt/history and must
 * never reach the extractor, the stored transcript, or the slot picker.
 */
export function latestUtterance(content: string): string {
  const m = content.match(/(?:^|\n)User:[ \t]*([\s\S]*?)\s*\n?Assistant:\s*$/);
  return (m ? m[1]! : content).trim();
}

/** What the caller said since the agent last spoke (consecutive duplicates removed). */
export function newCallerText(transcript: VaaniMessage[]): string {
  const lastAssistant = transcript.map((m) => m.role).lastIndexOf('assistant');
  const users = transcript
    .slice(lastAssistant + 1)
    .filter((m) => m.role === 'user')
    .map((m) => latestUtterance(m.content))
    .filter(Boolean);
  return users.filter((u, i) => u !== users[i - 1]).join(' ');
}

export class ByolConnection {
  private session: CallSession | null = null;
  private queue: Promise<void> = Promise.resolve();
  private latestId = -1;
  private closed = false;

  constructor(
    private readonly deps: SessionDeps & { store: Store },
    private readonly providerCallId: string,
    private readonly send: (frame: Frame) => void,
  ) {}

  hello(): void {
    this.send({ interaction_type: 'config', content: 'Aangan agent ready' });
    this.send({ interaction_type: 'greeting', content: 'Hello' });
  }

  /** Feed one raw frame from Vaani. Returns when this frame has been handled. */
  onFrame(raw: string | Frame): Promise<void> {
    let msg: Frame;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return Promise.resolve();
    }
    if (msg.response_type === 'ping_pong') return Promise.resolve();
    if (msg.interaction_type !== 'response_required') return Promise.resolve();
    const req = msg as unknown as VaaniTurnRequest;
    this.latestId = Math.max(this.latestId, req.response_id);
    this.queue = this.queue.then(() => this.handle(req)).catch((e) => logger.error('byol.turn_failed', { message: (e as Error).message }));
    return this.queue;
  }

  private async ensureSession(req: VaaniTurnRequest): Promise<CallSession> {
    if (this.session) return this.session;
    const callId = callIdFor(this.providerCallId);
    let phone = req.req_body?.contact_number?.trim() || '';
    if (!phone) {
      // Inbound calls: the Vercel webhook stored the caller's number on `call_started`.
      try {
        phone = (await this.deps.store.getCall(callId))?.caller_phone_e164 ?? '';
      } catch {
        /* fall through */
      }
    }
    // A webhook may have stored a placeholder before the number was known — never use that as a real number.
    if (phone.startsWith('unknown')) phone = '';
    const { session } = await CallSession.start(this.deps, { callId, callerPhone: phone || placeholderPhoneFor(this.providerCallId), providerCallId: this.providerCallId });
    this.session = session;
    return session;
  }

  private async handle(req: VaaniTurnRequest): Promise<void> {
    if (this.closed) return;
    const session = await this.ensureSession(req);
    const said = newCallerText(req.transcript ?? []);
    if (!said) {
      if (req.response_id === this.latestId) this.send({ response_type: 'response', response_id: req.response_id, content: '', content_complete: true });
      return;
    }
    const reply = await session.onCallerTurn(said);
    if (req.response_id !== this.latestId) {
      logger.info('byol.stale_reply_dropped', { responseId: req.response_id, latest: this.latestId });
      return;
    }
    this.send({ response_type: 'response', response_id: req.response_id, content: reply.say, content_complete: true, ...(reply.endCall ? { end_call: true } : {}) });
  }

  /** Socket closed (hang-up, drop, or end_call): final write + outbox. */
  async onClose(): Promise<void> {
    this.closed = true;
    await this.queue;
    if (!this.session) return;
    try {
      await this.session.finish({ dropped: this.session.stage !== 'ended' });
    } catch (e) {
      logger.error('byol.finish_failed', { callId: this.session.callId, message: (e as Error).message });
    }
  }
}
