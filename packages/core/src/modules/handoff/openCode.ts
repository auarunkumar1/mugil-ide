/**
 * OpenCode Zen gateway client (https://opencode.ai/zen).
 *
 * Zen serves three wire formats behind one base URL and Bearer key:
 *   - `{base}/v1/messages`         — Anthropic Messages API (claude-* models)
 *   - `{base}/v1/chat/completions` — OpenAI chat format (everything else)
 *   - `{base}/v1/responses`        — OpenAI Responses API (gpt-* / codex-* — NOT supported yet)
 *
 * Delegates to the existing OpenAI/Anthropic clients rather than duplicating
 * their wire code; only endpoint selection and result re-branding live here.
 */
import type { ChatMessage, CompletionResult } from '../../types.js';
import { OpenAiClient } from './openAi.js';
import { AnthropicClient } from './anthropic.js';
import {
  mockCompletion,
  ProviderError,
  type ProviderClient,
  type ProviderCompleteOptions,
} from './provider.js';

export interface OpenCodeClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class OpenCodeClient implements ProviderClient {
  private readonly openai: OpenAiClient;
  private readonly anthropic: AnthropicClient;
  readonly mock: boolean;

  constructor(options: OpenCodeClientOptions = {}) {
    const base = options.baseUrl ?? 'https://opencode.ai/zen/v1';
    // AnthropicClient appends `/v1/messages`; strip our `/v1` so the combined
    // path is `{root}/v1/messages` exactly as Zen documents it.
    this.anthropic = new AnthropicClient({
      apiKey: options.apiKey,
      baseUrl: base.replace(/\/v1\/?$/, ''),
    });
    this.openai = new OpenAiClient({ apiKey: options.apiKey, baseUrl: base });
    this.mock = !options.apiKey;
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Promise<CompletionResult> {
    if (this.mock) return mockCompletion(messages, options, 'OPENCODE_API_KEY');

    // ponytail: gpt-*/codex-* need Zen's /responses (OpenAI Responses API),
    // a separate wire format. Upgrade path: add a responses translator here.
    if (/^(gpt|codex)/.test(options.model)) {
      throw new ProviderError(
        `OpenCode Zen model "${options.model}" requires the /responses endpoint, which is not supported yet — pick a claude-* model or another Zen model`,
        400,
        false,
      );
    }

    const result = options.model.startsWith('claude')
      ? await this.anthropic.complete(messages, options)
      : await this.openai.complete(messages, options);
    return { ...result, provider: 'opencode' };
  }
}
