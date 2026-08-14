import type { ChatMessage, CompletionResult, HandoffOptions, ModelSpec } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import type { ProviderClient } from './provider.js';

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
  private readonly client: ProviderClient;
  private readonly models: ModelSpec[];
  private readonly byId: Map<string, ModelSpec>;

  constructor(options: HandoffManagerOptions) {
    this.client = options.client;
    this.models = options.models;
    this.byId = new Map(options.models.map((m) => [m.id, m]));
  }

  /** Picks the cheapest tier whose context window fits the request. */
  route(promptTokens: number, preferredModel?: string): ModelSpec {
    if (preferredModel) {
      const preferred = this.byId.get(preferredModel);
      if (preferred) return preferred;
    }
    const fits = this.models.filter((m) => m.contextWindow >= promptTokens);
    const candidates = fits.length > 0 ? fits : this.models;
    return candidates[0]!;
  }

  /**
   * Runs the completion, walking the fallback chain on failure. The chain is
   * `[preferred, ...fallbackChain, ...models-with-larger-context]`.
   */
  async complete(
    messages: ChatMessage[],
    options: HandoffOptions = {},
  ): Promise<HandoffResult> {
    const promptTokens = messages.reduce((sum, m) => sum + this.tokens(m.content), 0);
    const primary = this.route(promptTokens, options.preferredModel);

    const chain: string[] = [];
    const seen = new Set<string>();
    for (const id of [primary.id, ...(options.fallbackChain ?? [])]) {
      if (!seen.has(id)) {
        seen.add(id);
        chain.push(id);
      }
    }
    for (const model of this.models) {
      if (!seen.has(model.id)) chain.push(model.id);
    }

    const attempts: string[] = [];
    let lastError: unknown;

    for (const modelId of chain) {
      attempts.push(modelId);
      try {
        const result = await this.client.complete(messages, {
          model: modelId,
          maxTokens: options.maxTokens,
          temperature: options.temperature,
        });
        return { ...result, attempts };
      } catch (err) {
        lastError = err;
        // Non-retryable errors (e.g. 400 auth) shouldn't burn the whole chain.
        if (err instanceof Error && 'retryable' in err && (err as { retryable: boolean }).retryable === false) {
          if ((err as { status?: number }).status !== undefined && (err as { status?: number }).status === 400) {
            break;
          }
        }
      }
    }

    throw lastError ?? new Error('handoff chain exhausted');
  }

  private tokens(text: string): number {
    return countTokens(text);
  }
}
