import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import type { Engine } from '@mugil-ide/core';
import { fetchProviderModels, readUserEnv, writeUserEnv } from '@mugil-ide/core';
import { getWebUiHtml } from './html.js';
import { AgentRepl } from '../terminal/agentRepl.js';
import { createPtySession, type PtyInstance } from './ptyManager.js';
import { createDiffRunner } from './diffRunner.js';

/**
 * Resolves a vendored xterm asset. Works from both the compiled dist/ layout
 * (production) and the src/ layout (jest/ts-node run the TS source directly).
 */
function vendorAssetPath(name: string): string | null {
  const candidates = [
    fileURLToPath(new URL(`../vendor/xterm/${name}`, import.meta.url)), // dist (packaged app)
    fileURLToPath(new URL(`../../dist/vendor/xterm/${name}`, import.meta.url)), // src (tests)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Diff-viewer safety bounds for /api/diffs: the `diff` package's worst case is
// O(N·M) in lines — two large, dissimilar files can stall the event loop for
// tens of seconds (the browser fetch then hangs: connection accepted, no
// response). Skip the patch for oversized files and show a placeholder instead.
const MAX_DIFF_LINES = 1000;
const MAX_DIFF_CHARS = 512 * 1024;
const MAX_PREVIEW_CHARS = 8 * 1024;

function listWorkspaceFiles(root: string, maxEntries = 200): Array<{ path: string; isDir: boolean; size?: number }> {
  const IGNORED = new Set(['node_modules', '.git', 'dist', '.cache', 'build', 'coverage']);
  const results: Array<{ path: string; isDir: boolean; size?: number }> = [];

  function scan(dir: string) {
    if (results.length >= maxEntries) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORED.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          results.push({ path: rel, isDir: true });
          scan(full);
        } else {
          try {
            const stat = fs.statSync(full);
            results.push({ path: rel, isDir: false, size: stat.size });
          } catch {
            results.push({ path: rel, isDir: false });
          }
        }
      }
    } catch {
      // ignore — best-effort file-tree scan, unreadable subtrees are skipped
    }
  }
  scan(root);
  return results;
}

export interface ServerOptions {
  port?: number;
  host?: string;
  engine: Engine;
  model?: string;
}

export interface RunningServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export async function startIdeServer(options: ServerOptions): Promise<RunningServer> {
  const { engine, model: initialModel } = options;
  // Diffs are computed on a worker thread so a slow (O(N·M) worst-case) patch
  // never blocks the event loop for other requests. Disposed in close().
  const diffRunner = createDiffRunner();
  const userEnv = readUserEnv();
  let activeModel = initialModel || process.env.MUGIL_IDE_MODEL || userEnv.MUGIL_IDE_MODEL || (engine.config.models && engine.config.models[0]?.id) || 'openrouter/auto';
  const updateActiveModel = (newModel: string, newProvider?: string) => {
    activeModel = newModel;
    const providerToSet = newProvider || engine.config.provider;
    if (providerToSet && providerToSet !== engine.config.provider) {
      engine.reconfigure({ ...engine.config, provider: providerToSet as any });
    }
    try {
      writeUserEnv({ MUGIL_IDE_MODEL: newModel, ...(providerToSet ? { AI_PROVIDER: providerToSet } : {}) });
    } catch {
      // ignore — model selection still applies for this session; persistence is best-effort
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getWebUiHtml());
      return;
    }

    // Vendored xterm.js assets (baked into dist/vendor at build time — offline-capable).
    if (url.pathname.startsWith('/vendor/xterm/')) {
      const name = url.pathname.slice('/vendor/xterm/'.length);
      const ALLOWED = new Set(['xterm.css', 'xterm.js', 'addon-fit.js', 'addon-web-links.js']);
      const file = vendorAssetPath(name);
      if (!ALLOWED.has(name) || !file) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const type = name.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8';
      res.writeHead(200, { 'Content-Type': type });
      fs.createReadStream(file).pipe(res);
      return;
    }

    if (url.pathname === '/api/models' && req.method === 'GET') {
      try {
        const localModels: Array<any> = [];
        const cloudModels: Array<any> = [];
        const env = readUserEnv();

        // 1. Probe local Ollama if available
        try {
          const ollamaModels = await fetchProviderModels({
            provider: 'ollama',
            baseUrl: process.env.OLLAMA_BASE_URL || env.OLLAMA_BASE_URL || engine.config.ollamaBaseUrl || 'http://localhost:11434/v1',
            timeoutMs: 1500,
          });
          if (ollamaModels && ollamaModels.length > 0) {
            ollamaModels.forEach((m) => localModels.push({ ...m, provider: 'ollama', isLocal: true, providerLabel: 'Ollama (Local)' }));
          }
        } catch {
          // ignore — Ollama not reachable, continue to other providers
        }

        // 2. Probe local LM Studio if available
        try {
          const lmModels = await fetchProviderModels({
            provider: 'lmstudio',
            baseUrl: process.env.LMSTUDIO_BASE_URL || env.LMSTUDIO_BASE_URL || engine.config.lmstudioBaseUrl || 'http://localhost:1234/v1',
            timeoutMs: 1500,
          });
          if (lmModels && lmModels.length > 0) {
            lmModels.forEach((m) => localModels.push({ ...m, provider: 'lmstudio', isLocal: true, providerLabel: 'LM Studio (Local)' }));
          }
        } catch {
          // ignore — LM Studio not reachable, continue to other providers
        }

        // 3. Probe cloud providers with configured keys (OpenRouter, Anthropic, OpenAI, Vercel, Cloudflare, Together, OpenCode)
        const openRouterKey = process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY || engine.config.openRouterApiKey;
        const openaiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || engine.config.openaiApiKey;
        const anthropicKey = process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || engine.config.anthropicApiKey;
        const vercelKey = process.env.VERCEL_API_KEY || env.VERCEL_API_KEY || engine.config.vercelApiKey;
        const cloudflareKey = process.env.CLOUDFLARE_API_KEY || env.CLOUDFLARE_API_KEY || engine.config.cloudflareApiKey;
        const togetherKey = process.env.TOGETHER_API_KEY || env.TOGETHER_API_KEY || engine.config.togetherApiKey;

        if (openRouterKey) {
          try {
            const cModels = await fetchProviderModels({
              provider: 'openrouter',
              apiKey: openRouterKey,
              baseUrl: engine.config.openRouterBaseUrl,
              timeoutMs: 4000,
            });
            if (cModels && cModels.length > 0) {
              cModels.forEach((m) => cloudModels.push({ ...m, provider: 'openrouter', isLocal: false, providerLabel: 'OpenRouter' }));
            }
          } catch {
            // ignore — OpenRouter probe failed (missing key / network), continue
          }
        }

        if (openaiKey) {
          try {
            const cModels = await fetchProviderModels({
              provider: 'openai',
              apiKey: openaiKey,
              baseUrl: engine.config.openaiBaseUrl,
              timeoutMs: 4000,
            });
            if (cModels && cModels.length > 0) {
              cModels.forEach((m) => cloudModels.push({ ...m, provider: 'openai', isLocal: false, providerLabel: 'OpenAI' }));
            }
          } catch {
            // ignore — OpenAI probe failed (missing key / network), continue
          }
        }

        if (anthropicKey) {
          try {
            const cModels = await fetchProviderModels({
              provider: 'anthropic',
              apiKey: anthropicKey,
              baseUrl: engine.config.anthropicBaseUrl,
              timeoutMs: 4000,
            });
            if (cModels && cModels.length > 0) {
              cModels.forEach((m) => cloudModels.push({ ...m, provider: 'anthropic', isLocal: false, providerLabel: 'Anthropic' }));
            }
          } catch {
            // ignore — Anthropic probe failed (missing key / network), continue
          }
        }

        if (vercelKey) {
          try {
            const cModels = await fetchProviderModels({
              provider: 'vercel',
              apiKey: vercelKey,
              baseUrl: engine.config.vercelBaseUrl,
              timeoutMs: 4000,
            });
            if (cModels && cModels.length > 0) {
              cModels.forEach((m) => cloudModels.push({ ...m, provider: 'vercel', isLocal: false, providerLabel: 'Vercel AI' }));
            }
          } catch {
            // ignore — Vercel probe failed
          }
        }

        if (cloudflareKey) {
          try {
            const cModels = await fetchProviderModels({
              provider: 'cloudflare',
              apiKey: cloudflareKey,
              baseUrl: engine.config.cloudflareBaseUrl,
              timeoutMs: 4000,
            });
            if (cModels && cModels.length > 0) {
              cModels.forEach((m) => cloudModels.push({ ...m, provider: 'cloudflare', isLocal: false, providerLabel: 'Cloudflare' }));
            }
          } catch {
            // ignore — Cloudflare probe failed
          }
        }

        if (togetherKey) {
          try {
            const cModels = await fetchProviderModels({
              provider: 'together',
              apiKey: togetherKey,
              baseUrl: engine.config.togetherBaseUrl,
              timeoutMs: 4000,
            });
            if (cModels && cModels.length > 0) {
              cModels.forEach((m) => cloudModels.push({ ...m, provider: 'together', isLocal: false, providerLabel: 'Together AI' }));
            }
          } catch {
            // ignore — Together probe failed
          }
        }

        const opencodeKey = process.env.OPENCODE_API_KEY || env.OPENCODE_API_KEY || engine.config.opencodeApiKey;
        if (opencodeKey) {
          try {
            const zModels = await fetchProviderModels({
              provider: 'opencode',
              apiKey: opencodeKey,
              baseUrl: engine.config.opencodeBaseUrl,
              timeoutMs: 4000,
            });
            if (zModels && zModels.length > 0) {
              zModels.forEach((m) => cloudModels.push({ ...m, provider: 'opencode', isLocal: false, providerLabel: 'OpenCode Zen' }));
            }
          } catch {
            // ignore — OpenCode Zen probe failed
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            activeModel,
            activeProvider: engine.config.provider,
            localModels,
            cloudModels,
            models: [...localModels, ...cloudModels],
          }),
        );
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (url.pathname === '/api/model' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.model) {
            updateActiveModel(String(json.model), json.provider);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, activeModel, provider: engine.config.provider }));
            return;
          }
        } catch {
          // ignore
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid model payload' }));
      });
      return;
    }

    if (url.pathname === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ provider: engine.config.provider, activeModel }));
      return;
    }

    if (url.pathname === '/api/files' && req.method === 'GET') {
      try {
        const root = process.cwd();
        const files = listWorkspaceFiles(root);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ root, files }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (url.pathname === '/api/file' && req.method === 'GET') {
      const filePath = url.searchParams.get('path');
      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'path parameter required' }));
        return;
      }
      const root = process.cwd();
      const resolved = path.resolve(root, filePath);
      if (!resolved.startsWith(root) || !fs.existsSync(resolved)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'file not found or outside workspace' }));
        return;
      }
      try {
        const content = fs.readFileSync(resolved, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(content);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (url.pathname === '/api/undo' && req.method === 'POST') {
      try {
        const { undoLast } = await import('@mugil-ide/core');
        const resUndo = undoLast(process.cwd());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: resUndo }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (url.pathname === '/api/diffs' && req.method === 'GET') {
      try {
        const { getRecordedEdits } = await import('@mugil-ide/core');
        const root = process.cwd();
        const edits = getRecordedEdits(root);
        const diffs = await Promise.all(
          edits.map(async (e) => {
            const beforeText = e.before.existed ? e.before.content : '';
            const afterText = e.after.existed ? e.after.content : '';
            const tooLarge =
              beforeText.split('\n').length > MAX_DIFF_LINES ||
              afterText.split('\n').length > MAX_DIFF_LINES ||
              beforeText.length > MAX_DIFF_CHARS ||
              afterText.length > MAX_DIFF_CHARS;
            // Bounded patch: never feed huge, dissimilar files to the diff
            // engine (worst case O(N·M) — it blocks the event loop and the
            // request appears to hang). The UI shows a skip notice instead.
            // In-cap patches run on a worker thread (see diffRunner.ts).
            const patch = tooLarge
              ? ''
              : await diffRunner.computePatch({
                  file1: `a/${e.rel}`,
                  file2: `b/${e.rel}`,
                  before: beforeText,
                  after: afterText,
                  header1: e.before.existed ? 'original' : 'created',
                  header2: e.after.existed ? 'modified' : 'deleted',
                });
            return {
              path: e.path,
              rel: e.rel,
              action: !e.before.existed ? 'created' : !e.after.existed ? 'deleted' : 'modified',
              skipped: tooLarge,
              before: tooLarge ? beforeText.slice(0, MAX_PREVIEW_CHARS) : beforeText,
              after: tooLarge ? afterText.slice(0, MAX_PREVIEW_CHARS) : afterText,
              patch,
            };
          }),
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, diffs }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (url.pathname === '/api/keys' && req.method === 'GET') {
      try {
        const { readUserEnv } = await import('@mugil-ide/core');
        const { PROVIDERS, maskKey } = await import('../providers.js');
        const env = readUserEnv();
        const providers = PROVIDERS.map((p) => {
          const keyVal = env[p.keyVar] || process.env[p.keyVar] || '';
          const baseVal = p.baseVar ? env[p.baseVar] || process.env[p.baseVar] || '' : undefined;
          return {
            id: p.id,
            label: p.label,
            url: p.url,
            keyVar: p.keyVar,
            baseVar: p.baseVar,
            custom: p.custom,
            isConfigured: Boolean(keyVal || baseVal),
            maskedKey: keyVal ? maskKey(keyVal) : '',
            baseUrl: baseVal || '',
          };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ providers }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (url.pathname === '/api/keys' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const { writeUserEnv } = await import('@mugil-ide/core');
          const json = JSON.parse(body);
          const { keyVar, value, baseVar, baseUrl, provider } = json;
          const toSave: Record<string, string> = {};
          if (keyVar && value) {
            toSave[keyVar] = value;
            process.env[keyVar] = value;
            if (keyVar === 'OPENROUTER_API_KEY') engine.config.openRouterApiKey = value;
            if (keyVar === 'OPENAI_API_KEY') engine.config.openaiApiKey = value;
            if (keyVar === 'ANTHROPIC_API_KEY') engine.config.anthropicApiKey = value;
          }
          if (baseVar && baseUrl) {
            toSave[baseVar] = baseUrl;
            process.env[baseVar] = baseUrl;
            if (baseVar === 'OPENROUTER_BASE_URL') engine.config.openRouterBaseUrl = baseUrl;
            if (baseVar === 'OPENAI_BASE_URL') engine.config.openaiBaseUrl = baseUrl;
            if (baseVar === 'ANTHROPIC_BASE_URL') engine.config.anthropicBaseUrl = baseUrl;
            if (baseVar === 'OLLAMA_BASE_URL') engine.config.ollamaBaseUrl = baseUrl;
            if (baseVar === 'LMSTUDIO_BASE_URL') engine.config.lmstudioBaseUrl = baseUrl;
            if (baseVar === 'VERCEL_BASE_URL') engine.config.vercelBaseUrl = baseUrl;
            if (baseVar === 'CLOUDFLARE_BASE_URL') engine.config.cloudflareBaseUrl = baseUrl;
            if (baseVar === 'TOGETHER_BASE_URL') engine.config.togetherBaseUrl = baseUrl;
            if (baseVar === 'OPENCODE_BASE_URL') engine.config.opencodeBaseUrl = baseUrl;
          }
          if (provider) {
            toSave.AI_PROVIDER = provider;
            process.env.AI_PROVIDER = provider;
            engine.config.provider = provider;
          }
          const savedFile = writeUserEnv(toSave);
          engine.reconfigure({
            ...engine.config,
            ...(toSave.OPENROUTER_API_KEY ? { openRouterApiKey: toSave.OPENROUTER_API_KEY } : {}),
            ...(toSave.OPENAI_API_KEY ? { openaiApiKey: toSave.OPENAI_API_KEY } : {}),
            ...(toSave.ANTHROPIC_API_KEY ? { anthropicApiKey: toSave.ANTHROPIC_API_KEY } : {}),
            ...(toSave.VERCEL_API_KEY ? { vercelApiKey: toSave.VERCEL_API_KEY } : {}),
            ...(toSave.CLOUDFLARE_API_KEY ? { cloudflareApiKey: toSave.CLOUDFLARE_API_KEY } : {}),
            ...(toSave.TOGETHER_API_KEY ? { togetherApiKey: toSave.TOGETHER_API_KEY } : {}),
            ...(toSave.OPENCODE_API_KEY ? { opencodeApiKey: toSave.OPENCODE_API_KEY } : {}),
            ...(toSave.AI_PROVIDER ? { provider: toSave.AI_PROVIDER as any } : {}),
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, savedFile }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
      return;
    }

    if (url.pathname === '/api/graph' && req.method === 'GET') {
      try {
        const { buildCodeGraph } = await import('@mugil-ide/core');
        const graph = buildCodeGraph(process.cwd());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(graph));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (url.pathname === '/api/graph/query' && req.method === 'GET') {
      try {
        const query = url.searchParams.get('q') || '';
        const { buildCodeGraph, queryCodeGraph } = await import('@mugil-ide/core');
        const graph = buildCodeGraph(process.cwd());
        const results = queryCodeGraph(graph, query, { top: 15 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results, stats: graph.stats }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (url.pathname === '/api/modules' && req.method === 'GET') {
      try {
        const { UpdateManager } = await import('@mugil-ide/core');
        const updater = new UpdateManager();
        const checkResult = await updater.check();
        const modules = [
          {
            id: 'caveman',
            name: 'Caveman',
            role: 'Terse Prompt Refinement (-65% tokens)',
            project: 'JuliusBrussee/caveman',
            url: 'https://github.com/JuliusBrussee/caveman',
            version: updater.localVersion('caveman') || '1.0.0',
            status: 'Active',
            savingsStrategy: 'Strips fluff and redundant qualifiers while preserving full technical semantics.',
          },
          {
            id: 'rtk',
            name: 'RTK (Reduced Token Kernel)',
            role: 'Command & Tool Output Compression (-60-90% tokens)',
            project: 'rtk-ai/rtk',
            url: 'https://github.com/rtk-ai/rtk',
            version: updater.localVersion('rtk') || '1.0.0',
            status: 'Active',
            savingsStrategy: 'Deduplicates diffs, collapses duplicate log lines, and compresses shell outputs.',
          },
          {
            id: 'ponytail',
            name: 'Ponytail',
            role: 'Output Minimization & YAGNI Ladder (-54% code output)',
            project: 'DietrichGebert/ponytail',
            url: 'https://github.com/DietrichGebert/ponytail',
            version: updater.localVersion('ponytail') || '1.0.0',
            status: 'Active',
            savingsStrategy: 'Prevents speculative abstractions, enforces standard library reuse and minimal surgical edits.',
          },
          {
            id: 'signature-remover',
            name: 'Signature Remover',
            role: 'AI Preamble & Watermark Stripping',
            project: 'conorbronsdon/avoid-ai-writing',
            url: 'https://github.com/conorbronsdon/avoid-ai-writing',
            version: updater.localVersion('signature-remover') || '1.0.0',
            status: 'Active',
            savingsStrategy: 'Removes ChatGPT/Claude persona preambles and generated attribution comments.',
          },
          {
            id: 'watermark-remover',
            name: 'Watermark Remover',
            role: 'Zero-Width Unicode Provenance Stripper',
            project: 'guillaumemeyer/watermarks-remover',
            url: 'https://github.com/guillaumemeyer/watermarks-remover',
            version: updater.localVersion('watermark-remover') || '1.0.0',
            status: 'Active',
            savingsStrategy: 'Strips zero-width spaces, bidi overrides, and synthetic sampling watermarks.',
          },
          {
            id: 'codegraph',
            name: 'CodeGraph',
            role: 'Single-Call Codebase Knowledge Graph',
            project: 'colbymchenry/codegraph',
            url: 'https://github.com/colbymchenry/codegraph',
            version: updater.localVersion('codegraph') || '1.0.0',
            status: 'Active',
            savingsStrategy: 'Pre-indexes symbols, call hierarchies, and imports to eliminate blind file-reading grep loops.',
          },
          {
            id: 'opencode-runtime',
            name: 'OpenCode Agent Runtime',
            role: 'Agentic Tool Loop & Multi-Turn History Budgeting',
            project: 'sst/opencode',
            url: 'https://github.com/sst/opencode',
            version: '1.18.18',
            status: 'Active',
            savingsStrategy: '3000-token sliding window history compaction to prevent context explosion across long sessions.',
          },
          {
            id: 'smart-cache',
            name: 'Smart Cache',
            role: 'Exact, Partial & Semantic Cache (100% savings on hit)',
            project: 'OpenAI Embeddings / Redis',
            url: 'https://redis.io',
            version: '1.0.0',
            status: 'Active',
            savingsStrategy: 'Zero-cost instant retrieval for repeated query patterns and subagent tools.',
          },
        ];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ modules, checkResult }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (url.pathname === '/api/modules/update' && req.method === 'POST') {
      try {
        const { UpdateManager } = await import('@mugil-ide/core');
        const updater = new UpdateManager();
        const checkResult = await updater.check();
        const applied = await updater.apply(checkResult.updates);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, applied, updates: checkResult.updates, npm: checkResult.npm }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '/', `http://${request.headers.host}`);
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', async (ws: WebSocket) => {
    let inputBuffer = '';
    let ptySession: PtyInstance | null = null;

    // Mid-task `question` tool round-trip: server asks → browser picks → answer.
    const questionResolvers = new Map<number, { resolve: (answer: string) => void; timer: NodeJS.Timeout }>();
    let questionSeq = 0;
    // 120s default; overridable so the browser smoke can exercise the timeout
    // path in seconds instead of minutes.
    const questionTimeoutRaw = Number(process.env.MUGIL_IDE_QUESTION_TIMEOUT_MS ?? 120_000);
    const QUESTION_TIMEOUT_MS = Number.isFinite(questionTimeoutRaw) && questionTimeoutRaw > 0 ? questionTimeoutRaw : 120_000;

    // Tool-permission approval round-trip: `ask`-gated call → browser modal → allow/deny.
    const approvalResolvers = new Map<number, { resolve: (granted: boolean) => void; timer: NodeJS.Timeout }>();
    let approvalSeq = 0;
    const APPROVAL_TIMEOUT_MS = 120_000;

    // Send data to frontend
    const sendAgentData = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'agent_data', data }));
      }
    };

    const sendPtyData = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pty_data', data }));
      }
    };

    const sendStatus = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'status',
            activeModel: repl.getActiveModel(),
            mode: repl.getMode(),
            stats: {
              ...repl.stats,
              filesModified: Array.from(repl.stats.filesModified),
            },
          }),
        );
      }
    };

    const repl = new AgentRepl(
      engine,
      {
        write: (d) => {
          sendAgentData(d);
          sendStatus();
        },
        onExit: () => {
          ws.close();
        },
        onTurnComplete: (turn) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'turn_complete', turn }));
          }
          sendStatus();
        },
        onModelChange: (m, prov) => {
          updateActiveModel(m, prov);
          sendStatus();
        },
      },
      activeModel,
      {
        onQuestion: async (q) => {
          const id = ++questionSeq;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({ type: 'question', id, header: q.header, question: q.question, options: q.options }),
            );
          }
          return new Promise<string>((resolve) => {
            const timer = setTimeout(() => {
              // Never hang the tool loop on an unanswered picker.
              if (questionResolvers.delete(id)) resolve('(dismissed — no answer provided)');
            }, QUESTION_TIMEOUT_MS);
            questionResolvers.set(id, { resolve, timer });
          });
        },
        onAsk: async (call) => {
          const id = ++approvalSeq;
          if (ws.readyState === WebSocket.OPEN) {
            let args: string;
            try {
              args = JSON.stringify(JSON.parse(call.arguments), null, 2);
            } catch {
              args = call.arguments;
            }
            ws.send(JSON.stringify({ type: 'approval', id, tool: call.name, args }));
          }
          return new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
              // Never hang the tool loop on an unanswered approval — deny.
              if (approvalResolvers.delete(id)) resolve(false);
            }, APPROVAL_TIMEOUT_MS);
            approvalResolvers.set(id, { resolve, timer });
          });
        },
      },
    );

    // Lazy PTY for the Shell pane: the shell process only spawns on first use
    // (the browser sends resize_pty when the shell tab is activated, and
    // pty_input on keystrokes) instead of on every connection. This avoids
    // spawning a shell per session and keeps node-pty teardown quirks out of
    // idle connections. Concurrent triggers share one spawn promise.
    let ptyStartPromise: Promise<void> | null = null;
    function startPty(cols?: number, rows?: number): Promise<void> {
      if (!ptyStartPromise) {
        ptyStartPromise = (async () => {
          try {
            ptySession = await createPtySession(cols !== undefined && rows !== undefined ? { cols, rows } : undefined);
            ptySession.onData((data) => sendPtyData(data));
            ptySession.onExit((code) => {
              sendPtyData(`\r\n[Process completed with code ${code}]\r\n`);
            });
          } catch (err) {
            sendPtyData(`\r\n[Failed to start PTY shell: ${err instanceof Error ? err.message : String(err)}]\r\n`);
          }
        })();
      }
      return ptyStartPromise;
    }

    // Print welcome banner in Agent terminal
    repl.printBanner();
    sendStatus();

    ws.on('message', async (messageRaw) => {
      try {
        const msg = JSON.parse(messageRaw.toString());

        if (msg.type === 'set_model') {
          const newModel = String(msg.model);
          repl.setActiveModel(newModel, msg.provider);
          updateActiveModel(newModel, msg.provider);
          sendAgentData(`\r\n\x1b[32m✓\x1b[0m Active model changed to: \x1b[1m\x1b[36m${newModel}\x1b[0m${engine.config.provider ? ` \x1b[2m(${engine.config.provider})\x1b[0m` : ''}\r\n\r\n`);
          repl.printPrompt();
          sendStatus();
        } else if (msg.type === 'set_mode') {
          const newMode = msg.mode === 'plan' ? 'plan' : 'act';
          repl.setMode(newMode);
          // Persist to user env file so the mode survives restarts.
          try {
            writeUserEnv({ MUGIL_IDE_MODE: newMode });
          } catch {
            // ignore — persistence is best-effort
          }
          sendAgentData(`\r\n\x1b[32m✓\x1b[0m Mode changed to: \x1b[1m\x1b[33m${newMode}\x1b[0m\r\n\r\n`);
          repl.printPrompt();
          sendStatus();
        } else if (msg.type === 'question_answer') {
          const entry = questionResolvers.get(Number(msg.id));
          if (entry) {
            clearTimeout(entry.timer);
            questionResolvers.delete(Number(msg.id));
            entry.resolve(String(msg.answer ?? ''));
          }
        } else if (msg.type === 'approval_answer') {
          const entry = approvalResolvers.get(Number(msg.id));
          if (entry) {
            clearTimeout(entry.timer);
            approvalResolvers.delete(Number(msg.id));
            entry.resolve(msg.granted !== false);
          }
        } else if (msg.type === 'agent_input') {
          const rawData: string = msg.data || '';

          // If a full command string was sent (e.g. from quick input or modal)
          if (rawData.includes('\r') || rawData.includes('\n')) {
            const cleanText = rawData.replace(/[\r\n]+$/, '');
            const fullLine = inputBuffer + cleanText;
            inputBuffer = '';
            sendAgentData(cleanText + '\r\n');
            await repl.handleInput(fullLine);
            sendStatus();
            return;
          }

          // Handle single character inputs from xterm.js
          const char = rawData;
          // Handle Enter / Return
          if (char === '\r' || char === '\n') {
            sendAgentData('\r\n');
            const lineToRun = inputBuffer;
            inputBuffer = '';
            await repl.handleInput(lineToRun);
            sendStatus();
          }
          // Handle Backspace (\x7f or \x08)
          else if (char === '\x7f' || char === '\x08') {
            if (inputBuffer.length > 0) {
              inputBuffer = inputBuffer.slice(0, -1);
              sendAgentData('\b \b');
            }
          }
          // Handle Ctrl+C (\x03)
          else if (char === '\x03') {
            inputBuffer = '';
            sendAgentData('^C\r\n');
            repl.printPrompt();
          }
          // Handle normal printable characters
          else if (char >= ' ' || char === '\t') {
            inputBuffer += char;
            sendAgentData(char);
          }
        } else if (msg.type === 'pty_input') {
          if (msg.data) {
            await startPty();
            ptySession?.write(msg.data);
          }
        } else if (msg.type === 'resize_pty') {
          if (msg.cols && msg.rows) {
            await startPty(Number(msg.cols), Number(msg.rows));
            ptySession?.resize(Number(msg.cols), Number(msg.rows));
          }
        }
      } catch {
        // Raw string input fallback
        const str = messageRaw.toString();
        if (!ptySession) await startPty();
        ptySession?.write(str);
      }
    });

    ws.on('close', () => {
      repl.stopLogoAnimation();
      void repl.dispose(); // close MCP stdio children
      if (ptySession) {
        ptySession.kill();
        ptySession = null;
      }
      // Clear any pending question/approval timers so nothing keeps the loop alive.
      for (const entry of questionResolvers.values()) clearTimeout(entry.timer);
      for (const entry of approvalResolvers.values()) clearTimeout(entry.timer);
      questionResolvers.clear();
      approvalResolvers.clear();
    });
  });

  const desiredPort = options.port || Number(process.env.PORT || 3000);
  const host = options.host || 'localhost';

  return new Promise<RunningServer>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && !options.port) {
        // Try random available port
        server.listen(0, host);
      } else {
        reject(err);
      }
    });

    server.listen(desiredPort, host, () => {
      const addr = server.address() as AddressInfo;
      const actualPort = addr.port;
      const url = `http://${host}:${actualPort}`;
      resolve({
        port: actualPort,
        url,
        close: () =>
          new Promise<void>((res) => {
            wss.close();
            diffRunner.dispose();
            // Close keep-alive client connections (e.g. undici fetch pools) so
            // server.close() doesn't wait on idle sockets.
            server.closeIdleConnections?.();
            server.close(() => res());
          }),
      });
    });
  });
}
