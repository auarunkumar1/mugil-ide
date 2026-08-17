/**
 * Minimal Anthropic Messages-API client. System messages are sent in the
 * `system` field (Anthropic has no system role); `max_tokens` is required.
 * Without an API key it runs in mock mode so the pipeline is exercisable
 * offline.
 */
import type { ChatMessage, CompletionResult, ToolCall, ToolDefinition } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import { mockCompletion, ProviderError, type ProviderClient, type ProviderCompleteOptions } from './provider.js';

export interface AnthropicClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

interface AnthropicResponse {
  model?: string;
  content?: Array<{
    type?: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

/**
 * Neutral ChatMessage[] -> Anthropic wire messages. Each tool result becomes
 * its own user message with a single tool_result block (Anthropic forbids
 * merging tool_results); assistant tool calls become tool_use content blocks.
 */
function toAnthropicMessages(
  messages: ChatMessage[],
): Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // handled via top-level `system` field
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId!, content: m.content }],
      });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: Array<Record<string, unknown>> = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const call of m.toolCalls) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.arguments);
        } catch {
          input = {};
        }
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input });
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  return out;
}

export class AnthropicClient implements ProviderClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  readonly mock: boolean;

  constructor(options: AnthropicClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
    this.mock = !this.apiKey;
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Promise<CompletionResult> {
    if (this.mock) return mockCompletion(messages, options, 'ANTHROPIC_API_KEY');
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    let chat = toAnthropicMessages(messages);
    if (chat.length === 0) {
      chat = [{ role: 'user', content: system || 'hello' }];
    }

    const thinkingLevel = options.thinkingLevel;
    let thinkingConfig: { type: 'enabled'; budget_tokens: number } | undefined;
    let maxTokens = options.maxTokens ?? 1024;
    let temperature = options.temperature;

    if (thinkingLevel && thinkingLevel !== 'off') {
      const budgetMap = { low: 1024, medium: 4096, high: 16384 };
      const budget = options.thinkingBudgetTokens ?? budgetMap[thinkingLevel] ?? 2048;
      thinkingConfig = { type: 'enabled', budget_tokens: budget };
      maxTokens = Math.max(maxTokens, budget + 1024);
      temperature = undefined; // Anthropic requires temperature=1 or omitted with thinking
    }

    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: maxTokens,
      system: system.trim().length > 0 ? system : undefined,
      messages: chat,
      temperature,
      thinking: thinkingConfig,
    };
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t: ToolDefinition) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(
        `Anthropic ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`,
        res.status,
        retryable,
      );
    }

    const data = (await res.json()) as AnthropicResponse;
    const blocks = data.content ?? [];
    let content = blocks
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text!)
      .join('');
    const thinking = blocks
      .filter((block) => block.type === 'thinking' && typeof block.thinking === 'string')
      .map((block) => block.thinking!)
      .join('');
    const toolCalls: ToolCall[] = blocks
      .filter((b) => b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string')
      .map((b) => ({ id: b.id!, name: b.name!, arguments: JSON.stringify(b.input ?? {}) }));
    // Thinking-only replies (max_tokens exhausted mid-reasoning) contain no
    // text block; surface the reasoning rather than a blank response.
    if (content.trim().length === 0 && toolCalls.length === 0 && thinking.trim().length > 0) {
      content = thinking;
    }
    const promptText = messages.map((m) => m.content).join('\n');
    const promptTokens = data.usage?.input_tokens ?? countTokens(promptText);
    const completionTokens = data.usage?.output_tokens ?? countTokens(content);
    const usage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
    return {
      provider: 'anthropic',
      model: data.model ?? options.model,
      content,
      usage,
      finishReason: data.stop_reason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: thinking.length > 0 ? thinking : undefined,
    };
  }
}
