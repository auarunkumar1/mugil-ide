import type { ChatMessage, CompletionResult, ThinkingLevel, ToolCall, ToolDefinition } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import { parseOpenAiSse, type StreamedCompletion, type StreamHandlers } from './stream.js';

export interface ProviderCompleteOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  thinkingLevel?: ThinkingLevel;
  thinkingBudgetTokens?: number;
  /** Tools the model may call. Omit for plain completions. */
  tools?: ToolDefinition[];
  /**
   * Cancels the in-flight HTTP request. Threaded from the REPL so Ctrl-C can
   * abort a hung provider instead of wedging the session.
   */
  signal?: AbortSignal;
  /**
   * Hard wall-clock cap for the request. Without one, a provider that accepts
   * the connection and then stalls hangs the turn forever.
   */
  timeoutMs?: number;
  /**
   * Opt out of streaming for this request even when the provider supports it.
   * Defaults to streaming when a client implements `stream()`.
   */
  stream?: boolean;
}

/**
 * Combines a caller-supplied signal with a timeout into one signal.
 * Returns undefined when neither is requested, so callers can omit the key.
 */
export function requestSignal(options: ProviderCompleteOptions): AbortSignal | undefined {
  const timeout = options.timeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS;
  const timeoutSignal = Number.isFinite(timeout) && timeout > 0 ? AbortSignal.timeout(timeout) : undefined;
  const external = options.signal;
  if (!external && !timeoutSignal) return undefined;
  if (!external) return timeoutSignal;
  if (!timeoutSignal) return external;
  // Any source firing aborts the request.
  return AbortSignal.any([external, timeoutSignal]);
}

/**
 * Generous enough that a long reasoning turn still completes, tight enough
 * that a dead connection surfaces as an error instead of an infinite wait.
 */
export const DEFAULT_COMPLETION_TIMEOUT_MS = 300_000;

/** True when a rejection is an abort (user cancel or timeout), not a real failure. */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

/**
 * Recursively canonicalizes an object or array by sorting object keys alphabetically.
 * Guarantees byte-level prefix stability across JSON serialization so OpenAI, DeepSeek,
 * and Gemini KV caches hit reliably without random key permutation busting the cache.
 */
export function canonicalizeJson<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item)) as unknown as T;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const result: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    result[k] = canonicalizeJson(obj[k]);
  }
  return result as T;
}

/** OpenAI-compatible `tools` wire format with canonicalized parameters for byte-level prefix stability. */
export function toOpenAiTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  // Sort tools by name to ensure stable prefix across request iterations
  const stableTools = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  return stableTools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: canonicalizeJson(t.parameters),
    },
  }));
}

/** Accurate prompt token estimator across messages and tool calls/schemas. */
export function estimateMessagesTokens(messages: ChatMessage[], tools?: ToolDefinition[]): number {
  let count = 0;
  for (const m of messages) {
    count += countTokens(m.content || '');
    if (m.toolCalls) {
      for (const call of m.toolCalls) {
        count += countTokens(call.name) + countTokens(call.arguments || '');
      }
    }
  }
  if (tools && tools.length > 0) {
    count += countTokens(JSON.stringify(tools));
  }
  return count;
}

/**
 * Neutral ChatMessage[] -> OpenAI-compatible wire messages.
 * Translates camelCase `toolCalls`/`toolCallId` into the snake_case
 * `tool_calls`/`tool_call_id` the API expects; plain messages pass through.
 */
export function toOpenAiMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m): Record<string, unknown> => {
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * A completion provider the HandoffManager can route to. OpenRouter, OpenAI
 * and Anthropic all implement this shape; each falls back to the offline
 * mock when its API key is absent.
 */
export interface ProviderClient {
  readonly mock: boolean;
  complete(messages: ChatMessage[], options: ProviderCompleteOptions): Promise<CompletionResult>;
  /**
   * Optional streaming completion.
   *
   * Best-effort contract: returning a rejected promise (a provider that does
   * not accept SSE, a body-less 200) degrades to the next model in the
   * `HandoffManager` ladder, not to a crash — the caller sees the same
   * behaviour as a retryable `complete()` failure. When the method is absent
   * the manager falls back to `complete()` and replays the answer as a single
   * delta, so every provider keeps working.
   */
  stream?(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    handlers?: StreamHandlers,
  ): Promise<CompletionResult>;
}

/**
 * Lifts a `<think>...</think>` block out of `content` into `thinking`.
 *
 * Local reasoning models (DeepSeek-R1 style) inline their reasoning in the
 * answer text instead of a `reasoning_content` field, so without this the
 * assistant renders `<think>…</think>answer` verbatim. `content` is returned
 * untouched when there is no block — or when the provider already reported
 * reasoning separately, which is a more trustworthy signal than a tag in the
 * answer text. Used by every `complete()` path and by `openAiStreamResult()`
 * so buffered and streamed results agree.
 */
export function extractThinkBlock(
  content: string,
  thinking?: string,
): { content: string; thinking?: string } {
  if (thinking) return { content, thinking };

  // 1. Closed <think>...</think>
  const match = content.match(/<think>([\s\S]*?)<\/think>/i);
  if (match) {
    return {
      content: content.replace(/<think>[\s\S]*?<\/think>/i, '').trim(),
      thinking: match[1]?.trim(),
    };
  }

  // 2. Unclosed <think>... (e.g. output truncated by max_tokens mid-reasoning)
  const unclosed = content.match(/<think>([\s\S]*)$/i);
  if (unclosed) {
    return {
      content: content.replace(/<think>[\s\S]*$/i, '').trim(),
      thinking: unclosed[1]?.trim(),
    };
  }

  // 3. Alternative [THINKING]...[/THINKING]
  const altMatch = content.match(/\[THINKING\]([\s\S]*?)\[\/THINKING\]/i);
  if (altMatch) {
    return {
      content: content.replace(/\[THINKING\][\s\S]*?\[\/THINKING\]/i, '').trim(),
      thinking: altMatch[1]?.trim(),
    };
  }

  return { content, thinking };
}

/**
 * Assembles a `CompletionResult` from OpenAI-wire-format streamed output.
 * Shared by openAi / openRouter / vercel / together / cloudflare so all five
 * produce byte-identical results from the same bytes.
 *
 * Two post-processing rules mirror the non-streaming `complete()` paths, and
 * both matter for streamed turns:
 *   - a `<think>...</think>` block inside `content` (local DeepSeek-R1 style)
 *     is lifted into `thinking` and stripped from `content`;
 *   - a reasoning-only turn (empty content, no tool calls) promotes its
 *     `thinking` to `content`, so it can never render blank.
 */
export function openAiStreamResult(
  provider: string,
  messages: ChatMessage[],
  options: ProviderCompleteOptions,
  streamed: StreamedCompletion,
): CompletionResult {
  const split = extractThinkBlock(streamed.content, streamed.thinking || undefined);
  let content = split.content;
  const thinking = split.thinking;

  if (content.trim().length === 0 && streamed.toolCalls.length === 0 && thinking && thinking.trim().length > 0) {
    content = thinking;
  }

  const promptTokens = streamed.usage?.promptTokens ?? estimateMessagesTokens(messages, options.tools);
  const completionTokens = streamed.usage?.completionTokens ?? countTokens(content);
  return {
    provider,
    model: streamed.model ?? options.model,
    content,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: streamed.usage?.totalTokens ?? promptTokens + completionTokens,
      ...(streamed.usage?.cachedTokens !== undefined ? { cachedTokens: streamed.usage.cachedTokens } : {}),
    },
    finishReason: streamed.finishReason,
    toolCalls: streamed.toolCalls.length > 0 ? streamed.toolCalls : undefined,
    thinking: thinking && thinking.length > 0 ? thinking : undefined,
  };
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Deterministic offline response shared by all providers. */
export function mockCompletion(
  messages: ChatMessage[],
  options: ProviderCompleteOptions,
  missingVar: string,
): CompletionResult {
  const userText = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  const content = [
    `[mock] no ${missingVar} — offline response.`,
    `requested model: ${options.model}`,
    `prompt (${countTokens(userText)} tokens): ${userText.slice(0, 200)}${userText.length > 200 ? '…' : ''}`,
  ].join('\n');
  const promptTokens = countTokens(messages.map((m) => m.content).join('\n'));
  const completionTokens = countTokens(content);
  return {
    provider: 'mock',
    model: options.model,
    content,
    usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    finishReason: 'stop',
    mock: true,
  };
}

export interface OpenAiWireConfig {
  providerName: string;
  baseUrl: string;
  apiKey?: string;
  missingEnvVar?: string;
  chatEndpoint?: string;
  defaultHeaders?: Record<string, string>;
  extraHeaders?: Record<string, string>;
  isLocalEndpoint?: () => boolean;
}

export class OpenAiWireClient implements ProviderClient {
  readonly mock: boolean;
  protected readonly config: OpenAiWireConfig;

  constructor(config: OpenAiWireConfig) {
    this.config = config;
    const isLocal = config.isLocalEndpoint ? config.isLocalEndpoint() : false;
    this.mock = !config.apiKey && !isLocal;
  }

  buildBody(messages: ChatMessage[], options: ProviderCompleteOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: toOpenAiMessages(messages),
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options.tools && options.tools.length > 0) {
      const tools = toOpenAiTools(options.tools);
      if (tools) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }
    }
    return body;
  }

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.defaultHeaders,
      ...this.config.extraHeaders,
    };
    if (this.config.apiKey && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  protected getUrl(): string {
    const endpoint = this.config.chatEndpoint ?? '/chat/completions';
    return `${this.config.baseUrl.replace(/\/+$/, '')}${endpoint}`;
  }

  async post(messages: ChatMessage[], options: ProviderCompleteOptions, stream = false): Promise<Response> {
    const body = this.buildBody(messages, options);
    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    const res = await fetch(this.getUrl(), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal: requestSignal(options),
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      const text = await res.text();
      this.handleHttpError(res.status, res.statusText, text, retryable);
    }
    return res;
  }

  protected handleHttpError(status: number, statusText: string, bodyText: string, retryable: boolean): never {
    throw new ProviderError(
      `${this.config.providerName} ${status} ${statusText}: ${bodyText.slice(0, 300)}`,
      status,
      retryable,
    );
  }

  async stream(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    handlers: StreamHandlers,
  ): Promise<CompletionResult> {
    if (this.mock) {
      const mock = mockCompletion(messages, options, this.config.missingEnvVar ?? `${this.config.providerName.toUpperCase()}_API_KEY`);
      handlers.onDelta?.(mock.content);
      return mock;
    }
    const res = await this.post(messages, options, true);
    if (!res.body) {
      throw new ProviderError(`${this.config.providerName} returned no body to stream`, res.status, true);
    }
    const streamed = await parseOpenAiSse(res.body, handlers);
    return openAiStreamResult(this.config.providerName, messages, options, streamed);
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Promise<CompletionResult> {
    if (this.mock) {
      return mockCompletion(messages, options, this.config.missingEnvVar ?? `${this.config.providerName.toUpperCase()}_API_KEY`);
    }
    const res = await this.post(messages, options, false);
    const data = (await res.json()) as {
      model?: string;
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning_content?: string;
          reasoning?: string;
          tool_calls?: Array<{
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const message = data.choices?.[0]?.message;
    const split = extractThinkBlock(message?.content ?? '', message?.reasoning_content ?? message?.reasoning);
    let content = split.content;
    const thinking = split.thinking;
    const toolCalls: ToolCall[] = (message?.tool_calls ?? [])
      .filter((tc) => Boolean(tc?.function?.name))
      .map((tc) => ({
        id: tc.id ?? '',
        name: tc.function!.name!,
        arguments: tc.function!.arguments ?? '{}',
      }));
    if (content.trim().length === 0 && toolCalls.length === 0 && thinking && thinking.trim().length > 0) {
      content = thinking;
    }
    const promptTokens = data.usage?.prompt_tokens ?? estimateMessagesTokens(messages, options.tools);
    const completionTokens = data.usage?.completion_tokens ?? countTokens(content);
    const cachedTokens = data.usage?.prompt_tokens_details?.cached_tokens;
    const usage = {
      promptTokens,
      completionTokens,
      totalTokens: data.usage?.total_tokens ?? promptTokens + completionTokens,
      ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    };
    return {
      provider: this.config.providerName,
      model: data.model ?? options.model,
      content,
      usage,
      finishReason: data.choices?.[0]?.finish_reason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: thinking && thinking.length > 0 ? thinking : undefined,
    };
  }
}
