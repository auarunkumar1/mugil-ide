import type { ChatMessage, CompletionResult, HandoffOptions, ModelSpec } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import { modelSupportsThinking } from '../../config.js';
import type { ProviderClient, ProviderCompleteOptions } from './provider.js';
import { isAbortError } from './provider.js';
import type { StreamHandlers } from './stream.js';

export interface HandoffManagerOptions {
  client: ProviderClient;
  models: ModelSpec[];
}

export interface HandoffResult extends CompletionResult {
  /** Models tried, in order, before success. */
  attempts: string[];
}

/**
 * Auto Handoff Manager.
 *
 * Routes a request to the cheapest model that can plausibly handle it, then
 * hands off up the ladder when a model fails (rate limit, server error,
 * context overflow) or when the task exceeds the current model's comfort
 * zone.
 */
export class HandoffManager {
  private client: ProviderClient;
  private models: ModelSpec[];
  private byId: Map<string, ModelSpec>;

  constructor(options: HandoffManagerOptions) {
    this.client = options.client;
    this.models = options.models;
    this.byId = new Map(options.models.map((m) => [m.id, m]));
  }

  setClient(client: ProviderClient): void {
    this.client = client;
  }

  get isMock(): boolean {
    return Boolean(this.client.mock);
  }

  get currentClient(): ProviderClient {
    return this.client;
  }

  setModels(models: ModelSpec[]): void {
    this.models = models;
    this.byId = new Map(models.map((m) => [m.id, m]));
  }

  /** Picks the cheapest tier whose context window fits the request. */
  route(promptTokens: number, preferredModel?: string): ModelSpec {
    if (preferredModel) {
      const preferred = this.byId.get(preferredModel);
      if (preferred) return preferred;
      return {
        id: preferredModel,
        tier: 'standard',
        costPerMTokIn: 0,
        costPerMTokOut: 0,
        contextWindow: 128000,
        supportsThinking: modelSupportsThinking(preferredModel),
      };
    }
    const fits = this.models.filter((m) => m.contextWindow >= promptTokens);
    const candidates = fits.length > 0 ? fits : this.models;
    if (candidates.length > 0 && candidates[0]) {
      return candidates[0];
    }
    return {
      id: 'default',
      tier: 'standard',
      costPerMTokIn: 0,
      costPerMTokOut: 0,
      contextWindow: 128000,
    };
  }

  /**
   * Models to try, in order, for one request. Single source of truth for both
   * `complete()` and `stream()` so the two paths cannot walk different ladders.
   *
   * When a `preferredModel` is set it is authoritative: the chain is
   * `[preferred, ...fallbackChain]` and never silently escalates into the rest
   * of the model ladder — a user who picked a local Ollama model must not end
   * up answered by a totally different model. Only auto-routing (no
   * preferredModel) walks the full ladder
   * `[primary, ...fallbackChain, ...models-with-larger-context]`.
   */
  private buildChain(messages: ChatMessage[], options: HandoffOptions): string[] {
    const promptTokens = messages.reduce((sum, m) => sum + this.tokens(m.content), 0);
    const primary = this.route(promptTokens, options.preferredModel);

    const ladder = options.preferredModel ? [] : this.models;
    const chain: string[] = [];
    const seen = new Set<string>();
    for (const id of [primary.id, ...(options.fallbackChain ?? [])]) {
      if (!seen.has(id)) {
        seen.add(id);
        chain.push(id);
      }
    }
    for (const model of ladder) {
      if (!seen.has(model.id)) chain.push(model.id);
    }
    return chain;
  }

  /** Provider options for a single attempt at `modelId`. */
  private attemptOptions(options: HandoffOptions, modelId: string): ProviderCompleteOptions {
    return {
      model: modelId,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      thinkingLevel: options.thinkingLevel,
      thinkingBudgetTokens: options.thinkingBudgetTokens,
      tools: options.tools,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      stream: options.stream,
    };
  }

  /**
   * Runs `attempt` against each model in `chain`, recording every id it reaches
   * in `attempts`. Rethrows the last error once the chain is exhausted.
   *
   * Shared by `complete()` and `stream()` so the break policy is identical on
   * both paths: a user cancel stops immediately, and a non-retryable 400/401/403
   * is a request bug that every model would reject the same way.
   */
  private async walk(
    chain: string[],
    attempts: string[],
    attempt: (modelId: string) => Promise<CompletionResult>,
  ): Promise<CompletionResult> {
    let lastError: unknown;

    for (const modelId of chain) {
      attempts.push(modelId);
      try {
        return await attempt(modelId);
      } catch (err) {
        lastError = err;
        // A user cancel is not a model failure — walking the rest of the ladder
        // would restart the request the user just aborted.
        if (isAbortError(err)) break;
        // Non-retryable errors (e.g. 400 invalid request, 401 auth, 403 forbidden) shouldn't burn the whole chain.
        if (err instanceof Error && 'retryable' in err && (err as { retryable: boolean }).retryable === false) {
          const status = (err as { status?: number }).status;
          if (status !== undefined && [400, 401, 403].includes(status)) {
            break;
          }
        }
      }
    }

    throw lastError ?? new Error('handoff chain exhausted');
  }

  /**
   * Runs the completion, walking the fallback chain on failure.
   *
   * See `buildChain()` for how the chain is ordered and `walk()` for the
   * break/rethrow policy.
   */
  async complete(
    messages: ChatMessage[],
    options: HandoffOptions = {},
  ): Promise<HandoffResult> {
    const attempts: string[] = [];
    const result = await this.walk(this.buildChain(messages, options), attempts, (modelId) =>
      this.client.complete(messages, this.attemptOptions(options, modelId)),
    );
    return { ...result, attempts };
  }

  /**
   * Streaming variant of `complete()`.
   *
   * Walks the identical chain with the identical break policy — a provider
   * that rejects SSE, or a stream that dies mid-flight, degrades to the next
   * model instead of hard-failing the turn the way a bare `client.stream()`
   * call would. A client with no `stream()` falls back to `complete()` for that
   * attempt and replays the answer as one delta flagged `streamed: false`, so
   * no provider loses support by omission and no renderer mistakes the replay
   * for a live stream. `options.stream === false` opts out at this layer too,
   * so a caller that reaches `stream()` directly gets the same buffered result
   * `streamCompletion` would give it.
   */
  async stream(
    messages: ChatMessage[],
    options: HandoffOptions = {},
    handlers: StreamHandlers = {},
  ): Promise<HandoffResult> {
    if (options.stream === false) {
      const buffered = await this.complete(messages, options);
      // One delta, flagged `streamed: false`: a renderer must not read "I got a
      // delta" as "streaming is on".
      if (buffered.content.length > 0) handlers.onDelta?.(buffered.content, false);
      if (buffered.thinking && buffered.thinking.length > 0) handlers.onThinking?.(buffered.thinking);
      return buffered;
    }
    const attempts: string[] = [];
    const client = this.client;
    const result = await this.walk(this.buildChain(messages, options), attempts, async (modelId) => {
      const attempt = this.attemptOptions(options, modelId);
      if (client.stream) return client.stream(messages, attempt, handlers);
      const buffered = await client.complete(messages, attempt);
      if (buffered.content.length > 0) handlers.onDelta?.(buffered.content, false);
      if (buffered.thinking && buffered.thinking.length > 0) handlers.onThinking?.(buffered.thinking);
      return buffered;
    });
    return { ...result, attempts };
  }

  private tokens(text: string): number {
    return countTokens(text);
  }
}
