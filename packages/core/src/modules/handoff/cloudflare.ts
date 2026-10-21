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
    const baseUrl = options.baseUrl ?? 'https://api.cloudflare.com/client/v4';
    const chatEndpoint =
      options.gatewayId && options.accountId
        ? `/gateway/accounts/${options.accountId}/gateways/${options.gatewayId}/openai/v1/chat/completions`
        : options.accountId
          ? `/accounts/${options.accountId}/ai/v1/chat/completions`
          : '/chat/completions';

    const effectiveBaseUrl =
      options.gatewayId && options.accountId ? baseUrl.replace('/client/v4', '') : baseUrl;

    super({
      providerName: 'cloudflare',
      baseUrl: effectiveBaseUrl,
      apiKey: options.apiKey,
      missingEnvVar: 'CLOUDFLARE_API_KEY',
      chatEndpoint,
    });

    if (!options.apiKey || !options.accountId) {
      (this as { mock: boolean }).mock = true;
    }
  }
}
