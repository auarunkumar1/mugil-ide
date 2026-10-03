/**
 * Minimal OpenAI chat-completions client. Talks to `{baseUrl}/chat/completions`
 * (OpenAI-compatible endpoints work too). Without an API key it runs in mock
 * mode so the pipeline is exercisable offline.
 */
import type { ChatMessage, CompletionResult, ToolCall } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import {
  extractThinkBlock,
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

export interface OpenAiClientOptions {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
}

export class OpenAiClient implements ProviderClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly extraHeaders?: Record<string, string>;
  readonly mock: boolean;

  constructor(options: OpenAiClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    this.extraHeaders = options.headers;
    this.mock = !this.apiKey && !this.isLocalEndpoint();
  }

  private isLocalEndpoint(): boolean {
    return (
      this.baseUrl.includes('localhost') ||
      this.baseUrl.includes('127.0.0.1') ||
      this.baseUrl.includes('0.0.0.0') ||
      this.baseUrl.includes('::1')
    );
  }

  /**
   * Builds the request body. `stream: true` adds the SSE flag plus
   * `stream_options.include_usage` — without it OpenAI omits `usage` from every
   * streamed chunk, so the streaming path would fall back to token estimates
   * while the non-streaming path reports real API counts.
   */
  private buildBody(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    stream = false,
  ): Record<string, unknown> {
    const isLocal = this.isLocalEndpoint();

    const isOpenAiReasoning =
      !isLocal &&
      (options.model.startsWith('o1') ||
        options.model.startsWith('o3') ||
        (options.thinkingLevel && options.thinkingLevel !== 'off'));

    const body: Record<string, unknown> = {
      model: options.model,
      messages: toOpenAiMessages(messages),
    };
    if (options.tools && options.tools.length > 0) {
      body.tools = toOpenAiTools(options.tools);
    }

    if (isOpenAiReasoning) {
      if (options.maxTokens) body.max_completion_tokens = options.maxTokens;
      if (options.thinkingLevel && options.thinkingLevel !== 'off') {
        body.reasoning_effort = options.thinkingLevel;
      }
    } else {
      if (options.maxTokens) body.max_tokens = options.maxTokens;
      if (!options.model.startsWith('o1') && !options.model.startsWith('o3')) {
        body.temperature = options.temperature ?? 0.7;
      }
    }

    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }
    return body;
  }

  private async post(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    stream = false,
  ): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey || 'local'}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(this.buildBody(messages, options, stream)),
      signal: requestSignal(options),
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(
        `OpenAI ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`,
        res.status,
        retryable,
      );
    }
    return res;
  }

  /**
   * Streaming variant of `complete()`. Same request body plus `stream: true`;
   * `choices[0].delta` fragments are aggregated by `parseOpenAiSse` so the
   * returned CompletionResult is identical to the non-streaming one.
   */
  async stream(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    handlers: StreamHandlers = {},
  ): Promise<CompletionResult> {
    if (this.mock) {
      const result = mockCompletion(messages, options, 'OPENAI_API_KEY');
      if (result.content.length > 0) handlers.onDelta?.(result.content);
      if (result.thinking && result.thinking.length > 0) handlers.onThinking?.(result.thinking);
      return result;
    }
    const res = await this.post(messages, options, true);
    if (!res.body) throw new ProviderError('OpenAI returned no body to stream', res.status, true);
    const streamed = await parseOpenAiSse(res.body, handlers);
    return openAiStreamResult('openai', messages, options, streamed);
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Promise<CompletionResult> {
    if (this.mock) return mockCompletion(messages, options, 'OPENAI_API_KEY');
    const res = await this.post(messages, options);

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
    // For local models like DeepSeek-R1 that stream <think>...</think> within
    // content, lift it into `thinking` — same rule as the streaming path.
    const split = extractThinkBlock(message?.content ?? '', message?.reasoning_content ?? message?.reasoning);
    let content = split.content;
    const thinking = split.thinking;
    // Only require a function name — some OpenAI-compatible endpoints (local
    // Ollama/LM Studio builds, proxies) omit the `type: 'function'` field on
    // tool_calls. Requiring it silently dropped the model's request, so a
    // write_file call never executed and the file was never created.
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
      provider: 'openai',
      model: data.model ?? options.model,
      content,
      usage,
      finishReason: data.choices?.[0]?.finish_reason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: thinking && thinking.length > 0 ? thinking : undefined,
    };
  }
}
