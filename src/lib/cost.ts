import { costConfig, type ModelRate } from '../../config/cost.config';

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Thinking tokens — billed at the output rate. */
  thinkingTokens: number;
  cachedTokens?: number;
};

/** Row shape for the Phase 3 `cost_events` table. */
export type CostEvent = {
  kind: 'llm' | 'telephony' | 'notification';
  provider: string;
  model?: string;
  units: Record<string, number>;
  unitRates: Record<string, number>;
  rateVersion: string;
  amountUsd: number;
  occurredOn: string;
  purpose: string;
};

export function rateFor(model: string, onDate: string): ModelRate | null {
  const rates = costConfig.llm[model];
  if (!rates) return null;
  return [...rates].filter((r) => r.from <= onDate).sort((a, b) => (a.from < b.from ? 1 : -1))[0] ?? null;
}

export function llmCostEvent(model: string, usage: TokenUsage, onDate: string, purpose: string): CostEvent {
  const rate = rateFor(model, onDate);
  const billedOutput = usage.outputTokens + usage.thinkingTokens;
  const amountUsd = rate
    ? (usage.inputTokens * rate.usdPerMTokInput + billedOutput * rate.usdPerMTokOutput) / 1_000_000
    : 0;
  return {
    kind: 'llm',
    provider: 'google-gemini',
    model,
    units: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, thinkingTokens: usage.thinkingTokens },
    unitRates: rate ? { usdPerMTokInput: rate.usdPerMTokInput, usdPerMTokOutput: rate.usdPerMTokOutput } : {},
    rateVersion: rate ? `${costConfig.rateVersion}:${rate.from}` : 'unknown-model-rate',
    amountUsd,
    occurredOn: onDate,
    purpose,
  };
}
