/**
 * OpenCode gateway client (https://opencode.ai/docs/zen — base `/zen/v1` or `/inference`).
 *
 * OpenCode serves these wire formats behind one base URL and Bearer key:
 *   - `{base}/v1/messages`         — Anthropic Messages API (claude-* models)
 *   - `{base}/v1/chat/completions` — OpenAI chat format (everything else)
 *   - `{base}/v1/responses`        — OpenAI Responses API (gpt-* / codex-*)
 *
 * Delegates to the existing OpenAI/Anthropic clients rather than duplicating
 * their wire code; only endpoint selection and result re-branding live here.
 */
import type { ChatMessage, CompletionResult, Usage } from '../../types.js';
import { VERSION } from '../../branding.js';
import {
  mockCompletion,
  ProviderError,
  requestSignal,
  type ProviderClient,
  type ProviderCompleteOptions,
} from './provider.js';
import type { StreamHandlers } from './stream.js';
import {
  ChatCompletionsAdapter,
  MessagesAdapter,
  ResponsesAdapter,
  type ProtocolAdapter,
} from './protocols/index.js';
import { sanitizeOutbound } from '../security/outboundGuard.js';

export interface OpenCodeClientOptions {
  apiKey?: string;
  baseUrl?: string;
  sessionId?: string;
  headers?: Record<string, string>;
}

export interface OpenCodeUsageInfo {
  status?: string;
  plan?: string;
  billing_source?: string;
  usage?: {
    rolling?: { status?: string; percent?: number; resetsAt?: string; [key: string]: unknown };
    weekly?: { status?: string; percent?: number; resetsAt?: string; [key: string]: unknown };
    monthly?: { status?: string; percent?: number; resetsAt?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  allowance?: {
    used: number;
    total: number;
    reset_at?: string;
  };
  rolling_usage?: {
    requests?: number;
    tokens?: number;
  };
  cost?: number;
  opencode?: unknown;
}

export interface OpenCodePlanResult {
  plan: 'go' | 'zen';
  usage?: OpenCodeUsageInfo;
}

const planCache = new Map<string, { plan: 'go' | 'zen'; usage?: OpenCodeUsageInfo; timestamp: number }>();
export const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;

export function clearOpenCodePlanCache(): void {
  planCache.clear();
}

/** Fetches usage and allowance metrics from OpenCode Go usage API. */
export async function fetchOpenCodeUsage(
  apiKey?: string,
  baseUrl = 'https://opencode.ai/inference/go',
  timeoutMs = 4000,
): Promise<OpenCodeUsageInfo | undefined> {
  if (!apiKey) return undefined;
  const root = baseUrl
    .replace(/\/+$/, '')
    .replace(/\/openai(\/v1)?$/, '')
    .replace(/\/anthropic$/, '');
  const url = `${root}/v1/usage`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': `mugil-ide/${VERSION}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      return (await res.json()) as OpenCodeUsageInfo;
    }
    if (res.status === 401) {
      throw new ProviderError('OpenCode authentication failed: invalid API key (401)', 401, false);
    }
    return undefined;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    return undefined;
  }
}

/** Resolves the OpenCode subscription plan ('go' vs 'zen'). */
export async function resolveOpenCodePlan(
  apiKey?: string,
  baseUrl?: string,
  timeoutMs = 3000,
): Promise<OpenCodePlanResult> {
  if (baseUrl) {
    const clean = baseUrl.replace(/\/+$/, '');
    if (/\/inference\/go$/.test(clean)) {
      return { plan: 'go' };
    }
    if (clean.includes('/zen') || (clean.includes('/inference') && !clean.includes('/go'))) {
      return { plan: 'zen' };
    }
  }
  if (!apiKey) {
    return { plan: 'go' }; // Offline/mock default
  }
  const cached = planCache.get(apiKey);
  if (cached && Date.now() - cached.timestamp < PLAN_CACHE_TTL_MS) {
    return { plan: cached.plan, usage: cached.usage };
  }

  try {
    const usage = await fetchOpenCodeUsage(apiKey, 'https://opencode.ai/inference/go', timeoutMs);
    if (
      usage &&
      (usage.usage?.rolling?.status === 'ok' ||
        Boolean(usage.usage?.rolling) ||
        Boolean(usage.usage) ||
        usage.status === 'ok' ||
        usage.plan === 'go' ||
        Boolean(usage.allowance))
    ) {
      const res: OpenCodePlanResult = { plan: 'go', usage };
      planCache.set(apiKey, { plan: 'go', usage, timestamp: Date.now() });
      return res;
    }
    const res: OpenCodePlanResult = { plan: 'zen' };
    planCache.set(apiKey, { plan: 'zen', timestamp: Date.now() });
    return res;
  } catch (err) {
    if (err instanceof ProviderError && err.status === 401) {
      throw err;
    }
    const plan = cached ? cached.plan : 'go';
    return { plan };
  }
}

/** User agent for OpenCode requests (identifies Mugil IDE). */
export const OPENCODE_USER_AGENT = `mugil-ide/${VERSION}`;

/**
 * Resolves wire-protocol base URLs from the configured provider base.
 *
 * OpenCode documents two shapes:
 *   - current: https://opencode.ai/inference -> /openai/v1, /anthropic, /v1/models
 *   - legacy:  https://opencode.ai/zen/v1    -> /v1/chat/completions, /v1/messages
 */
export function opencodeBaseUrls(baseUrl = 'https://opencode.ai/inference/go'): {
  openAi: string;
  anthropic: string;
  models: string;
  responses: string;
} {
  const base = (baseUrl || 'https://opencode.ai/inference/go').replace(/\/+$/, '');
  if (/\/inference(\/go)?$/.test(base)) {
    return {
      openAi: `${base}/openai/v1`,
      anthropic: `${base}/anthropic`,
      models: `${base}/v1/models`,
      responses: `${base}/openai/v1`,
    };
  }
  // AnthropicClient appends `/v1/messages`, the OpenAI client `/chat/completions`.
  const root = base.replace(/\/v1$/, '');
  return {
    openAi: `${root}/v1`,
    anthropic: root,
    models: `${root}/v1/models`,
    responses: `${root}/v1`,
  };
}

export class OpenCodeClient implements ProviderClient {
  readonly name = 'opencode';
  readonly mock: boolean;
  readonly sessionId: string;
  readonly baseUrl?: string;
  private readonly options: OpenCodeClientOptions;
  private readonly chatCompletionsAdapter = new ChatCompletionsAdapter();
  private readonly messagesAdapter = new MessagesAdapter();
  private readonly responsesAdapter = new ResponsesAdapter();

  constructor(options: OpenCodeClientOptions = {}) {
    this.options = options;
    this.baseUrl = options.baseUrl;
    this.sessionId =
      options.sessionId ||
      `ses_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    this.mock = !options.apiKey;
  }

  private getAdapterAndUrl(
    model: string,
    urls: { openAi: string; anthropic: string; responses: string },
    protocol?: 'chat' | 'messages' | 'responses',
  ): { adapter: ProtocolAdapter; endpointUrl: string } {
    const effectiveProtocol =
      protocol ??
      (/^(gpt|codex)/.test(model) ? 'responses' : /^claude/.test(model) ? 'messages' : 'chat');

    if (effectiveProtocol === 'responses') {
      return {
        adapter: this.responsesAdapter,
        endpointUrl: `${urls.responses}/responses`,
      };
    }
    if (effectiveProtocol === 'messages') {
      return {
        adapter: this.messagesAdapter,
        endpointUrl: `${urls.anthropic}/v1/messages`,
      };
    }
    return {
      adapter: this.chatCompletionsAdapter,
      endpointUrl: `${urls.openAi}/chat/completions`,
    };
  }

  private determineBillingSource(
    usage?: Partial<Usage>,
    model?: string,
    targetUrl?: string,
  ): Usage['billingSource'] {
    if (usage?.billingSource && usage.billingSource !== 'unknown') {
      return usage.billingSource;
    }
    if (model?.endsWith('-free') || model?.includes('free')) {
      return 'free';
    }
    const url = targetUrl || this.baseUrl || '';
    if (url.includes('/inference/go')) {
      return 'go';
    }
    return 'opencode';
  }

  private async dispatchProtocol(
    urls: { openAi: string; anthropic: string; responses: string },
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    effectiveModel: string,
    isStream: boolean,
    handlers: StreamHandlers = {},
  ): Promise<CompletionResult> {
    const { adapter, endpointUrl } = this.getAdapterAndUrl(
      effectiveModel,
      urls,
      options.protocol,
    );
    const body = adapter.buildRequestBody(messages, {
      ...options,
      model: effectiveModel,
      stream: isStream ? true : undefined,
    });
    if (isStream) {
      body.stream = true;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': OPENCODE_USER_AGENT,
      'x-opencode-session': this.sessionId,
      ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
      ...(this.options.headers || {}),
    };
    if (adapter.name === 'messages') {
      headers['anthropic-version'] = '2023-06-01';
      if (this.options.apiKey) {
        headers['x-api-key'] = this.options.apiKey;
      }
    }

    const safeBody = sanitizeOutbound(body, {
      destinationUrl: endpointUrl,
      expectedProviderKey: this.options.apiKey,
    });

    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(safeBody),
      signal: requestSignal(options),
    });

    if (!res || !res.ok) {
      const text = res?.text ? await res.text() : '';
      const retryable = res?.status === 429 || (res?.status !== undefined && res.status >= 500);
      let retryAfter: number | undefined;
      const retryHeader =
        typeof res?.headers?.get === 'function'
          ? res.headers.get('retry-after')
          : (res?.headers as any)?.['retry-after'];
      if (retryHeader) {
        const sec = parseInt(retryHeader, 10);
        if (!isNaN(sec)) retryAfter = sec;
      }
      throw new ProviderError(
        `OpenCode ${res?.status || 500} ${res?.statusText || 'Error'}: ${text.slice(0, 300)}`,
        res?.status || 500,
        retryable,
        retryAfter,
      );
    }

    if (isStream) {
      if (!res.body) throw new ProviderError('OpenCode stream response body is null', 500, false);
      const streamed = await adapter.parseStream(res.body, handlers);
      const billingSource = this.determineBillingSource(streamed.usage, effectiveModel, endpointUrl);
      const usage: Usage = {
        promptTokens: streamed.usage?.promptTokens ?? 0,
        completionTokens: streamed.usage?.completionTokens ?? 0,
        totalTokens:
          streamed.usage?.totalTokens ??
          (streamed.usage?.promptTokens ?? 0) + (streamed.usage?.completionTokens ?? 0),
        cachedTokens: streamed.usage?.cachedTokens,
        reasoningTokens: streamed.usage?.reasoningTokens,
        cacheWriteTokens: streamed.usage?.cacheWriteTokens,
        cost: streamed.usage?.cost,
        listCost: streamed.usage?.listCost,
        allowance: streamed.usage?.allowance,
        billingSource: streamed.usage?.billingSource ?? billingSource,
      };
      return {
        provider: 'opencode',
        model: effectiveModel,
        content: streamed.content,
        thinking: streamed.thinking,
        toolCalls: streamed.toolCalls && streamed.toolCalls.length > 0 ? streamed.toolCalls : undefined,
        finishReason: streamed.finishReason,
        usage,
      };
    } else {
      const json = (await res.json()) as Record<string, unknown>;
      const result = adapter.parseResponse(json, effectiveModel, 'opencode');
      const billingSource = this.determineBillingSource(result.usage, effectiveModel, endpointUrl);
      return {
        ...result,
        provider: 'opencode',
        usage: {
          ...result.usage,
          billingSource,
        },
      };
    }
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Promise<CompletionResult> {
    if (this.mock) return mockCompletion(messages, options, 'OPENCODE_API_KEY');

    const effectiveModel = this.normalizeModel(options.model);
    const urls = opencodeBaseUrls(this.baseUrl);

    try {
      return await this.dispatchProtocol(urls, messages, options, effectiveModel, false);
    } catch (err) {
      if (this.isGoSubscriptionMismatchError(err)) {
        return this.retryOnGoEndpoint(messages, options, effectiveModel, false);
      }
      if (this.isZenSubscriptionMismatchError(err)) {
        return this.retryOnZenEndpoint(messages, options, effectiveModel, false);
      }
      this.handleOpenCodeError(err, effectiveModel);
    }
  }

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
    const urls = opencodeBaseUrls(this.baseUrl);

    try {
      return await this.dispatchProtocol(urls, messages, options, effectiveModel, true, handlers);
    } catch (err) {
      if (this.isGoSubscriptionMismatchError(err)) {
        return this.retryOnGoEndpoint(messages, options, effectiveModel, true, handlers);
      }
      if (this.isZenSubscriptionMismatchError(err)) {
        return this.retryOnZenEndpoint(messages, options, effectiveModel, true, handlers);
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

  private isZenSubscriptionMismatchError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    const isGoUrl = /\/inference\/go$/.test((this.baseUrl || '').replace(/\/+$/, ''));
    if (
      isGoUrl &&
      (msg.includes('OpenCode Go subscription required') ||
        msg.includes('EntitlementError') ||
        msg.includes('not entitled') ||
        msg.includes('not subscribed to OpenCode Go') ||
        msg.includes('requires pay-as-you-go credits') ||
        msg.includes('unsubscribed'))
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
    try {
      return await this.dispatchProtocol(goUrls, messages, options, effectiveModel, isStream, handlers);
    } catch (retryErr) {
      this.handleOpenCodeError(retryErr, effectiveModel);
    }
  }

  private async retryOnZenEndpoint(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    effectiveModel: string,
    isStream: boolean,
    handlers: StreamHandlers = {},
  ): Promise<CompletionResult> {
    const zenUrls = opencodeBaseUrls('https://opencode.ai/inference');
    try {
      return await this.dispatchProtocol(zenUrls, messages, options, effectiveModel, isStream, handlers);
    } catch (retryErr) {
      this.handleOpenCodeError(retryErr, effectiveModel);
    }
  }

  private normalizeModel(model: string): string {
    // Preserve free model variants - do not rewrite to paid models
    return model;
  }

  private handleOpenCodeError(err: unknown, model: string): never {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('quota_exceeded') ||
      msg.includes('FreeUsageLimitError') ||
      msg.includes('Free usage limit reached') ||
      msg.includes('allowance exhausted')
    ) {
      // Non-retryable so fallback chain does not hammer the exhausted allowance
      throw new ProviderError(
        `OpenCode quota limit reached for "${model}". Allowance or free limits have been exhausted. Please check usage under Account Settings (https://opencode.ai/console).`,
        429,
        false,
      );
    }
    if (msg.includes('MissingSessionID') || msg.includes('x-opencode-session')) {
      throw new ProviderError(
        `OpenCode session ID missing or invalid for "${model}". Ensure a valid session is set.`,
        400,
        false,
      );
    }
    if (msg.includes('AuthError') || msg.includes('authentication_error') || msg.includes('Invalid API key')) {
      throw new ProviderError(
        `OpenCode authentication failed: check your OPENCODE_API_KEY.`,
        401,
        false,
      );
    }
    if (msg.includes('EntitlementError') || msg.includes('not entitled')) {
      throw new ProviderError(
        `OpenCode entitlement error for "${model}": your subscription does not include access to this model.`,
        403,
        false,
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
}
