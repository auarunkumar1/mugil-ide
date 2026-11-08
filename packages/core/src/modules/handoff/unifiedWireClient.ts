/**
 * Unified OpenAI-Compatible Wire Client
 * =====================================
 * Consolidates repetitive provider wire clients (OpenAI, OpenRouter, Together,
 * Vercel, Groq, Cloudflare, Ollama, LM Studio, custom endpoints) into a single
 * configurable client architecture with provider-specific adapters.
 */

import type { ChatMessage } from '../../types.js';
import { OpenAiWireClient, type ProviderCompleteOptions } from './provider.js';

export type UnifiedProviderKind =
  | 'openai'
  | 'openrouter'
  | 'together'
  | 'vercel'
  | 'groq'
  | 'cloudflare'
  | 'ollama'
  | 'lmstudio'
  | 'custom';

export interface UnifiedWireClientOptions {
  provider: UnifiedProviderKind;
  apiKey?: string;
  baseUrl?: string;
  extraHeaders?: Record<string, string>;
  isLocalEndpoint?: () => boolean;
}

const DEFAULT_BASE_URLS: Record<UnifiedProviderKind, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  together: 'https://api.together.xyz/v1',
  vercel: 'https://ai-gateway.vercel.sh/v1',
  groq: 'https://api.groq.com/openai/v1',
  cloudflare: 'https://api.cloudflare.com/client/v4/ai/v1',
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  custom: 'http://localhost:11434/v1',
};

const DEFAULT_ENV_VARS: Record<UnifiedProviderKind, string> = {
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  together: 'TOGETHER_API_KEY',
  vercel: 'VERCEL_API_KEY',
  groq: 'GROQ_API_KEY',
  cloudflare: 'CLOUDFLARE_API_KEY',
  ollama: '',
  lmstudio: '',
  custom: '',
};

export class UnifiedWireClient extends OpenAiWireClient {
  readonly name: string;
  readonly providerKind: UnifiedProviderKind;

  constructor(options: UnifiedWireClientOptions) {
    const kind = options.provider;
    const baseUrl = options.baseUrl || DEFAULT_BASE_URLS[kind];
    const missingEnvVar = DEFAULT_ENV_VARS[kind];

    const isLocal =
      options.isLocalEndpoint ??
      (() =>
        baseUrl.includes('localhost') ||
        baseUrl.includes('127.0.0.1') ||
        baseUrl.includes('0.0.0.0') ||
        baseUrl.includes('::1') ||
        kind === 'ollama' ||
        kind === 'lmstudio');

    const headers: Record<string, string> = { ...(options.extraHeaders || {}) };
    if (kind === 'openrouter') {
      if (!headers['HTTP-Referer'])
        headers['HTTP-Referer'] = 'https://github.com/auarunkumar1/mugil-ide';
      if (!headers['X-Title']) headers['X-Title'] = 'Mugil IDE';
    }

    super({
      providerName: kind,
      baseUrl,
      apiKey: options.apiKey,
      missingEnvVar,
      extraHeaders: headers,
      isLocalEndpoint: isLocal,
    });

    this.name = kind;
    this.providerKind = kind;
  }

  override buildBody(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Record<string, unknown> {
    const body = super.buildBody(messages, options);

    // Together reasoning effort
    if (
      this.providerKind === 'together' &&
      options.thinkingLevel &&
      options.thinkingLevel !== 'off'
    ) {
      body.reasoning = { effort: options.thinkingLevel };
    }

    // OpenRouter streaming usage
    if (this.providerKind === 'openrouter') {
      body.stream_options = { include_usage: true };
    }

    return body;
  }
}

/** Factory helper to instantiate a unified wire client */
export function createUnifiedWireClient(options: UnifiedWireClientOptions): UnifiedWireClient {
  return new UnifiedWireClient(options);
}
