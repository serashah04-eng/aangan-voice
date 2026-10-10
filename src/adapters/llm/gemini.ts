import { GoogleGenAI } from '@google/genai';
import { logger } from '../../lib/logger';
import type { JsonRequest, JsonResponse, LlmClient } from './types';

export type GeminiOptions = {
  apiKey: string;
  /** Optional backup key (e.g. GEMINI_API_KEY_FALLBACK) used when the primary key's quota is exhausted. */
  fallbackApiKey?: string;
  model: string;
  maxRetries?: number;
  /** Thinking level for Gemini 3.x models: LOW | MEDIUM | HIGH. Default LOW (latency matters on a call). */
  thinkingLevel?: string;
  /** Per-request timeout. Default 60 s. */
  timeoutMs?: number;
};

/** Raised when the key's quota is exhausted — retrying will not help. */
export class QuotaExceededError extends Error {}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; code?: number; message?: string };
  if (typeof e?.status === 'number') return e.status;
  if (typeof e?.code === 'number') return e.code;
  const m = /\b(4\d\d|5\d\d)\b/.exec(e?.message ?? '');
  return m ? Number(m[1]) : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gemini adapter (Google Gen AI SDK). Server-side only: the API key never reaches a browser. */
export class GeminiClient implements LlmClient {
  readonly model: string;
  private ai: GoogleGenAI;
  private fallback: GoogleGenAI | null;
  private readonly maxRetries: number;
  private readonly thinkingLevel?: string;

  constructor(opts: GeminiOptions) {
    if (!opts.apiKey && !opts.fallbackApiKey) throw new Error('GEMINI_API_KEY is not set');
    const make = (apiKey: string) => new GoogleGenAI({ apiKey, httpOptions: { timeout: opts.timeoutMs ?? 60_000 } });
    this.ai = make(opts.apiKey || opts.fallbackApiKey!);
    this.fallback = opts.apiKey && opts.fallbackApiKey ? make(opts.fallbackApiKey) : null;
    this.model = opts.model;
    this.maxRetries = opts.maxRetries ?? 3;
    this.thinkingLevel = (opts.thinkingLevel || 'LOW').toUpperCase();
  }

  async generateJson(req: JsonRequest): Promise<JsonResponse> {
    let useSchema = !!req.jsonSchema;
    let schemaDropped = false;

    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      try {
        const res = await this.ai.models.generateContent({
          model: this.model,
          contents: [{ role: 'user', parts: [{ text: req.user }] }],
          config: {
            systemInstruction: req.system,
            responseMimeType: 'application/json',
            ...(useSchema ? { responseJsonSchema: req.jsonSchema } : {}),
            ...(/^gemini-3/.test(this.model) ? { thinkingConfig: { thinkingLevel: this.thinkingLevel as never } } : {}),
          },
        });
        const u = res.usageMetadata ?? {};
        return {
          text: res.text ?? '',
          model: res.modelVersion ?? this.model,
          usage: {
            inputTokens: u.promptTokenCount ?? 0,
            outputTokens: u.candidatesTokenCount ?? 0,
            thinkingTokens: u.thoughtsTokenCount ?? 0,
            cachedTokens: u.cachedContentTokenCount ?? 0,
          },
          latencyMs: Date.now() - started,
          schemaDropped,
        };
      } catch (err) {
        const status = statusOf(err);
        const msg = (err as Error)?.message ?? String(err);
        if (status === 400 && useSchema && /schema/i.test(msg)) {
          logger.warn('llm.schema_rejected_falling_back', { model: this.model, message: msg.slice(0, 300) });
          useSchema = false;
          schemaDropped = true;
          continue;
        }
        const quota = status === 429 && /quota|PerDay|free_tier/i.test(msg);
        if ((quota || status === 401 || status === 403) && this.fallback) {
          // Primary key exhausted or rejected → switch to the backup key for the rest of this process.
          logger.warn('llm.switching_to_fallback_key', { model: this.model, status });
          this.ai = this.fallback;
          this.fallback = null;
          continue;
        }
        if (quota) {
          throw new QuotaExceededError(`Gemini quota exhausted for ${this.model}: ${msg.slice(0, 200)}`);
        }
        const network = status === undefined && /fetch failed|ECONNRESET|ETIMEDOUT|timeout|aborted|socket/i.test(msg);
        if ((network || (status !== undefined && RETRYABLE.has(status))) && attempt < this.maxRetries) {
          const wait = 1000 * 2 ** attempt + Math.floor(Math.random() * 250);
          logger.warn('llm.retry', { model: this.model, status, attempt: attempt + 1, waitMs: wait });
          await sleep(wait);
          continue;
        }
        throw err;
      }
    }
  }
}
