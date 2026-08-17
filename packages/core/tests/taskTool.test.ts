import * as path from 'node:path';
import { HandoffManager } from '../src/modules/handoff/index.js';
import type { ProviderClient } from '../src/modules/handoff/provider.js';
import { createWorkspaceTools } from '../src/modules/tools/workspaceTools.js';
import type { ChatMessage, CompletionResult, ToolCall } from '../src/types.js';

const ROOT = path.resolve(__dirname, '..');

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
    model: 'sub-model',
    content: '',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    ...over,
  };
}

const taskCall = (id: string, args: Record<string, unknown>): ToolCall => ({
  id,
  name: 'task',
  arguments: JSON.stringify(args),
});

describe('task tool (subagents)', () => {
  it('runs an explore subagent with its own system prompt and returns its answer', async () => {
    const client = scriptedClient([result({ content: 'Found ToolLoop at modules/tool-loop/index.ts:18' })]);
    const handoff = new HandoffManager({ client, models: [] });
    const { toolRegistry } = createWorkspaceTools(ROOT, { handoff });

    const out = await toolRegistry.task(taskCall('t1', { description: 'Find the tool loop' }));
    expect(out).toContain('modules/tool-loop/index.ts');

    const firstMessages = (client.complete as jest.Mock).mock.calls[0]![0] as ChatMessage[];
    const system = firstMessages.find((m) => m.role === 'system')!;
    expect(system.content).toContain('explore subagent');
    expect(firstMessages[firstMessages.length - 1]).toMatchObject({
      role: 'user',
      content: 'Find the tool loop',
    });
  });

  it('explore subagents get a read-only permission gate (writes are denied)', async () => {
    const client = scriptedClient([
      result({
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'c1', name: 'write_file', arguments: '{}' }],
      }),
      result({ content: 'I could not write the file.', finishReason: 'stop' }),
    ]);
    const handoff = new HandoffManager({ client, models: [] });
    const { toolRegistry } = createWorkspaceTools(ROOT, { handoff });

    const out = await toolRegistry.task(taskCall('t2', { description: 'Try to write' }));
    const secondMessages = (client.complete as jest.Mock).mock.calls[1]![0] as ChatMessage[];
    expect(secondMessages[secondMessages.length - 1]).toMatchObject({
      role: 'tool',
      content: expect.stringContaining('Permission denied'),
    });
    expect(out).toContain('I could not write the file.');
  });

  it('does not offer the task tool to the subagent (no infinite recursion)', async () => {
    const client = scriptedClient([result({ content: 'done', finishReason: 'stop' })]);
    const handoff = new HandoffManager({ client, models: [] });
    const { toolRegistry } = createWorkspaceTools(ROOT, { handoff });

    await toolRegistry.task(taskCall('t3', { description: 'hi' }));
    const firstOptions = (client.complete as jest.Mock).mock.calls[0]![1] as { tools?: { name: string }[] };
    expect(firstOptions.tools!.map((t) => t.name)).not.toContain('task');
    expect(firstOptions.tools!.map((t) => t.name)).toContain('read_file');
  });

  it('general mode applies the injected subagent permission and model', async () => {
    // The injected permission gates the subagent's own tool loop (denied here),
    // and the picked model is forwarded to the provider as `model`.
    const client = scriptedClient([
      result({
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'c1', name: 'edit_file', arguments: '{}' }],
      }),
      result({ content: 'blocked by policy', finishReason: 'stop' }),
    ]);
    const handoff = new HandoffManager({ client, models: [] });
    const { toolRegistry } = createWorkspaceTools(ROOT, {
      handoff,
      subagentPermission: async () => false,
      subagentModel: 'my-picked-model',
    });

    const out = await toolRegistry.task(taskCall('t4', { description: 'x', mode: 'general' }));
    const secondMessages = (client.complete as jest.Mock).mock.calls[1]![0] as ChatMessage[];
    expect(secondMessages[secondMessages.length - 1]).toMatchObject({
      role: 'tool',
      content: expect.stringContaining('Permission denied'),
    });
    expect(out).toContain('blocked by policy');
    const firstOptions = (client.complete as jest.Mock).mock.calls[0]![1] as { model?: string };
    expect(firstOptions.model).toBe('my-picked-model');
  });

  it('truncates very long subagent output', async () => {
    const client = scriptedClient([result({ content: 'x'.repeat(10_000), finishReason: 'stop' })]);
    const handoff = new HandoffManager({ client, models: [] });
    const { toolRegistry } = createWorkspaceTools(ROOT, { handoff });

    const out = await toolRegistry.task(taskCall('t5', { description: 'long' }));
    expect(out.length).toBeLessThan(4500);
    expect(out).toContain('truncated at 4000 chars');
  });

  it('returns a clear error when no handoff is wired', async () => {
    const { toolRegistry } = createWorkspaceTools(ROOT);
    const out = await toolRegistry.task(taskCall('t6', { description: 'x' }));
    expect(out).toContain('handoff');
  });

  it('errors on missing description', async () => {
    const handoff = new HandoffManager({ client: scriptedClient([]), models: [] });
    const { toolRegistry } = createWorkspaceTools(ROOT, { handoff });
    const out = await toolRegistry.task(taskCall('t7', {}));
    expect(out).toContain('description parameter is required');
  });

  it('streams subagent tool calls through onSubagentTool', async () => {
    const client = scriptedClient([
      result({
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [
          { id: 'c1', name: 'search_code', arguments: '{}' },
          { id: 'c2', name: 'read_file', arguments: '{}' },
        ],
      }),
      result({ content: 'found it', finishReason: 'stop' }),
    ]);
    const handoff = new HandoffManager({ client, models: [] });
    const seen: { mode: 'explore' | 'general'; name: string }[] = [];
    const { toolRegistry } = createWorkspaceTools(ROOT, {
      handoff,
      onSubagentTool: (mode, call) => {
        seen.push({ mode, name: call.name });
      },
    });

    await toolRegistry.task(taskCall('t8', { description: 'search the code' }));
    expect(seen).toEqual([
      { mode: 'explore', name: 'search_code' },
      { mode: 'explore', name: 'read_file' },
    ]);
  });

  it('reports the general mode in onSubagentTool', async () => {
    const client = scriptedClient([
      result({
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'c1', name: 'edit_file', arguments: '{}' }],
      }),
      result({ content: 'edited', finishReason: 'stop' }),
    ]);
    const handoff = new HandoffManager({ client, models: [] });
    const seen: { mode: 'explore' | 'general'; name: string }[] = [];
    const { toolRegistry } = createWorkspaceTools(ROOT, {
      handoff,
      subagentPermission: async () => false,
      onSubagentTool: (mode, call) => {
        seen.push({ mode, name: call.name });
      },
    });

    await toolRegistry.task(taskCall('t9', { description: 'x', mode: 'general' }));
    expect(seen).toEqual([{ mode: 'general', name: 'edit_file' }]);
  });
});
