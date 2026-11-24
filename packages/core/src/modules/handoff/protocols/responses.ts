import type { ChatMessage, CompletionResult, ToolCall } from '../../../types.js';
import { canonicalizeJson, ProviderError, type ProviderCompleteOptions } from '../provider.js';
import { iterateSseEvents, type StreamedCompletion, type StreamHandlers } from '../stream.js';
import { extractTextualToolCalls } from '../toolExtractor.js';
import type { ProtocolAdapter } from './types.js';
import { parseUsageMetadata } from './types.js';

export class ResponsesAdapter implements ProtocolAdapter {
  readonly name = 'responses';
  readonly chatEndpoint = '/responses';

  buildRequestBody(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Record<string, unknown> {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const input = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            type: 'function_call_output',
            call_id: m.toolCallId,
            output: m.content,
          };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant',
            content: m.content || undefined,
            function_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            })),
          };
        }
        return {
          role: m.role,
          content: m.content,
        };
      });

    const body: Record<string, unknown> = {
      model: options.model,
      input,
    };

    if (system.trim().length > 0) {
      body.instructions = system;
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (options.maxTokens !== undefined) {
      body.max_output_tokens = options.maxTokens;
    }

    if (options.thinkingLevel && options.thinkingLevel !== 'off') {
      body.reasoning = { effort: options.thinkingLevel };
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: canonicalizeJson(t.parameters),
      }));
    }

    return body;
  }

  parseResponse(
    json: Record<string, unknown>,
    model: string,
    providerName: string,
  ): CompletionResult {
    let content = '';
    let thinking = '';
    const toolCalls: ToolCall[] = [];

    if (json.status === 'failed' || json.error) {
      const err = json.error as Record<string, any> | string | undefined;
      const message =
        typeof err === 'string'
          ? err
          : err?.message ?? JSON.stringify(err ?? { status: json.status });
      throw new ProviderError(`Responses API error: ${message}`, 500, false);
    }

    // Output items array (native Responses API shape)
    if (Array.isArray(json.output)) {
      for (const item of json.output) {
        if (item.type === 'message' && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (
              (part.type === 'output_text' || part.type === 'text') &&
              typeof part.text === 'string'
            ) {
              content += part.text;
            }
            if (part.type === 'reasoning' && typeof part.text === 'string') {
              thinking += part.text;
            }
          }
        }
        if (item.type === 'reasoning') {
          const parts = Array.isArray(item.content) ? item.content : [];
          for (const part of parts) {
            if (typeof part.text === 'string') thinking += part.text;
          }
          const summaries = Array.isArray(item.summary) ? item.summary : [];
          for (const part of summaries) {
            if (typeof part.text === 'string') thinking += part.text;
          }
        }
        if (item.type === 'function_call') {
          toolCalls.push({
            id: item.call_id ?? item.id ?? '',
            name: item.name ?? '',
            arguments:
              typeof item.arguments === 'string'
                ? item.arguments
                : JSON.stringify(item.arguments ?? {}),
          });
        }
      }
    }

    if (typeof json.output_text === 'string' && json.output_text.length > 0) {
      content = json.output_text;
    }

    // Fallback to standard OpenAI choices shape if Console translated it
    if (!content && Array.isArray(json.choices) && json.choices.length > 0) {
      const choice = json.choices[0];
      content = choice.message?.content ?? '';
      thinking = choice.message?.reasoning_content ?? choice.message?.reasoning ?? '';
      if (Array.isArray(choice.message?.tool_calls)) {
        for (const tc of choice.message.tool_calls) {
          toolCalls.push({
            id: tc.id ?? '',
            name: tc.function?.name ?? '',
            arguments: tc.function?.arguments ?? '{}',
          });
        }
      }
    }

    if (toolCalls.length === 0) {
      const extracted = extractTextualToolCalls(content);
      if (extracted.toolCalls.length > 0) {
        toolCalls.push(...extracted.toolCalls);
        content = extracted.cleanContent;
      }
    }

    const u = json.usage as Record<string, any> | undefined;
    const promptTokens = u?.input_tokens ?? u?.prompt_tokens ?? 0;
    const completionTokens = u?.output_tokens ?? u?.completion_tokens ?? 0;
    const totalTokens = u?.total_tokens ?? promptTokens + completionTokens;
    const meta = parseUsageMetadata(u);
    const incomplete =
      json.incomplete_details && typeof json.incomplete_details === 'object'
        ? (json.incomplete_details as { reason?: string }).reason
        : undefined;

    return {
      provider: providerName,
      model,
      content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        reasoningTokens: u?.output_tokens_details?.reasoning_tokens,
        cachedTokens: u?.input_tokens_details?.cached_tokens,
        cacheWriteTokens:
          u?.input_tokens_details?.cache_write_tokens ??
          u?.input_tokens_details?.cache_creation_tokens,
        cost: meta.cost,
        listCost: meta.listCost,
        allowance: meta.allowance,
        billingSource: meta.billingSource,
      },
      finishReason:
        incomplete ??
        (typeof json.status === 'string' ? json.status : undefined),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: thinking.length > 0 ? thinking : undefined,
    };
  }

  async parseStream(
    body: ReadableStream<Uint8Array>,
    handlers: StreamHandlers,
  ): Promise<StreamedCompletion> {
    let content = '';
    let thinking = '';
    let finishReason: string | undefined;
    let usage: StreamedCompletion['usage'];
    const partial = new Map<string, { id: string; name: string; args: string }>();

    for await (const ev of iterateSseEvents(body)) {
      if (ev.data === '[DONE]') break;
      let json: Record<string, any>;
      try {
        json = JSON.parse(ev.data);
      } catch {
        continue;
      }

      const type = String(json.type ?? ev.event ?? '');

      if (type === 'error' || type === 'response.failed') {
        const err = json.error ?? json.response?.error ?? json;
        const message =
          typeof err?.message === 'string'
            ? err.message
            : typeof err === 'string'
              ? err
              : 'Responses stream failed';
        throw new ProviderError(`Responses API stream error: ${message}`, 500, false);
      }

      if (
        type === 'response.reasoning.delta' ||
        type === 'response.reasoning_text.delta' ||
        type === 'response.reasoning_summary_text.delta'
      ) {
        const delta = typeof json.delta === 'string' ? json.delta : json.text;
        if (typeof delta === 'string' && delta.length > 0) {
          thinking += delta;
          handlers.onThinking?.(delta, true);
        }
        continue;
      }

      if (type === 'response.output_text.delta') {
        const delta = typeof json.delta === 'string' ? json.delta : undefined;
        if (delta) {
          content += delta;
          handlers.onDelta?.(delta, true);
        }
        continue;
      }

      // Do not append response.output_text.done / output_item.done text: it
      // duplicates the deltas already streamed above.
      if (type === 'response.output_item.added' || type === 'response.output_item.done') {
        const item = json.item;
        if (item?.type === 'function_call') {
          const id = item.call_id ?? item.id ?? '';
          partial.set(id, {
            id,
            name: item.name ?? '',
            args: typeof item.arguments === 'string' ? item.arguments : '',
          });
        }
        continue;
      }

      if (type === 'response.function_call_arguments.delta') {
        const id = json.item_id ?? json.call_id ?? '';
        const slot = partial.get(id) ?? { id, name: '', args: '' };
        if (typeof json.delta === 'string') slot.args += json.delta;
        partial.set(id, slot);
        continue;
      }

      if (type === 'response.function_call_arguments.done') {
        const id = json.item_id ?? json.call_id ?? '';
        const slot = partial.get(id) ?? { id, name: '', args: '' };
        if (typeof json.arguments === 'string') slot.args = json.arguments;
        partial.set(id, slot);
        continue;
      }

      if (
        type === 'response.completed' ||
        type === 'response.incomplete' ||
        type === 'response.done'
      ) {
        const response = json.response ?? json;
        const u = response?.usage ?? json.usage;
        if (u) {
          usage = {
            promptTokens: u.input_tokens ?? u.prompt_tokens,
            completionTokens: u.output_tokens ?? u.completion_tokens,
            totalTokens: u.total_tokens,
            reasoningTokens: u.output_tokens_details?.reasoning_tokens,
            cachedTokens: u.input_tokens_details?.cached_tokens,
            cacheWriteTokens:
              u.input_tokens_details?.cache_write_tokens ??
              u.input_tokens_details?.cache_creation_tokens,
            ...parseUsageMetadata(u),
          };
        }
        if (typeof response?.status === 'string') finishReason = response.status;
        if (
          response?.incomplete_details &&
          typeof response.incomplete_details.reason === 'string'
        ) {
          finishReason = response.incomplete_details.reason;
        }
      }
    }

    const toolCalls: ToolCall[] = [...partial.values()]
      .filter((v) => v.name.length > 0)
      .map((v) => ({ id: v.id, name: v.name, arguments: v.args || '{}' }));

    return {
      content,
      thinking,
      toolCalls,
      finishReason,
      usage,
    };
  }
}
