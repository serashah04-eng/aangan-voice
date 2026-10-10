import type { LlmClient } from '../adapters/llm/types';
import type { Extraction, Transcript } from '../domain/types';
import { llmCostEvent, type CostEvent } from '../lib/cost';
import { logger } from '../lib/logger';
import { buildResponseJsonSchema, parseModelReply, type ParseIssue } from './model-schema';
import { buildSystemInstruction, buildUserContent, EXTRACTOR_PROMPT_VERSION } from './prompt';
import { normaliseForQuote, validateQuotes, type QuoteRejection } from './quote-validator';

export type ExtractionRun = {
  /** Validated extraction, ready for the rules engine. */
  extraction: Extraction;
  rejectedQuotes: QuoteRejection[];
  parseIssues: ParseIssue[];
  droppedContradictions: number;
  /** Logged only — never used to decide anything. */
  modelSuggestedOutcome?: string;
  model: string;
  promptVersion: string;
  cost: CostEvent;
  latencyMs: number;
  schemaDropped: boolean;
  rawText: string;
};

const SYSTEM = buildSystemInstruction();
const SCHEMA = buildResponseJsonSchema();

/**
 * transcript → Gemini → JSON → Zod-checked fields → quote validator → Extraction.
 * The returned Extraction is what the deterministic rules engine evaluates.
 */
export async function extract(opts: { llm: LlmClient; transcript: Transcript; callDate: string; callId?: string }): Promise<ExtractionRun> {
  const res = await opts.llm.generateJson({
    system: SYSTEM,
    user: buildUserContent(opts.transcript, opts.callDate),
    jsonSchema: SCHEMA,
  });

  const parsed = parseModelReply(res.text);
  const { extraction, rejected } = validateQuotes(parsed.extraction, opts.transcript);

  // Contradictions trigger X3, so their quotes must be real caller words too.
  const callerText = opts.transcript.filter((t) => t.speaker === 'caller').map((t) => normaliseForQuote(t.text));
  const realContradictions = extraction.contradictions.filter((c) =>
    c.quotes.every((q) => callerText.some((t) => t.includes(normaliseForQuote(q)))),
  );

  // Rates are keyed by the configured model ID (the reply may carry a more specific version string).
  const cost = llmCostEvent(opts.llm.model, res.usage, opts.callDate, 'extraction');
  logger.info('llm.extraction', {
    callId: opts.callId,
    model: res.model,
    promptVersion: EXTRACTOR_PROMPT_VERSION,
    inputTokens: res.usage.inputTokens,
    outputTokens: res.usage.outputTokens,
    thinkingTokens: res.usage.thinkingTokens,
    costUsd: Number(cost.amountUsd.toFixed(6)),
    latencyMs: res.latencyMs,
    rejectedQuotes: rejected.length,
    parseIssues: parsed.issues.length,
  });

  return {
    extraction: { ...extraction, contradictions: realContradictions },
    rejectedQuotes: rejected,
    parseIssues: parsed.issues,
    droppedContradictions: extraction.contradictions.length - realContradictions.length,
    modelSuggestedOutcome: parsed.modelSuggestedOutcome,
    model: res.model,
    promptVersion: EXTRACTOR_PROMPT_VERSION,
    cost,
    latencyMs: res.latencyMs,
    schemaDropped: res.schemaDropped,
    rawText: res.text,
  };
}
