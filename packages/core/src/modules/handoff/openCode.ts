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
import { VERSION } from '../../branding.js';
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
  sessionId?: string;
  headers?: Record<string, string>;
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
  if (/\/inference(\/go)?$/.test(base)) {
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
  private openai: OpenAiClient;
  private anthropic: AnthropicClient;
  readonly mock: boolean;
  readonly sessionId: string;
  readonly baseUrl?: string;
  private readonly options: OpenCodeClientOptions;

  constructor(options: OpenCodeClientOptions = {}) {
    this.options = options;
    this.baseUrl = options.baseUrl;
    const urls = opencodeBaseUrls(options.baseUrl);
    this.sessionId =
      options.sessionId ||
      `ses_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    const isConsoleOrGo = /\/inference(\/go)?$/.test((options.baseUrl || '').replace(/\/+$/, ''));
    const userAgent = isConsoleOrGo ? `mugil-ide/${VERSION}` : OPENCODE_USER_AGENT;
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      'x-opencode-session': this.sessionId,
      ...(options.headers || {}),
    };
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

    const effectiveModel = this.normalizeModel(options.model);
    this.assertSupported(effectiveModel);

    try {
      const opts = effectiveModel !== options.model ? { ...options, model: effectiveModel } : options;
      const result = effectiveModel.startsWith('claude')
        ? await this.anthropic.complete(messages, opts)
        : await this.openai.complete(messages, opts);
      return { ...result, provider: 'opencode' };
    } catch (err) {
      if (this.isGoSubscriptionMismatchError(err)) {
        return this.retryOnGoEndpoint(messages, options, effectiveModel, false);
      }
      this.handleOpenCodeError(err, effectiveModel);
    }
  }

  /**
   * Streaming variant of `complete()`, delegating to the composed client the
   * same way `complete()` does.
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

    const effectiveModel = this.normalizeModel(options.model);
    this.assertSupported(effectiveModel);

    try {
      const opts = effectiveModel !== options.model ? { ...options, model: effectiveModel } : options;
      const result = effectiveModel.startsWith('claude')
        ? await this.anthropic.stream(messages, opts, handlers)
        : await this.openai.stream(messages, opts, handlers);
      return { ...result, provider: 'opencode' };
    } catch (err) {
      if (this.isGoSubscriptionMismatchError(err)) {
        return this.retryOnGoEndpoint(messages, options, effectiveModel, true, handlers);
      }
      this.handleOpenCodeError(err, effectiveModel);
    }
  }

  private isGoSubscriptionMismatchError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    const isGoUrl = /\/inference\/go$/.test((this.baseUrl || '').replace(/\/+$/, ''));
    if (
      !isGoUrl &&
      (msg.includes('OpenCode Go covers only requests') ||
        (msg.includes('Insufficient balance') && msg.includes('OpenCode Go')))
    ) {
      return true;
    }
    return false;
  }

  private async retryOnGoEndpoint(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    effectiveModel: string,
    isStream: boolean,
    handlers: StreamHandlers = {},
  ): Promise<CompletionResult> {
    const goUrls = opencodeBaseUrls('https://opencode.ai/inference/go');
    const headers: Record<string, string> = {
      'User-Agent': `mugil-ide/${VERSION}`,
      'x-opencode-session': this.sessionId,
      ...(this.options.headers || {}),
    };
    const goAnthropic = new AnthropicClient({
      apiKey: this.options.apiKey,
      baseUrl: goUrls.anthropic,
      headers,
    });
    const goOpenAi = new OpenAiClient({
      apiKey: this.options.apiKey,
      baseUrl: goUrls.openAi,
      headers,
    });
    const opts = effectiveModel !== options.model ? { ...options, model: effectiveModel } : options;
    try {
      if (isStream) {
        const result = effectiveModel.startsWith('claude')
          ? await goAnthropic.stream(messages, opts, handlers)
          : await goOpenAi.stream(messages, opts, handlers);
        return { ...result, provider: 'opencode' };
      } else {
        const result = effectiveModel.startsWith('claude')
          ? await goAnthropic.complete(messages, opts)
          : await goOpenAi.complete(messages, opts);
        return { ...result, provider: 'opencode' };
      }
    } catch (retryErr) {
      this.handleOpenCodeError(retryErr, effectiveModel);
    }
  }

  private normalizeModel(model: string): string {
    // OpenCode's unauthenticated web-only free endpoints reject external API callers with 429 FreeUsageLimitError.
    // In OpenCode Go, DeepSeek and MiMo use their standard model IDs:
    if (model === 'deepseek-v4.1-flash-free') return 'deepseek-v4.1-flash';
    if (model === 'mimo-v2.6-flash-free') return 'mimo-v2.6-flash';
    return model;
  }

  private handleOpenCodeError(err: unknown, model: string): never {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('FreeUsageLimitError') || msg.includes('Free usage limit reached')) {
      throw new ProviderError(
        `OpenCode free model limit reached for "${model}". In OpenCode Go, use model 'deepseek-v4.1-flash' or set OPENCODE_BASE_URL=https://opencode.ai/inference/go. Free models: beam-free, iceman-free, longcat-2.5-free, hy4-flash-free.`,
        429,
        true,
      );
    }
    if (msg.includes('hosted outside Europe') || msg.includes('Select Global at') || msg.includes('#regions')) {
      throw new ProviderError(
        `OpenCode Go region restriction for "${model}": DeepSeek models in OpenCode Go require the "Global" region privacy setting. Enable "Global" under Settings > Privacy > Regions (https://opencode.ai/console) or switch to worldwide models like 'claude-haiku-5-5' or 'beam-free'.`,
        400,
        false,
      );
    }
    if (
      msg.includes('OpenCode Go covers only requests to the OpenCode Go provider') ||
      (msg.includes('Insufficient balance') && msg.includes('OpenCode Go'))
    ) {
      throw new ProviderError(
        `OpenCode Go subscription error: ${msg}. Requests for OpenCode Go subscribers must be sent to the OpenCode Go provider (OPENCODE_BASE_URL=https://opencode.ai/inference/go).`,
        402,
        false,
      );
    }
    throw err;
  }

  // ponytail: gpt-*/codex-* models need Zen's /responses (OpenAI Responses
  // API), a separate wire format. OpenCode Console (/inference & /inference/go)
  // automatically translates across wire formats.
  private assertSupported(model: string): void {
    const isConsoleOrGo = /\/inference(\/go)?$/.test((this.baseUrl || '').replace(/\/+$/, ''));
    if (!isConsoleOrGo && /^(gpt|codex)/.test(model)) {
      throw new ProviderError(
        `OpenCode Zen model "${model}" requires the /responses endpoint, which is not supported yet — pick a claude-* model or another Zen model`,
        400,
        false,
      );
    }
  }
}
