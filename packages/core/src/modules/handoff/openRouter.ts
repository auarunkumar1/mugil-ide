import type { ChatMessage, CompletionResult, ToolCall } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import {
  extractThinkBlock,
  mockCompletion,
  openAiStreamResult,
  toOpenAiMessages,
  toOpenAiTools,
  requestSignal,
  type ProviderClient,
  type ProviderCompleteOptions,
} from './provider.js';
import { parseOpenAiSse, type StreamHandlers } from './stream.js';

export interface OpenRouterClientOptions {
  apiKey?: string;
  baseUrl?: string;
  appTitle?: string;
  appUrl?: string;
}

export type OpenRouterCompleteOptions = ProviderCompleteOptions;

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

/**
 * Minimal OpenRouter client. Without an API key it runs in mock mode and
 * returns deterministic responses so the whole pipeline is exercisable
 * offline.
 */
export class OpenRouterClient implements ProviderClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly appTitle: string;
  private readonly appUrl: string;
  readonly mock: boolean;

  constructor(options: OpenRouterClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://openrouter.ai/api/v1';
    this.appTitle = options.appTitle ?? 'Mugil IDE';
    this.appUrl = options.appUrl ?? 'https://mugil-ide.local';
    this.mock = !this.apiKey;
  }

  async complete(
    messages: ChatMessage[],
    options: OpenRouterCompleteOptions,
  ): Promise<CompletionResult> {
    if (this.mock) {
      return this.mockComplete(messages, options);
    }
    return this.remoteComplete(messages, options);
  }

  /**
   * Builds the request body. `stream: true` adds the SSE flag plus
   * `stream_options.include_usage`; without it OpenRouter omits `usage` from
   * streamed chunks and token counts fall back to estimates.
   */
  private buildBody(
    messages: ChatMessage[],
    options: OpenRouterCompleteOptions,
    stream = false,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: toOpenAiMessages(messages),
      max_tokens: options.maxTokens,
      temperature: options.temperature ?? 0.7,
    };
    if (options.tools && options.tools.length > 0) {
      body.tools = toOpenAiTools(options.tools);
    }

    if (options.thinkingLevel && options.thinkingLevel !== 'off') {
      body.reasoning = {
        effort: options.thinkingLevel,
        ...(options.thinkingBudgetTokens ? { max_tokens: options.thinkingBudgetTokens } : {}),
      };
    }

    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }
    return body;
  }

  async stream(
    messages: ChatMessage[],
    options: OpenRouterCompleteOptions,
    handlers: StreamHandlers = {},
  ): Promise<CompletionResult> {
    if (this.mock) {
      const result = this.mockComplete(messages, options);
      if (result.content.length > 0) handlers.onDelta?.(result.content);
      if (result.thinking && result.thinking.length > 0) handlers.onThinking?.(result.thinking);
      return result;
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': this.appUrl,
        'X-Title': this.appTitle,
      },
      body: JSON.stringify(this.buildBody(messages, options, true)),
      signal: requestSignal(options),
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new OpenRouterError(
        `OpenRouter ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`,
        res.status,
        retryable,
      );
    }
    if (!res.body) throw new OpenRouterError('OpenRouter returned no body to stream', res.status, true);
    const streamed = await parseOpenAiSse(res.body, handlers);
    return openAiStreamResult('openrouter', messages, options, streamed);
  }

  private async remoteComplete(
    messages: ChatMessage[],
    options: OpenRouterCompleteOptions,
  ): Promise<CompletionResult> {
    const body = this.buildBody(messages, options);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': this.appUrl,
        'X-Title': this.appTitle,
      },
      body: JSON.stringify(body),
      signal: requestSignal(options),
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new OpenRouterError(
        `OpenRouter ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`,
        res.status,
        retryable,
      );
    }

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
    // Same `<think>` split the streaming path applies, so buffered and streamed
    // results agree.
    const split = extractThinkBlock(message?.content ?? '', message?.reasoning_content ?? message?.reasoning);
    let content = split.content;
    const thinking = split.thinking;
    // Only require a function name — some OpenAI-compatible endpoints omit
    // the `type: 'function'` field on tool_calls; requiring it would silently
    // drop the model's tool request (e.g. a write_file that never runs).
    const toolCalls: ToolCall[] = (message?.tool_calls ?? [])
      .filter((tc) => Boolean(tc?.function?.name))
      .map((tc) => ({
        id: tc.id ?? '',
        name: tc.function!.name!,
        arguments: tc.function!.arguments ?? '{}',
      }));
    // Reasoning-only replies (e.g. DeepSeek-R1 that answers inside
    // reasoning_content with empty content) must not surface as a blank
    // response that consumes tokens without producing visible text.
    if (content.trim().length === 0 && toolCalls.length === 0 && thinking && thinking.trim().length > 0) {
      content = thinking;
    }
    const promptText = messages.map((m) => m.content).join('\n');
    const promptTokens = data.usage?.prompt_tokens ?? countTokens(promptText);
    const completionTokens = data.usage?.completion_tokens ?? countTokens(content);
    const cachedTokens = data.usage?.prompt_tokens_details?.cached_tokens;
    const usage = {
      promptTokens,
      completionTokens,
      totalTokens: data.usage?.total_tokens ?? promptTokens + completionTokens,
      ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    };
    return {
      provider: 'openrouter',
      model: data.model ?? options.model,
      content,
      usage,
      finishReason: data.choices?.[0]?.finish_reason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: thinking && thinking.length > 0 ? thinking : undefined,
    };
  }

  /**
   * Deterministic offline response. Reflects the request so the pipeline and
   * cache layers can be exercised end-to-end without any network call.
   */
  private mockComplete(
    messages: ChatMessage[],
    options: OpenRouterCompleteOptions,
  ): CompletionResult {
    return mockCompletion(messages, options, 'OPENROUTER_API_KEY');
  }
}
