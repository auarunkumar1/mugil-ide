import type { ChatMessage, CompletionResult, HandoffOptions, ModelSpec } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import { modelSupportsThinking } from '../../config.js';
import type { ProviderClient, ProviderCompleteOptions } from './provider.js';
import { estimateMessagesTokens, isAbortError } from './provider.js';
import type { StreamHandlers } from './stream.js';
import { globalSecretVault } from '../security/secretVault.js';
import { scanSecrets } from '../security/secretScanner.js';
import { SecretLeakError } from '../security/outboundGuard.js';

export interface HandoffManagerOptions {
  client: ProviderClient;
  models: ModelSpec[];
  secretPolicy?: 'local-only' | 'redact';
  sensitivePolicy?: 'secrets' | 'secrets+pii';
  localEndpointsPolicy?: 'loopback' | 'private-lan';
  providerV2?: boolean;
}

export interface HandoffResult extends CompletionResult {
  /** Models tried, in order, before success. */
  attempts: string[];
}

/**
 * Last-chance redaction applied to every message leaving the process.
 *
 * Ingestion and tool output are already sanitized, so this is normally a
 * no-op pass (one substring check keeps the hot path cheap). It exists so a
 * secret that arrives by any other route — a prompt the caller assembled
 * itself, a session file written by an older version — cannot reach a remote
 * model in cleartext.
 */
function redactForRemote(messages: ChatMessage[]): ChatMessage[] {
  const dirty = messages.some(
    (message) =>
      message.content.includes('[MUGIL_SECRET_') ||
      scanSecrets(message.content).length > 0 ||
      Boolean(message.toolCalls?.some((call) => scanSecrets(call.arguments).length > 0)),
  );
  if (!dirty) return messages;
  const tokenized = messages.map((message) => {
    const next: ChatMessage = {
      ...message,
      content: globalSecretVault.tokenize(message.content).text,
    };
    if (message.toolCalls) {
      next.toolCalls = message.toolCalls.map((call) => ({
        ...call,
        arguments: globalSecretVault.tokenize(call.arguments).text,
      }));
    }
    return next;
  });

  // Outbound verification: fail closed if an un-tokenized secret survived
  for (const msg of tokenized) {
    const leaks = scanSecrets(msg.content);
    if (leaks.length > 0) {
      throw new SecretLeakError(leaks[0]!.type, 'remote-provider');
    }
    if (msg.toolCalls) {
      for (const call of msg.toolCalls) {
        const callLeaks = scanSecrets(call.arguments);
        if (callLeaks.length > 0) {
          throw new SecretLeakError(callLeaks[0]!.type, 'remote-provider');
        }
      }
    }
  }

  return tokenized;
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
  private secretPolicy: 'local-only' | 'redact';
  private sensitivePolicy: 'secrets' | 'secrets+pii';
  private localEndpointsPolicy: 'loopback' | 'private-lan';
  private providerV2: boolean;

  constructor(options: HandoffManagerOptions) {
    this.client = options.client;
    this.models = options.models;
    this.byId = new Map(options.models.map((m) => [m.id, m]));
    this.secretPolicy = options.secretPolicy ?? 'local-only';
    this.sensitivePolicy = options.sensitivePolicy ?? 'secrets';
    this.localEndpointsPolicy = options.localEndpointsPolicy ?? 'loopback';
    this.providerV2 = options.providerV2 ?? false;
  }

  setSecretPolicy(policy: 'local-only' | 'redact'): void {
    this.secretPolicy = policy;
  }

  setSensitivePolicy(policy: 'secrets' | 'secrets+pii'): void {
    this.sensitivePolicy = policy;
  }

  setLocalEndpointsPolicy(policy: 'loopback' | 'private-lan'): void {
    this.localEndpointsPolicy = policy;
  }

  setProviderV2(enabled: boolean): void {
    this.providerV2 = enabled;
  }

  isModelLocal(spec?: ModelSpec): boolean {
    if (!spec) return false;
    if (spec.isLocal) return true;
    if (spec.provider && ['llamacpp', 'ollama', 'lmstudio', 'local'].includes(spec.provider)) return true;
    if (['llamacpp', 'ollama', 'lmstudio', 'local'].some((p) => spec.id.startsWith(`${p}/`))) return true;
    if (this.client && 'providerKind' in this.client && ['llamacpp', 'ollama', 'lmstudio', 'custom'].includes((this.client as any).providerKind)) return true;
    if (this.client && 'name' in this.client && ['llamacpp', 'ollama', 'lmstudio', 'local'].includes((this.client as any).name)) return true;
    return false;
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
    if (candidates.length > 0) {
      const tierRank: Record<string, number> = { cheap: 1, standard: 2, smart: 3 };
      const sorted = [...candidates].sort((a, b) => {
        const trA = tierRank[a.tier] ?? 99;
        const trB = tierRank[b.tier] ?? 99;
        if (trA !== trB) return trA - trB;
        return a.costPerMTokIn - b.costPerMTokIn;
      });
      return sorted[0]!;
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
    const hasSecrets = messages.some(
      (m) =>
        m.content.includes('[MUGIL_SECRET_') ||
        scanSecrets(m.content).length > 0 ||
        Boolean(
          m.toolCalls?.some(
            (call) =>
              call.arguments.includes('[MUGIL_SECRET_') ||
              scanSecrets(call.arguments).length > 0,
          ),
        ),
    );

    const clientIsLocal =
      Boolean((this.client as any)?.isLocal) ||
      ('providerKind' in this.client &&
        ['llamacpp', 'ollama', 'lmstudio', 'custom'].includes(
          (this.client as any).providerKind,
        )) ||
      ('name' in this.client &&
        ['llamacpp', 'ollama', 'lmstudio', 'local'].includes(
          (this.client as any).name,
        ));

    const secretLocalOnly = this.secretPolicy === 'local-only' && hasSecrets;

    if (secretLocalOnly) {
      // A secret-bearing turn must never be sent through a remote client. The
      // policy cannot magically switch providers mid-turn, so fail closed and
      // tell the user to select a local provider.
      if (!clientIsLocal) {
        throw new SecretLeakError(
          'secret-local-only-policy',
          'remote-provider (Secret policy is "local-only"; switch to llama.cpp, Ollama, or LM Studio for this turn)',
        );
      }
      if (options.preferredModel) {
        const preferredSpec = this.byId.get(options.preferredModel);
        if (preferredSpec && !this.isModelLocal(preferredSpec)) {
          throw new SecretLeakError(
            'secret-local-only-policy',
            `remote-model "${options.preferredModel}" (Secret policy is "local-only"; switch to a local model for this turn)`,
          );
        }
      }
    }

    const promptTokens = estimateMessagesTokens(messages, options.tools);
    const primary = this.route(promptTokens, options.preferredModel);

    let ladder = options.preferredModel ? [] : this.models;
    if (secretLocalOnly) {
      ladder = ladder.filter((m) => this.isModelLocal(m));
    }
    const chain: string[] = [];
    const seen = new Set<string>();
    for (const id of [primary.id, ...(options.fallbackChain ?? [])]) {
      if (secretLocalOnly) {
        const spec = this.byId.get(id);
        if (!this.isModelLocal(spec)) continue;
      }
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
      protocol: this.byId.get(modelId)?.protocol,
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
        // Non-retryable errors (e.g. 400 invalid request, 401 auth, 403 forbidden, 429 quota exhaustion) shouldn't burn the whole chain.
        if (
          err instanceof Error &&
          'retryable' in err &&
          (err as { retryable: boolean }).retryable === false
        ) {
          break;
        }
        if (
          err instanceof Error &&
          'retryAfter' in err &&
          typeof (err as { retryAfter?: number }).retryAfter === 'number' &&
          (err as { retryAfter: number }).retryAfter > 0
        ) {
          const delayMs = Math.min((err as { retryAfter: number }).retryAfter * 1000, 5000);
          await new Promise((r) => setTimeout(r, delayMs));
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
  async complete(messages: ChatMessage[], options: HandoffOptions = {}): Promise<HandoffResult> {
    const attempts: string[] = [];
    const safeMessages = redactForRemote(messages);
    const result = await this.walk(this.buildChain(safeMessages, options), attempts, (modelId) =>
      this.client.complete(safeMessages, this.attemptOptions(options, modelId)),
    );
    return { ...result, attempts };
  }

  /**
   * Streaming variant of `complete()`.
   *
   * Walks the identical chain with the identical break policy — a stream that
   * fails retryably (429/5xx) or dies mid-flight degrades to the next model
   * instead of hard-failing the turn the way a bare `client.stream()` call
   * would. A non-retryable rejection is not absorbed: `walk()` breaks on
   * `400`/`401`/`403` and rethrows, so a provider that rejects SSE outright
   * fails the turn rather than walking on. A client with no `stream()` falls
   * back to `complete()` for that attempt and replays the answer as one delta
   * flagged `streamed: false`, so
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
      if (buffered.thinking && buffered.thinking.length > 0)
        handlers.onThinking?.(buffered.thinking, false);
      return buffered;
    }
    const attempts: string[] = [];
    const client = this.client;
    const safeMessages = redactForRemote(messages);
    const result = await this.walk(
      this.buildChain(safeMessages, options),
      attempts,
      async (modelId) => {
        const attempt = this.attemptOptions(options, modelId);
        if (client.stream) return client.stream(safeMessages, attempt, handlers);
        const buffered = await client.complete(safeMessages, attempt);
        if (buffered.content.length > 0) handlers.onDelta?.(buffered.content, false);
        if (buffered.thinking && buffered.thinking.length > 0)
          handlers.onThinking?.(buffered.thinking, false);
        return buffered;
      },
    );
    return { ...result, attempts };
  }

  private tokens(text: string): number {
    return countTokens(text);
  }
}
