import type { AskResult, CacheLookupResult, ChatMessage, HandoffOptions, PipelineEvent, ToolCall } from './types.js';
import { SmartCache } from './modules/smart-cache/index.js';
import { stripSignatures } from './modules/signature-remover/index.js';
import { stripWatermarks } from './modules/watermark-remover/index.js';
import {
  ponytailInstruction,
  ponytailOutputBudget,
  type PonytailOptions,
} from './modules/ponytail/index.js';
import { refinePrompt, type RefineOptions } from './refine.js';
import { countTokens } from './token/tokenizer.js';
import type { HandoffManager } from './modules/handoff/index.js';
import { ToolLoop, type ToolLoopResult, type ToolRegistry } from './modules/tool-loop/index.js';
import { fireWebhooks, parseWebhookConfigs, type WebhookConfig } from './modules/webhooks.js';

export interface PipelineOptions {
  cache: SmartCache;
  handoff: HandoffManager;
  /** Max tokens the refined prompt is allowed to consume. */
  tokenBudget?: number;
  refine?: RefineOptions;
  /** Enable output minimization (Ponytail module). Default true. */
  ponytail?: boolean;
}

export interface AskOptions extends HandoffOptions {
  /** Skip the cache entirely for this request. */
  noCache?: boolean;
  /** Skip token refinement for this request. */
  noRefine?: boolean;
  /** Override the token budget for this request (defaults to pipeline.tokenBudget or model context window). */
  tokenBudget?: number;
  systemPrompt?: string;
  /** Multi-turn conversation history before this prompt. */
  history?: ChatMessage[];
  /**
   * Executors for the declared tools. Required when `tools` is set — a
   * declared tool without an executor throws before any request is sent.
   */
  toolRegistry?: ToolRegistry;
  /** Max tool-loop iterations before a forced final answer. Default 6. */
  maxToolIterations?: number;
  /**
   * Gates each tool call (allow/ask/deny). A denied call is fed back to the
   * model as a tool result. Absent = allow all (backwards compatible).
   */
  permission?: (call: ToolCall) => boolean | Promise<boolean>;
  /** Live progress callback; emitted synchronously as the pipeline runs. */
  onEvent?: (event: PipelineEvent) => void;
  /**
   * Output minimization. `true` (default) appends the Ponytail instruction to
   * the system prompt; pass `{ outputBudget }` to also cap completion tokens.
   */
  ponytail?: boolean | PonytailOptions;
  /**
   * Webhook endpoints to notify (`turn.started` / `tool.executed` /
   * `turn.completed` / `turn.error`). Defaults to `MUGIL_IDE_WEBHOOKS` /
   * `MUGIL_IDE_WEBHOOKS_CONFIG`. Delivery is fire-and-forget and never
   * slows the loop.
   */
  webhooks?: WebhookConfig[];
  /** Injectable fetch for webhook delivery (tests). */
  webhookFetch?: typeof fetch;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are a precise, terse engineering assistant. Answer directly; no preamble, no disclaimers.';

/**
 * The engine pipeline: signature-strip -> token-efficient refinement ->
 * smart-cache lookup -> handoff -> watermark strip -> cache store. The handoff
 * stage forks: plain asks go to the handoff ladder, while asks that declare
 * tools run the bounded ToolLoop instead — and tool-bearing asks bypass the
 * cache entirely (lookup and store). Every stage degrades gracefully (offline
 * mock completions, in-memory cache, estimator tokens).
 */
export class Pipeline {
  private readonly cache: SmartCache;
  private readonly handoff: HandoffManager;
  public tokenBudget: number;
  private readonly refineOptions: RefineOptions;
  private readonly ponytailEnabled: boolean;

  constructor(options: PipelineOptions) {
    this.cache = options.cache;
    this.handoff = options.handoff;
    this.tokenBudget = options.tokenBudget ?? Number.POSITIVE_INFINITY;
    this.refineOptions = options.refine ?? {};
    this.ponytailEnabled = options.ponytail ?? true;
  }

  async ask(prompt: string, options: AskOptions = {}): Promise<AskResult> {
    const webhooks = options.webhooks ?? parseWebhookConfigs();
    const startedAt = Date.now();
    void fireWebhooks(webhooks, 'turn.started', { prompt }, options.webhookFetch);
    try {
      const result = await this.runAsk(prompt, options, webhooks);
      void fireWebhooks(
        webhooks,
        'turn.completed',
        {
          response: result.response,
          model: result.model,
          provider: result.provider,
          usage: result.usage,
          toolCalls: result.toolCalls,
          durationMs: Date.now() - startedAt,
        },
        options.webhookFetch,
      );
      return result;
    } catch (err) {
      void fireWebhooks(
        webhooks,
        'turn.error',
        { error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startedAt },
        options.webhookFetch,
      );
      throw err;
    }
  }

  private async runAsk(
    prompt: string,
    options: AskOptions,
    webhooks: WebhookConfig[],
  ): Promise<AskResult> {
    const emit = options.onEvent ?? (() => {});
    const effectiveBudget = options.tokenBudget ?? this.tokenBudget;
    // Tool-bearing requests bypass the cache entirely (lookup AND store): a
    // cache hit would skip tool execution, which is wrong for side-effectful
    // tools and stale for any tool whose result may have changed.
    const hasTools = Boolean(options.tools && options.tools.length > 0);

    // 1. Signature removal + refinement
    emit({ type: 'stage', stage: 'signature' });
    const stripped = stripSignatures(prompt);
    emit({ type: 'stage', stage: 'refine' });
    const refine = refinePrompt(stripped.text, {
      ...this.refineOptions,
      budgetTokens: effectiveBudget,
    });
    emit({ type: 'refined', refine });

    // 2. Cache lookup
    emit({ type: 'stage', stage: 'cache' });
    let cacheLookup: CacheLookupResult = {};
    // Scope the cache to the explicitly requested model so a cached answer
    // produced under another selection (e.g. DeepSeek) is never served for a
    // local model. `openrouter/auto` routes dynamically — keep it shared.
    const cacheModel =
      options.preferredModel && options.preferredModel !== 'openrouter/auto'
        ? options.preferredModel
        : undefined;
    if (!options.noCache && !hasTools) {
      cacheLookup = await this.cache.lookup(prompt, { model: cacheModel });
      // If we are currently running with a LIVE provider, ignore any stale
      // cached mock responses! The stored `mock` flag is authoritative; legacy
      // entries (written before the flag existed) fall back to the [mock]
      // content marker. An entry flagged mock:false is served even when its
      // text happens to contain "[mock]".
      if (
        cacheLookup.entry &&
        !this.handoff.isMock &&
        (cacheLookup.entry.mock === true ||
          (cacheLookup.entry.mock === undefined &&
            cacheLookup.entry.response.includes('[mock]')))
      ) {
        cacheLookup = {};
      }
    }
    emit({ type: 'cache', hit: Boolean(cacheLookup.entry), kind: cacheLookup.kind });
    if (cacheLookup.entry && cacheLookup.kind !== 'partial') {
      const usage = cacheLookup.entry.usage ?? {
        promptTokens: refine.originalTokens,
        completionTokens: countTokens(cacheLookup.entry.response),
        totalTokens: refine.originalTokens + countTokens(cacheLookup.entry.response),
      };
      emit({ type: 'done', usage });
      return {
        response: cacheLookup.entry.response,
        model: cacheLookup.entry.model,
        provider: 'cache',
        mock: false,
        usage,
        refine,
        cache: { hit: true, kind: cacheLookup.kind },
        toolCalls: 0,
      };
    }

    // 3. Build messages and call the handoff manager.
    const effectivePrompt =
      cacheLookup.kind === 'partial' && cacheLookup.delta
        ? `The following was already answered, continue from where it left off.\n\n${cacheLookup.delta}`
        : options.noRefine
          ? prompt
          : refine.refined;

    // Ponytail: output minimization via a system-level instruction + cap.
    const ponytail: boolean | PonytailOptions = options.ponytail ?? this.ponytailEnabled;
    const systemParts = [options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT];
    const ponytailOpts = typeof ponytail === 'object' ? ponytail : undefined;
    if (ponytail) {
      systemParts.push(ponytailInstruction());
    }

    const messages: ChatMessage[] = [];
    const system = systemParts.filter((p) => p.trim().length > 0).join('\n\n');
    if (system.trim().length > 0) messages.push({ role: 'system', content: system });
    if (options.history && options.history.length > 0) {
      messages.push(...options.history);
    }
    messages.push({ role: 'user', content: effectivePrompt });

    const outputBudget = ponytailOutputBudget(ponytailOpts);
    // Reserve safety headroom for system prompt & tokenizer variance,
    // and cap default generation max_tokens at standard output limit (8192).
    const remainingHeadroom = Math.max(256, Math.floor(effectiveBudget - refine.refinedTokens - 1024));
    const defaultMax = Math.min(8192, remainingHeadroom);
    const maxTokens = outputBudget !== undefined ? Math.min(defaultMax, outputBudget) : options.maxTokens ?? defaultMax;
    emit({ type: 'stage', stage: 'handoff' });
    const completion = hasTools
      ? await new ToolLoop({
          handoff: this.handoff,
          maxIterations: options.maxToolIterations,
          onTool: (call, index) => {
            emit({ type: 'tool', name: call.name, args: call.arguments, index });
            void fireWebhooks(
              webhooks,
              'tool.executed',
              { name: call.name, args: call.arguments },
              options.webhookFetch,
            );
          },
          onToolResult: (call, outcome, index) => {
            emit({
              type: 'tool-result',
              name: call.name,
              index,
              ok: outcome.ok,
              result: outcome.content,
            });
          },
        }).run(messages, {
          ...options,
          tools: options.tools!,
          registry: options.toolRegistry ?? {},
          maxTokens,
        })
      : await this.handoff.complete(messages, { ...options, maxTokens });
    emit({
      type: 'handoff',
      attempts: completion.attempts,
      model: completion.model,
      mock: completion.mock,
    });

    // 4. Strip AI provenance watermarks from the generated content, store in
    //    cache (original prompt so future variants can hit), and return.
    emit({ type: 'stage', stage: 'store' });
    const strippedNew = stripWatermarks(completion.content).text;
    const response =
      cacheLookup.kind === 'partial' && cacheLookup.entry
        ? `${cacheLookup.entry.response}\n\n${strippedNew}`
        : strippedNew;
    // Never surface a blank "success": a model that consumed tokens without
    // producing text (even with no reasoning to fall back on) becomes a clear
    // error instead of an invisible empty response in the TUI.
    if (response.trim().length === 0) {
      throw new Error(
        `model returned an empty response (${completion.model}); tokens were consumed but no text was produced`,
      );
    }
    if (!options.noCache && !hasTools) {
      await this.cache.store(
        prompt,
        response,
        completion.model,
        completion.usage,
        cacheModel,
        // Always write an explicit flag: `mock` absent on a completion means
        // a live provider, so the entry must be marked mock:false — otherwise
        // a later run would fall back to the ambiguous [mock] text scan.
        completion.mock ?? false,
      );
    }
    emit({ type: 'done', usage: completion.usage });

    return {
      response,
      model: completion.model,
      provider: completion.provider,
      mock: completion.mock ?? false,
      usage: completion.usage,
      refine,
      cache: { hit: false },
      thinking: completion.thinking,
      toolCalls: hasTools ? (completion as ToolLoopResult).toolCalls : 0,
    };
  }
}
