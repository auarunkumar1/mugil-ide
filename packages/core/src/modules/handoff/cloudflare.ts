/**
 * Minimal Cloudflare Workers AI client. Talks to the Cloudflare AI Gateway
 * or directly to the Workers AI API. Without an API key it runs in mock mode
 * so the pipeline is exercisable offline.
 */
import { OpenAiWireClient } from './provider.js';

export interface CloudflareClientOptions {
  apiKey?: string;
  accountId?: string;
  baseUrl?: string;
  gatewayId?: string;
}

export class CloudflareClient extends OpenAiWireClient {
  constructor(options: CloudflareClientOptions = {}) {
    // Two distinct APIs:
    //   gateway → https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/openai/chat/completions
    //   direct  → https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1/chat/completions
    // The gateway lives on its own host, so it cannot be derived from the
    // direct Workers AI base URL (the old code produced a 404 path).
    const gatewayBase =
      options.gatewayId && options.accountId
        ? `https://gateway.ai.cloudflare.com/v1/${options.accountId}/${options.gatewayId}`
        : undefined;
    const baseUrl = gatewayBase ?? options.baseUrl ?? 'https://api.cloudflare.com/client/v4';
    const chatEndpoint = gatewayBase
      ? '/openai/chat/completions'
      : options.accountId
        ? `/accounts/${options.accountId}/ai/v1/chat/completions`
        : '/chat/completions';

    super({
      providerName: 'cloudflare',
      baseUrl,
      apiKey: options.apiKey,
      missingEnvVar: 'CLOUDFLARE_API_KEY',
      chatEndpoint,
    });

    if (!options.apiKey || !options.accountId) {
      (this as { mock: boolean }).mock = true;
    }
  }
}
