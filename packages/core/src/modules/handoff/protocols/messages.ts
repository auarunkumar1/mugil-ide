import type { ChatMessage, CompletionResult, ToolCall, ToolDefinition } from '../../../types.js';
import { canonicalizeJson, type ProviderCompleteOptions } from '../provider.js';
import { parseAnthropicSse, type StreamedCompletion, type StreamHandlers } from '../stream.js';
import type { ProtocolAdapter } from './types.js';
import { parseUsageMetadata } from './types.js';

function toAnthropicMessages(
  messages: ChatMessage[],
): Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> {
  const out: Array<{
    role: 'user' | 'assistant';
    content: string | Array<Record<string, unknown>>;
  }> = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId!, content: m.content }],
      });
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = [];
      if (m.reasoning) {
        blocks.push({ type: 'thinking', thinking: m.reasoning });
      }
      if (m.content) {
        blocks.push({ type: 'text', text: m.content });
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        for (const call of m.toolCalls) {
          let input: unknown = {};
          try {
            input = JSON.parse(call.arguments);
          } catch {
            input = {};
          }
          blocks.push({ type: 'tool_use', id: call.id, name: call.name, input });
        }
      }
      if (blocks.length > 0) {
        out.push({ role: 'assistant', content: blocks });
        continue;
      }
    }
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  return out;
}

export class MessagesAdapter implements ProtocolAdapter {
  readonly name = 'messages';
  readonly chatEndpoint = '/v1/messages';

  buildRequestBody(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Record<string, unknown> {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
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
      temperature = undefined;
    }

    const systemBlocks: Array<{
      type: 'text';
      text: string;
      cache_control?: { type: 'ephemeral' };
    }> = [];
    if (system.trim().length > 0) {
      systemBlocks.push({
        type: 'text',
        text: system,
        cache_control: { type: 'ephemeral' },
      });
    }

    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: maxTokens,
      system: systemBlocks.length > 0 ? systemBlocks : undefined,
      messages: chat,
      temperature,
      thinking: thinkingConfig,
    };

    if (options.tools && options.tools.length > 0) {
      const stableTools = [...options.tools].sort((a, b) => a.name.localeCompare(b.name));
      body.tools = stableTools.map((t: ToolDefinition, idx: number) => {
        const toolDef: Record<string, unknown> = {
          name: t.name,
          description: t.description,
          input_schema: canonicalizeJson(t.parameters),
        };
        if (idx === stableTools.length - 1) {
          toolDef.cache_control = { type: 'ephemeral' };
        }
        return toolDef;
      });
    }

    return body;
  }

  parseResponse(
    json: Record<string, unknown>,
    model: string,
    providerName: string,
  ): CompletionResult {
    const contentBlocks = (json.content as Array<Record<string, any>> | undefined) ?? [];
    let text = '';
    let thinking = '';
    const toolCalls: ToolCall[] = [];

    for (const b of contentBlocks) {
      if (b.type === 'text' && typeof b.text === 'string') text += b.text;
      if (b.type === 'thinking' && typeof b.thinking === 'string') thinking += b.thinking;
      if (b.type === 'tool_use') {
        toolCalls.push({
          id: b.id ?? '',
          name: b.name ?? '',
          arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input ?? {}),
        });
      }
    }

    const u = json.usage as Record<string, any> | undefined;
    const promptTokens = u?.input_tokens ?? 0;
    const completionTokens = u?.output_tokens ?? 0;
    const cachedTokens = u?.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = u?.cache_creation_input_tokens;
    const totalTokens = promptTokens + completionTokens;
    const meta = parseUsageMetadata(u);

    return {
      provider: providerName,
      model,
      content: text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        cachedTokens: cachedTokens > 0 ? cachedTokens : undefined,
        cacheWriteTokens,
        cost: meta.cost,
        allowance: meta.allowance,
        billingSource: meta.billingSource,
      },
      finishReason: typeof json.stop_reason === 'string' ? json.stop_reason : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: thinking.length > 0 ? thinking : undefined,
    };
  }

  async parseStream(
    body: ReadableStream<Uint8Array>,
    handlers: StreamHandlers,
  ): Promise<StreamedCompletion> {
    return parseAnthropicSse(body, handlers);
  }
}
