import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import type { Engine } from '@mugil-ide/core';
import { fetchProviderModels, readUserEnv, saveMode, writeUserEnv } from '@mugil-ide/core';
import { getWebUiHtml } from './html.js';
import { EMBEDDED_VENDOR_ASSETS } from './embeddedVendor.js';
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

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function isValidProviderBaseUrl(baseVar: string, urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (isLoopbackHost(host)) return true;

    if (baseVar === 'OLLAMA_BASE_URL' || baseVar === 'LMSTUDIO_BASE_URL') {
      return false;
    }

    const DOMAIN_MAP: Record<string, string[]> = {
      OPENAI_BASE_URL: ['api.openai.com', 'openai.com'],
      ANTHROPIC_BASE_URL: ['api.anthropic.com', 'anthropic.com'],
      OPENROUTER_BASE_URL: ['openrouter.ai'],
      VERCEL_BASE_URL: ['vercel.dev', 'vercel.com'],
      CLOUDFLARE_BASE_URL: ['api.cloudflare.com', 'cloudflare.com', 'gateway.ai.cloudflare.com'],
      TOGETHER_BASE_URL: ['together.xyz', 'together.ai'],
      OPENCODE_BASE_URL: ['opencode.ai'],
    };

    const allowedDomains = DOMAIN_MAP[baseVar];
    if (!allowedDomains) return false;
    return allowedDomains.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

function isSystemDirectory(dirPath: string): boolean {
  const resolved = path.resolve(dirPath);
  const root = path.parse(resolved).root;
  if (resolved.toLowerCase() === root.toLowerCase()) return true;
  const lower = resolved.toLowerCase();
  const systemDirs = [
    'c:\\windows',
    'c:\\program files',
    'c:\\program files (x86)',
    '/etc',
    '/bin',
    '/sbin',
    '/usr',
    '/var',
    '/sys',
    '/proc',
    '/dev',
  ];
  return systemDirs.some((sys) => lower === sys || lower.startsWith(sys + path.sep));
}

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
  tokenUrl: string;
  token: string;
  close: () => Promise<void>;
}

export async function startIdeServer(options: ServerOptions): Promise<RunningServer> {
  const { engine, model: initialModel } = options;
  // Diffs are computed on a worker thread so a slow (O(N·M) worst-case) patch
  // never blocks the event loop for other requests. Disposed in close().
  const diffRunner = createDiffRunner();
  const sessionToken = process.env.MUGIL_IDE_AUTH_TOKEN || crypto.randomBytes(24).toString('hex');
  const tokenDir = path.join(os.homedir(), '.config', 'mugil-ide');
  const tokenFile = path.join(tokenDir, 'session.token');
  try {
    fs.mkdirSync(tokenDir, { recursive: true });
    fs.writeFileSync(tokenFile, sessionToken, { mode: 0o600 });
  } catch {
    // best-effort token persistence
  }

  function readJsonBody(req: http.IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<any> {
    return new Promise((resolve, reject) => {
      let size = 0;
      let body = '';
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new Error(`Payload too large: exceeds ${maxBytes} bytes ceiling`));
          reject(new Error(`Payload too large: exceeds ${maxBytes} bytes ceiling`));
          return;
        }
        body += chunk;
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  }
  const userEnv = readUserEnv();
  let turboMode = process.env.MUGIL_IDE_TURBO_MODE === '1' || process.env.MUGIL_IDE_TURBO_MODE === 'true';
  let activeModel = initialModel || process.env.MUGIL_IDE_MODEL || userEnv.MUGIL_IDE_MODEL || (engine.config.models && engine.config.models[0]?.id) || 'openrouter/auto';
  let probedModelsCache: Array<any> = [];
  let activeRepl: AgentRepl | null = null;
  const updateActiveModel = (newModel: string, newProvider?: string) => {
    activeModel = newModel;
    const providerToSet = newProvider || engine.config.provider;
    if (providerToSet && providerToSet !== engine.config.provider) {
      engine.reconfigure({ ...engine.config, provider: providerToSet as any });
    }
    if (activeRepl && probedModelsCache.length > 0) {
      activeRepl.setAvailableModels(probedModelsCache);
    }
    try {
      writeUserEnv({ MUGIL_IDE_MODEL: newModel, ...(providerToSet ? { AI_PROVIDER: providerToSet } : {}) });
    } catch {
      // ignore — model selection still applies for this session; persistence is best-effort
    }
  };

  function isOriginAllowed(originHeader?: string | string[]): boolean {
    if (!originHeader) return true; // Direct non-browser clients (CLI/curl/tests) have no Origin header
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', options.host || 'localhost']);
      return allowedHosts.has(parsed.hostname);
    } catch {
      return false;
    }
  }

  function isAuthorized(req: http.IncomingMessage, url: URL): boolean {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ') && authHeader.slice(7) === sessionToken) {
      return true;
    }
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/mugil_session=([a-zA-Z0-9_-]+)/);
      if (match && match[1] === sessionToken) {
        return true;
      }
    }
    const customHeader = req.headers['x-mugil-token'];
    if (customHeader && (Array.isArray(customHeader) ? customHeader[0] : customHeader) === sessionToken) {
      return true;
    }
    const tokenQuery = url.searchParams.get('token');
    if (tokenQuery && tokenQuery === sessionToken) {
      return true;
    }
    return false;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Auth check for /api/* requests
    if (url.pathname.startsWith('/api/') && !isAuthorized(req, url)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: valid session token required' }));
      return;
    }

    // Origin check for state-changing /api/* requests
    if (url.pathname.startsWith('/api/') && req.method !== 'GET' && !isOriginAllowed(req.headers.origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: invalid origin' }));
      return;
    }

    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (!isAuthorized(req, url)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: valid session token or cookie required' }));
        return;
      }

      const tokenQuery = url.searchParams.get('token');
      const setCookie = tokenQuery && tokenQuery === sessionToken
        ? { 'Set-Cookie': `mugil_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/` }
        : {};

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'self' 'unsafe-inline'; connect-src 'self' ws: http:; img-src 'self' data: https:;",
        ...setCookie,
      });
      res.end(getWebUiHtml());
      return;
    }

    // Vendored xterm.js assets (embedded directly into binary for 100% self-contained standalone execution).
    if (url.pathname.startsWith('/vendor/xterm/')) {
      const name = url.pathname.slice('/vendor/xterm/'.length);
      const ALLOWED = new Set(['xterm.css', 'xterm.js', 'addon-fit.js', 'addon-web-links.js']);
      if (!ALLOWED.has(name)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const type = name.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8';
      res.writeHead(200, { 'Content-Type': type });
      if (EMBEDDED_VENDOR_ASSETS[name]) {
        res.end(EMBEDDED_VENDOR_ASSETS[name]);
        return;
      }
      const file = vendorAssetPath(name);
      if (file && fs.existsSync(file)) {
        fs.createReadStream(file).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end('not found');
      return;
    }

    if (url.pathname === '/api/models' && req.method === 'GET') {
      try {
        const localModels: Array<any> = [];
        const cloudModels: Array<any> = [];
        const env = readUserEnv();

        const openRouterKey = process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY || engine.config.openRouterApiKey;
        const openaiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || engine.config.openaiApiKey;
        const anthropicKey = process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || engine.config.anthropicApiKey;
        const vercelKey = process.env.VERCEL_API_KEY || env.VERCEL_API_KEY || engine.config.vercelApiKey;
        const cloudflareKey = process.env.CLOUDFLARE_API_KEY || env.CLOUDFLARE_API_KEY || engine.config.cloudflareApiKey;
        const togetherKey = process.env.TOGETHER_API_KEY || env.TOGETHER_API_KEY || engine.config.togetherApiKey;
        const opencodeKey = process.env.OPENCODE_API_KEY || env.OPENCODE_API_KEY || engine.config.opencodeApiKey;

        // Run provider probes concurrently with Promise.allSettled
        const probes: Array<Promise<{ isLocal: boolean; models: any[] }>> = [
          fetchProviderModels({
            provider: 'ollama',
            baseUrl: process.env.OLLAMA_BASE_URL || env.OLLAMA_BASE_URL || engine.config.ollamaBaseUrl || 'http://localhost:11434/v1',
            timeoutMs: 1500,
          }).then((m) => ({
            isLocal: true,
            models: (m || []).map((x) => ({ ...x, provider: 'ollama', isLocal: true, providerLabel: 'Ollama (Local)' })),
          })).catch(() => ({ isLocal: true, models: [] })),

          fetchProviderModels({
            provider: 'lmstudio',
            baseUrl: process.env.LMSTUDIO_BASE_URL || env.LMSTUDIO_BASE_URL || engine.config.lmstudioBaseUrl || 'http://localhost:1234/v1',
            timeoutMs: 1500,
          }).then((m) => ({
            isLocal: true,
            models: (m || []).map((x) => ({ ...x, provider: 'lmstudio', isLocal: true, providerLabel: 'LM Studio (Local)' })),
          })).catch(() => ({ isLocal: true, models: [] })),

          openRouterKey ? fetchProviderModels({
            provider: 'openrouter',
            apiKey: openRouterKey,
            baseUrl: engine.config.openRouterBaseUrl,
            timeoutMs: 4000,
          }).then((m) => ({
            isLocal: false,
            models: (m || []).map((x) => ({ ...x, provider: 'openrouter', isLocal: false, providerLabel: 'OpenRouter' })),
          })).catch(() => ({ isLocal: false, models: [] })) : Promise.resolve({ isLocal: false, models: [] }),

          openaiKey ? fetchProviderModels({
            provider: 'openai',
            apiKey: openaiKey,
            baseUrl: engine.config.openaiBaseUrl,
            timeoutMs: 4000,
          }).then((m) => ({
            isLocal: false,
            models: (m || []).map((x) => ({ ...x, provider: 'openai', isLocal: false, providerLabel: 'OpenAI' })),
          })).catch(() => ({ isLocal: false, models: [] })) : Promise.resolve({ isLocal: false, models: [] }),

          anthropicKey ? fetchProviderModels({
            provider: 'anthropic',
            apiKey: anthropicKey,
            baseUrl: engine.config.anthropicBaseUrl,
            timeoutMs: 4000,
          }).then((m) => ({
            isLocal: false,
            models: (m || []).map((x) => ({ ...x, provider: 'anthropic', isLocal: false, providerLabel: 'Anthropic' })),
          })).catch(() => ({ isLocal: false, models: [] })) : Promise.resolve({ isLocal: false, models: [] }),

          vercelKey ? fetchProviderModels({
            provider: 'vercel',
            apiKey: vercelKey,
            baseUrl: engine.config.vercelBaseUrl,
            timeoutMs: 4000,
          }).then((m) => ({
            isLocal: false,
            models: (m || []).map((x) => ({ ...x, provider: 'vercel', isLocal: false, providerLabel: 'Vercel AI' })),
          })).catch(() => ({ isLocal: false, models: [] })) : Promise.resolve({ isLocal: false, models: [] }),

          cloudflareKey ? fetchProviderModels({
            provider: 'cloudflare',
            apiKey: cloudflareKey,
            baseUrl: engine.config.cloudflareBaseUrl,
            timeoutMs: 4000,
          }).then((m) => ({
            isLocal: false,
            models: (m || []).map((x) => ({ ...x, provider: 'cloudflare', isLocal: false, providerLabel: 'Cloudflare' })),
          })).catch(() => ({ isLocal: false, models: [] })) : Promise.resolve({ isLocal: false, models: [] }),

          togetherKey ? fetchProviderModels({
            provider: 'together',
            apiKey: togetherKey,
            baseUrl: engine.config.togetherBaseUrl,
            timeoutMs: 4000,
          }).then((m) => ({
            isLocal: false,
            models: (m || []).map((x) => ({ ...x, provider: 'together', isLocal: false, providerLabel: 'Together AI' })),
          })).catch(() => ({ isLocal: false, models: [] })) : Promise.resolve({ isLocal: false, models: [] }),

          opencodeKey ? fetchProviderModels({
            provider: 'opencode',
            apiKey: opencodeKey,
            baseUrl: engine.config.opencodeBaseUrl,
            timeoutMs: 4000,
          }).then((m) => ({
            isLocal: false,
            models: (m || []).map((x) => ({ ...x, provider: 'opencode', isLocal: false, providerLabel: 'OpenCode Zen' })),
          })).catch(() => ({ isLocal: false, models: [] })) : Promise.resolve({ isLocal: false, models: [] }),
        ];

        const settled = await Promise.allSettled(probes);
        for (const res of settled) {
          if (res.status === 'fulfilled') {
            if (res.value.isLocal) {
              localModels.push(...res.value.models);
            } else {
              cloudModels.push(...res.value.models);
            }
          }
        }

        const combinedModels = [...localModels, ...cloudModels];
        probedModelsCache = combinedModels;
        if (activeRepl) {
          activeRepl.setAvailableModels(combinedModels);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            activeModel,
            activeProvider: engine.config.provider,
            localModels,
            cloudModels,
            models: combinedModels,
          }),
        );
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (url.pathname === '/api/model' && req.method === 'POST') {
      try {
        const json = await readJsonBody(req);
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
      return;
    }

    if (url.pathname === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ provider: engine.config.provider, activeModel }));
      return;
    }

    if (url.pathname === '/api/fs/browse' && req.method === 'GET') {
      try {
        const os = await import('os');
        const queryPath = url.searchParams.get('path');
        let targetDir = queryPath ? path.resolve(queryPath) : process.cwd();
        if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
          targetDir = os.homedir();
        }

        const entries: Array<{ name: string; path: string }> = [];
        try {
          const dirEntries = fs.readdirSync(targetDir, { withFileTypes: true });
          for (const d of dirEntries) {
            if (d.isDirectory() && !d.name.startsWith('.')) {
              entries.push({ name: d.name, path: path.join(targetDir, d.name) });
            }
          }
          entries.sort((a, b) => a.name.localeCompare(b.name));
        } catch {
          // ignore permission errors
        }

        const parent = path.dirname(targetDir);
        const hasParent = parent !== targetDir;

        // Quick shortcuts
        const shortcuts: Array<{ label: string; path: string }> = [
          { label: 'Home', path: os.homedir() },
          { label: 'Desktop', path: path.join(os.homedir(), 'Desktop') },
          { label: 'Documents', path: path.join(os.homedir(), 'Documents') },
          { label: 'Downloads', path: path.join(os.homedir(), 'Downloads') },
        ].filter((s) => fs.existsSync(s.path));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            current: targetDir,
            parent: hasParent ? parent : null,
            dirs: entries,
            shortcuts,
          }),
        );
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (url.pathname === '/api/workspace' && req.method === 'POST') {
      try {
        const json = await readJsonBody(req);
        if (json.path && typeof json.path === 'string') {
          const target = path.resolve(json.path.trim());
          if (isSystemDirectory(target)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Access denied: cannot select system directory as workspace' }));
            return;
          }
          let created = false;
          if (!fs.existsSync(target) && json.create) {
            fs.mkdirSync(target, { recursive: true });
            created = true;
          }
          if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
            process.chdir(target);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, root: process.cwd(), created }));
            return;
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Directory does not exist' }));
            return;
          }
        }
      } catch {
        // ignore
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid directory path' }));
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
      const root = path.resolve(process.cwd());
      const resolved = path.resolve(root, filePath);
      const rel = path.relative(root, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(resolved)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'file not found or outside workspace' }));
        return;
      }
      try {
        const realRoot = fs.realpathSync(root);
        const realTarget = fs.realpathSync(resolved);
        const realRel = path.relative(realRoot, realTarget);
        if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden: file outside workspace via symlink' }));
          return;
        }
      } catch {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'file not found' }));
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
      try {
        const { writeUserEnv } = await import('@mugil-ide/core');
        const json = await readJsonBody(req);
        const { keyVar, value, baseVar, baseUrl, provider } = json;

        const ALLOWED_KEY_VARS = new Set([
          'OPENROUTER_API_KEY',
          'OPENAI_API_KEY',
          'ANTHROPIC_API_KEY',
          'VERCEL_API_KEY',
          'CLOUDFLARE_API_KEY',
          'CLOUDFLARE_ACCOUNT_ID',
          'TOGETHER_API_KEY',
          'OPENCODE_API_KEY',
        ]);
        const ALLOWED_BASE_VARS = new Set([
          'OPENROUTER_BASE_URL',
          'OPENAI_BASE_URL',
          'ANTHROPIC_BASE_URL',
          'OLLAMA_BASE_URL',
          'LMSTUDIO_BASE_URL',
          'VERCEL_BASE_URL',
          'CLOUDFLARE_BASE_URL',
          'TOGETHER_BASE_URL',
          'OPENCODE_BASE_URL',
        ]);

        if (keyVar && !ALLOWED_KEY_VARS.has(keyVar)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unauthorized environment key variable: ${keyVar}` }));
          return;
        }
        if (baseVar && !ALLOWED_BASE_VARS.has(baseVar)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unauthorized environment base variable: ${baseVar}` }));
          return;
        }

        // Validate baseUrl format and destination domain
        if (baseVar && baseUrl) {
          if (!isValidProviderBaseUrl(baseVar, baseUrl)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: `Disallowed Base URL for ${baseVar}: host is not recognized as a valid provider endpoint or loopback`,
              }),
            );
            return;
          }
        }

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

    if (url.pathname === '/api/config' && req.method === 'GET') {
      const { getHistoryBudget, getMaxHistoryTurns, getMaxOutputTokens, getMaxToolIterations, getThinkingLevel } = await import('@mugil-ide/core');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          historyBudget: getHistoryBudget(),
          maxTurns: getMaxHistoryTurns(),
          maxOutputTokens: getMaxOutputTokens(),
          maxToolIterations: getMaxToolIterations(),
          webfetchEnabled: process.env.MUGIL_IDE_ENABLE_WEBFETCH !== '0' && process.env.MUGIL_IDE_ENABLE_WEBFETCH !== 'false',
          turboMode,
          thinkingLevel: getThinkingLevel(),
        }),
      );
      return;
    }

    if (url.pathname === '/api/config' && req.method === 'POST') {
      try {
        const data = (await readJsonBody(req)) as {
          historyBudget?: number;
          maxTurns?: number;
          maxOutputTokens?: number;
          maxToolIterations?: number;
          webfetchEnabled?: boolean;
          turboMode?: boolean;
          thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
        };
        if (typeof data.historyBudget === 'number' && data.historyBudget > 0) {
          process.env.MUGIL_IDE_TOKEN_LIMIT = String(Math.floor(data.historyBudget));
          process.env.MUGIL_IDE_HISTORY_BUDGET = String(Math.floor(data.historyBudget));
        }
        if (typeof data.maxTurns === 'number' && data.maxTurns > 0) {
          process.env.MUGIL_IDE_MAX_TURNS = String(Math.floor(data.maxTurns));
        }
        if (typeof data.maxOutputTokens === 'number' && data.maxOutputTokens > 0) {
          process.env.MUGIL_IDE_MAX_OUTPUT_TOKENS = String(Math.floor(data.maxOutputTokens));
        }
        if (typeof data.maxToolIterations === 'number' && data.maxToolIterations > 0) {
          process.env.MUGIL_IDE_MAX_TOOL_ITERATIONS = String(Math.floor(data.maxToolIterations));
        }
        if (typeof data.webfetchEnabled === 'boolean') {
          process.env.MUGIL_IDE_ENABLE_WEBFETCH = data.webfetchEnabled ? '1' : '0';
        }
        if (typeof data.turboMode === 'boolean') {
          turboMode = data.turboMode;
          process.env.MUGIL_IDE_TURBO_MODE = turboMode ? '1' : '0';
        }
        if (data.thinkingLevel && ['off', 'low', 'medium', 'high'].includes(data.thinkingLevel)) {
          process.env.MUGIL_IDE_THINKING_LEVEL = data.thinkingLevel;
          try { const { writeUserEnv } = await import('@mugil-ide/core'); writeUserEnv({ MUGIL_IDE_THINKING_LEVEL: data.thinkingLevel }); } catch { /* ignore */ }
        }
        const { getHistoryBudget, getMaxHistoryTurns, getMaxOutputTokens, getMaxToolIterations, getThinkingLevel } = await import('@mugil-ide/core');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            historyBudget: getHistoryBudget(),
            maxTurns: getMaxHistoryTurns(),
            maxOutputTokens: getMaxOutputTokens(),
            maxToolIterations: getMaxToolIterations(),
            webfetchEnabled: process.env.MUGIL_IDE_ENABLE_WEBFETCH !== '0' && process.env.MUGIL_IDE_ENABLE_WEBFETCH !== 'false',
            turboMode,
            thinkingLevel: getThinkingLevel(),
          }),
        );
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/ws') {
      if (!isOriginAllowed(request.headers.origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      if (!isAuthorized(request, url)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', async (ws: WebSocket) => {
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
            turboMode,
            stats: {
              ...repl.stats,
              filesModified: Array.from(repl.stats.filesModified),
            },
          }),
        );
      }
    };

    // A `status` frame is a snapshot of model/mode/stats — none of which change
    // while a turn streams, but `write` now fires once per token, so an eager
    // sendStatus() there costs a second WebSocket frame and a second
    // JSON.stringify per token. Coalesce: at most one status frame per
    // interval, sent immediately on the first write of a burst and once more at
    // the end so the final snapshot always reaches the browser. Lifecycle
    // events (turn_complete, mode/model change) still send eagerly — they are
    // the frames a waiting UI actually blocks on.
    const STATUS_INTERVAL_MS = 100;
    let lastStatusAt = 0;
    let statusTimer: NodeJS.Timeout | null = null;
    const clearStatusTimer = (): void => {
      if (!statusTimer) return;
      clearTimeout(statusTimer);
      statusTimer = null;
    };
    /** Eager send, cancelling any pending coalesced one. */
    const sendStatusNow = (): void => {
      clearStatusTimer();
      lastStatusAt = Date.now();
      sendStatus();
    };
    /**
     * Rate-limited send for the write path: one frame immediately if the
     * interval has elapsed, otherwise exactly one trailing frame carrying the
     * state at the end of the burst. Never more than ~1 frame per 100ms.
     */
    const coalesceStatus = (): void => {
      const elapsed = Date.now() - lastStatusAt;
      if (elapsed >= STATUS_INTERVAL_MS && !statusTimer) {
        lastStatusAt = Date.now();
        sendStatus();
        return;
      }
      if (statusTimer) return;
      const timer = setTimeout(() => {
        statusTimer = null;
        lastStatusAt = Date.now();
        sendStatus();
      }, Math.max(0, STATUS_INTERVAL_MS - elapsed));
      // Never hold the process open for a status frame.
      timer.unref?.();
      statusTimer = timer;
    };

    const repl = new AgentRepl(
      engine,
      {
        write: (d) => {
          sendAgentData(d);
          coalesceStatus();
        },
        onExit: () => {
          ws.close();
        },
        onTurnComplete: (turn) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'turn_complete', turn }));
          }
          sendStatusNow();
        },
        onModelChange: (m, prov) => {
          updateActiveModel(m, prov);
          sendStatusNow();
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
          if (turboMode) return true;
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
    activeRepl = repl;

    if (probedModelsCache.length > 0) {
      repl.setAvailableModels(probedModelsCache);
    }

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
    sendStatusNow();

    ws.on('message', async (messageRaw) => {
      try {
        const msg = JSON.parse(messageRaw.toString());

        if (msg.type === 'set_model') {
          const newModel = String(msg.model);
          repl.setActiveModel(newModel, msg.provider);
          updateActiveModel(newModel, msg.provider);
          sendAgentData(`\r\n\x1b[32m✓\x1b[0m Active model changed to: \x1b[1m\x1b[36m${newModel}\x1b[0m${engine.config.provider ? ` \x1b[2m(${engine.config.provider})\x1b[0m` : ''}\r\n\r\n`);
          repl.printPrompt();
          sendStatusNow();
        } else if (msg.type === 'set_mode') {
          const newMode = msg.mode === 'plan' ? 'plan' : 'act';
repl.setMode(newMode);
          // Persist per workspace so plan mode in one repo does not make
          // every other repo on the machine start read-only.
          saveMode(newMode);
          sendAgentData(`\r\n\x1b[32m✓\x1b[0m Mode changed to: \x1b[1m\x1b[33m${newMode}\x1b[0m\r\n\r\n`);
          repl.printPrompt();
          sendStatusNow();
        } else if (msg.type === 'question_answer') {
          const entry = questionResolvers.get(Number(msg.id));
          if (entry) {
            clearTimeout(entry.timer);
            questionResolvers.delete(Number(msg.id));
            entry.resolve(String(msg.answer ?? ''));
          }
        } else if (msg.type === 'set_turbo_mode') {
          turboMode = Boolean(msg.enabled);
          process.env.MUGIL_IDE_TURBO_MODE = turboMode ? '1' : '0';
          sendAgentData(`\r\n\x1b[33m⚡ Turbo Mode: ${turboMode ? '\x1b[32mENABLED (Autonomous execution without user prompts)\x1b[0m' : '\x1b[31mDISABLED (User approval required)\x1b[0m'}\x1b[0m\r\n\r\n`);
          repl.printPrompt();
          sendStatusNow();
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
            sendAgentData(cleanText + '\r\n');
            await repl.handleInput(cleanText);
            sendStatusNow();
            return;
          }

          // Handle single character inputs from xterm.js (e.g. Ctrl+C)
          const char = rawData;
          // Handle Ctrl+C (\x03)
          if (char === '\x03') {
            // Cancel the running turn first — otherwise Ctrl-C just clears the
            // input box and the session stays wedged until the request returns.
            if (repl.cancelTurn()) {
              sendAgentData('\r\n\x1b[33m■ Cancelling turn...\x1b[0m\r\n');
            } else {
              sendAgentData('^C\r\n');
              repl.printPrompt();
            }
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
        // Discard malformed non-JSON WebSocket frames rather than piping directly to shell PTY
      }
    });

    ws.on('close', () => {
      if (activeRepl === repl) {
        activeRepl = null;
      }
      clearStatusTimer();
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

  const desiredPort = options.port !== undefined ? options.port : Number(process.env.PORT || 0);
  const host = options.host || 'localhost';

  return new Promise<RunningServer>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && options.port === undefined) {
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
      const tokenUrl = `http://${host}:${actualPort}/?token=${sessionToken}`;
      resolve({
        port: actualPort,
        url,
        tokenUrl,
        token: sessionToken,
        close: () =>
          new Promise<void>((res) => {
            try {
              if (fs.existsSync(tokenFile) && fs.readFileSync(tokenFile, 'utf8') === sessionToken) {
                fs.unlinkSync(tokenFile);
              }
            } catch {
              // best-effort cleanup
            }
            wss.close();
            diffRunner.dispose();
            // Terminate and close all active and idle sockets so server.close()
            // exits immediately without waiting on pooled client connections.
            (server as any).closeAllConnections?.();
            server.closeIdleConnections?.();
            server.close(() => res());
          }),
      });
    });
  });
}
