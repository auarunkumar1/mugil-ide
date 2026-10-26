/**
 * Minimal Vercel AI Gateway client. Talks to `{baseUrl}/chat/completions`
 * (OpenAI-compatible endpoint). Without an API key it runs in mock mode
 * so the pipeline is exercisable offline.
 *
 * The gateway lives at ai-gateway.vercel.sh — `api.vercel.ai` is not a valid
 * host (it 404s with DEPLOYMENT_NOT_FOUND).
 */
import type { ChatMessage } from '../../types.js';
import { OpenAiWireClient, type ProviderCompleteOptions } from './provider.js';

export interface VercelClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class VercelClient extends OpenAiWireClient {
  constructor(options: VercelClientOptions = {}) {
    super({
      providerName: 'vercel',
      baseUrl: options.baseUrl ?? 'https://ai-gateway.vercel.sh/v1',
      apiKey: options.apiKey,
      missingEnvVar: 'VERCEL_API_KEY (or AI_GATEWAY_API_KEY)',
    });
  }

  override buildBody(messages: ChatMessage[], options: ProviderCompleteOptions): Record<string, unknown> {
    const body = super.buildBody(messages, options);
    if (options.thinkingLevel && options.thinkingLevel !== 'off') {
      body.reasoning = { effort: options.thinkingLevel };
    }
    return body;
  }
}
