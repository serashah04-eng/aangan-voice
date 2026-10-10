import type { TokenUsage } from '../../lib/cost';

export type JsonRequest = {
  system: string;
  user: string;
  /** JSON Schema for structured output. Adapters may drop it if the provider rejects it. */
  jsonSchema?: Record<string, unknown>;
};

export type JsonResponse = {
  /** Raw text returned by the model (expected to be JSON). */
  text: string;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  /** True if the adapter had to fall back to plain JSON mode without the schema. */
  schemaDropped: boolean;
};

/** Every LLM sits behind this interface; tests use the in-memory mock. */
export interface LlmClient {
  readonly model: string;
  generateJson(req: JsonRequest): Promise<JsonResponse>;
}
