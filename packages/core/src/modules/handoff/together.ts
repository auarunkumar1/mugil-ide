/**
 * Minimal Together AI client. Talks to `{baseUrl}/chat/completions`
 * (OpenAI-compatible endpoint). Without an API key it runs in mock mode
 * so the pipeline is exercisable offline.
 */
import type { ChatMessage, CompletionResult, ToolCall } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import {
  mockCompletion,
  openAiStreamResult,
  ProviderError,
  toOpenAiMessages,
  toOpenAiTools,
  requestSignal,
  type ProviderClient,
  type ProviderCompleteOptions,
} from './provider.js';
import { parseOpenAiSse, type StreamHandlers } from './stream.js';

export interface TogetherClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class TogetherClient implements ProviderClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  readonly mock: boolean;

  constructor(options: TogetherClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.together.xyz/v1';
this.mock = !this.apiKey;
  }

  /**
   * Builds the request body. `stream: true` adds the SSE flag plus
   * `stream_options.include_usage`; without it Together omits `usage` from
   * streamed chunks and token counts fall back to estimates.
   */
  private buildBody(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
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
    options: ProviderCompleteOptions,
    handlers: StreamHandlers = {},
  ): Promise<CompletionResult> {
    if (this.mock) {
      const result = mockCompletion(messages, options, 'TOGETHER_API_KEY');
      if (result.content.length > 0) handlers.onDelta?.(result.content);
      return result;
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(this.buildBody(messages, options, true)),
      signal: requestSignal(options),
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(
        `Together ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`,
        res.status,
        retryable,
      );
    }
    if (!res.body) throw new ProviderError('Together returned no body to stream', res.status, true);
    const streamed = await parseOpenAiSse(res.body, handlers);
    return openAiStreamResult('together', messages, options, streamed);
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Promise<CompletionResult> {
    if (this.mock) return mockCompletion(messages, options, 'TOGETHER_API_KEY');

    const body = this.buildBody(messages, options);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: requestSignal(options),
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(
        `Together ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`,
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
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const message = data.choices?.[0]?.message;
    let content = message?.content ?? '';
    const thinking = message?.reasoning_content ?? message?.reasoning;
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
    const usage = {
      promptTokens,
      completionTokens,
      totalTokens: data.usage?.total_tokens ?? promptTokens + completionTokens,
    };
    return {
      provider: 'together',
      model: data.model ?? options.model,
      content,
      usage,
      finishReason: data.choices?.[0]?.finish_reason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: thinking && thinking.length > 0 ? thinking : undefined,
    };
  }
}
