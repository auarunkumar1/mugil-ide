import { HandoffManager } from '../src/modules/handoff/index.js';
import type { ProviderClient } from '../src/modules/handoff/provider.js';
import { ToolError, ToolLoop, parseToolArguments } from '../src/modules/tool-loop/index.js';
import type { ChatMessage, CompletionResult, ToolCall } from '../src/types.js';

/** Scripted client: each complete() call returns the next scripted result. */
function scriptedClient(script: CompletionResult[]): ProviderClient {
  let i = 0;
  return {
    mock: false,
    complete: jest.fn(async () => {
      const r = script[Math.min(i, script.length - 1)]!;
      i += 1;
      return r;
    }) as unknown as ProviderClient['complete'],
  } as ProviderClient;
}

function result(over: Partial<CompletionResult>): CompletionResult {
  return {
    provider: 'openai',
    model: 'test-model',
    content: '',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    ...over,
  };
}

const ADD: import('../src/types.js').ToolDefinition = {
  name: 'add',
  description: 'add two numbers',
  parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
};

const registry = {
  add: async (call: ToolCall): Promise<string> => {
    const args = parseToolArguments(call) as { a: number; b: number };
    return String(args.a + args.b);
  },
};

const system = [{ role: 'system' as const, content: 'you are terse' }];

describe('ToolLoop', () => {
  it('returns immediately when the model makes no tool calls', async () => {
    const client = scriptedClient([result({ content: '5', finishReason: 'stop' })]);
    const loop = new ToolLoop({ handoff: new HandoffManager({ client, models: [] }) });
    const out = await loop.run([...system, { role: 'user', content: '2 + 3' }], { tools: [ADD], registry });
    expect(out.content).toBe('5');
    expect(out.toolCalls).toBe(0);
    expect(out.usage.totalTokens).toBe(15);
    expect(client.complete).toHaveBeenCalledTimes(1);
  });

  it('executes a tool call, feeds the result back, and returns the final answer', async () => {
    const client = scriptedClient([
      result({
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'add', arguments: '{"a":2,"b":3}' }],
      }),
      result({ content: 'The answer is 5.', finishReason: 'stop' }),
    ]);
    const loop = new ToolLoop({ handoff: new HandoffManager({ client, models: [] }) });
    const out = await loop.run([...system, { role: 'user', content: '2 + 3' }], { tools: [ADD], registry });

    expect(out.content).toBe('The answer is 5.');
    expect(out.toolCalls).toBe(1);
    expect(client.complete).toHaveBeenCalledTimes(2);

    const secondCallMessages = (client.complete as jest.Mock).mock.calls[1]![0] as ChatMessage[];
    expect(secondCallMessages[secondCallMessages.length - 1]).toEqual({
      role: 'tool',
      toolCallId: 'call_1',
      content: '5',
    });
  });

  it('feeds back an error string for an unknown tool so the model can recover', async () => {
    const client = scriptedClient([
      result({
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'nope', arguments: '{}' }],
      }),
      result({ content: 'I cannot do that.', finishReason: 'stop' }),
    ]);
    const loop = new ToolLoop({ handoff: new HandoffManager({ client, models: [] }) });
    const out = await loop.run([...system, { role: 'user', content: 'do it' }], { tools: [ADD], registry });
    const messages = (client.complete as jest.Mock).mock.calls[1]![0] as ChatMessage[];
    expect(messages[messages.length - 1]).toMatchObject({
      role: 'tool',
      toolCallId: 'call_1',
      content: 'Error: unknown tool "nope"',
    });
    expect(out.toolCalls).toBe(1);
  });

  it('captures executor exceptions as tool results', async () => {
    const boom = {
      add: async (): Promise<string> => {
        throw new Error('division by zero');
      },
    };
    const client = scriptedClient([
      result({
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'add', arguments: '{"a":1,"b":0}' }],
      }),
      result({ content: 'failed', finishReason: 'stop' }),
    ]);
    const loop = new ToolLoop({ handoff: new HandoffManager({ client, models: [] }) });
    await loop.run([...system, { role: 'user', content: 'divide' }], { tools: [ADD], registry: boom });
    const messages = (client.complete as jest.Mock).mock.calls[1]![0] as ChatMessage[];
    expect(messages[messages.length - 1]).toMatchObject({
      role: 'tool',
      content: 'Error: division by zero',
    });
  });

  it('throws ToolError when a declared tool has no registry entry', async () => {
    const loop = new ToolLoop({ handoff: new HandoffManager({ client: scriptedClient([]), models: [] }) });
    await expect(loop.run([{ role: 'user', content: 'x' }], { tools: [ADD], registry: {} })).rejects.toBeInstanceOf(
      ToolError,
    );
  });

  it('forces a final answer without tools when iterations are exhausted', async () => {
    const alwaysCall = result({
      content: '',
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'call_1', name: 'add', arguments: '{"a":1,"b":2}' }],
    });
    const client = scriptedClient([alwaysCall, alwaysCall, alwaysCall, result({ content: 'forced', finishReason: 'stop' })]);
    const loop = new ToolLoop({ handoff: new HandoffManager({ client, models: [] }), maxIterations: 3 });
    const out = await loop.run([...system, { role: 'user', content: 'loop forever' }], { tools: [ADD], registry });
    expect(out.content).toBe('forced');
    expect(out.toolCalls).toBe(3);
    // The final (forced) completion must NOT send tools.
    const lastCall = (client.complete as jest.Mock).mock.calls.at(-1)![1] as { tools?: unknown };
    expect(lastCall.tools).toBeUndefined();
  });

  it('sums usage across iterations', async () => {
    const client = scriptedClient([
      result({
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'add', arguments: '{"a":2,"b":3}' }],
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      }),
      result({ content: '5', finishReason: 'stop', usage: { promptTokens: 30, completionTokens: 5, totalTokens: 35 } }),
    ]);
    const loop = new ToolLoop({ handoff: new HandoffManager({ client, models: [] }) });
    const out = await loop.run([...system, { role: 'user', content: '2 + 3' }], { tools: [ADD], registry });
    expect(out.usage).toEqual({ promptTokens: 50, completionTokens: 15, totalTokens: 65 });
  });

  it('parseToolArguments throws ToolError on invalid JSON', () => {
    expect(() => parseToolArguments({ id: 'c', name: 'add', arguments: 'not json' })).toThrow(ToolError);
    expect(parseToolArguments({ id: 'c', name: 'add', arguments: '{"a":1}' })).toEqual({ a: 1 });
  });
});
