import type { ChatMessage, CompletionResult } from '../../types.js';
import { OpenAiWireClient, ProviderError, type ProviderCompleteOptions } from './provider.js';
import type { StreamHandlers } from './stream.js';

export interface OpenRouterClientOptions {
  apiKey?: string;
  baseUrl?: string;
  appTitle?: string;
  appUrl?: string;
}

export type OpenRouterCompleteOptions = ProviderCompleteOptions;

export class OpenRouterError extends ProviderError {
  constructor(
    message: string,
    status?: number,
    retryable = false,
    public override readonly retryAfter?: number,
    public readonly errorType?: string,
  ) {
    super(message, status, retryable, retryAfter);
    this.name = 'OpenRouterError';
  }
}

/**
 * OpenRouter client with robust thinking/reasoning parameters, provider routing,
 * and rate-limit delay handling.
 */
export class OpenRouterClient extends OpenAiWireClient {
  constructor(options: OpenRouterClientOptions = {}) {
    super({
      providerName: 'openrouter',
      baseUrl: options.baseUrl ?? 'https://openrouter.ai/api/v1',
      apiKey: options.apiKey,
      missingEnvVar: 'OPENROUTER_API_KEY',
      defaultHeaders: {
        'HTTP-Referer': options.appUrl ?? 'https://github.com/auarunkumar1/mugil-ide',
        'X-Title': options.appTitle ?? 'Mugil IDE',
      },
    });
  }

  override buildBody(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Record<string, unknown> {
    const body = super.buildBody(messages, options);

    // Wire thinkingLevel and thinkingBudgetTokens to OpenRouter reasoning format
    if (options.thinkingLevel && options.thinkingLevel !== 'off') {
      const reasoning: Record<string, unknown> = { effort: options.thinkingLevel };
      if (options.thinkingBudgetTokens) {
        reasoning.max_tokens = options.thinkingBudgetTokens;
      }
      body.reasoning = reasoning;
    }

    // Tools routing parameters: require_parameters ensures provider enforces parameter presence
    if (options.tools && options.tools.length > 0) {
      body.provider = {
        require_parameters: true,
        ...(typeof (body.provider as any) === 'object' ? (body.provider as any) : {}),
      };
    }

    return body;
  }

  protected override createError(
    message: string,
    status?: number,
    retryable = false,
    retryAfter?: number,
  ): ProviderError {
    return new OpenRouterError(message, status, retryable, retryAfter);
  }

  protected override handleHttpError(
    status: number,
    statusText: string,
    bodyText: string,
    retryable: boolean,
    headers?: Headers,
  ): never {
    let retryAfter: number | undefined;
    const retryHeader = headers?.get('retry-after');
    if (retryHeader) {
      const sec = parseInt(retryHeader, 10);
      if (!isNaN(sec)) {
        retryAfter = sec;
      } else {
        const d = Date.parse(retryHeader);
        if (!isNaN(d)) {
          retryAfter = Math.max(0, Math.ceil((d - Date.now()) / 1000));
        }
      }
    }

    let errorType: string | undefined;
    let message = `OpenRouter ${status} ${statusText}: ${bodyText.slice(0, 300)}`;
    try {
      const parsed = JSON.parse(bodyText);
      const err = parsed?.error;
      if (err) {
        if (typeof err.message === 'string') {
          message = `OpenRouter ${status}: ${err.message}`;
        }
        if (err.metadata?.error_type) {
          errorType = String(err.metadata.error_type);
          message += ` (error_type: ${errorType})`;
        }
        if (err.metadata?.recheck_after && retryAfter === undefined) {
          const recheck = Number(err.metadata.recheck_after);
          if (!isNaN(recheck)) retryAfter = recheck;
        }
      }
    } catch {
      // not JSON
    }

    throw new OpenRouterError(
      message,
      status,
      retryable,
      retryAfter,
      errorType,
    );
  }

  override async complete(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Promise<CompletionResult> {
    const execute = async () => {
      const result = await super.complete(messages, options);
      return {
        ...result,
        usage: {
          ...result.usage,
          billingSource: 'openrouter' as const,
        },
      };
    };

    try {
      return await execute();
    } catch (err) {
      if (
        err instanceof OpenRouterError &&
        err.retryable &&
        typeof err.retryAfter === 'number' &&
        err.retryAfter > 0 &&
        err.retryAfter <= 10
      ) {
        await new Promise((r) => setTimeout(r, err.retryAfter! * 1000));
        return await execute();
      }
      throw err;
    }
  }

  override async stream(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    handlers: StreamHandlers = {},
  ): Promise<CompletionResult> {
    const execute = async () => {
      const result = await super.stream(messages, options, handlers);
      return {
        ...result,
        usage: {
          ...result.usage,
          billingSource: 'openrouter' as const,
        },
      };
    };

    try {
      return await execute();
    } catch (err) {
      if (
        err instanceof OpenRouterError &&
        err.retryable &&
        typeof err.retryAfter === 'number' &&
        err.retryAfter > 0 &&
        err.retryAfter <= 10
      ) {
        await new Promise((r) => setTimeout(r, err.retryAfter! * 1000));
        return await execute();
      }
      throw err;
    }
  }
}
