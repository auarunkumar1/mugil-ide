import {
  createEngine,
  loadConfig,
  SmartCache,
  MemoryBackend,
  LexicalEmbedding,
  HandoffManager,
  Pipeline,
  saveSession,
  sessionFilePath,
  pushEdit,
} from '@mugil-ide/core';
import type { Engine, ProviderClient } from '@mugil-ide/core';
import { startIdeServer } from '../src/server/server.js';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

let cacheDir = '';

beforeEach(() => {
  // Isolate session auto-save/resume (and never touch the real user cache).
  cacheDir = mkdtempSync(join(tmpdir(), 'mugil-cache-'));
  process.env.MUGIL_IDE_CACHE_DIR = cacheDir;
});

beforeAll(() => {
  // Use the child_process PTY backend: node-pty's Windows kill() leaks its
  // named-pipe sockets, which would hang the jest process on exit.
  process.env.MUGIL_IDE_PTY_BACKEND = 'child';
});

afterAll(async () => {
  delete process.env.MUGIL_IDE_CACHE_DIR;
  delete process.env.MUGIL_IDE_PTY_BACKEND;
  // Close undici's pooled keep-alive sockets (Node's global fetch dispatcher)
  // so they don't hold the jest process open after the servers are closed.
  try {
    const dispatcher = (globalThis as any)[Symbol.for('undici.globalDispatcher.1')];
    await dispatcher?.close?.();
  } catch {
    // ignore — dispatcher cleanup is best-effort
  }
});

/** A minimal Engine whose handoff/pipeline use a scripted client (mock mode). */
function scriptedEngine(client: ProviderClient): Engine {
  const cache = new SmartCache({ backend: new MemoryBackend(), ttlSeconds: 0, embedding: new LexicalEmbedding() });
  const handoff = new HandoffManager({ client, models: [] });
  const pipeline = new Pipeline({ cache, handoff });
  const engine = {
    cache,
    handoff,
    pipeline,
    backend: { close: async () => {} },
    config: loadConfig(),
    get client() {
      return client;
    },
    reconfigure: () => engine,
  };
  return engine as unknown as Engine;
}

function scriptedResult(over: Partial<import('@mugil-ide/core').CompletionResult>): import('@mugil-ide/core').CompletionResult {
  return {
    provider: 'mock',
    model: 'mock-model',
    content: '',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    ...over,
  };
}

/** Connects a WS client and resolves with the first message matching a predicate. */
function waitForMessage<T>(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 10000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
    const onMessage = (data: WebSocket.RawData): void => {
      try {
        const msg = JSON.parse(data.toString());
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.off('message', onMessage);
          resolve(msg);
        }
      } catch {
        // raw string frames — ignore
      }
    };
    ws.on('message', onMessage);
    ws.on('error', reject);
  });
}

describe('Mugil IDE PTY + xterm.js Web Server', () => {
  it('starts the server and serves HTML and JSON status', async () => {
    const engine = createEngine(loadConfig());
    const server = await startIdeServer({ engine, port: 0 });

    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toContain(`http://localhost:${server.port}`);

    // Test GET /
    const htmlRes = await fetch(`${server.url}/`);
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toContain('xterm');
    expect(html).toContain('MUGIL IDE');
    // Vendored assets, no CDN dependency (offline-capable).
    expect(html).toContain('/vendor/xterm/xterm.js');
    expect(html).not.toContain('cdn.jsdelivr');

    // Vendored xterm assets are served locally.
    const jsRes = await fetch(`${server.url}/vendor/xterm/xterm.js`);
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get('content-type')).toContain('javascript');
    expect((await jsRes.text()).length).toBeGreaterThan(1000);
    const cssRes = await fetch(`${server.url}/vendor/xterm/xterm.css`);
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get('content-type')).toContain('text/css');
    const badRes = await fetch(`${server.url}/vendor/xterm/other.js`);
    expect(badRes.status).toBe(404);

    // Test GET /api/status
    const statusRes = await fetch(`${server.url}/api/status`);
    expect(statusRes.status).toBe(200);
    const statusJson = (await statusRes.json()) as { provider: string; activeModel: string };
    expect(statusJson.provider).toBeDefined();

    // Test WebSocket connection
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const received: string[] = [];

    const wsTimer = setTimeout(() => ws.close(), 5000);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'agent_input', data: '/stats\r' }));
      });
      ws.on('message', (data) => {
        received.push(data.toString());
        if (received.length >= 2) {
          clearTimeout(wsTimer);
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
    });

    expect(received.length).toBeGreaterThan(0);

    // Test POST /api/model switches model and sticks
    const postModelRes = await fetch(`${server.url}/api/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek/deepseek-chat', provider: 'openrouter' }),
    });
    expect(postModelRes.status).toBe(200);
    const postJson = (await postModelRes.json()) as { ok: boolean; activeModel: string; provider: string };
    expect(postJson.ok).toBe(true);
    expect(postJson.activeModel).toBe('deepseek/deepseek-chat');

    // Verify GET /api/status returns the updated model
    const newStatusRes = await fetch(`${server.url}/api/status`);
    const newStatusJson = (await newStatusRes.json()) as { provider: string; activeModel: string };
    expect(newStatusJson.activeModel).toBe('deepseek/deepseek-chat');

    // Verify GET /api/models returns the updated activeModel
    const modelsRes = await fetch(`${server.url}/api/models`);
    const modelsJson = (await modelsRes.json()) as { activeModel: string; activeProvider: string };
    expect(modelsJson.activeModel).toBe('deepseek/deepseek-chat');

    ws.terminate();
    await server.close();
    await engine.backend.close();
  });

  it('keeps the RGB banner shimmering on the idle screen even after session resume', async () => {
    // Simulate a returning user: the repl constructor auto-resumes the saved
    // last-session, so turns.length > 0 at connect time. The idle-screen
    // shimmer must keep cycling until the user actually interacts.
    saveSession(
      [{ id: 1, prompt: 'previous question', response: 'previous answer' }],
      sessionFilePath(),
    );

    const client: ProviderClient = {
      mock: false,
      complete: async () => scriptedResult({ content: 'ok' }),
    };
    const engine = scriptedEngine(client);
    const server = await startIdeServer({ engine, port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);

    const animationFrames: string[] = [];
    let sawColoredBanner = false;
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'agent_data' && typeof msg.data === 'string') {
          // Animation frames are cursor-positioned banner redraws; the static
          // banner and every animated frame carry the 24-bit RGB colour codes.
          if (msg.data.includes('\x1b[s\x1b[?25l')) animationFrames.push(msg.data);
          if (msg.data.includes('\x1b[38;2;')) sawColoredBanner = true;
        }
      } catch {
        // raw frames — ignore
      }
    });

    try {
      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });
      // Wait a few 120ms shimmer ticks: a resumed session must not stop it.
      await new Promise((r) => setTimeout(r, 900));
      expect(sawColoredBanner).toBe(true);
      expect(animationFrames.length).toBeGreaterThanOrEqual(2);
    } finally {
      ws.terminate();
      await server.close();
      await engine.backend.close();
    }
  });

  it('spawns the shell PTY lazily on first use and streams output back (pty round-trip)', async () => {
    const client: ProviderClient = {
      mock: false,
      complete: async () => scriptedResult({ content: 'ok' }),
    };
    const engine = scriptedEngine(client);
    const server = await startIdeServer({ engine, port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);

    const ptyOutput: string[] = [];
    const gotEcho = new Promise<string>((resolve) => {
      const onMsg = (data: WebSocket.RawData): void => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'pty_data') {
            ptyOutput.push(String(msg.data));
            if (String(msg.data).includes('pty-alive')) resolve(String(msg.data));
          }
        } catch {
          // raw frames — ignore
        }
      };
      ws.on('message', onMsg);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });
      // Mirror the browser: activating the shell tab resizes it (which triggers
      // the lazy spawn), then keystrokes flow as pty_input.
      ws.send(JSON.stringify({ type: 'resize_pty', cols: 80, rows: 24 }));
      ws.send(JSON.stringify({ type: 'pty_input', data: 'echo pty-alive\r\n' }));

      let timeout: NodeJS.Timeout;
      try {
        const echoed = await Promise.race([
          gotEcho,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error(`pty echo timed out; got: ${ptyOutput.join('|')}`)), 15000);
          }),
        ]);
        expect(echoed).toContain('pty-alive');
      } finally {
        clearTimeout(timeout!);
      }
    } finally {
      ws.terminate();
      await server.close();
    }
  });

  it('round-trips a mid-task question over WebSocket (question tool)', async () => {
    let calls = 0;
    const fedBack: string[] = [];
    const client: ProviderClient = {
      mock: false,
      complete: async (messages) => {
        fedBack.push(JSON.stringify(messages));
        calls += 1;
        if (calls === 1) {
          // First completion asks the user a structured question.
          return scriptedResult({
            finishReason: 'tool_calls',
            toolCalls: [
              {
                id: 'q1',
                name: 'question',
                arguments: JSON.stringify({ header: 'Runner', question: 'Which test runner?', options: ['jest', 'vitest'] }),
              },
            ],
          });
        }
        return scriptedResult({ content: 'Final answer after the question.' });
      },
    };
    const engine = scriptedEngine(client);
    const server = await startIdeServer({ engine, port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);

    try {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'agent_input', data: 'hello\r' })));

      const question = await waitForMessage<{ id: number; question: string; options: string[] }>(ws, (m) => m.type === 'question');
      expect(question.question).toBe('Which test runner?');
      expect(question.options).toEqual(['jest', 'vitest']);

      ws.send(JSON.stringify({ type: 'question_answer', id: question.id, answer: 'vitest' }));

      const turn = await waitForMessage<{ turn: { response: string; toolsCalled: Array<{ name: string }> } }>(
        ws,
        (m) => m.type === 'turn_complete',
      );
      expect(turn.turn.response).toContain('Final answer after the question.');
      expect(turn.turn.toolsCalled.map((t) => t.name)).toContain('question');
      // The chosen answer was fed back to the model (tool result).
      expect(fedBack.some((s) => s.includes('vitest'))).toBe(true);
    } finally {
      ws.terminate();
      await server.close();
    }
  });

  it('runs a task subagent over WebSocket (task tool)', async () => {
    let calls = 0;
    const client: ProviderClient = {
      mock: false,
      complete: async () => {
        calls += 1;
        if (calls === 1) {
          // Main loop delegates to a subagent.
          return scriptedResult({
            finishReason: 'tool_calls',
            toolCalls: [
              {
                id: 't1',
                name: 'task',
                arguments: JSON.stringify({ description: 'Find the tool loop module' }),
              },
            ],
          });
        }
        if (calls === 2) {
          // Subagent answers.
          return scriptedResult({ content: 'Found at modules/tool-loop/index.ts' });
        }
        return scriptedResult({ content: 'Main answer using the subagent result.' });
      },
    };
    const engine = scriptedEngine(client);
    const server = await startIdeServer({ engine, port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);

    try {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'agent_input', data: 'delegate\r' })));
      const turn = await waitForMessage<{ turn: { response: string; toolsCalled: Array<{ name: string }> } }>(
        ws,
        (m) => m.type === 'turn_complete',
      );
      expect(turn.turn.response).toContain('Main answer using the subagent result.');
      expect(turn.turn.toolsCalled.map((t) => t.name)).toContain('task');
    } finally {
      ws.terminate();
      await server.close();
    }
  });

  it('asks for approval before gated calls in act mode and executes on allow', async () => {
    let calls = 0;
    const fedBack: string[] = [];
    const client: ProviderClient = {
      mock: false,
      complete: async (messages) => {
        fedBack.push(JSON.stringify(messages));
        calls += 1;
        if (calls === 1) {
          return scriptedResult({
            finishReason: 'tool_calls',
            toolCalls: [
              { id: 'c1', name: 'run_command', arguments: JSON.stringify({ command: 'echo approved-ok' }) },
            ],
          });
        }
        return scriptedResult({ content: 'Done after approval.' });
      },
    };
    const engine = scriptedEngine(client);
    const server = await startIdeServer({ engine, port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);

    try {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'agent_input', data: 'run it\r' })));

      const approval = await waitForMessage<{ id: number; tool: string; args: string }>(ws, (m) => m.type === 'approval');
      expect(approval.tool).toBe('run_command');
      expect(approval.args).toContain('echo approved-ok');
      ws.send(JSON.stringify({ type: 'approval_answer', id: approval.id, granted: true }));

      const turn = await waitForMessage<{ turn: { response: string } }>(ws, (m) => m.type === 'turn_complete');
      expect(turn.turn.response).toContain('Done after approval.');
      // Environment-context injection: the system prompt carries the workspace.
      expect(fedBack[0]).toContain('Working directory:');
    } finally {
      ws.terminate();
      await server.close();
    }
  });

  it('feeds a permission denial back to the model when the user denies', async () => {
    let calls = 0;
    const fedBack: string[] = [];
    const client: ProviderClient = {
      mock: false,
      complete: async (messages) => {
        fedBack.push(JSON.stringify(messages));
        calls += 1;
        if (calls === 1) {
          return scriptedResult({
            finishReason: 'tool_calls',
            toolCalls: [
              { id: 'c1', name: 'run_command', arguments: JSON.stringify({ command: 'echo never-runs' }) },
            ],
          });
        }
        return scriptedResult({ content: 'Understood, skipped it.' });
      },
    };
    const engine = scriptedEngine(client);
    const server = await startIdeServer({ engine, port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);

    try {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'agent_input', data: 'attempt\r' })));
      const approval = await waitForMessage<{ id: number }>(ws, (m) => m.type === 'approval');
      ws.send(JSON.stringify({ type: 'approval_answer', id: approval.id, granted: false }));

      const turn = await waitForMessage<{ turn: { response: string } }>(ws, (m) => m.type === 'turn_complete');
      expect(turn.turn.response).toContain('Understood, skipped it.');
      // The denial was fed back to the model as a tool result.
      expect(fedBack.some((s) => s.includes('Permission denied'))).toBe(true);
    } finally {
      ws.terminate();
      await server.close();
    }
  });

  it('denies gated calls outright in plan mode without prompting', async () => {
    let calls = 0;
    const fedBack: string[] = [];
    const messages: any[] = [];
    const client: ProviderClient = {
      mock: false,
      complete: async (messages2) => {
        fedBack.push(JSON.stringify(messages2));
        calls += 1;
        if (calls === 1) {
          return scriptedResult({
            finishReason: 'tool_calls',
            toolCalls: [
              { id: 'c1', name: 'run_command', arguments: JSON.stringify({ command: 'echo nope' }) },
            ],
          });
        }
        return scriptedResult({ content: 'Plan only — nothing ran.' });
      },
    };
    const engine = scriptedEngine(client);
    const server = await startIdeServer({ engine, port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    ws.on('message', (d) => {
      try {
        messages.push(JSON.parse(d.toString()));
      } catch {
        // raw frames — ignore
      }
    });

    try {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'agent_input', data: '/plan\r' }));
        setTimeout(() => ws.send(JSON.stringify({ type: 'agent_input', data: 'try write\r' })), 200);
      });

      const turn = await waitForMessage<{ turn: { response: string } }>(ws, (m) => m.type === 'turn_complete');
      expect(turn.turn.response).toContain('Plan only');
      expect(messages.some((m) => m.type === 'approval')).toBe(false);
      expect(fedBack.some((s) => s.includes('Permission denied'))).toBe(true);
    } finally {
      ws.terminate();
      await server.close();
    }
  });

  it('tolerates an unreachable MCP server (soft failure, turn still runs)', async () => {
    process.env.MUGIL_IDE_MCP_SERVERS = JSON.stringify([{ name: 'bad', command: 'no-such-mcp-binary-xyz', args: [] }]);
    try {
      let calls = 0;
      const client: ProviderClient = {
        mock: false,
        complete: async () => {
          calls += 1;
          return scriptedResult({ content: 'Turn completed despite MCP failure.' });
        },
      };
      const engine = scriptedEngine(client);
      const server = await startIdeServer({ engine, port: 0 });
      const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
      const agentText: string[] = [];
      ws.on('message', (d) => {
        try {
          const m = JSON.parse(d.toString());
          if (m.type === 'agent_data') agentText.push(m.data);
        } catch {
          // ignore
        }
      });

      try {
        ws.on('open', () => ws.send(JSON.stringify({ type: 'agent_input', data: 'hi\r' })));
        const turn = await waitForMessage<{ turn: { response: string } }>(ws, (m) => m.type === 'turn_complete');
        expect(turn.turn.response).toContain('Turn completed');
        expect(calls).toBeGreaterThan(0);
        // The soft-failure warning was surfaced in the terminal.
        expect(agentText.join('')).toContain('MCP server "bad" unavailable');
      } finally {
        ws.terminate();
        await server.close();
      }
    } finally {
      delete process.env.MUGIL_IDE_MCP_SERVERS;
    }
  });

  it('auto-saves the conversation and resumes it on the next connection', async () => {
    let calls = 0;
    const fedBack: string[] = [];
    const client: ProviderClient = {
      mock: false,
      complete: async (messages) => {
        fedBack.push(JSON.stringify(messages));
        calls += 1;
        return scriptedResult({ content: calls === 1 ? 'first answer' : 'second answer' });
      },
    };
    const engine = scriptedEngine(client);
    const server = await startIdeServer({ engine, port: 0 });
    const url = `ws://localhost:${server.port}/ws`;

    // Connection 1: one completed turn → auto-save.
    const ws1 = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws1.on('open', () => resolve());
      ws1.on('error', reject);
    });
    ws1.send(JSON.stringify({ type: 'agent_input', data: 'hello\r' }));
    await waitForMessage(ws1, (m) => m.type === 'turn_complete');
    ws1.terminate();

    const file = sessionFilePath();
    expect(existsSync(file)).toBe(true);
    // The auto-saved session is scoped to this workspace, not a global file.
    expect(file).toMatch(/last-session-[0-9a-f]{10}\.json$/);
    expect(file).not.toContain('last-session.json');
    const saved = JSON.parse(readFileSync(file, 'utf8')) as {
      entries: Array<{ prompt: string }>;
      stats: { requests: number };
    };
    expect(saved.entries.some((e) => e.prompt === 'hello')).toBe(true);
    // Session metrics are persisted with the conversation (the one completed turn).
    expect(saved.stats.requests).toBe(1);

    // Connection 2: auto-resume restores that turn into the new session's history.
    const ws2 = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws2.on('open', () => resolve());
      ws2.on('error', reject);
    });
    ws2.send(JSON.stringify({ type: 'agent_input', data: 'again\r' }));
    const turn2 = await waitForMessage<{ turn: { response: string } }>(ws2, (m) => m.type === 'turn_complete');
    expect(turn2.turn.response).toContain('second answer');
    // The second prompt saw the restored history.
    expect(fedBack[1]).toContain('first answer');
    // The restored stats carried into connection 2 and accumulated: the file
    // now shows 2 requests (1 restored + the new turn), not just 1.
    const saved2 = JSON.parse(readFileSync(file, 'utf8')) as { stats: { requests: number } };
    expect(saved2.stats.requests).toBe(2);
    ws2.terminate();

    await server.close();
  });

  it('compacts the conversation with /compact and continues from the summary', async () => {
    let calls = 0;
    const fedBack: string[] = [];
    const client: ProviderClient = {
      mock: false,
      complete: async (messages) => {
        fedBack.push(JSON.stringify(messages));
        calls += 1;
        if (calls === 1) return scriptedResult({ content: 'first turn done' });
        if (calls === 2) return scriptedResult({ content: 'COMPACT-SUMMARY' });
        return scriptedResult({ content: 'after compact' });
      },
    };
    const engine = scriptedEngine(client);
    const server = await startIdeServer({ engine, port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);

    try {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'agent_input', data: 'turn one\r' })));
      await waitForMessage(ws, (m) => m.type === 'turn_complete' && m.turn?.prompt === 'turn one');

      ws.send(JSON.stringify({ type: 'agent_input', data: '/compact\r' }));
      // Give the compaction model call a beat before sending the next prompt.
      await new Promise((r) => setTimeout(r, 250));
      ws.send(JSON.stringify({ type: 'agent_input', data: 'continue\r' }));

      const turn = await waitForMessage<{ turn: { response: string } }>(ws, (m) => m.type === 'turn_complete' && m.turn?.prompt === 'continue');
      expect(turn.turn.response).toContain('after compact');
      // The post-compact prompt carried the summary as its history.
      expect(fedBack[2]).toContain('COMPACT-SUMMARY');
      expect(fedBack[2]).toContain('[Conversation compacted');
    } finally {
      ws.terminate();
      await server.close();
    }
  });

  it('serves /api/diffs quickly and skips pathological large diffs', async () => {
    const engine = createEngine(loadConfig());
    const server = await startIdeServer({ engine, port: 0 });
    const root = process.cwd();

    // A normal edit → a real patch. A large, totally-rewritten file → the
    // O(N·M) diff would block the event loop for seconds; it must be skipped.
    pushEdit(root, {
      path: join(root, 'diff-smoke-small.txt'),
      before: { content: 'hello\nworld\n', existed: true },
      after: { content: 'hello\nmugil\n', existed: true },
    });
    // Medium edit: in-cap but worst-case (900 dissimilar lines ≈ 300-400ms of
    // diff work) — exercises the worker-thread path.
    const mediumBefore = Array.from({ length: 900 }, (_, i) => `alpha line ${i}`).join('\n');
    const mediumAfter = Array.from({ length: 900 }, (_, i) => `beta line ${i}`).join('\n');
    pushEdit(root, {
      path: join(root, 'diff-smoke-medium.txt'),
      before: { content: mediumBefore, existed: true },
      after: { content: mediumAfter, existed: true },
    });
    const bigBefore = Array.from({ length: 3000 }, (_, i) => `alpha line ${i}`).join('\n');
    const bigAfter = Array.from({ length: 3000 }, (_, i) => `beta line ${i}`).join('\n');
    pushEdit(root, {
      path: join(root, 'diff-smoke-big.txt'),
      before: { content: bigBefore, existed: true },
      after: { content: bigAfter, existed: true },
    });

    try {
      // Async diffing: the medium diff is computed on a worker thread, so a
      // cheap request fired while it's in flight must win the race. (If the
      // diff ran synchronously on the event loop, /api/status could only be
      // served after the ~400ms patch finished.)
      const t0 = Date.now();
      const statusP = fetch(`${server.url}/api/status`).then(() => ({ kind: 'status', t: Date.now() - t0 }));
      const diffsP = fetch(`${server.url}/api/diffs`).then(() => ({ kind: 'diffs', t: Date.now() - t0 }));
      const results = await Promise.all([statusP, diffsP]);
      const first = [...results].sort((a, b) => a.t - b.t)[0];
      expect(first.kind).toBe('status');

      const res = results[1].kind === 'diffs' ? results[1].t : 0;
      expect(res).toBeLessThan(2000);

      const data = await (await fetch(`${server.url}/api/diffs`)).json() as {
        diffs: Array<{ rel: string; patch: string; skipped?: boolean; before: string }>;
      };
      const small = data.diffs.find((d) => d.rel.includes('diff-smoke-small'));
      const medium = data.diffs.find((d) => d.rel.includes('diff-smoke-medium'));
      const big = data.diffs.find((d) => d.rel.includes('diff-smoke-big'));
      expect(small?.patch).toContain('mugil');
      expect(small?.skipped).toBe(false);
      // The medium diff went through the worker and produced a real patch.
      expect(medium?.skipped).toBe(false);
      expect(medium?.patch).toContain('beta line');
      expect(big?.skipped).toBe(true);
      expect(big?.patch).toBe('');
      // Payload stays bounded for oversized edits (preview only).
      expect(big?.before.length).toBeLessThan(bigBefore.length);
    } finally {
      await server.close();
    }
  });

  it('updates model via WebSocket set_model and slash command', async () => {
    const engine = createEngine(loadConfig());
    const server = await startIdeServer({ engine, port: 0, model: 'initial/model' });

    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const messages: any[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        // Send set_model message
        ws.send(JSON.stringify({ type: 'set_model', model: 'anthropic/claude-3.7-sonnet', provider: 'anthropic' }));
      });
      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          messages.push(parsed);
          if (parsed.type === 'status' && parsed.activeModel === 'anthropic/claude-3.7-sonnet') {
            ws.close();
            resolve();
          }
        } catch {
          // ignore raw string
        }
      });
      ws.on('error', reject);
    });

    // Verify GET /api/status reflects the model set via WS
    const statusRes = await fetch(`${server.url}/api/status`);
    const statusJson = (await statusRes.json()) as { activeModel: string; provider: string };
    expect(statusJson.activeModel).toBe('anthropic/claude-3.7-sonnet');
    expect(statusJson.provider).toBe('anthropic');

    ws.terminate();
    await server.close();
    await engine.backend.close();
  });
});
