import type { ChatMessage, CompletionResult, HandoffOptions, ModelSpec } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import { modelSupportsThinking } from '../../config.js';
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
   * Runs the completion, walking the fallback chain on failure.
   *
   * When a `preferredModel` is set it is authoritative: the chain is
   * `[preferred, ...fallbackChain]` and never silently escalates into the
   * rest of the model ladder — a user who picked a local Ollama model must
   * not end up answered by a totally different model. Only auto-routing
   * (no preferredModel) walks the full ladder
   * `[primary, ...fallbackChain, ...models-with-larger-context]`.
   */
  async complete(
    messages: ChatMessage[],
    options: HandoffOptions = {},
  ): Promise<HandoffResult> {
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

    const attempts: string[] = [];
    let lastError: unknown;

    for (const modelId of chain) {
      attempts.push(modelId);
      try {
        const result = await this.client.complete(messages, {
          model: modelId,
          maxTokens: options.maxTokens,
          temperature: options.temperature,
          thinkingLevel: options.thinkingLevel,
          thinkingBudgetTokens: options.thinkingBudgetTokens,
        });
        return { ...result, attempts };
      } catch (err) {
        lastError = err;
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

  private tokens(text: string): number {
    return countTokens(text);
  }
}
