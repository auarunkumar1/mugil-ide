/**
 * LSP Client (language-server code intelligence)
 * ==============================================
 * A minimal, zero-dependency Language Server Protocol client over stdio —
 * JSON-RPC 2.0 with Content-Length framing (the LSP wire format), speaking
 * to `typescript-language-server` (opt-in via `MUGIL_IDE_ENABLE_LSP=1`).
 * Supports goToDefinition, findReferences and hover on file positions, the
 * same operations as OpenCode's experimental `lsp` tool.
 *
 * Only what the tool needs is implemented: initialize handshake, didOpen /
 * didChange document sync, and the three requests. Diagnostics pushed by the
 * server are ignored. The client is deliberately dependency-free (the
 * project's convention — its own glob matcher and dotenv parser follow the
 * same pattern).
 *
 * Credit: the Language Server Protocol specification by Microsoft —
 * https://microsoft.github.io/language-server-protocol/. See ATTRIBUTIONS.md
 * for the full list.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LSP_TIMEOUT_MS = 10_000;
const MAX_LOCATIONS = 50;

/** Per-extension language ids understood by typescript-language-server. */
export function languageIdFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.json': 'json',
      '.css': 'css',
      '.scss': 'scss',
      '.html': 'html',
      '.md': 'markdown',
    }[ext] ?? 'typescript'
  );
}

interface LspLocation {
  uri: string;
  line: number;
  character: number;
}

/** Normalizes definition/reference results (Location | Location[] | LocationLink[] | null). */
function normalizeLocations(result: unknown): LspLocation[] {
  const items = Array.isArray(result) ? result : result ? [result] : [];
  const out: LspLocation[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const uri = typeof record.targetUri === 'string' ? record.targetUri : typeof record.uri === 'string' ? record.uri : null;
    const range = (record.targetRange ?? record.range) as { start?: { line?: number; character?: number } } | undefined;
    if (!uri || !range?.start || typeof range.start.line !== 'number' || typeof range.start.character !== 'number') continue;
    out.push({ uri, line: range.start.line, character: range.start.character });
    if (out.length >= MAX_LOCATIONS) break;
  }
  return out;
}

/** Formats LSP locations as `relpath:line:col` (1-indexed), relative to root. */
export function formatLspLocations(root: string, result: unknown): string {
  const locations = normalizeLocations(result);
  if (locations.length === 0) return '(no results)';
  return locations
    .map((l) => {
      try {
        const p = fileURLToPath(l.uri);
        const rel = path.relative(root, p).replace(/\\/g, '/');
        return `${rel}:${l.line + 1}:${l.character + 1}`;
      } catch {
        return `${l.uri}:${l.line + 1}:${l.character + 1}`;
      }
    })
    .join('\n');
}

/** Extracts display text from an LSP Hover.contents (string | MarkupContent | MarkedString[]). */
export function hoverText(contents: unknown): string {
  const parts: string[] = [];
  const push = (c: unknown): void => {
    if (typeof c === 'string') parts.push(c);
    else if (c && typeof c === 'object' && typeof (c as Record<string, unknown>).value === 'string') {
      parts.push((c as Record<string, unknown>).value as string);
    }
  };
  if (Array.isArray(contents)) {
    for (const c of contents) push(c);
  } else {
    push(contents);
  }
  return parts.filter((p) => p.trim().length > 0).join('\n') || '(no hover content)';
}

/** The tool-facing surface; `operation` returns pre-formatted text. */
export interface LspClient {
  goToDefinition(file: string, line: number, character: number): Promise<string>;
  findReferences(file: string, line: number, character: number): Promise<string>;
  hover(file: string, line: number, character: number): Promise<string>;
  close(): Promise<void>;
}

/** Reads Content-Length framed JSON-RPC messages from a stream. */
export class FramedStreamReader {
  private buffer = Buffer.alloc(0);
  private readonly onMessage: (msg: Record<string, unknown>) => void;

  constructor(stream: NodeJS.ReadableStream, onMessage: (msg: Record<string, unknown>) => void) {
    this.onMessage = onMessage;
    stream.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
  }

  private drain(): void {
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const headers = this.buffer.subarray(0, headerEnd).toString('utf-8');
      const match = /content-length:\s*(\d+)/i.exec(headers);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = parseInt(match[1]!, 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf-8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        this.onMessage(JSON.parse(body) as Record<string, unknown>);
      } catch {
        // malformed frame — skip
      }
    }
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** Real LSP client: spawns the language server and speaks JSON-RPC over stdio. */
export class LanguageServerClient implements LspClient {
  private readonly proc: ChildProcess;
  private readonly root: string;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly openVersions = new Map<string, number>();
  private closed = false;

  private constructor(proc: ChildProcess, root: string) {
    this.proc = proc;
    this.root = root;
  }

  /** Spawns `typescript-language-server --stdio`, performs the initialize handshake. */
  static async spawn(root: string): Promise<LanguageServerClient> {
    let proc: ChildProcess;
    try {
      proc = spawn('typescript-language-server', ['--stdio'], {
        cwd: root,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      throw new Error(
        `failed to start typescript-language-server: ${err instanceof Error ? err.message : String(err)}. Install it with "npm i -g typescript-language-server".`,
      );
    }
    const client = new LanguageServerClient(proc, root);
    client.proc.on('error', (err) => {
      const message =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'typescript-language-server not found on PATH — install it with "npm i -g typescript-language-server"'
          : `language server error: ${err.message}`;
      client.failAll(new Error(message));
    });
    client.proc.on('exit', (code) => client.failAll(new Error(`language server exited (code ${code ?? 'unknown'})`)));
    client.proc.stderr!.on('data', () => {
      // language servers log to stderr; ignore (failures surface via requests)
    });
    new FramedStreamReader(client.proc.stdout!, (msg) => client.dispatch(msg));

    const init = await client.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      capabilities: {
        textDocument: {
          synchronization: { didSave: false },
          definition: { linkSupport: true },
          references: true,
          hover: { contentFormat: ['markdown', 'plaintext'] },
        },
      },
    });
    if (!init || typeof init !== 'object' || !('capabilities' in (init as Record<string, unknown>))) {
      client.close();
      throw new Error('language server initialize failed');
    }
    client.notify('initialized', {});
    return client;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('language server is closed'));
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP ${method} timed out after ${LSP_TIMEOUT_MS}ms`));
      }, LSP_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
    });
    writeMessage(this.proc, { jsonrpc: '2.0', id, method, params });
    return promise;
  }

  notify(method: string, params: unknown): void {
    if (this.closed) return;
    writeMessage(this.proc, { jsonrpc: '2.0', method, params });
  }

  private dispatch(msg: Record<string, unknown>): void {
    const id = msg.id;
    if (typeof id === 'number' && this.pending.has(id)) {
      const pending = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (msg.error) pending.reject(new Error(typeof msg.error === 'object' ? JSON.stringify(msg.error) : String(msg.error)));
      else pending.resolve(msg.result);
    }
    // Server notifications (publishDiagnostics, window/logMessage) are ignored.
  }

  private failAll(err: Error): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  /** Opens (or refreshes) a document with its current on-disk content. */
  private async openDocument(file: string): Promise<void> {
    const uri = pathToFileURL(file).href;
    const version = (this.openVersions.get(uri) ?? 0) + 1;
    this.openVersions.set(uri, version);
    const text = fs.readFileSync(file, 'utf-8');
    if (version === 1) {
      this.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: languageIdFor(file), version, text },
      });
    } else {
      this.notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }
  }

  async goToDefinition(file: string, line: number, character: number): Promise<string> {
    await this.openDocument(file);
    const result = await this.request('textDocument/definition', {
      textDocument: { uri: pathToFileURL(file).href },
      position: { line, character },
    });
    return formatLspLocations(this.root, result);
  }

  async findReferences(file: string, line: number, character: number): Promise<string> {
    await this.openDocument(file);
    const result = await this.request('textDocument/references', {
      textDocument: { uri: pathToFileURL(file).href },
      position: { line, character },
      context: { includeDeclaration: true },
    });
    return formatLspLocations(this.root, result);
  }

  async hover(file: string, line: number, character: number): Promise<string> {
    await this.openDocument(file);
    const result = (await this.request('textDocument/hover', {
      textDocument: { uri: pathToFileURL(file).href },
      position: { line, character },
    })) as { contents?: unknown } | null;
    return hoverText(result?.contents);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error('language server closed'));
    try {
      this.proc.kill();
    } catch {
      // already gone
    }
  }
}

function writeMessage(proc: ChildProcess, msg: Record<string, unknown>): void {
  const body = JSON.stringify(msg);
  proc.stdin!.write(`Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`);
}

const lspClientCache = new Map<string, Promise<LspClient>>();

/**
 * Returns a cached real client for the root (or the injected fake in tests).
 * Failures are dropped from the cache so a later call can retry.
 */
export function getLspClient(root: string, connect?: (r: string) => Promise<LspClient>): Promise<LspClient> {
  if (connect) return connect(root);
  let cached = lspClientCache.get(root);
  if (!cached) {
    cached = LanguageServerClient.spawn(root).catch((err: unknown) => {
      lspClientCache.delete(root);
      throw err;
    });
    lspClientCache.set(root, cached);
  }
  return cached;
}

/** Closes every cached client (called on TUI unmount). */
export async function closeLspClients(): Promise<void> {
  const clients = await Promise.allSettled([...lspClientCache.values()]);
  lspClientCache.clear();
  await Promise.allSettled(
    clients.map((c) => (c.status === 'fulfilled' ? c.value.close() : Promise.resolve())),
  );
}
