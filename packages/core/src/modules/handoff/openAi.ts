/**
 * Minimal OpenAI chat-completions client. Talks to `{baseUrl}/chat/completions`
 * (OpenAI-compatible endpoints work too). Without an API key it runs in mock
 * mode so the pipeline is exercisable offline.
 */
import type { ChatMessage, CompletionResult } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import { mockCompletion, ProviderError, type ProviderClient, type ProviderCompleteOptions } from './provider.js';

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
    this.mock = !this.apiKey;
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Promise<CompletionResult> {
    if (this.mock) return mockCompletion(messages, options, 'OPENAI_API_KEY');
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature ?? 0.7,
      }),
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
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content ?? '';
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
    };
  }
}
