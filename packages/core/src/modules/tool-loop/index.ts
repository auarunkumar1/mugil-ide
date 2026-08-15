/**
 * Tool Loop — the agentic "function calling" loop.
 *
 * Given a chat history, a set of tool declarations and a registry of tool
 * executors, it repeatedly asks the model, executes any requested tool calls
 * (feeding results back as `tool` messages), and stops when the model replies
 * without tool calls. The loop is bounded: after `maxIterations` the model is
 * forced to answer without tools so a final text is always produced.
 */
import type { ChatMessage, HandoffOptions, ToolCall, ToolDefinition, Usage } from '../../types.js';
import type { HandoffManager } from '../handoff/index.js';

export type ToolExecutor = (call: ToolCall) => Promise<string>;
export type ToolRegistry = Record<string, ToolExecutor>;

export interface ToolLoopOptions {
  handoff: HandoffManager;
  /** Bounded iterations; a forced no-tools completion follows when exhausted. Default 6. */
  maxIterations?: number;
  /** Called with each executed tool call (for live progress events). */
  onTool?: (call: ToolCall, index: number) => void;
}

export interface ToolLoopRunOptions extends HandoffOptions {
  tools: ToolDefinition[];
  registry: ToolRegistry;
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
  'You have reached the maximum number of tool calls. Provide your final answer now without calling any tools.';

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

  constructor(options: ToolLoopOptions) {
    this.handoff = options.handoff;
    this.maxIterations = options.maxIterations ?? 6;
    this.onTool = options.onTool;
  }

  async run(messages: ChatMessage[], options: ToolLoopRunOptions): Promise<ToolLoopResult> {
    const missing = options.tools.map((t) => t.name).filter((name) => !(name in options.registry));
    if (missing.length > 0) {
      throw new ToolError(`no executor registered for tool(s): ${missing.join(', ')}`);
    }

    const msgs = [...messages];
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let toolCalls = 0;

    for (let i = 0; i < this.maxIterations; i += 1) {
      const completion = await this.handoff.complete(msgs, { ...options, tools: options.tools });
      usage = this.sum(usage, completion.usage);
      if (!completion.toolCalls || completion.toolCalls.length === 0) {
        return { ...completion, usage, toolCalls };
      }

      msgs.push({
        role: 'assistant',
        content: completion.content ?? '',
        toolCalls: completion.toolCalls,
      });

      for (const call of completion.toolCalls) {
        toolCalls += 1;
        this.onTool?.(call, toolCalls);
        msgs.push({ role: 'tool', toolCallId: call.id, content: await this.execute(call, options.registry) });
      }
    }

    // Bounded: force a final answer without tools so we never return empty.
    const final = await this.handoff.complete([...msgs, { role: 'user', content: MAX_ITERATION_PROMPT }], {
      ...options,
      tools: undefined,
    });
    usage = this.sum(usage, final.usage);
    return { ...final, usage, toolCalls };
  }

  private async execute(call: ToolCall, registry: ToolRegistry): Promise<string> {
    const executor = registry[call.name];
    if (!executor) {
      return `Error: unknown tool "${call.name}"`;
    }
    try {
      return await executor(call);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
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
