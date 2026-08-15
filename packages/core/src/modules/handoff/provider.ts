import type { ChatMessage, CompletionResult, ThinkingLevel, ToolDefinition } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';

export interface ProviderCompleteOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  thinkingLevel?: ThinkingLevel;
  thinkingBudgetTokens?: number;
  /** Tools the model may call. Omit for plain completions. */
  tools?: ToolDefinition[];
}

/** OpenAI-compatible `tools` wire format (used by openAi.ts and openRouter.ts). */
export function toOpenAiTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Neutral ChatMessage[] -> OpenAI-compatible wire messages.
 * Translates camelCase `toolCalls`/`toolCallId` into the snake_case
 * `tool_calls`/`tool_call_id` the API expects; plain messages pass through.
 */
export function toOpenAiMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m): Record<string, unknown> => {
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * A completion provider the HandoffManager can route to. OpenRouter, OpenAI
 * and Anthropic all implement this shape; each falls back to the offline
 * mock when its API key is absent.
 */
export interface ProviderClient {
  readonly mock: boolean;
  complete(messages: ChatMessage[], options: ProviderCompleteOptions): Promise<CompletionResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Deterministic offline response shared by all providers. */
export function mockCompletion(
  messages: ChatMessage[],
  options: ProviderCompleteOptions,
  missingVar: string,
): CompletionResult {
  const userText = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  const content = [
    `[mock] no ${missingVar} — offline response.`,
    `requested model: ${options.model}`,
    `prompt (${countTokens(userText)} tokens): ${userText.slice(0, 200)}${userText.length > 200 ? '…' : ''}`,
  ].join('\n');
  const promptTokens = countTokens(messages.map((m) => m.content).join('\n'));
  const completionTokens = countTokens(content);
  return {
    provider: 'mock',
    model: options.model,
    content,
    usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    finishReason: 'stop',
    mock: true,
  };
}
