import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { HandoffManager } from '../src/modules/handoff/index.js';
import type { ProviderClient } from '../src/modules/handoff/provider.js';
import { ToolLoop } from '../src/modules/tool-loop/index.js';
import { Pipeline } from '../src/pipeline.js';
import { SmartCache } from '../src/modules/smart-cache/index.js';
import { MemoryBackend } from '../src/modules/smart-cache/backends.js';
import { LexicalEmbedding } from '../src/modules/smart-cache/embeddings.js';
import { globalSecretVault } from '../src/modules/security/secretVault.js';
import { createWorkspaceTools } from '../src/modules/tools/workspaceTools.js';
import type { ChatMessage, ModelSpec, ToolCall } from '../src/types.js';

const OPENROUTER = ['sk-or-v1-', 'abcdef0123456789abcdef0123456789'].join('');

const MODELS: ModelSpec[] = [
  { id: 'fake', tier: 'cheap', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 200_000 },
];

/** Records exactly what crossed the wire, so leakage is observable. */
function recordingClient(reply = 'ok'): ProviderClient & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    name: 'fake',
    mock: true,
    seen,
    async complete(messages) {
      seen.push(messages.map((m) => ({ ...m })));
      return {
        provider: 'fake',
        model: 'fake',
        content: reply,
        usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
      };
    },
    async stream(messages, _options, handlers) {
      seen.push(messages.map((m) => ({ ...m })));
      handlers.onDelta?.(reply, true);
      return {
        provider: 'fake',
        model: 'fake',
        content: reply,
        usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
      };
    },
  } as ProviderClient & { seen: ChatMessage[][] };
}

describe('secret protection choke points', () => {
  beforeEach(() => globalSecretVault.clear());

  it('handoff redacts a secret the caller left in cleartext', async () => {
    const client = recordingClient();
    const handoff = new HandoffManager({ client, models: MODELS });
    await handoff.complete([{ role: 'user', content: `key is ${OPENROUTER}` }]);
    expect(JSON.stringify(client.seen[0])).not.toContain('sk-or-v1');
    expect(JSON.stringify(client.seen[0])).toContain('[MUGIL_SECRET_OPENROUTER_API_KEY_1]');
  });

  it('handoff redacts secrets inside tool-call arguments', async () => {
    const client = recordingClient();
    const handoff = new HandoffManager({ client, models: MODELS });
    await handoff.stream([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: '1', name: 'run_command', arguments: `{"command":"echo ${OPENROUTER}"}` }],
      },
    ]);
    expect(JSON.stringify(client.seen[0])).not.toContain('sk-or-v1');
  });

  it('pipeline never caches or sends cleartext input', async () => {
    const client = recordingClient('done');
    const handoff = new HandoffManager({ client, models: MODELS });
    const pipeline = new Pipeline({
      cache: new SmartCache({
        backend: new MemoryBackend(),
        ttlSeconds: 3600,
        embedding: new LexicalEmbedding(),
      }),
      handoff,
      ponytail: false,
    });
    const result = await pipeline.ask(`deploy with ${OPENROUTER}`, { preferredModel: 'fake' });
    expect(result.response).toBe('done');
    expect(JSON.stringify(client.seen[0])).not.toContain('sk-or-v1');
    expect(JSON.stringify(client.seen[0])).toContain('[MUGIL_SECRET_OPENROUTER_API_KEY_');
  });

  it('tool output is tokenized before the model sees it', async () => {
    const client = recordingClient('done');
    const handoff = new HandoffManager({ client, models: MODELS });
    const loop = new ToolLoop({ handoff, maxIterations: 2 });
    const toolCall: ToolCall = { id: 'c1', name: 'leak', arguments: '{}' };

    // First completion asks for the tool; the second returns text.
    let calls = 0;
    client.stream = async (messages, _options, handlers) => {
      client.seen.push(messages.map((m) => ({ ...m })));
      calls += 1;
      if (calls === 1) {
        return {
          provider: 'fake',
          model: 'fake',
          content: '',
          toolCalls: [toolCall],
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      handlers.onDelta?.('done', true);
      return {
        provider: 'fake',
        model: 'fake',
        content: 'done',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    };

    await loop.run([{ role: 'user', content: 'go' }], {
      tools: [{ name: 'leak', description: 'leak', parameters: {} }],
      registry: { leak: async () => `OPENROUTER_API_KEY=${OPENROUTER}` },
    });

    const secondRequest = JSON.stringify(client.seen[1]);
    expect(secondRequest).not.toContain('sk-or-v1');
    expect(secondRequest).toContain('[MUGIL_SECRET_OPENROUTER_API_KEY_');
    // The real value is still resolvable locally for tool execution.
    expect(globalSecretVault.resolve(secondRequest)).toContain(OPENROUTER);
  });

  it('run_command resolves a vaulted token locally', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-secret-run-'));
    const { toolRegistry } = createWorkspaceTools(dir);
    const { tokens } = globalSecretVault.tokenize(`echo ${OPENROUTER}`);
    const call: ToolCall = {
      id: 'r1',
      name: 'run_command',
      arguments: JSON.stringify({ command: `echo ${tokens[0]}` }),
    };
    const out = await toolRegistry.run_command!(call);
    // stdout echoes the real value (the tool loop re-tokenizes before the model).
    expect(out).toContain(OPENROUTER);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
