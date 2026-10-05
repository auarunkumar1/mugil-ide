import type { ChatMessage, CompletionResult, ThinkingLevel, ToolDefinition } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import type { StreamedCompletion, StreamHandlers } from './stream.js';

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

/** OpenAI-compatible `tools` wire format (used by openAi.ts and openRouter.ts). */
export function toOpenAiTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
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
  if (thinking || !content.includes('<think>')) return { content, thinking };
  const match = content.match(/<think>([\s\S]*?)<\/think>/i);
  if (!match) return { content, thinking };
  return {
    content: content.replace(/<think>[\s\S]*?<\/think>/i, '').trim(),
    thinking: match[1]?.trim(),
  };
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

  const promptTokens = streamed.usage?.promptTokens ?? countTokens(messages.map((m) => m.content).join('\n'));
  const completionTokens = streamed.usage?.completionTokens ?? countTokens(content);
  return {
    provider,
    model: streamed.model ?? options.model,
    content,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: streamed.usage?.totalTokens ?? promptTokens + completionTokens,
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
