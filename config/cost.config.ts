/**
 * Running-cost rates for the SYSTEM ITSELF (model tokens, telephony, notifications) — used by the
 * cost meter and the Phase 5 dashboard. This file holds no studio pricing.
 *
 * Model rates: Google AI paid tier, standard, text, USD per 1M tokens, from
 * https://ai.google.dev/gemini-api/docs/pricing (checked 2026-10-10). Thinking tokens bill as output.
 * Each rate has an effective-from date; the rate in force on the call date is used.
 */

export type ModelRate = { from: string; usdPerMTokInput: number; usdPerMTokOutput: number };

export const costConfig = {
  rateVersion: '2026-10-10',

  /** Default extraction / dialogue model. Override with GEMINI_MODEL. */
  defaultModel: 'gemini-3.8-flash',

  llm: {
    'gemini-3.8-flash': [
      { from: '2026-01-01', usdPerMTokInput: 0.75, usdPerMTokOutput: 3.75 },
      { from: '2027-01-01', usdPerMTokInput: 1.5, usdPerMTokOutput: 7.5 },
    ],
    'gemini-3.6-flash': [
      { from: '2026-01-01', usdPerMTokInput: 0.75, usdPerMTokOutput: 3.75 },
      { from: '2027-01-01', usdPerMTokInput: 1.5, usdPerMTokOutput: 7.5 },
    ],
    'gemini-3-flash-preview': [{ from: '2026-01-01', usdPerMTokInput: 0.5, usdPerMTokOutput: 3.0 }],
    'gemini-2.5-flash': [{ from: '2026-01-01', usdPerMTokInput: 0.3, usdPerMTokOutput: 2.5 }],
    'gemini-3.5-flash-lite': [{ from: '2026-01-01', usdPerMTokInput: 0.3, usdPerMTokOutput: 2.5 }],
    'gemini-3.1-flash-lite': [{ from: '2026-01-01', usdPerMTokInput: 0.25, usdPerMTokOutput: 1.5 }],
  } as Record<string, ModelRate[]>,

  /** FX for showing USD-billed costs in INR on the dashboard. Update monthly. */
  usdToInrFx: 88,

  /**
   * Vaani AI telephony + voice, per minute, in INR. Observed on the account dashboard on 2026-10-10
   * (one 1-minute call cost 0.65). Replace with Vaani's quoted rate when confirmed.
   */
  telephonyInrPerMinute: 4.92, // confirmed by the owner 2026-10-10 (Vaani agent page estimate)
  /** Telegram Bot API is free; Resend's free tier covers our volume. */
  notificationUsdPerMessage: { telegram: 0, email: 0 },
} as const;
