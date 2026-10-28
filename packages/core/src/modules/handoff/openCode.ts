/**
 * OpenCode gateway client (https://opencode.ai/docs/zen — base `/zen/v1` or `/inference`).
 *
 * OpenCode serves these wire formats behind one base URL and Bearer key:
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
import type { StreamHandlers } from './stream.js';

export interface OpenCodeClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Zen gates free-model access on client fingerprinting and answers third-party
 * or missing User-Agents with a 429 `FreeUsageLimitError`. Pinned to the
 * official client version — bump when tracking a new OpenCode release, and keep
 * it in sync with model discovery in `models.ts` (both import this constant).
 */
export const OPENCODE_USER_AGENT = 'opencode/1.18.27';

/**
 * Resolves wire-protocol base URLs from the configured provider base.
 *
 * OpenCode documents two shapes:
 *   - current: https://opencode.ai/inference -> /openai/v1, /anthropic, /v1/models
 *   - legacy:  https://opencode.ai/zen/v1    -> /v1/chat/completions, /v1/messages
 *
 * Both are still served. The legacy base stays the default so existing saved
 * keys keep working; an `/inference` base opts into the documented paths.
 */
export function opencodeBaseUrls(baseUrl = 'https://opencode.ai/zen/v1'): {
  openAi: string;
  anthropic: string;
  models: string;
} {
  const base = baseUrl.replace(/\/+$/, '');
  if (/\/inference$/.test(base)) {
    return {
      openAi: `${base}/openai/v1`,
      anthropic: `${base}/anthropic`,
      models: `${base}/v1/models`,
    };
  }
  // AnthropicClient appends `/v1/messages`, the OpenAI client `/chat/completions`.
  const root = base.replace(/\/v1$/, '');
  return { openAi: `${root}/v1`, anthropic: root, models: `${root}/v1/models` };
}

export class OpenCodeClient implements ProviderClient {
  private readonly openai: OpenAiClient;
  private readonly anthropic: AnthropicClient;
  readonly mock: boolean;

  constructor(options: OpenCodeClientOptions = {}) {
    const urls = opencodeBaseUrls(options.baseUrl);
    const headers = { 'User-Agent': OPENCODE_USER_AGENT };
    this.anthropic = new AnthropicClient({
      apiKey: options.apiKey,
      baseUrl: urls.anthropic,
      headers,
    });
    this.openai = new OpenAiClient({
      apiKey: options.apiKey,
      baseUrl: urls.openAi,
      headers,
    });
    this.mock = !options.apiKey;
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Promise<CompletionResult> {
    if (this.mock) return mockCompletion(messages, options, 'OPENCODE_API_KEY');

    this.assertSupported(options.model);

    const result = options.model.startsWith('claude')
      ? await this.anthropic.complete(messages, options)
      : await this.openai.complete(messages, options);
    return { ...result, provider: 'opencode' };
  }

  /**
   * Streaming variant of `complete()`, delegating to the composed client the
   * same way `complete()` does.
   *
   * TypeScript does not forward an optional interface member through
   * composition: declaring `private readonly openai: OpenAiClient` and calling
   * `this.openai.complete()` never makes `OpenCodeClient.stream` exist on
   * `ProviderClient`, so without this method every OpenCode turn silently took
   * the buffered fallback — one whole-answer delta, no progressive output.
   * The `claude` routing branch, the unsupported-model guard and the
   * `provider: 'opencode'` re-brand are reproduced exactly; only the transport
   * differs.
   */
  async stream(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    handlers: StreamHandlers = {},
  ): Promise<CompletionResult> {
    if (this.mock) {
      const result = mockCompletion(messages, options, 'OPENCODE_API_KEY');
      if (result.content.length > 0) handlers.onDelta?.(result.content);
      return result;
    }

    this.assertSupported(options.model);

    const result = options.model.startsWith('claude')
      ? await this.anthropic.stream(messages, options, handlers)
      : await this.openai.stream(messages, options, handlers);
    return { ...result, provider: 'opencode' };
  }

  // ponytail: gpt-*/codex-* models need Zen's /responses (OpenAI Responses
  // API), a separate wire format. Upgrade path: add a responses translator
  // here and call it from both complete() and stream().
  private assertSupported(model: string): void {
    if (/^(gpt|codex)/.test(model)) {
      throw new ProviderError(
        `OpenCode Zen model "${model}" requires the /responses endpoint, which is not supported yet — pick a claude-* model or another Zen model`,
        400,
        false,
      );
    }
  }
}
