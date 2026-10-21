import { OpenAiWireClient, type ProviderCompleteOptions } from './provider.js';

export interface OpenRouterClientOptions {
  apiKey?: string;
  baseUrl?: string;
  appTitle?: string;
  appUrl?: string;
}

export type OpenRouterCompleteOptions = ProviderCompleteOptions;

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

/**
 * Minimal OpenRouter client. Without an API key it runs in mock mode and
 * returns deterministic responses so the whole pipeline is exercisable
 * offline.
 */
export class OpenRouterClient extends OpenAiWireClient {
  constructor(options: OpenRouterClientOptions = {}) {
    super({
      providerName: 'openrouter',
      baseUrl: options.baseUrl ?? 'https://openrouter.ai/api/v1',
      apiKey: options.apiKey,
      missingEnvVar: 'OPENROUTER_API_KEY',
      defaultHeaders: {
        'HTTP-Referer': options.appUrl ?? 'https://mugil-ide.local',
        'X-Title': options.appTitle ?? 'Mugil IDE',
      },
    });
  }

  protected override handleHttpError(status: number, statusText: string, bodyText: string, retryable: boolean): never {
    throw new OpenRouterError(
      `OpenRouter ${status} ${statusText}: ${bodyText.slice(0, 300)}`,
      status,
      retryable,
    );
  }
}
