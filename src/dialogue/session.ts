import { rulesConfig, scriptsHi, type ScriptSet } from '../../config/rules.config';
import type { CalendarProvider, Slot } from '../adapters/calendar/types';
import type { LlmClient } from '../adapters/llm/types';
import type { Store } from '../adapters/store/types';
import type { AskableField, EvaluationResult, Extraction, Transcript } from '../domain/types';
import { extract, type ExtractionRun } from '../extraction/extractor';
import { guardAgentUtterance } from '../guard/pricing-guard';
import type { CostEvent } from '../lib/cost';
import { logger } from '../lib/logger';
import { evaluate } from '../rules/engine';
import { known } from '../rules/fields';
import { offerSlots, persistBookingOutcome, type LiveBookingOutcome } from '../services/booking';
import { finalizeCall, type FinalizeResult } from '../services/finalize-call';
import { processOutbox, type OutboxDeps } from '../services/outbox';
import { findResumableCall } from '../services/resume';

export type SessionDeps = {
  llm: LlmClient;
  store: Store;
  /** null → never offer booking (e.g. calendar not configured). */
  calendar: CalendarProvider | null;
  /** When set, queued HubSpot/Telegram/email work is processed right after the call. */
  outbox?: OutboxDeps | null;
  now?: () => Date;
};

export type SessionInit = {
  callId: string;
  callerPhone: string;
  providerCallId?: string | null;
};

export type AgentReply = { say: string; endCall: boolean };

type Stage = 'qualifying' | 'booking_offered' | 'closing' | 'ended';

const istDate = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export function formatSlot(s: Slot): string {
  return new Date(s.start).toLocaleString('en-IN', { timeZone: rulesConfig.calendar.timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true });
}

/** Ordinal words win over bare numbers ("the second one" is slot 2, not "one"). */
const ORDINALS: Array<[RegExp, number]> = [
  [/\b(first|1st|pehl[aei])\b|पहला|पहली/i, 0],
  [/\b(second|2nd|doosr[aei]|dusr[aei])\b|दूसरा|दूसरी/i, 1],
  [/\b(third|3rd|teesr[aei])\b|तीसरा|तीसरी/i, 2],
  [/^\s*(one|1)\b/i, 0],
  [/^\s*(two|2)\b/i, 1],
  [/^\s*(three|3)\b/i, 2],
];
const YES = /\b(yes|yeah|yep|sure|ok|okay|fine|works|perfect|haan|ha|ji|theek|ठीक|हाँ|हां)\b/i;
const NO = /\b(no|nope|none|neither|not really|doesn'?t work|nahi|nahin|नहीं)\b/i;

/** Which offered slot did the caller pick? null = unclear; 'none' = none suit. */
export function pickSlot(answer: string, offered: Slot[]): number | 'none' | null {
  if (NO.test(answer) && !ORDINALS.some(([re]) => re.test(answer))) return 'none';
  for (const [re, i] of ORDINALS) if (re.test(answer) && i < offered.length) return i;
  const day = offered.findIndex((s) => {
    const wd = new Date(s.start).toLocaleDateString('en-IN', { timeZone: rulesConfig.calendar.timeZone, weekday: 'long' }).toLowerCase();
    return answer.toLowerCase().includes(wd);
  });
  if (day >= 0) return day;
  if (YES.test(answer)) return 0;
  return null;
}

/**
 * One phone call. The LLM is used for exactly one thing per caller turn — extracting facts
 * (with quotes) from the transcript. The deterministic rules engine decides what to ask or
 * whether to close; every spoken line comes from config and passes the output guard.
 */
export class CallSession {
  readonly callId: string;
  readonly callerPhone: string;
  readonly providerCallId: string | null;
  readonly startedAt: string;
  readonly callDate: string;
  readonly resumedFromCallId: string | null;
  transcript: Transcript = [];
  asked: AskableField[] = [];
  stage: Stage = 'qualifying';
  lang: 'en' | 'hi' = 'en';
  lastRun: ExtractionRun | null = null;
  lastExtraction: Extraction | null = null;
  lastEval: EvaluationResult | null = null;
  booking: LiveBookingOutcome | null = null;
  unsupportedLanguage = false;
  endReason: string | null = null;
  private pricingSeen = 0;
  private pricingReplies = 0;
  private modelFailures = 0;
  private validatorFailures: Record<string, number> = {};
  private offered: Slot[] = [];
  private bookingAsks = 0;
  private costs: CostEvent[] = [];
  private savedTurns = 0;
  private finished: FinalizeResult | null = null;

  private constructor(private readonly deps: SessionDeps, init: SessionInit & { resumedFrom?: { id: string; transcript: Transcript; startedAt: string } }) {
    const now = this.now();
    this.callId = init.resumedFrom?.id ?? init.callId;
    this.callerPhone = init.callerPhone;
    this.providerCallId = init.providerCallId ?? null;
    this.resumedFromCallId = init.resumedFrom ? init.resumedFrom.id : null;
    this.startedAt = init.resumedFrom?.startedAt ?? now.toISOString();
    this.callDate = istDate(new Date(this.startedAt));
    if (init.resumedFrom) this.transcript = [...init.resumedFrom.transcript];
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  private get S(): ScriptSet {
    return (this.lang === 'hi' ? scriptsHi : rulesConfig.scripts) as ScriptSet;
  }

  /**
   * Start a call. If the same number dropped off within the resume window, continue that record
   * (brief §5, T17). Returns the session and the opening line to speak.
   */
  static async start(deps: SessionDeps, init: SessionInit): Promise<{ session: CallSession; opening: string }> {
    let resumedFrom: { id: string; transcript: Transcript; startedAt: string } | undefined;
    if (init.callerPhone && !init.callerPhone.startsWith('+999')) {
      try {
        const prev = await findResumableCall(deps.store, init.callerPhone, deps.now?.() ?? new Date());
        if (prev && prev.id !== init.callId) {
          const turns = await deps.store.getTurns(prev.id);
          resumedFrom = { id: prev.id, startedAt: prev.started_at, transcript: turns.map((t) => ({ speaker: t.speaker, text: t.text })) };
        }
      } catch (e) {
        logger.warn('session.resume_lookup_failed', { message: (e as Error).message });
      }
    }
    const session = new CallSession(deps, { ...init, resumedFrom });
    const opening = resumedFrom ? `${rulesConfig.scripts.conversation.resume} ${session.nextQuestionFromHistory()}`.trim() : rulesConfig.scripts.greeting;
    session.pushAgent(opening);
    await session.persistProgress('in_progress');
    return { session, opening };
  }

  /** For a resumed call: re-ask whatever the last agent turn was asking (best effort). */
  private nextQuestionFromHistory(): string {
    const lastAgent = [...this.transcript].reverse().find((t) => t.speaker === 'agent');
    return lastAgent && /\?\s*$/.test(lastAgent.text) ? lastAgent.text : '';
  }

  private pushAgent(text: string) {
    this.transcript.push({ speaker: 'agent', text });
  }

  private persistChain: Promise<void> = Promise.resolve();

  /** Saves run strictly one after another, so overlapping turns can never lose or reorder rows. */
  private persistProgress(status: 'in_progress' | 'dropped'): Promise<void> {
    this.persistChain = this.persistChain.then(() => this.persistNow(status));
    return this.persistChain;
  }

  private async persistNow(status: 'in_progress' | 'dropped') {
    try {
      await this.deps.store.saveCall({
        id: this.callId, caller_phone_e164: this.callerPhone, provider_call_id: this.providerCallId,
        provider: 'vaani', status, started_at: this.startedAt, resumed_from_call_id: null,
      });
      const fresh = this.transcript.slice(this.savedTurns).map((t, i) => ({ call_id: this.callId, turn_index: this.savedTurns + i, speaker: t.speaker, text: t.text }));
      if (fresh.length) await this.deps.store.saveTurns(fresh);
      this.savedTurns = this.transcript.length;
    } catch (e) {
      // Never break a live call because the database is slow; the final write retries everything.
      logger.warn('session.persist_failed', { callId: this.callId, message: (e as Error).message });
    }
  }

  private finish_(text: string, endCall: boolean): AgentReply {
    const guarded = guardAgentUtterance(text).text;
    this.pushAgent(guarded);
    if (endCall) this.stage = 'ended';
    void this.persistProgress('in_progress');
    return { say: guarded, endCall };
  }

  /** Handle one caller turn and return what the agent says next. */
  async onCallerTurn(text: string): Promise<AgentReply> {
    const said = text.trim();
    if (this.stage === 'ended') return { say: this.S.conversation.goodbye, endCall: true };
    if (said) this.transcript.push({ speaker: 'caller', text: said });

    if (this.stage === 'closing') return this.finish_(this.S.conversation.goodbye, true);
    if (this.stage === 'booking_offered') return this.handleBookingAnswer(said);

    // 1. Extract (the only model call).
    let run: ExtractionRun;
    try {
      run = await extract({ llm: this.deps.llm, transcript: this.transcript, callDate: this.callDate, callId: this.callId });
      this.modelFailures = 0;
    } catch (e) {
      this.modelFailures++;
      logger.warn('session.extraction_failed', { callId: this.callId, attempt: this.modelFailures, message: (e as Error).message });
      if (this.modelFailures >= rulesConfig.voice.maxModelFailuresPerCall) {
        this.endReason = 'model_unavailable';
        return this.finish_(this.S.conversation.technicalTrouble, true);
      }
      return this.finish_(this.S.conversation.retry, false);
    }
    this.lastRun = run;
    this.costs.push(run.cost);
    for (const r of run.rejectedQuotes) this.validatorFailures[r.field] = (this.validatorFailures[r.field] ?? 0) + 1;
    const extraction: Extraction = { ...run.extraction, validatorFailures: { ...this.validatorFailures } };
    this.lastExtraction = extraction;

    // 2. Rules engine decides (always evaluated, so the end-of-call record has an outcome).
    const f = extraction.fields;
    const ev = evaluate(extraction, { callDate: this.callDate, asked: this.asked });
    this.lastEval = ev;

    // 3. Language (Q11).
    if (known(f.language)) {
      if (f.language.value === 'other') {
        this.unsupportedLanguage = true;
        this.endReason = 'unsupported_language';
        return this.finish_(rulesConfig.scripts.closing.unsupportedLanguage, true);
      }
      if (f.language.value === 'hi' && rulesConfig.voice.replyInHindi) this.lang = 'hi';
    }
    const parts: string[] = [];

    // Pricing questions: approved line first time, the push-back line after (brief §3.1).
    const pricingNow = known(f.pricing_asked_count) ? f.pricing_asked_count.value : 0;
    if (pricingNow > this.pricingSeen) {
      this.pricingSeen = pricingNow;
      if (this.pricingReplies === 0) {
        parts.push(ev.outcome === 'qualified' && !this.booking ? `${this.S.pricing.approved} ${this.S.pricing.bookingSuffix}` : this.S.pricing.approved);
      } else parts.push(this.S.pricing.pushedAgain);
      this.pricingReplies++;
    }

    // Budget misalignment (C4 fail) — the founder's line, no figure.
    if (ev.criteria.C4.state === 'fail') {
      parts.push(this.S.budgetFail, this.S.closing.notQualified);
      this.endReason = 'closed_not_qualified';
      return this.finish_(parts.join(' '), true);
    }

    const next = ev.next;
    if (next.next === 'ask') {
      this.asked.push(next.field);
      if (!parts.length && this.transcript.filter((t) => t.speaker === 'caller').length > 1) parts.push(this.S.conversation.ack);
      parts.push(this.S.questions[next.field]);
      return this.finish_(parts.join(' '), false);
    }

    switch (next.outcome) {
      case 'qualified':
        return this.offerBooking(parts);
      case 'not_qualified': {
        const reasons = Object.values(ev.criteria).filter((c) => c.state === 'fail' && c.note).map((c) => c.note!);
        parts.push(this.S.closing.notQualified, ...reasons.slice(0, 1));
        this.endReason = 'closed_not_qualified';
        return this.finish_(parts.join(' '), true);
      }
      case 'needs_more_information':
        parts.push(this.S.closing.needsMoreInfo);
        this.stage = 'closing';
        return this.finish_(parts.join(' '), false);
      case 'human_review_required':
        parts.push(this.S.closing.escalation);
        this.endReason = 'escalated';
        return this.finish_(parts.join(' '), true);
      default:
        parts.push(this.S.conversation.notApplicable);
        this.endReason = 'not_an_enquiry';
        return this.finish_(parts.join(' '), true);
    }
  }

  private async offerBooking(parts: string[]): Promise<AgentReply> {
    const calendar = this.deps.calendar;
    if (!calendar) {
      parts.push(this.S.booking.pending, this.S.conversation.goodbye);
      this.booking = { status: 'pending', provider: 'calcom', preference: null };
      return this.finish_(parts.join(' '), true);
    }
    const res = await offerSlots({ store: this.deps.store, calendar, now: this.deps.now });
    if (!res.ok) {
      this.booking = { status: 'failed', slot: null, reason: res.error, provider: calendar.provider, preference: null };
      parts.push(this.S.booking.failed, this.S.conversation.goodbye);
      return this.finish_(parts.join(' '), true);
    }
    if (!res.slots.length) {
      this.booking = { status: 'pending', provider: calendar.provider, preference: null };
      parts.push(this.S.booking.pending, this.S.conversation.goodbye);
      return this.finish_(parts.join(' '), true);
    }
    this.offered = res.slots;
    this.stage = 'booking_offered';
    const list = res.slots.map(formatSlot);
    const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')}, or ${list.at(-1)}` : list[0]!;
    parts.push(this.S.booking.offer.replace('{slots}', joined));
    return this.finish_(parts.join(' '), false);
  }

  /** Book only after a yes, and only if the calendar confirms the slot (S16, S17, S18). */
  private async handleBookingAnswer(answer: string): Promise<AgentReply> {
    const calendar = this.deps.calendar!;
    const choice = pickSlot(answer, this.offered);
    if (choice === null) {
      if (this.bookingAsks === 0) {
        this.bookingAsks++;
        return this.finish_(this.S.booking.whichOne, false);
      }
      this.booking = { status: 'pending', provider: calendar.provider, preference: answer.slice(0, 200) || null };
      return this.finish_(`${this.S.booking.pending} ${this.S.conversation.goodbye}`, true);
    }
    if (choice === 'none') {
      this.booking = { status: 'pending', provider: calendar.provider, preference: answer.slice(0, 200) || null };
      return this.finish_(`${this.S.booking.pending} ${this.S.conversation.goodbye}`, true);
    }
    const slot = this.offered[choice]!;
    try {
      if (!(await calendar.isAvailable(slot))) {
        const later = await calendar.listSlots(slot.end, new Date(new Date(slot.start).getTime() + rulesConfig.calendar.lookaheadDays * 86_400_000).toISOString());
        const alt = later.find((s) => !this.offered.some((o) => o.start === s.start));
        if (!alt) {
          this.booking = { status: 'pending', provider: calendar.provider, preference: answer.slice(0, 200) || null };
          return this.finish_(`${this.S.booking.pending} ${this.S.conversation.goodbye}`, true);
        }
        this.offered = [alt];
        this.bookingAsks = 0;
        return this.finish_(this.S.booking.slotTaken.replace('{slot}', formatSlot(alt)), false);
      }
      const name = this.lastExtraction && known(this.lastExtraction.fields.caller_name) ? this.lastExtraction.fields.caller_name.value : 'Caller';
      const { bookingId } = await calendar.book({
        slot,
        attendeeName: name,
        attendeePhone: this.callerPhone,
        notes: `Caller ${name}, ${this.callerPhone}. Booked by the Aangan phone agent.`,
        idempotencyKey: `booking:${this.callId}`,
      });
      this.booking = { status: 'confirmed', slot, bookingId, provider: calendar.provider, preference: null };
      return this.finish_(`${this.S.booking.confirmed.replace('{slot}', formatSlot(slot))} ${this.S.conversation.goodbye}`, true);
    } catch (e) {
      this.booking = { status: 'failed', slot, reason: (e as Error).message.slice(0, 300), provider: calendar.provider, preference: null };
      return this.finish_(`${this.S.booking.failed} ${this.S.conversation.goodbye}`, true);
    }
  }

  /**
   * End of call (hang-up, drop, or agent close): final write to Supabase via finalizeCall, the
   * booking outcome, then (optionally) process the outbox right away. Safe to call twice.
   */
  async finish(opts: { endedAt?: string; dropped?: boolean; endReason?: string | null; telephonyMinutes?: number | null } = {}): Promise<FinalizeResult | null> {
    if (this.finished) return this.finished;
    await this.persistChain;
    const status = opts.dropped ?? this.stage !== 'ended' ? 'dropped' : 'completed';
    const hasCaller = this.transcript.some((t) => t.speaker === 'caller');

    if (!this.lastExtraction || !this.lastEval) {
      // Nothing understood (e.g. hung up immediately): keep the partial record only.
      await this.persistProgress(status === 'dropped' ? 'dropped' : 'in_progress');
      if (!hasCaller) return null;
      return null;
    }

    const result = await finalizeCall(this.deps.store, {
      callId: this.callId,
      callerPhone: this.callerPhone,
      providerCallId: this.providerCallId,
      startedAt: this.startedAt,
      endedAt: opts.endedAt ?? this.now().toISOString(),
      callDate: this.callDate,
      status,
      endReason: opts.endReason ?? this.endReason,
      resumedFromCallId: this.resumedFromCallId,
      transcript: this.transcript,
      extraction: this.lastExtraction,
      evaluation: this.lastEval,
      asked: this.asked,
      run: this.lastRun ? { ...this.lastRun, cost: undefined as never } : null,
      extraCosts: this.costs,
      telephonyMinutes: opts.telephonyMinutes ?? null,
    });
    this.finished = result;

    if (result.leadId && this.booking) await persistBookingOutcome(this.deps.store, result.leadId, this.callId, this.booking);
    if (result.leadId && this.unsupportedLanguage) {
      await this.deps.store.addFollowupTask({ lead_id: result.leadId, call_id: this.callId, reason: 'unsupported_language', missing_fields: [], notes: 'Caller spoke a language other than English or Hindi — call back.' });
    }
    if (this.deps.outbox) {
      try {
        await processOutbox(this.deps.outbox, 10);
      } catch (e) {
        logger.warn('session.outbox_after_call_failed', { callId: this.callId, message: (e as Error).message });
      }
    }
    return result;
  }
}
