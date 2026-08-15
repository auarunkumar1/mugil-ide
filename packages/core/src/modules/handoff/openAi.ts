/**
 * Minimal OpenAI chat-completions client. Talks to `{baseUrl}/chat/completions`
 * (OpenAI-compatible endpoints work too). Without an API key it runs in mock
 * mode so the pipeline is exercisable offline.
 */
import type { ChatMessage, CompletionResult, ToolCall } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import {
  mockCompletion,
  ProviderError,
  toOpenAiMessages,
  toOpenAiTools,
  type ProviderClient,
  type ProviderCompleteOptions,
} from './provider.js';

export interface OpenAiClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class OpenAiClient implements ProviderClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  readonly mock: boolean;

  constructor(options: OpenAiClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    const isLocal =
      this.baseUrl.includes('localhost') ||
      this.baseUrl.includes('127.0.0.1') ||
      this.baseUrl.includes('0.0.0.0') ||
      this.baseUrl.includes('::1');
    this.mock = !this.apiKey && !isLocal;
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Promise<CompletionResult> {
    if (this.mock) return mockCompletion(messages, options, 'OPENAI_API_KEY');
    const isLocal =
      this.baseUrl.includes('localhost') ||
      this.baseUrl.includes('127.0.0.1') ||
      this.baseUrl.includes('0.0.0.0') ||
      this.baseUrl.includes('::1');

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

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey || 'local'}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(
        `OpenAI ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`,
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
    let thinking = message?.reasoning_content ?? message?.reasoning;

    // For local models like DeepSeek-R1 that stream <think>...</think> within content
    if (!thinking && content.includes('<think>')) {
      const match = content.match(/<think>([\s\S]*?)<\/think>/i);
      if (match) {
        thinking = match[1]?.trim();
        content = content.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
      }
    }
    const toolCalls: ToolCall[] = (message?.tool_calls ?? [])
      .filter((tc) => tc?.type === 'function' && Boolean(tc.function?.name))
      .map((tc) => ({
        id: tc.id ?? '',
        name: tc.function!.name!,
        arguments: tc.function!.arguments ?? '{}',
      }));
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
