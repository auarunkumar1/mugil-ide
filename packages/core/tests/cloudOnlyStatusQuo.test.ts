import {
  Pipeline,
  SmartCache,
  MemoryBackend,
  LexicalEmbedding,
  HandoffManager,
} from '../src/index.js';
import type { ToolDefinition, ProviderClient, ChatMessage, CompletionResult } from '../src/types.js';

describe('Cloud-Only Status Quo Invariant', () => {
  const dummyTools: ToolDefinition[] = [
    { name: 'read_file', description: 'read', parameters: {} },
    { name: 'write_file', description: 'write', parameters: {} },
    { name: 'edit_file', description: 'edit', parameters: {} },
    { name: 'apply_patch', description: 'patch', parameters: {} },
    { name: 'read_blob', description: 'blob', parameters: {} },
    { name: 'run_command', description: 'run', parameters: {} },
    { name: 'generate_image', description: 'image', parameters: {} },
    { name: 'websearch', description: 'search', parameters: {} },
    { name: 'webfetch', description: 'fetch', parameters: {} },
    { name: 'list_files', description: 'list', parameters: {} },
    { name: 'search_code', description: 'grep', parameters: {} },
    { name: 'codegraph', description: 'graph', parameters: {} },
    { name: 'read_symbol', description: 'symbol', parameters: {} },
    { name: 'read_skeleton', description: 'skeleton', parameters: {} },
    { name: 'lsp', description: 'lsp', parameters: {} },
    { name: 'todowrite', description: 'todo', parameters: {} },
    { name: 'todoread', description: 'todoread', parameters: {} },
    { name: 'question', description: 'question', parameters: {} },
  ];

  it('guarantees 100% untouched tool schemas and zero pre-flight when topology is cloud-only', async () => {
    let receivedTools: ToolDefinition[] | undefined;

    const fakeClient: ProviderClient = {
      name: 'fake-cloud-model',
      async complete(messages: ChatMessage[], options?: any): Promise<CompletionResult> {
        receivedTools = options?.tools;
        return {
          content: 'Cloud model direct answer without local pre-flight.',
          model: 'cloud-flagship',
          usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
        };
      },
    };

    const cache = new SmartCache({
      backend: new MemoryBackend(),
      embedding: new LexicalEmbedding(),
    });
    const handoff = new HandoffManager({
      client: fakeClient,
      models: [{ id: 'cloud-flagship', tier: 'smart', costPerMTokIn: 1, costPerMTokOut: 2, contextWindow: 128000 }],
    });

    const pipeline = new Pipeline({
      cache,
      handoff,
    });

    const result = await pipeline.ask('Refactor database queries', {
      topology: 'cloud-only',
      tools: dummyTools,
      toolRegistry: Object.fromEntries(
        dummyTools.map((t) => [t.name, async () => ({ ok: true, content: 'ok' })]),
      ),
      noCache: true,
    });

    // Invariant 1: All 18 tools are passed without pruning
    expect(receivedTools).toBeDefined();
    expect(receivedTools?.length).toBe(18);
    expect(receivedTools?.map((t) => t.name)).toEqual(dummyTools.map((t) => t.name));

    // Invariant 2: No preflight capsule injected into system prompt
    expect(result.response).toBe('Cloud model direct answer without local pre-flight.');

    // Invariant 3: Savings breakdown has 0 for toolPruning and hybridRecon
    expect(result.savings.breakdown?.toolPruning).toBe(0);
    expect(result.savings.breakdown?.hybridRecon).toBe(0);
  });
});
