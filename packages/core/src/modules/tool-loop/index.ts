/**
 * Tool Loop — the agentic "function calling" loop.
 *
 * Credits
 * -------
 * Inspired by the Model Context Protocol (https://modelcontextprotocol.io),
 * OpenAI Function Calling (https://platform.openai.com/docs/guides/function-calling),
 * and Anthropic Tool Use standards (https://docs.anthropic.com).
 *
 * Given a chat history, a set of tool declarations and a registry of tool
 * executors, it repeatedly asks the model, executes any requested tool calls
 * (feeding results back as `tool` messages), and stops when the model replies
 * without tool calls. The loop is bounded: after `maxIterations` the model is
 * forced to answer without tools so a final text is always produced.
 *
 * See ATTRIBUTIONS.md at the repository root for the full credit list.
 */
import type { ChatMessage, HandoffOptions, ToolCall, ToolDefinition, Usage } from '../../types.js';
import type { HandoffManager, HandoffResult } from '../handoff/index.js';
import { streamCompletion, type StreamHandlers } from '../handoff/stream.js';
import { compressCommandOutput } from '../rtk/index.js';

export type ToolExecutor = (call: ToolCall) => Promise<string>;
export type ToolRegistry = Record<string, ToolExecutor>;

export interface ToolLoopOptions {
  handoff: HandoffManager;
  /** Bounded iterations; a forced no-tools completion follows when exhausted. Default 15. */
  maxIterations?: number;
  /** Called with each executed tool call (for live progress events). */
  onTool?: (call: ToolCall, index: number) => void;
  /**
   * Called after each tool call finishes, with the outcome (content fed back
   * to the model + whether it succeeded) so callers can render results.
   */
  onToolResult?: (call: ToolCall, result: { content: string; ok: boolean }, index: number) => void;
  /**
   * Recomputes `maxTokens` from the messages actually accumulated so far.
   * The pipeline sizes the output budget once, before any tool result exists;
   * by iteration 10 the context has grown by tens of thousands of tokens and a
   * fixed cap no longer reflects what the model has room to say. Returning
   * undefined keeps the original value.
   */
  sizeMaxTokens?: (messages: ChatMessage[]) => number | undefined;
  /**
   * Called with each streamed text fragment as it arrives. The text is
   * provisional: a completion that streams and then requests tool calls makes
   * the consumer discard what it rendered. `streamed` is the provenance flag
   * forwarded from `StreamHandlers` (`false` for the buffered whole-answer
   * replay) — the loop adds no interpretation of its own.
   */
  onDelta?: (text: string, streamed?: boolean) => void;
  /** Called with each streamed reasoning fragment as it arrives. */
  onThinking?: (text: string, streamed?: boolean) => void;
}

export interface ToolLoopRunOptions extends HandoffOptions {
  tools: ToolDefinition[];
  registry: ToolRegistry;
  /**
   * Optional gate: return false to deny a tool call. A denied call is fed
   * back to the model as a `Permission denied: ...` tool result so it can
   * recover (ask the user, choose another approach). Absent = allow all.
   */
  permission?: (call: ToolCall) => boolean | Promise<boolean>;
}

/** Mirrors HandoffResult with the number of executed tool calls. */
export interface ToolLoopResult {
  provider: string;
  model: string;
  content: string;
  usage: Usage;
  finishReason?: string;
  mock?: boolean;
  thinking?: string;
  /** Models tried, in order, before success (from the final completion). */
  attempts: string[];
  /** Number of tool calls executed across the loop. */
  toolCalls: number;
}

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

const MAX_ITERATION_PROMPT =
  'You have reached the maximum number of tool calls for this turn. Stop using tools now and provide a final response: summarize the work completed so far and list the remaining steps that still need doing.';

/** JSON.parse(call.arguments); returns null on invalid JSON instead of crashing the turn. */
export function tryParseToolArguments(call: ToolCall): unknown | null {
  try {
    return JSON.parse(call.arguments);
  } catch {
    return null;
  }
}

/** JSON.parse(call.arguments); throws ToolError on invalid JSON. */
export function parseToolArguments(call: ToolCall): unknown {
  try {
    return JSON.parse(call.arguments);
  } catch {
    throw new ToolError(`tool "${call.name}" received invalid JSON arguments: ${call.arguments}`);
  }
}

export class ToolLoop {
  private readonly handoff: HandoffManager;
  private readonly maxIterations: number;
  private readonly onTool?: (call: ToolCall, index: number) => void;
  private readonly onToolResult?: (call: ToolCall, result: { content: string; ok: boolean }, index: number) => void;
  private readonly sizeMaxTokens?: (messages: ChatMessage[]) => number | undefined;
  private readonly onDelta?: (text: string, streamed?: boolean) => void;
  private readonly handlers: StreamHandlers;

  constructor(options: ToolLoopOptions) {
    this.handoff = options.handoff;
    const envLimit = process.env.MUGIL_IDE_MAX_TOOL_ITERATIONS ? Number(process.env.MUGIL_IDE_MAX_TOOL_ITERATIONS) : NaN;
    this.maxIterations = options.maxIterations ?? (Number.isFinite(envLimit) && envLimit > 0 ? Math.floor(envLimit) : 15);
    this.onTool = options.onTool;
    this.onToolResult = options.onToolResult;
    this.sizeMaxTokens = options.sizeMaxTokens;
    this.onDelta = options.onDelta;
    this.handlers = { onDelta: this.onDelta, onThinking: options.onThinking };
  }

  async run(messages: ChatMessage[], options: ToolLoopRunOptions): Promise<ToolLoopResult> {
    const missing = options.tools.map((t) => t.name).filter((name) => !(name in options.registry));
    if (missing.length > 0) {
      throw new ToolError(`no executor registered for tool(s): ${missing.join(', ')}`);
    }

    const msgs = [...messages];
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let toolCalls = 0;
    // A model that keeps re-issuing a call the gate refused spends a full
    // round-trip (and the whole resend context) per attempt. Count denials by
    // call signature and, past the limit, tell it plainly that retrying is
    // pointless instead of letting it burn the iteration budget.
    const denials = new Map<string, number>();
    const REPEAT_DENIAL_LIMIT = 2;

    for (let i = 0; i < this.maxIterations; i += 1) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted');
      const completion = await streamCompletion(
        this.handoff,
        msgs,
        this.sized(msgs, options),
        this.handlers,
      );
      usage = this.sum(usage, completion.usage);
      if (!completion.toolCalls || completion.toolCalls.length === 0) {
        return this.finish(completion, msgs, options, usage, toolCalls);
      }

      msgs.push({
        role: 'assistant',
        content: completion.content ?? '',
        toolCalls: completion.toolCalls,
      });

      for (const call of completion.toolCalls) {
        toolCalls += 1;
        this.onTool?.(call, toolCalls);
        const outcome = await this.execute(call, options.registry, options.permission);
        this.onToolResult?.(call, outcome, toolCalls);
        const signature = `${call.name}:${call.arguments}`;
        const times = (denials.get(signature) ?? 0) + (outcome.ok ? 0 : 1);
        denials.set(signature, times);
        if (!outcome.ok && times > REPEAT_DENIAL_LIMIT && outcome.content.startsWith('Permission denied')) {
          // Same call, same refusal — escalate the instruction once instead of
          // letting the loop spend the remaining iterations re-asking.
          msgs.push({
            role: 'assistant',
            content: `(repeating the denied call "${call.name}")`,
            toolCalls: [call],
          });
          msgs.push({
            role: 'tool',
            toolCallId: call.id,
            content:
              `Permission denied again for "${call.name}" (${times} attempts). The permission policy will not change during this turn. ` +
              'Do not retry this call. Either choose tools the policy allows, or finish your turn and tell the user exactly which call needs their approval.',
          });
          continue;
        }
        msgs.push({
          role: 'tool',
          toolCallId: call.id,
          content: outcome.content,
        });
      }
    }

    // Bounded: force a final answer without tools so we never return empty.
    const forcedMessages = [...msgs, { role: 'user' as const, content: MAX_ITERATION_PROMPT }];
    const final = await streamCompletion(
      this.handoff,
      forcedMessages,
      { ...this.sized(forcedMessages, options), tools: undefined },
      this.handlers,
    );
    usage = this.sum(usage, final.usage);
    return this.finish(final, forcedMessages, options, usage, toolCalls);
  }

  /** Re-sizes the output budget against the context accumulated so far. */
  private sized(messages: ChatMessage[], options: ToolLoopRunOptions): ToolLoopRunOptions {
    if (!this.sizeMaxTokens) return options;
    const maxTokens = this.sizeMaxTokens(messages);
    return maxTokens === undefined ? options : { ...options, maxTokens };
  }

  /**
   * Ensures the loop never returns a blank "success". An empty final completion
   * (e.g. a reasoning-only reply from DeepSeek-R1, or a thinking-only Anthropic
   * response) is retried once without tools; if the retry is still empty we
   * surface the reasoning text when present and otherwise throw, so a caller
   * sees a clear error instead of "tokens consumed, no response".
   */
  private async finish(
    completion: HandoffResult,
    messages: ChatMessage[],
    options: ToolLoopRunOptions,
    usage: Usage,
    toolCalls: number,
  ): Promise<ToolLoopResult> {
    if (completion.content.trim().length > 0) {
      return { ...completion, usage, toolCalls };
    }
    const retryPrompt =
      'Your previous response was empty. Provide your final answer now without calling any tools.';
    // Append to the last message when it is a user message so providers that
    // forbid consecutive same-role messages (Anthropic) still accept the retry.
    const retryMessages = [...messages];
    const last = retryMessages[retryMessages.length - 1];
    if (last && last.role === 'user') {
      retryMessages[retryMessages.length - 1] = {
        ...last,
        content: `${last.content}\n\n${retryPrompt}`,
      };
    } else {
      retryMessages.push({ role: 'user', content: retryPrompt });
    }
    const retry = await streamCompletion(
      this.handoff,
      retryMessages,
      { ...this.sized(retryMessages, options), tools: undefined },
      this.handlers,
    );
    usage = this.sum(usage, retry.usage);
    if (retry.content.trim().length > 0) {
      return { ...retry, usage, toolCalls };
    }
    if (retry.thinking && retry.thinking.trim().length > 0) {
      return { ...retry, content: retry.thinking, usage, toolCalls };
    }
    // Rather than throwing a fatal ToolError that crashes the conversation turn,
    // return a clean status message with the actions performed so the turn stays valid.
    return {
      ...retry,
      content: `The model completed ${toolCalls} tool operation(s) but produced no further text.`,
      usage,
      toolCalls,
    };
  }

  private async execute(
    call: ToolCall,
    registry: ToolRegistry,
    permission?: (call: ToolCall) => boolean | Promise<boolean>,
  ): Promise<{ content: string; ok: boolean }> {
    const executor = registry[call.name];
    if (!executor) {
      return { content: `Error: unknown tool "${call.name}"`, ok: false };
    }
    if (permission) {
      let allowed = true;
      try {
        allowed = await permission(call);
      } catch {
        allowed = false;
      }
      if (!allowed) {
        return {
          content:
            'Permission denied: the user did not approve the "' +
            `${call.name}" tool call. Explain what you wanted to do and ask for approval, or find another approach that does not need this tool.`,
          ok: false,
        };
      }
    }
    try {
      const raw = await executor(call);
      let content = typeof raw === 'string' ? raw : String(raw ?? '');
      if (content.length > 400) {
        content = compressCommandOutput(content, { maxLineLength: 400 }).text;
      }
      const envMaxChars = process.env.MUGIL_IDE_MAX_TOOL_CHARS ? Number(process.env.MUGIL_IDE_MAX_TOOL_CHARS) : NaN;
      const MAX_TOOL_OUTPUT_CHARS = Number.isFinite(envMaxChars) && envMaxChars > 0 ? Math.floor(envMaxChars) : 48_000;
      if (content.length > MAX_TOOL_OUTPUT_CHARS) {
        content =
          content.slice(0, MAX_TOOL_OUTPUT_CHARS) +
          `\n\n… [output truncated: ${content.length - MAX_TOOL_OUTPUT_CHARS} characters omitted to conserve context]`;
      }
      return { content, ok: true };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, ok: false };
    }
  }

  private sum(
    a: { promptTokens: number; completionTokens: number; totalTokens: number },
    b: { promptTokens: number; completionTokens: number; totalTokens: number },
  ): { promptTokens: number; completionTokens: number; totalTokens: number } {
    return {
      promptTokens: a.promptTokens + b.promptTokens,
      completionTokens: a.completionTokens + b.completionTokens,
      totalTokens: a.totalTokens + b.totalTokens,
    };
  }
}
