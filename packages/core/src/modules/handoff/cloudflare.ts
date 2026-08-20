/**
 * Minimal Cloudflare Workers AI client. Talks to the Cloudflare AI Gateway
 * or directly to the Workers AI API. Without an API key it runs in mock mode
 * so the pipeline is exercisable offline.
 *
 * Cloudflare Workers AI uses an OpenAI-compatible endpoint at:
 *   https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions
 *
 * When using AI Gateway (recommended), the endpoint is:
 *   https://gateway.ai.cloudflare.com/accounts/{account_id}/gateways/{gateway_id}/openai/v1/chat/completions
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

export interface CloudflareClientOptions {
  apiKey?: string;
  accountId?: string;
  baseUrl?: string;
  gatewayId?: string;
}

export class CloudflareClient implements ProviderClient {
  private readonly apiKey?: string;
  private readonly accountId?: string;
  private readonly baseUrl: string;
  private readonly gatewayId?: string;
  readonly mock: boolean;

  constructor(options: CloudflareClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.accountId = options.accountId;
    this.gatewayId = options.gatewayId;
    this.baseUrl = options.baseUrl ?? 'https://api.cloudflare.com/client/v4';
    this.mock = !this.apiKey || !this.accountId;
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Promise<CompletionResult> {
    if (this.mock) return mockCompletion(messages, options, 'CLOUDFLARE_API_KEY');

    // Build the endpoint URL
    let endpoint: string;
    if (this.gatewayId && this.accountId) {
      // AI Gateway endpoint (recommended)
      endpoint = `${this.baseUrl.replace('/client/v4', '')}/gateway/accounts/${this.accountId}/gateways/${this.gatewayId}/openai/v1/chat/completions`;
    } else {
      // Direct Workers AI endpoint
      endpoint = `${this.baseUrl}/accounts/${this.accountId}/ai/v1/chat/completions`;
    }

    const body: Record<string, unknown> = {
      model: options.model,
      messages: toOpenAiMessages(messages),
      max_tokens: options.maxTokens,
      temperature: options.temperature ?? 0.7,
    };
    if (options.tools && options.tools.length > 0) {
      body.tools = toOpenAiTools(options.tools);
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(
        `Cloudflare ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`,
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
    // Reasoning-only replies must not surface as a blank response.
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
      provider: 'cloudflare',
      model: data.model ?? options.model,
      content,
      usage,
      finishReason: data.choices?.[0]?.finish_reason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: thinking && thinking.length > 0 ? thinking : undefined,
    };
  }
}
