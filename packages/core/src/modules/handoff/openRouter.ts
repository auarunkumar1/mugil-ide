import type { ChatMessage, CompletionResult } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import { mockCompletion, type ProviderClient, type ProviderCompleteOptions } from './provider.js';

export interface OpenRouterClientOptions {
  apiKey?: string;
  baseUrl?: string;
  appTitle?: string;
  appUrl?: string;
}

export interface OpenRouterCompleteOptions extends ProviderCompleteOptions {}

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

  private async remoteComplete(
    messages: ChatMessage[],
    options: OpenRouterCompleteOptions,
  ): Promise<CompletionResult> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': this.appUrl,
        'X-Title': this.appTitle,
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
      throw new OpenRouterError(
        `OpenRouter ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`,
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
      provider: 'openrouter',
      model: data.model ?? options.model,
      content,
      usage,
      finishReason: data.choices?.[0]?.finish_reason,
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
