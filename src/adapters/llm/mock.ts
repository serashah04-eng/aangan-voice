import type { JsonRequest, JsonResponse, LlmClient } from './types';

/** In-memory LLM for tests and the offline simulator: returns scripted JSON, records requests. */
export class MockLlmClient implements LlmClient {
  readonly model = 'mock-llm';
  readonly requests: JsonRequest[] = [];

  constructor(private readonly respond: (req: JsonRequest) => unknown) {}

  async generateJson(req: JsonRequest): Promise<JsonResponse> {
    this.requests.push(req);
    const out = this.respond(req);
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    return {
      text,
      model: this.model,
      usage: { inputTokens: Math.ceil((req.system.length + req.user.length) / 4), outputTokens: Math.ceil(text.length / 4), thinkingTokens: 0 },
      latencyMs: 0,
      schemaDropped: false,
    };
  }
}
