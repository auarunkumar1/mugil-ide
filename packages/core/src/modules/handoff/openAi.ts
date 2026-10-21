/**
 * Minimal OpenAI chat-completions client. Talks to `{baseUrl}/chat/completions`
 * (OpenAI-compatible endpoints work too). Without an API key it runs in mock
 * mode so the pipeline is exercisable offline.
 */
import { OpenAiWireClient } from './provider.js';

export interface OpenAiClientOptions {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
}

export class OpenAiClient extends OpenAiWireClient {
  constructor(options: OpenAiClientOptions = {}) {
    const baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    super({
      providerName: 'openai',
      baseUrl,
      apiKey: options.apiKey,
      missingEnvVar: 'OPENAI_API_KEY',
      extraHeaders: options.headers,
      isLocalEndpoint: () =>
        baseUrl.includes('localhost') ||
        baseUrl.includes('127.0.0.1') ||
        baseUrl.includes('0.0.0.0') ||
        baseUrl.includes('::1'),
    });
  }
}
