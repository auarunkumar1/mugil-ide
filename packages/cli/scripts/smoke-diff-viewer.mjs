#!/usr/bin/env node
/**
 * Browser smoke — Diff Viewer (the manual DOM check for the /api/diffs path).
 *
 * Launches the real web server + a real headless Chrome, records edits into
 * the server's undo stack exactly as the tool loop does (via pushEdit), then
 * drives the actual page DOM over the Chrome DevTools Protocol (raw `ws` — no
 * new deps) and verifies:
 *
 *   1. The Diff tab loads the recorded edits and renders a real patch for a
 *      normal edit (small file).
 *   2. An in-cap but worst-case diff (900 dissimilar lines) is computed on a
 *      worker thread — a cheap /api/status request fired while the diff is in
 *      flight still wins the race (the event loop is not blocked).
 *   3. An oversized edit (>1000 lines) is skipped server-side and the UI shows
 *      the "File too large to diff" notice instead of hanging.
 *
 * Usage:  npm run smoke:diff-viewer   (in packages/cli — builds first)
 *         or: node scripts/smoke-diff-viewer.mjs (after `npm run build`)
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
  pushEdit,
  SmartCache,
  MemoryBackend,
  LexicalEmbedding,
  HandoffManager,
  Pipeline,
  loadConfig,
} from '@mugil-ide/core';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Minimal scripted engine (mirrors packages/cli/tests/server.test.ts). */
function scriptedEngine() {
  const client = {
    mock: false,
    complete: async () => {
      throw new Error('smoke: no model call expected');
    },
  };
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

/** Records edits into the in-process undo stack (root = process.cwd(), which
 *  is exactly what /api/diffs reads). */
function recordSmokeEdits() {
  const root = process.cwd();
  pushEdit(root, {
    path: join(root, 'diff-smoke-small.txt'),
    before: { content: 'hello\nworld\n', existed: true },
    after: { content: 'hello\nmugil\n', existed: true },
  });
  // In-cap but worst-case: 900 fully-dissimilar lines ≈ 300-400ms of diff work.
  pushEdit(root, {
    path: join(root, 'diff-smoke-medium.txt'),
    before: { content: Array.from({ length: 900 }, (_, i) => `alpha line ${i}`).join('\n'), existed: true },
    after: { content: Array.from({ length: 900 }, (_, i) => `beta line ${i}`).join('\n'), existed: true },
  });
  // Oversized (>1000 lines): must be skipped by the server, not diffed.
  pushEdit(root, {
    path: join(root, 'diff-smoke-big.txt'),
    before: { content: Array.from({ length: 3000 }, (_, i) => `alpha line ${i}`).join('\n'), existed: true },
    after: { content: Array.from({ length: 3000 }, (_, i) => `beta line ${i}`).join('\n'), existed: true },
  });
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
  const diagnostics = { console: [], exceptions: [] };
  cdp.onEvent('Runtime.consoleAPICalled', (p) => {
    diagnostics.console.push(p.args.map((a) => a.value ?? a.description ?? '').join(' '));
  });
  cdp.onEvent('Runtime.exceptionThrown', (p) => {
    diagnostics.exceptions.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'unknown');
  });
  cdp.onEvent('Log.entryAdded', (p) => {
    diagnostics.console.push(`[log:${p.entry.level}] ${p.entry.text}`);
  });
  return { cdp, diagnostics };
}

// ----------------------------------------------------------------- Smoke

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function runScenario() {
  const engine = scriptedEngine();
  const server = await startIdeServer({ engine, port: 0 });
  // Record the edits BEFORE the browser loads so the first /api/diffs sees them.
  recordSmokeEdits();

  const chrome = await launchChrome(findChrome());
  const { cdp, diagnostics } = await connectPage(chrome.port);
  try {
    const htmlRes = await fetch(server.url);
    const htmlText = await htmlRes.text();
    if (htmlRes.status !== 200 || !htmlText.includes('id="chat-input"')) {
      throw new Error(`server did not serve the app HTML (${server.url}, status ${htmlRes.status})`);
    }

    await cdp.send('Page.navigate', { url: server.url });
    await cdp.waitFor(
      `location.href.indexOf(${JSON.stringify(server.url)}) === 0 && ` +
        `typeof ws !== 'undefined' && ws.readyState === WebSocket.OPEN && ` +
        `typeof switchRightTab === 'function'`,
      { timeout: 30000, label: 'page WS connected + script ready' },
    );

    // 1. Open the Diff Viewer tab — this fires loadDiffs() → fetch('/api/diffs').
    await cdp.evaluate(`switchRightTab('diff')`);
    await cdp.waitFor(`document.getElementById('diff-count').textContent === '3'`, {
      timeout: 30000,
      label: 'diff-count badge = 3 (all three edits rendered)',
    });

    assertEq(await cdp.evaluate(`document.getElementById('diff-file-title').textContent`), 'Modified Files (3)', 'diff title');
    assertEq(await cdp.evaluate(`document.querySelectorAll('#diff-content > div').length`), 3, 'diff cards rendered');

    // The small edit produced a real patch (a '+mugil' added line).
    assertEq(
      await cdp.evaluate(`Array.from(document.querySelectorAll('#diff-content pre div')).some((el) => el.textContent.includes('mugil'))`),
      true,
      'small-edit patch rendered',
    );
    // The medium edit (worker-thread diff) rendered its changed lines too.
    assertEq(
      await cdp.evaluate(`Array.from(document.querySelectorAll('#diff-content pre div')).some((el) => el.textContent.includes('beta line'))`),
      true,
      'medium-edit patch rendered',
    );
    // The oversized edit was skipped — the UI shows the notice, not a hang.
    assertEq(
      await cdp.evaluate(
        `Array.from(document.querySelectorAll('#diff-content pre div')).some((el) => el.textContent.includes('File too large to diff'))`,
      ),
      true,
      'big-edit skip notice rendered',
    );

    // 2. Async diffing: the second /api/diffs recomputes the medium diff on the
    // worker thread (~400ms), so a cheap /api/status fired at the same time
    // must resolve first. If the diff blocked the event loop, /api/status
    // could only be served after the patch finished.
    const winner = await cdp.evaluate(`(async () => {
      const statusP = fetch('/api/status').then(() => 'status');
      const diffsP = fetch('/api/diffs').then(() => 'diffs');
      return await Promise.race([statusP, diffsP]);
    })()`);
    assertEq(winner, 'status', 'event loop responsive during diff (async diffing)');

    console.log('  ✓ Diff Viewer: patches render, oversized edits show the skip notice, event loop stays responsive');
  } catch (err) {
    if (process.env.MUGIL_SMOKE_DEBUG) {
      const safeEval = async (expr) => {
        try {
          return await cdp.evaluate(expr);
        } catch (e) {
          return `(eval failed: ${e.message})`;
        }
      };
      console.error('DEBUG diff-content HTML:', await safeEval(`document.getElementById('diff-content').innerHTML.slice(0, 2000)`));
      console.error('DEBUG console/exceptions:', JSON.stringify(diagnostics.console, null, 2));
      console.error('DEBUG exceptions:', JSON.stringify(diagnostics.exceptions, null, 2));
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
  // Sandbox: never read the developer's real sessions or keys.
  const sandbox = mkdtempSync(join(tmpdir(), 'mugil-smoke-env-'));
  process.env.MUGIL_IDE_CACHE_DIR = join(sandbox, 'cache');
  process.env.MUGIL_IDE_ENV_FILE = join(sandbox, 'user.env');

  const chromePath = findChrome();
  if (!chromePath) {
    console.error('No Chrome found. Install Chrome or set CHROME_PATH.');
    process.exit(2);
  }
  console.log(`Chrome: ${chromePath}`);
  console.log('Smoke: Diff Viewer (real browser)\n');

  await runScenario();
  console.log('\nAll diff-viewer smoke paths passed ✔');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('\nSmoke FAILED:', err.message);
    process.exit(1);
  },
);
