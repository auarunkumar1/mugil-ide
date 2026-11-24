import type { ChatMessage, CompletionResult, ToolCall } from '../../../types.js';
import {
  extractThinkBlock,
  toOpenAiMessages,
  toOpenAiTools,
  type ProviderCompleteOptions,
} from '../provider.js';
import { parseOpenAiSse, type StreamedCompletion, type StreamHandlers } from '../stream.js';
import { extractTextualToolCalls } from '../toolExtractor.js';
import type { ProtocolAdapter } from './types.js';
import { parseUsageMetadata } from './types.js';

export class ChatCompletionsAdapter implements ProtocolAdapter {
  readonly name = 'chat-completions';
  readonly chatEndpoint = '/chat/completions';

  buildRequestBody(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: toOpenAiMessages(messages),
    };

    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

    if (options.tools && options.tools.length > 0) {
      body.tools = toOpenAiTools(options.tools);
      body.tool_choice = 'auto';
    }

    if (options.thinkingLevel && options.thinkingLevel !== 'off') {
      body.reasoning_effort = options.thinkingLevel;
    }

    return body;
  }

  parseResponse(
    json: Record<string, unknown>,
    model: string,
    providerName: string,
  ): CompletionResult {
    const choices = (json.choices as Array<Record<string, any>> | undefined) ?? [];
    const choice = choices[0];
    const message = choice?.message;

    const split = extractThinkBlock(
      message?.content ?? '',
      message?.reasoning_content ?? message?.reasoning,
    );
    let content = split.content;
    const thinking = split.thinking;

    let toolCalls: ToolCall[] = (message?.tool_calls ?? [])
      .filter((tc: any) => Boolean(tc?.function?.name))
      .map((tc: any) => ({
        id: tc.id ?? '',
        name: tc.function!.name!,
        arguments: tc.function!.arguments ?? '{}',
      }));

    if (toolCalls.length === 0) {
      const extracted = extractTextualToolCalls(content);
      if (extracted.toolCalls.length > 0) {
        toolCalls = extracted.toolCalls;
        content = extracted.cleanContent;
      }
    }

    if (
      content.trim().length === 0 &&
      toolCalls.length === 0 &&
      thinking &&
      thinking.trim().length > 0
    ) {
      content = thinking;
    }

    const u = json.usage as Record<string, any> | undefined;
    const promptTokens = u?.prompt_tokens ?? 0;
    const completionTokens = u?.completion_tokens ?? 0;
    const totalTokens = u?.total_tokens ?? promptTokens + completionTokens;
    const cachedTokens = u?.prompt_tokens_details?.cached_tokens;
    const reasoningTokens = u?.completion_tokens_details?.reasoning_tokens;
    const meta = parseUsageMetadata(u);

    return {
      provider: providerName,
      model,
      content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        cachedTokens,
        reasoningTokens,
        cost: meta.cost,
        allowance: meta.allowance,
        billingSource: meta.billingSource,
      },
      finishReason: choice?.finish_reason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: thinking && thinking.length > 0 ? thinking : undefined,
    };
  }

  async parseStream(
    body: ReadableStream<Uint8Array>,
    handlers: StreamHandlers,
  ): Promise<StreamedCompletion> {
    return parseOpenAiSse(body, handlers);
  }
}
