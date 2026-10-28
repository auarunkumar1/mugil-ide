import type {
  AskResult,
  CacheLookupResult,
  ChatMessage,
  HandoffOptions,
  InputSavings,
  PipelineEvent,
  ToolCall,
  Usage,
} from './types.js';
import { SmartCache } from './modules/smart-cache/index.js';
import { stripSignatures } from './modules/signature-remover/index.js';
import { stripWatermarks } from './modules/watermark-remover/index.js';
import { streamCompletion } from './modules/handoff/stream.js';
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
  /** Store cache entries in the background asynchronously without blocking the return path. */
  asyncStore?: boolean;
}

export interface AskOptions extends HandoffOptions {
  /** Skip the cache entirely for this request. */
  noCache?: boolean;
  /** Skip token refinement for this request. */
  noRefine?: boolean;
  /** Store cache entries in the background without awaiting storage/embeddings. */
  asyncStore?: boolean;
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
  /**
   * Called when tool iterations reach the limit before forcing a final answer.
   * Return number of additional iterations (e.g. 15), or 0 to finish now.
   */
  onLimitReached?: (info: { currentIterations: number; toolCalls: number; usage: Usage }) => number | Promise<number>;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are a precise, terse engineering assistant. Answer directly; no preamble, no disclaimers.';

/**
 * Output-token target when the caller expresses no preference. Deliberately
 * generous: an answer cut off mid-sentence is a functional bug, not a token
 * saving.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_MAX_TOOL_ITERATIONS = 20;

/**
 * Resolves the default max tool iterations from environment or falls back to DEFAULT_MAX_TOOL_ITERATIONS.
 */
export function getMaxToolIterations(env: NodeJS.ProcessEnv = process.env): number {
  const custom = env.MUGIL_IDE_MAX_TOOL_ITERATIONS;
  if (custom) {
    const parsed = Number(custom);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return DEFAULT_MAX_TOOL_ITERATIONS;
}

/**
 * Resolves the default max output tokens from environment or falls back to DEFAULT_MAX_OUTPUT_TOKENS.
 */
export function getMaxOutputTokens(env: NodeJS.ProcessEnv = process.env): number {
  const custom = env.MUGIL_IDE_MAX_OUTPUT_TOKENS || env.MUGIL_IDE_OUTPUT_BUDGET;
  if (custom) {
    const parsed = Number(custom);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * Hard floor for a single completion. The pipeline never asks a provider for
 * less than this — previously the floor was 256, which silently truncated every
 * reply to a couple of sentences once history plus tool schemas exceeded the
 * prompt budget.
 */
export const MIN_MAX_OUTPUT_TOKENS = 1024;

/** Slack left for the provider's own framing when sizing max_tokens. */
const CONTEXT_SAFETY_MARGIN = 1024;

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
  private readonly asyncStore: boolean;

  constructor(options: PipelineOptions) {
    this.cache = options.cache;
    this.handoff = options.handoff;
    this.tokenBudget = options.tokenBudget ?? Number.POSITIVE_INFINITY;
    this.refineOptions = options.refine ?? {};
    this.ponytailEnabled = options.ponytail ?? true;
    this.asyncStore = options.asyncStore ?? false;
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
    // Input-side savings actually realised for this request. Measured against
    // the compressible input (signature-stripped prompt, compacted history and
    // compressed tool output) — never against the provider's prompt count,
    // which includes tens of thousands of uncompressed system/tool tokens and
    // diluted every real saving to 0%.
    const signatureSaved = options.noRefine ? 0 : Math.max(0, countTokens(prompt) - refine.originalTokens);
    const refineSaved = options.noRefine ? 0 : Math.max(0, refine.originalTokens - refine.refinedTokens);
    const savings: InputSavings = {
      savedTokens: signatureSaved + refineSaved,
      keptTokens: options.noRefine ? 0 : refine.refinedTokens,
    };

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
        // A cache hit sends no prompt at all: the entire compressible input
        // was saved. Measured against the refined prompt (the part the modules
        // own), never the provider's whole-prompt count.
        savings: { savedTokens: refine.refinedTokens, keptTokens: 0 },
        cache: { hit: true, kind: cacheLookup.kind },
        toolCalls: 0,
        truncated: false,
      };
    }

    // 3. Build messages and call the handoff manager.
    //
    // A partial cache hit means the stored prompt is a long prefix of this one,
    // so the delta alone is NOT enough context: the model needs the shared
    // prefix to know what "continue from where it left off" refers to. Sending
    // only the delta (the old behaviour) produced answers that ignored the
    // original question entirely.
    let effectivePrompt: string;
    if (cacheLookup.kind === 'partial' && cacheLookup.delta) {
      const shared = cacheLookup.entry?.prompt ?? '';
      effectivePrompt = [
        'This is a continuation of a request you have already partially answered.',
        'Original request (shared prefix):',
        shared,
        '',
        'Additional request:',
        cacheLookup.delta,
        '',
        'Answer ONLY the additional request. Do not repeat the part already answered.',
      ].join('\n');
    } else {
      effectivePrompt = options.noRefine ? prompt : refine.refined;
    }

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

    const systemTokens = countTokens(system);
    const historyTokens = options.history ? options.history.reduce((acc, m) => acc + countTokens(m.content), 0) : 0;
    const toolsTokens = options.tools ? countTokens(JSON.stringify(options.tools)) : 0;
    const totalPromptTokens = refine.refinedTokens + systemTokens + historyTokens + toolsTokens;

    const outputBudget = ponytailOutputBudget(ponytailOpts);
    // Output budget is sized independently of the prompt-trimming budget.
    // Previously the prompt budget was also the generation budget, so a session
    // with history + tool schemas over budget floored max_tokens at 256 and
    // every reply was cut off mid-sentence.
    //
    // Precedence: an explicit cap is a cap. When the caller passes maxTokens
    // AND ponytail an outputBudget, the tighter of the two wins — neither
    // silently overrides the other.
    const caps = [options.maxTokens, outputBudget].filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
    );
    const preferred = caps.length > 0 ? Math.min(...caps) : getMaxOutputTokens();
    const contextWindow = this.handoff.route(totalPromptTokens, options.preferredModel).contextWindow;
    const sizeFor = (promptTokens: number): number => {
      const contextRoom = contextWindow - promptTokens - CONTEXT_SAFETY_MARGIN;
      if (!Number.isFinite(contextRoom) || contextRoom <= 0) {
        throw new Error(
          `Context overflow: prompt (${promptTokens} tokens) plus safety margin (${CONTEXT_SAFETY_MARGIN}) exceeds model context window (${contextWindow})`,
        );
      }
      let maxTokens = preferred;
      maxTokens = Math.min(maxTokens, contextRoom);
      const floor = Math.min(MIN_MAX_OUTPUT_TOKENS, Math.floor(contextRoom));
      return Math.max(floor, Math.floor(maxTokens));
    };
    const maxTokens = sizeFor(totalPromptTokens);
    emit({ type: 'stage', stage: 'handoff' });
    let cachedExtraTokens = 0;
    let lastCountedLength = messages.length;
    const completion = hasTools
      ? await new ToolLoop({
          handoff: this.handoff,
          maxIterations: options.maxToolIterations ?? getMaxToolIterations(),
          onLimitReached: options.onLimitReached,
          // Tool results grow the context every iteration; re-size the output
          // budget against what is actually about to be sent.
          // Incrementally accumulate newly added message tokens (O(K) vs O(K^2)).
          sizeMaxTokens: (msgs) => {
            while (lastCountedLength < msgs.length) {
              cachedExtraTokens += countTokens(msgs[lastCountedLength]!.content);
              lastCountedLength += 1;
            }
            return sizeFor(totalPromptTokens + cachedExtraTokens);
          },
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
          // Provisional text: a streamed fragment that is followed by tool
          // calls must be discarded by the consumer. Renderers own that
          // decision; the pipeline only reports what arrived, including whether
          // it arrived incrementally (`streamed`) or as the buffered replay.
          onDelta: (text, streamed) => emit({ type: 'delta', text, streamed: streamed === true }),
          onThinking: (text, streamed) => emit({ type: 'thinking', text, streamed: streamed === true }),
        }).run(messages, {
          ...options,
          tools: options.tools!,
          registry: options.toolRegistry ?? {},
          maxTokens,
        })
      : await streamCompletion(
          this.handoff,
          messages,
          { ...options, maxTokens },
          {
            onDelta: (text, streamed) => emit({ type: 'delta', text, streamed: streamed === true }),
            onThinking: (text, streamed) => emit({ type: 'thinking', text, streamed: streamed === true }),
          },
        );
    emit({
      type: 'handoff',
      attempts: completion.attempts,
      model: completion.model,
      mock: completion.mock,
    });
    if (hasTools) {
      const toolSavings = (completion as ToolLoopResult).savings;
      if (toolSavings) {
        savings.savedTokens += toolSavings.savedTokens;
        savings.keptTokens += toolSavings.keptTokens;
      }
    }

    // 4. Strip AI provenance watermarks from the generated content, store in
    //    cache (original prompt so future variants can hit), and return.
    emit({ type: 'stage', stage: 'store' });
    const strippedNew = stripWatermarks(completion.content).text;
    let continuationText = strippedNew;
    if (cacheLookup.kind === 'partial' && cacheLookup.entry) {
      const cached = cacheLookup.entry.response.trim();
      // If the model repeated the cached response prefix despite the continuation instruction, strip it
      if (continuationText.trim().startsWith(cached)) {
        continuationText = continuationText.trim().slice(cached.length).trimStart();
      }
    }
    const response =
      cacheLookup.kind === 'partial' && cacheLookup.entry
        ? `${cacheLookup.entry.response}\n\n${continuationText}`
        : strippedNew;
    // Never surface a blank "success": a model that consumed tokens without
    // producing text (even with no reasoning to fall back on) becomes a clear
    // error instead of an invisible empty response in the TUI.
    if (response.trim().length === 0) {
      throw new Error(
        `model returned an empty response (${completion.model}); tokens were consumed but no text was produced`,
      );
    }
    // A completion cut off at max_tokens is a partial answer. Caching it would
    // make every later identical prompt an instant hit on the truncated stub,
    // so the user sees a permanently short answer with no visible cause.
    const finishReason = completion.finishReason;
    const truncated = finishReason === 'length' || finishReason === 'max_tokens';
    if (truncated) {
      emit({ type: 'truncated', finishReason, maxTokens });
    }
    if (!options.noCache && !hasTools && !truncated) {
      const isAsync = options.asyncStore ?? this.asyncStore;
      const storeTask = this.cache.store(
        prompt,
        response,
        completion.model,
        completion.usage,
        cacheModel,
        // Always write an explicit flag: `mock` absent on a completion means
        // a live provider, so the entry must be marked mock:false — otherwise
        // a later run would fall back to the ambiguous [mock] text scan.
        completion.mock ?? false,
        // Mark concatenations so they never seed another concatenation.
        cacheLookup.kind === 'partial',
      );
      if (isAsync) {
        void storeTask.catch(() => {});
      } else {
        await storeTask;
      }
    }
    emit({ type: 'done', usage: completion.usage });

    return {
      response,
      model: completion.model,
      provider: completion.provider,
      mock: completion.mock ?? false,
      usage: completion.usage,
      refine,
      savings,
      cache: { hit: Boolean(cacheLookup.entry), kind: cacheLookup.kind },
      thinking: completion.thinking,
      toolCalls: hasTools ? (completion as ToolLoopResult).toolCalls : 0,
      finishReason,
      truncated,
    };
  }
}
