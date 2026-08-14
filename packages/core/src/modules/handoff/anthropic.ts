/**
 * Minimal Anthropic Messages-API client. System messages are sent in the
 * `system` field (Anthropic has no system role); `max_tokens` is required.
 * Without an API key it runs in mock mode so the pipeline is exercisable
 * offline.
 */
import type { ChatMessage, CompletionResult } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import { mockCompletion, ProviderError, type ProviderClient, type ProviderCompleteOptions } from './provider.js';

export interface AnthropicClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

interface AnthropicResponse {
  model?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

export class AnthropicClient implements ProviderClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  readonly mock: boolean;

  constructor(options: AnthropicClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
    this.mock = !this.apiKey;
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Promise<CompletionResult> {
    if (this.mock) return mockCompletion(messages, options, 'ANTHROPIC_API_KEY');
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const chat = messages.filter((m) => m.role !== 'system');

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens ?? 1024,
        system: system.trim().length > 0 ? system : undefined,
        messages: chat,
        temperature: options.temperature,
      }),
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(
        `Anthropic ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`,
        res.status,
        retryable,
      );
    }

    const data = (await res.json()) as AnthropicResponse;
    const content = (data.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text!)
      .join('');
    const promptText = messages.map((m) => m.content).join('\n');
    const promptTokens = data.usage?.input_tokens ?? countTokens(promptText);
    const completionTokens = data.usage?.output_tokens ?? countTokens(content);
    const usage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
    return {
      provider: 'anthropic',
      model: data.model ?? options.model,
      content,
      usage,
      finishReason: data.stop_reason,
    };
  }
}
