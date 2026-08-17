#!/usr/bin/env node
/**
 * Browser smoke — question picker modal (the "manual" DOM check that the
 * automated WS tests cannot reach).
 *
 * Launches the real web server + a real headless Chrome, drives the actual
 * page DOM over the Chrome DevTools Protocol (raw `ws` — no new deps), and
 * verifies the three picker paths end-to-end (browser DOM -> WS -> server ->
 * tool loop -> model):
 *
 *   1. Click an option  -> the chosen answer is fed back to the model
 *   2. Esc / ✕ dismiss  -> "(dismissed)" is fed back
 *   3. No answer        -> the server timeout resolves the picker and the
 *      turn still completes (never hangs the loop)
 *
 * Usage:  npm run smoke:question-picker   (in packages/cli — builds first)
 *         or: node scripts/smoke-question-picker.mjs (after `npm run build`)
 *
 * Exit code 0 = all paths pass; non-zero = a path failed.
 *
 * NOTE: all sleeps are async — the server runs in this same process, so a
 * busy-wait would block the event loop and deadlock the smoke.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import WebSocket from 'ws';

import { startIdeServer } from '../dist/server/server.js';
import {
  SmartCache,
  MemoryBackend,
  LexicalEmbedding,
  HandoffManager,
  Pipeline,
  loadConfig,
} from '@mugil-ide/core';

const QUESTION_ARGS = JSON.stringify({
  header: 'Runner',
  question: 'Which test runner?',
  options: ['jest', 'vitest'],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Minimal scripted engine + client (mirrors packages/cli/tests/server.test.ts). */
function scriptedEngine(client) {
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
  return engine;
}

/** A scripted client whose first completion asks the `question` tool. */
function questionClient(fedBack) {
  let calls = 0;
  return {
    mock: false,
    complete: async (messages) => {
      fedBack.push(JSON.stringify(messages));
      calls += 1;
      if (calls === 1) {
        return {
          provider: 'mock',
          model: 'mock-model',
          content: '',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'q1', name: 'question', arguments: QUESTION_ARGS }],
        };
      }
      return {
        provider: 'mock',
        model: 'mock-model',
        content: 'Final answer after the question.',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
      };
    },
  };
}

// ---------------------------------------------------------------- Chrome

function findChrome() {
  const env = process.env;
  const candidates = [
    env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

async function launchChrome(chromePath) {
  const profile = mkdtempSync(join(tmpdir(), 'mugil-smoke-'));
  const flagSets = [
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0'],
    ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0'],
  ];
  for (const flags of flagSets) {
    const proc = spawn(chromePath, [...flags, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    const portFile = join(profile, 'DevToolsActivePort');
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !existsSync(portFile) && proc.exitCode === null) {
      await sleep(100);
    }
    if (existsSync(portFile)) {
      const [port] = readFileSync(portFile, 'utf-8').trim().split('\n');
      return { proc, profile, port };
    }
    proc.kill();
    await sleep(200);
  }
  throw new Error('Chrome did not start (no DevToolsActivePort). Is Chrome installed? Set CHROME_PATH if needed.');
}

function killChrome(proc, profile) {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      proc.kill('SIGKILL');
    }
  } catch {
    // best-effort
  }
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

// ------------------------------------------------------- CDP (over `ws`)

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.seq = 0;
    this.pending = new Map();
    this.eventHandlers = new Map();
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code ?? ''})`));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.eventHandlers.get(msg.method) ?? []) h(msg.params);
      }
    });
  }
  /** Subscribes to CDP events of a given method (e.g. 'Network.webSocketFrameSent'). */
  onEvent(method, handler) {
    const list = this.eventHandlers.get(method) ?? [];
    list.push(handler);
    this.eventHandlers.set(method, list);
  }
  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(`page eval failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
    }
    return r.result?.value;
  }
  /** Polls `expr` until truthy; returns its value. Throws on timeout. */
  async waitFor(expression, { timeout = 20000, interval = 150, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    let lastErr;
    while (Date.now() < deadline) {
      try {
        const value = await this.evaluate(expression);
        if (value) return value;
      } catch (err) {
        lastErr = err; // navigation mid-flight etc. — keep polling
      }
      await sleep(interval);
    }
    throw new Error(`timed out waiting for: ${label}${lastErr ? ` (last error: ${lastErr.message})` : ''}`);
  }
}

async function connectPage(port) {
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  // Capture page console / exceptions / WS frames for the debug dump.
  const diagnostics = { console: [], exceptions: [], ws: [] };
  cdp.onEvent('Runtime.consoleAPICalled', (p) => {
    diagnostics.console.push(p.args.map((a) => a.value ?? a.description ?? '').join(' '));
  });
  cdp.onEvent('Runtime.exceptionThrown', (p) => {
    diagnostics.exceptions.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'unknown');
  });
  cdp.onEvent('Log.entryAdded', (p) => {
    diagnostics.console.push(`[log:${p.entry.level}] ${p.entry.text}`);
  });
  cdp.onEvent('Network.webSocketFrameSent', (p) => {
    diagnostics.ws.push(`SENT ${p.response.payloadData}`);
  });
  cdp.onEvent('Network.webSocketFrameReceived', (p) => {
    diagnostics.ws.push(`RECV ${p.response.payloadData}`);
  });
  return { cdp, diagnostics };
}

// ----------------------------------------------------------------- Smoke

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function waitForFedBack(fedBack, needle, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fedBack.some((s) => s.includes(needle))) return;
    await sleep(100);
  }
  throw new Error(`model never saw ${JSON.stringify(needle)}; fedBack=${JSON.stringify(fedBack, null, 2)}`);
}

async function runScenario(name, { timeoutMs, act }) {
  // The server reads this per connection — set it before starting up.
  process.env.MUGIL_IDE_QUESTION_TIMEOUT_MS = String(timeoutMs ?? 120000);

  const fedBack = [];
  const client = questionClient(fedBack);
  const engine = scriptedEngine(client);
  const server = await startIdeServer({ engine, port: 0 });

  const chrome = await launchChrome(findChrome());
  const { cdp, diagnostics } = await connectPage(chrome.port);
  try {
    // Sanity: the server must actually serve the app HTML before we point a
    // browser at it.
    const htmlRes = await fetch(server.url);
    const htmlText = await htmlRes.text();
    if (htmlRes.status !== 200 || !htmlText.includes('id="chat-input"')) {
      throw new Error(`server did not serve the app HTML (${server.url}, status ${htmlRes.status})`);
    }

    await cdp.send('Page.navigate', { url: server.url });
    // Page fully loaded, its WebSocket connected to the server, and the inline
    // script's functions defined (guards against evaluating mid-navigation,
    // where the old document's global scope is still active).
    // Note: the status span's initial HTML text is 'Connected', so we must
    // wait on the actual socket state (readyState OPEN), not the label.
    await cdp.waitFor(
      `location.href.indexOf(${JSON.stringify(server.url)}) === 0 && ` +
        `typeof ws !== 'undefined' && ws.readyState === WebSocket.OPEN && ` +
        `typeof submitQuickInput === 'function'`,
      { timeout: 30000, label: 'page WS connected + script ready' },
    );

    // Submit the prompt through the real quick-input bar.
    await cdp.evaluate(`
      (() => {
        document.getElementById('chat-input').value = 'which runner?';
        submitQuickInput();
      })()
    `);

    // The picker modal must render with the question + options.
    await cdp.waitFor(`document.getElementById('question-modal').classList.contains('open')`, {
      label: 'question modal open',
    });
    const rendered = await cdp.evaluate(`(() => ({
      header: document.getElementById('question-modal-header').textContent,
      text: document.getElementById('question-modal-text').textContent,
      options: Array.from(document.querySelectorAll('#question-modal-options .modal-item-card')).map((b) => b.textContent),
    }))()`);
    assertEq(rendered.header, 'Runner', 'modal header');
    assertEq(rendered.text, 'Which test runner?', 'modal question text');
    assertEq(JSON.stringify(rendered.options), JSON.stringify(['[1] jest', '[2] vitest']), 'modal option buttons');

    await act(cdp, fedBack);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    if (process.env.MUGIL_SMOKE_DEBUG) {
      const safeEval = async (expr) => {
        try {
          return await cdp.evaluate(expr);
        } catch (e) {
          return `(eval failed: ${e.message})`;
        }
      };
      try {
        const probeState = await safeEval(`(() => {
          const state = { href: location.href, wsType: typeof ws, wsReady: typeof ws !== 'undefined' ? ws.readyState : -1 };
          try {
            window.__sent = [];
            const orig = ws.send.bind(ws);
            ws.send = (d) => { window.__sent.push(String(d)); return orig(d); };
            sendAgentCmd('smoke-probe');
            state.sent = window.__sent;
          } catch (e) { state.sendError = String(e); }
          return state;
        })()`);
        console.error('DEBUG probe state:', JSON.stringify(probeState, null, 2));
        await sleep(800);
        const dump = {};
        const expr = (label, js) =>
          safeEval(js).then((v) => (dump[label] = v)).catch((e) => (dump[label] = `(err: ${e.message})`));
        await expr('href', `location.href`);
        await expr('hasQuestionModal', `!!document.getElementById('question-modal')`);
        await expr('questionModalClass', `(document.getElementById('question-modal') || {}).className || '(missing)'`);
        await expr('showQuestion', `typeof showQuestion`);
        await expr('pendingQuestionId', `typeof pendingQuestionId !== 'undefined' ? pendingQuestionId : '(n/a)'`);
        await expr('termTail', `(() => {
          const out = [];
          if (typeof agentTerm !== 'undefined' && agentTerm && agentTerm.buffer) {
            const n = agentTerm.buffer.active.length;
            for (let i = Math.max(0, n - 10); i < n; i++) {
              const l = agentTerm.buffer.active.getLine(i);
              out.push(l ? l.translateToString(true) : '');
            }
          } else {
            out.push('(no agentTerm)');
          }
          return out.join('|');
        })()`);
        console.error('DEBUG page state:', JSON.stringify(dump, null, 2));
        console.error('DEBUG fedBack:', JSON.stringify(fedBack, null, 2));
        console.error('DEBUG console/exceptions:', JSON.stringify(diagnostics.console, null, 2));
        console.error('DEBUG exceptions:', JSON.stringify(diagnostics.exceptions, null, 2));
        console.error('DEBUG ws frames:', JSON.stringify(diagnostics.ws.slice(-25), null, 2));
      } catch {
        // dump is best-effort
      }
    }
    throw err;
  } finally {
    cdp.close();
    killChrome(chrome.proc, chrome.profile);
    await server.close();
    await engine.backend.close();
  }
}

async function main() {
  // Sandbox: never read the developer's real sessions, keys, MCP servers or
  // webhooks from ~/.cache/mugil-ide / ~/.config/mugil-ide/.env.
  const sandbox = mkdtempSync(join(tmpdir(), 'mugil-smoke-env-'));
  process.env.MUGIL_IDE_CACHE_DIR = join(sandbox, 'cache');
  process.env.MUGIL_IDE_ENV_FILE = join(sandbox, 'user.env'); // missing -> readUserEnv returns {}

  const chromePath = findChrome();
  if (!chromePath) {
    console.error('No Chrome found. Install Chrome or set CHROME_PATH.');
    process.exit(2);
  }
  console.log(`Chrome: ${chromePath}`);
  console.log('Smoke: question picker modal (real browser)\n');

  // 1. Click an option -> the chosen answer feeds back to the model.
  await runScenario('click option', {
    act: async (cdp, fedBack) => {
      await cdp.evaluate(`document.querySelector('#question-modal-options .modal-item-card').click()`);
      await cdp.waitFor(`!document.getElementById('question-modal').classList.contains('open')`, {
        label: 'modal closed after click',
      });
      await waitForFedBack(fedBack, 'jest');
    },
  });

  // 2. Esc dismiss -> "(dismissed)" feeds back.
  await runScenario('Esc dismiss', {
    act: async (cdp, fedBack) => {
      await cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      await cdp.waitFor(`!document.getElementById('question-modal').classList.contains('open')`, {
        label: 'modal closed after Esc',
      });
      await waitForFedBack(fedBack, '(dismissed)');
    },
  });

  // 3. No interaction -> the server timeout resolves the picker; loop survives.
  await runScenario('server timeout (no answer)', {
    timeoutMs: 1200,
    act: async (_cdp, fedBack) => {
      await waitForFedBack(fedBack, '(dismissed — no answer provided)');
    },
  });

  console.log('\nAll question-picker smoke paths passed ✔');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('\nSmoke FAILED:', err.message);
    process.exit(1);
  },
);
