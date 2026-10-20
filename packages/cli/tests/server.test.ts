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
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

let cacheDir = '';

beforeEach(() => {
  // Isolate session auto-save/resume (and never touch the real user cache).
  cacheDir = mkdtempSync(join(tmpdir(), 'mugil-cache-'));
  process.env.MUGIL_IDE_CACHE_DIR = cacheDir;
  // Isolate the user env file: set_model persists MUGIL_IDE_MODEL there via
  // writeUserEnv. (/plan and set_mode persist to the workspace-scoped mode file
  // in MUGIL_IDE_CACHE_DIR, which the line above already isolates.)
  process.env.MUGIL_IDE_ENV_FILE = join(cacheDir, 'user.env');
});

beforeAll(() => {
  // Use the child_process PTY backend: node-pty's Windows kill() leaks its
  // named-pipe sockets, which would hang the jest process on exit.
  process.env.MUGIL_IDE_PTY_BACKEND = 'child';
});

afterAll(async () => {
  delete process.env.MUGIL_IDE_CACHE_DIR;
  delete process.env.MUGIL_IDE_ENV_FILE;
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

  it('binds to a random available port when port is omitted', async () => {
    const engine = createEngine(loadConfig());
    const server = await startIdeServer({ engine });
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.url).toContain(`http://localhost:${server.port}`);
      const res = await fetch(`${server.url}/api/status`);
      expect(res.status).toBe(200);
    } finally {
      await server.close();
      await engine.backend.close();
    }
  });

  it('prints clean banner without ASCII logo on connection even after session resume', async () => {
    // Simulate a returning user: the repl constructor auto-resumes the saved
    // last-session, so turns.length > 0 at connect time.
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

    const receivedData: string[] = [];
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'agent_data' && typeof msg.data === 'string') {
          receivedData.push(msg.data);
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
      await new Promise((r) => setTimeout(r, 500));
      const combined = receivedData.join('');
      expect(combined).toContain('MUGIL IDE');
      expect(combined).toContain('Token-Efficient Autonomous AI IDE');
      // No 24-bit RGB cursor-animated ASCII banner
      expect(combined).not.toContain('\x1b[s\x1b[?25l');
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

  it('switches mode via set_mode WebSocket message', async () => {
    let calls = 0;
    const fedBack: string[] = [];
    const client: ProviderClient = {
      mock: false,
      complete: async (messages) => {
        fedBack.push(JSON.stringify(messages));
        calls += 1;
        if (calls === 1) {
          // A write attempt while still in plan mode — denied outright.
          return scriptedResult({
            finishReason: 'tool_calls',
            toolCalls: [
              { id: 'c1', name: 'write_file', arguments: JSON.stringify({ path: 'plan-test.txt', content: 'nope' }) },
            ],
          });
        }
        return scriptedResult({ content: 'Done in act mode.' });
      },
    };
    const engine = scriptedEngine(client);
    const server = await startIdeServer({ engine, port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);

    try {
      // First switch to plan mode
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'set_mode', mode: 'plan' }));
      });

      // NOTE: predicate must include the mode — the server broadcasts an
      // initial `status` (mode 'act') on connect, so filtering on type alone
      // is racy.
      const planStatus = await waitForMessage<{ mode: string }>(ws, (m) => m.type === 'status' && m.mode === 'plan');
      expect(planStatus.mode).toBe('plan');

      // Now send a prompt — the write tool call should be denied in plan mode
      ws.send(JSON.stringify({ type: 'agent_input', data: 'write a file\r' }));

      const turn = await waitForMessage<{ turn: { response: string } }>(ws, (m) => m.type === 'turn_complete');
      expect(turn.turn.response).toContain('Done in act mode.');
      // The plan-mode denial was fed back to the model as a tool result.
      expect(fedBack.some((s) => s.includes('Permission denied'))).toBe(true);

      // Switch back to act mode
      ws.send(JSON.stringify({ type: 'set_mode', mode: 'act' }));
      const actStatus = await waitForMessage<{ mode: string }>(ws, (m) => m.type === 'status' && m.mode === 'act');
      expect(actStatus.mode).toBe('act');
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

  it('writes file to disk in act mode after user approval', async () => {
    const testFile = 'act-write-test-output.txt';
    const testContent = 'hello from act mode write test';
    // Clean up any leftover file from a prior run.
    try { rmSync(testFile, { force: true }); } catch { /* ignore */ }

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
              {
                id: 'w1',
                name: 'write_file',
                arguments: JSON.stringify({ path: testFile, content: testContent }),
              },
            ],
          });
        }
        return scriptedResult({ content: 'File written successfully.' });
      },
    };
    const engine = scriptedEngine(client);
    const server = await startIdeServer({ engine, port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);

    try {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'agent_input', data: 'create the file\r' })));

      // The write_file tool should trigger an approval modal.
      const approval = await waitForMessage<{ id: number; tool: string; args: string }>(
        ws,
        (m) => m.type === 'approval',
      );
      expect(approval.tool).toBe('write_file');
      expect(approval.args).toContain(testFile);

      // User approves.
      ws.send(JSON.stringify({ type: 'approval_answer', id: approval.id, granted: true }));

      const turn = await waitForMessage<{ turn: { response: string; toolsCalled: Array<{ name: string }> } }>(
        ws,
        (m) => m.type === 'turn_complete',
      );
      expect(turn.turn.response).toContain('File written successfully.');

      // The write_file tool was actually called.
      expect(turn.turn.toolsCalled.map((t) => t.name)).toContain('write_file');

      // The file must exist on disk with the expected content.
      expect(existsSync(testFile)).toBe(true);
      expect(readFileSync(testFile, 'utf-8')).toBe(testContent);

      // The agent instruction should be in the system prompt.
      expect(fedBack[0]).toContain('autonomous coding agent');
    } finally {
      ws.terminate();
      await server.close();
      // Clean up.
      try { rmSync(testFile, { force: true }); } catch { /* ignore */ }
    }
  });

  /** Concatenated `agent_data` payloads seen on a socket, in arrival order. */
  const agentOutput = (chunks: string[]): string => chunks.join('');

  const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

  it('streams assistant text to the browser before the turn completes', async () => {
    // The completion parks mid-flight so "the delta arrived while the turn was
    // still running" is a fact the test can observe, not a race it hopes wins.
    let release: () => void = () => {};
    const midFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const streaming = {
      mock: false,
      complete: async () => scriptedResult({ content: 'unused' }),
      stream: async (_messages: unknown, _options: unknown, handlers: any) => {
        handlers?.onDelta?.('Hello ', true);
        await midFlight;
        handlers?.onDelta?.('world', true);
        return scriptedResult({
          provider: 'openai',
          model: 'm',
          content: 'Hello world',
          finishReason: 'stop',
        });
      },
    } as unknown as ProviderClient;
    const server = await startIdeServer({ engine: scriptedEngine(streaming), port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const chunks: string[] = [];

    try {
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'agent_data') chunks.push(msg.data as string);
      });

      ws.send(JSON.stringify({ type: 'agent_input', data: 'hello there\r' }));

      const deadline = Date.now() + 10000;
      while (!agentOutput(chunks).includes('Hello ') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // The first token is already on the wire; the second is still inside the
      // provider. Only token-by-token delivery can look like this.
      const midTurn = agentOutput(chunks);
      expect(midTurn).toContain('Hello ');
      expect(midTurn).not.toContain('world');

      release();
      const turn = await waitForMessage<{ turn: { response: string } }>(ws, (m) => m.type === 'turn_complete');
      expect(turn.turn.response).toBe('Hello world');

      // The streamed text is the answer, so the formatted response must not be
      // printed a second time underneath it.
      const out = agentOutput(chunks);
      expect(occurrences(out, 'Hello world')).toBe(1);
    } finally {
      release();
      ws.terminate();
      await server.close();
    }
  });

  it('coalesces status frames instead of sending one per streamed token', async () => {
    // 60 fragments land in one burst (no awaits between them), which is the
    // worst case streaming creates. Status must be rate-limited, not per-token.
    const TOKENS = 60;
    const client = {
      mock: false,
      complete: async () => scriptedResult({ content: 'unused' }),
      stream: async (_messages: unknown, _options: unknown, handlers: any) => {
        for (let i = 0; i < TOKENS; i += 1) handlers?.onDelta?.(`t${i} `, true);
        return scriptedResult({ content: 'done' });
      },
    } as unknown as ProviderClient;
    const server = await startIdeServer({ engine: scriptedEngine(client), port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const counts = { data: 0, status: 0 };

    try {
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'agent_data') counts.data += 1;
        if (msg.type === 'status') counts.status += 1;
      });
      ws.send(JSON.stringify({ type: 'agent_input', data: 'stream a lot\r' }));
      await waitForMessage(ws, (m) => m.type === 'turn_complete');
      // The trailing status (the one turn_complete sends eagerly) must arrive.
      const deadline = Date.now() + 2000;
      while (counts.status === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Every token still reaches the browser...
      expect(counts.data).toBeGreaterThanOrEqual(TOKENS);
      // ...but status is bounded: the burst plus the turn_complete frame, not
      // one per token. 60 tokens produce 2 frames — the leading edge and the one
      // turn_complete sends eagerly — so 4 still leaves room for the trailing
      // frame firing just after this test reads the count, while failing by an
      // order of magnitude if the limiter is dropped.
      expect(counts.status).toBeLessThanOrEqual(4);
      expect(counts.status).toBeGreaterThan(0);
    } finally {
      ws.terminate();
      await server.close();
    }
  });

  it('sends a trailing status frame when the burst ends inside the interval', async () => {
    // The trailing edge of the limiter. The synchronous burst above is all one
    // tick, so its pending trailing frame is cancelled by turn_complete before
    // it ever fires — only the leading edge is exercised there. Here the second
    // fragment lands mid-interval (arming the timer) and the stream then stays
    // open past it, so the trailing frame must arrive on its own, with no
    // lifecycle event behind it.
    const client = {
      mock: false,
      complete: async () => scriptedResult({ content: 'unused' }),
      stream: async (_messages: unknown, _options: unknown, handlers: any) => {
        handlers?.onDelta?.('first ', true);
        await new Promise((resolve) => setTimeout(resolve, 10));
        handlers?.onDelta?.('second', true);
        // Outlast the 100ms interval so the armed timer has room to fire before
        // the turn completes (which would otherwise cancel it).
        await new Promise((resolve) => setTimeout(resolve, 200));
        return scriptedResult({ content: 'done' });
      },
    } as unknown as ProviderClient;
    const server = await startIdeServer({ engine: scriptedEngine(client), port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const events: string[] = [];

    try {
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'agent_data' || msg.type === 'status' || msg.type === 'turn_complete') {
          events.push(`${msg.type}:${JSON.stringify(msg.data ?? '').slice(0, 20)}`);
        }
      });
      ws.send(JSON.stringify({ type: 'agent_input', data: 'two slow tokens\r' }));
      await waitForMessage(ws, (m) => m.type === 'turn_complete');

      // Both fragments reached the browser.
      expect(events.filter((e) => e.startsWith('agent_data:"first ')).length).toBe(1);
      expect(events.filter((e) => e.startsWith('agent_data:"second')).length).toBe(1);

      // The load-bearing assertion: the frame IMMEDIATELY after the second
      // fragment is a status. A coalescing trailing timer fires on its own
      // schedule, so nothing has to write first. Every other status in this turn
      // rides either a write (leading edge) or a lifecycle event, all of which
      // put an `agent_data` frame or `turn_complete` in front of them — with
      // the timer removed, the summary writes that follow the stream land
      // there instead and this fails.
      const secondDeltaAt = events.findIndex((e) => e.startsWith('agent_data:"second'));
      expect(events[secondDeltaAt + 1]).toMatch(/^status:/);
    } finally {
      ws.terminate();
      await server.close();
    }
  });

  it('marks partial streamed text as incomplete when the turn is cancelled', async () => {
    // Ctrl-C mid-stream. The fake client streams a fragment, then parks until
    // the turn's AbortSignal fires — the same shape as a real SSE body being
    // cut off mid-answer.
    const client = {
      mock: false,
      complete: async () => scriptedResult({ content: 'unused' }),
      stream: async (_messages: unknown, options: any, handlers: any) => {
        handlers?.onDelta?.('Here is half an ans', true);
        await new Promise<void>((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        });
        return scriptedResult({ content: 'never' });
      },
    } as unknown as ProviderClient;
    const server = await startIdeServer({ engine: scriptedEngine(client), port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const chunks: string[] = [];

    try {
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'agent_data') chunks.push(msg.data as string);
      });
      ws.send(JSON.stringify({ type: 'agent_input', data: 'long answer please\r' }));

      const deadline = Date.now() + 10000;
      while (!agentOutput(chunks).includes('half an ans') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(agentOutput(chunks)).toContain('Here is half an ans');

      ws.send(JSON.stringify({ type: 'agent_input', data: '\x03' }));

      const cancelled = Date.now() + 10000;
      while (!agentOutput(chunks).includes('Turn cancelled') && Date.now() < cancelled) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const out = agentOutput(chunks);
      expect(out).toContain('Turn cancelled');
      // The partial answer must be labelled as incomplete rather than left
      // looking like a finished one.
      expect(out).toContain('incomplete answer');
      expect(out).toContain('NOT saved');
    } finally {
      ws.terminate();
      await server.close();
    }
  });

  it('discards provisional streamed text when the model then requests tools', async () => {
    let calls = 0;
    const client = {
      mock: false,
      complete: async () => scriptedResult({ content: 'unused' }),
      stream: async (_messages: unknown, _options: unknown, handlers: any) => {
        calls += 1;
        if (calls === 1) {
          // Narration, then a tool call: the narration was never the answer.
          handlers?.onDelta?.('Let me look that up.', true);
          return scriptedResult({
            finishReason: 'tool_calls',
            toolCalls: [
              {
                id: 'q1',
                name: 'question',
                arguments: JSON.stringify({ header: 'Runner', question: 'Which runner?', options: ['jest', 'vitest'] }),
              },
            ],
          });
        }
        handlers?.onDelta?.('The answer.', true);
        return scriptedResult({ content: 'The answer.' });
      },
    } as unknown as ProviderClient;
    const server = await startIdeServer({ engine: scriptedEngine(client), port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const chunks: string[] = [];

    try {
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'agent_data') chunks.push(msg.data as string);
      });
      ws.send(JSON.stringify({ type: 'agent_input', data: 'answer this\r' }));

      const question = await waitForMessage<{ id: number }>(ws, (m) => m.type === 'question');
      ws.send(JSON.stringify({ type: 'question_answer', id: question.id, answer: 'jest' }));

      const turn = await waitForMessage<{ turn: { response: string; toolsCalled: Array<{ name: string }> } }>(
        ws,
        (m) => m.type === 'turn_complete',
      );
      expect(turn.turn.response).toBe('The answer.');
      expect(turn.turn.toolsCalled.map((t) => t.name)).toContain('question');

      const out = agentOutput(chunks);
      // The provisional narration is labelled as discarded, and the answer that
      // actually ended the turn is printed exactly once.
      expect(out).toContain('Partial reasoning discarded');
      expect(occurrences(out, 'Let me look that up.')).toBe(1);
      expect(occurrences(out, 'The answer.')).toBe(1);
    } finally {
      ws.terminate();
      await server.close();
    }
  });

  it('handles GET and POST /api/config with historyBudget, maxOutputTokens, maxToolIterations, webfetchEnabled, and turboMode', async () => {
    const client: ProviderClient = {
      mock: false,
      complete: async () => scriptedResult({ content: 'done' }),
    };
    const server = await startIdeServer({ engine: scriptedEngine(client), port: 0 });
    try {
      const getRes = await fetch(`http://localhost:${server.port}/api/config`);
      expect(getRes.status).toBe(200);
      const getJson = (await getRes.json()) as any;
      expect(typeof getJson.historyBudget).toBe('number');
      expect(typeof getJson.maxOutputTokens).toBe('number');
      expect(typeof getJson.maxToolIterations).toBe('number');
      expect(typeof getJson.webfetchEnabled).toBe('boolean');
      expect(typeof getJson.turboMode).toBe('boolean');

      const postRes = await fetch(`http://localhost:${server.port}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          historyBudget: 24000,
          maxOutputTokens: 12000,
          maxToolIterations: 30,
          webfetchEnabled: false,
          turboMode: true,
        }),
      });
      expect(postRes.status).toBe(200);
      const postJson = (await postRes.json()) as any;
      expect(postJson.ok).toBe(true);
      expect(postJson.historyBudget).toBe(24000);
      expect(postJson.maxOutputTokens).toBe(12000);
      expect(postJson.maxToolIterations).toBe(30);
      expect(postJson.webfetchEnabled).toBe(false);
      expect(postJson.turboMode).toBe(true);
      expect(process.env.MUGIL_IDE_MAX_OUTPUT_TOKENS).toBe('12000');
      expect(process.env.MUGIL_IDE_MAX_TOOL_ITERATIONS).toBe('30');
      expect(process.env.MUGIL_IDE_ENABLE_WEBFETCH).toBe('0');
      expect(process.env.MUGIL_IDE_TURBO_MODE).toBe('1');
    } finally {
      process.env.MUGIL_IDE_ENABLE_WEBFETCH = '1';
      await server.close();
    }
  });
});
