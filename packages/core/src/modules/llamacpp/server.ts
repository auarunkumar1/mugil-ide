import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { spawn, execFile, execFileSync, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { pidFile, ensureDir } from './paths.js';
import { ensureLlamaServerBinary } from './binary.js';

const execFileAsync = promisify(execFile);

export interface LlamaStartOptions {
  modelPath: string;
  ctx?: number; // default 8192
  gpuLayers?: number; // default: 999 on metal/cuda/vulkan builds, else 0
  port?: number; // default: scan 8080-8199
  threads?: number; // default: unset -> llama.cpp auto (-1)
  alias?: string; // default 'mugil' -> shows up in /v1/models
  binaryPath?: string;
}

export interface LlamaStatus {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  port?: number;
  baseUrl?: string;
  modelPath?: string;
  pid?: number;
  startedAt?: number;
  lastError?: string;
  stderrTail: string[]; // last 20 lines
}

export function buildServerArgs(o: LlamaStartOptions & { port: number }): string[] {
  const args: string[] = [
    '-m',
    o.modelPath,
    '--host',
    '127.0.0.1',
    '--port',
    String(o.port),
    '-c',
    String(o.ctx ?? 8192),
    '-ngl',
    String(o.gpuLayers ?? 0),
    '-a',
    o.alias || 'mugil',
    '--jinja',
    '-np',
    '1',
    '-fa',
    'on',
    '--cache-reuse',
    '256',
  ];

  if (typeof o.threads === 'number' && o.threads > 0) {
    args.push('-t', String(o.threads));
  }

  return args;
}

/** Probes whether a port on 127.0.0.1 is free to bind. */
function checkPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/** Scans 8080-8199 for an available loopback port. */
export async function pickPort(preferred?: number): Promise<number> {
  if (preferred && (await checkPortFree(preferred))) {
    return preferred;
  }
  for (let port = 8080; port <= 8199; port++) {
    if (await checkPortFree(port)) {
      return port;
    }
  }
  throw new Error('No available loopback port found in range 8080-8199 for llama-server');
}

/** Check if process cmdline matches llama-server before killing stale pid */
async function isLlamaServerProcess(pid: number): Promise<boolean> {
  try {
    if (process.platform === 'linux') {
      const commPath = `/proc/${pid}/comm`;
      if (fs.existsSync(commPath)) {
        const comm = fs.readFileSync(commPath, 'utf8').trim();
        if (comm === 'llama-server' || comm.startsWith('llama-server')) return true;
      }
      const cmdlinePath = `/proc/${pid}/cmdline`;
      if (fs.existsSync(cmdlinePath)) {
        const cmd = fs.readFileSync(cmdlinePath, 'utf8');
        return cmd.includes('llama-server');
      }
      return false;
    }
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command=']);
    return stdout.includes('llama-server');
  } catch {
    return false;
  }
}

/** Discovers candidate running llama-server PIDs from pidFile, /proc, and OS process query tools. */
export function findRunningLlamaPids(env: NodeJS.ProcessEnv = process.env): Set<number> {
  const pids = new Set<number>();
  const pFile = pidFile(env);
  if (fs.existsSync(pFile)) {
    try {
      const content = fs.readFileSync(pFile, 'utf8').trim();
      const pid = parseInt(content, 10);
      if (Number.isFinite(pid) && pid > 0) {
        pids.add(pid);
      }
    } catch {
      /* ignore */
    }
  }

  // 1. Discover via Linux /proc
  if (process.platform === 'linux') {
    try {
      const entries = fs.readdirSync('/proc');
      for (const entry of entries) {
        if (!/^\d+$/.test(entry)) continue;
        const pid = parseInt(entry, 10);
        if (pid === process.pid) continue;
        try {
          const commPath = `/proc/${entry}/comm`;
          if (fs.existsSync(commPath)) {
            const comm = fs.readFileSync(commPath, 'utf8').trim();
            if (comm === 'llama-server' || comm.startsWith('llama-server')) {
              pids.add(pid);
              continue;
            }
          }
          const cmdlinePath = `/proc/${entry}/cmdline`;
          if (fs.existsSync(cmdlinePath)) {
            const cmdline = fs.readFileSync(cmdlinePath, 'utf8');
            const argv0 = cmdline.split('\0')[0] || '';
            if (argv0.endsWith('llama-server') || argv0.endsWith('llama-server.exe') || cmdline.includes('llama-server')) {
              pids.add(pid);
            }
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 2. Discover via pgrep on Linux/macOS
  if (process.platform !== 'win32') {
    try {
      const out = execFileSync('pgrep', ['-x', 'llama-server'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const line of out.split('\n')) {
        const p = parseInt(line.trim(), 10);
        if (Number.isFinite(p) && p > 0 && p !== process.pid) {
          pids.add(p);
        }
      }
    } catch {
      /* ignore if pgrep not available or no match */
    }
  }

  // 3. Discover via tasklist on Windows
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('tasklist', ['/fi', 'IMAGENAME eq llama-server.exe', '/fo', 'csv', '/nh'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const line of out.split('\n')) {
        const match = line.match(/"llama-server\.exe","(\d+)"/i);
        if (match && match[1]) {
          const p = parseInt(match[1], 10);
          if (Number.isFinite(p) && p > 0 && p !== process.pid) {
            pids.add(p);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  return pids;
}

/** Reaps any stale llama-server process left from an ungraceful shutdown. */
export async function reapStaleProcess(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const pidsToReap = findRunningLlamaPids(env);

  for (const pid of pidsToReap) {
    try {
      let isAlive = false;
      try {
        process.kill(pid, 0);
        isAlive = true;
      } catch {
        isAlive = false;
      }

      if (isAlive) {
        const isLlama = await isLlamaServerProcess(pid);
        if (isLlama) {
          try {
            process.kill(pid, 'SIGTERM');
            try { process.kill(-pid, 'SIGTERM'); } catch { /* ignore */ }
            // Give it 300ms to exit gracefully
            await new Promise((r) => setTimeout(r, 300));
            try {
              process.kill(pid, 0);
              process.kill(pid, 'SIGKILL');
              try { process.kill(-pid, 'SIGKILL'); } catch { /* ignore */ }
            } catch {
              /* ignore */
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  try {
    const pFile = pidFile(env);
    if (fs.existsSync(pFile)) fs.unlinkSync(pFile);
  } catch {
    /* ignore */
  }
}

type SpawnFn = typeof spawn;

export interface LlamaServerManagerOptions {
  spawnFn?: SpawnFn;
  binaryResolver?: () => Promise<string>;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  startupTimeoutMs?: number;
  stopGraceMs?: number;
}

export class LlamaServerManager {
  private static _instance?: LlamaServerManager;

  private spawnFn: SpawnFn;
  private binaryResolver: () => Promise<string>;
  private env: NodeJS.ProcessEnv;
  private fetchFn: typeof fetch;
  private startupTimeoutMs: number;
  private stopGraceMs: number;

  private child?: ChildProcess;
  private lastPid?: number;
  private listeners: Set<(s: LlamaStatus) => void> = new Set();
  private _status: LlamaStatus = {
    state: 'stopped',
    stderrTail: [],
  };
  private currentOptions?: LlamaStartOptions;
  private activeStartup?: Promise<LlamaStatus>;

  constructor(opts?: LlamaServerManagerOptions) {
    this.spawnFn = opts?.spawnFn ?? spawn;
    this.binaryResolver = opts?.binaryResolver ?? (() => ensureLlamaServerBinary({ env: opts?.env }));
    this.env = opts?.env ?? process.env;
    this.fetchFn = opts?.fetchFn ?? globalThis.fetch;
    this.startupTimeoutMs =
      opts?.startupTimeoutMs ??
      (this.env.LLAMACPP_STARTUP_TIMEOUT_MS ? parseInt(this.env.LLAMACPP_STARTUP_TIMEOUT_MS, 10) : 120_000);
    this.stopGraceMs =
      opts?.stopGraceMs ??
      (this.env.LLAMACPP_STOP_GRACE_MS ? parseInt(this.env.LLAMACPP_STOP_GRACE_MS, 10) : 2_000);
  }

  public static instance(): LlamaServerManager {
    if (!LlamaServerManager._instance) {
      LlamaServerManager._instance = new LlamaServerManager();
    }
    return LlamaServerManager._instance;
  }

  public status(): LlamaStatus {
    return { ...this._status, stderrTail: [...this._status.stderrTail] };
  }

  public onStateChange(cb: (s: LlamaStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setStatus(update: Partial<LlamaStatus>) {
    this._status = { ...this._status, ...update };
    for (const listener of this.listeners) {
      try {
        listener(this.status());
      } catch {
        /* ignore */
      }
    }
  }

  private pushStderr(line: string) {
    const lines = this._status.stderrTail;
    lines.push(line);
    if (lines.length > 20) {
      lines.shift();
    }
  }

  public isRunning(): boolean {
    if (this._status.state !== 'running') return false;
    if (this.child) {
      if (this.child.exitCode !== null || this.child.killed) {
        this._status.state = 'stopped';
        this.child = undefined;
        return false;
      }
      if (this.child.pid) {
        try {
          process.kill(this.child.pid, 0);
          return true;
        } catch {
          this._status.state = 'stopped';
          this.child = undefined;
          return false;
        }
      }
    }
    const pids = findRunningLlamaPids(this.env);
    if (pids.size > 0) return true;
    this._status.state = 'stopped';
    return false;
  }

  public async start(opts: LlamaStartOptions): Promise<LlamaStatus> {
    if (!fs.existsSync(opts.modelPath)) {
      const err = `model file not found: ${opts.modelPath}`;
      this.setStatus({ state: 'error', lastError: err });
      throw new Error(err);
    }

    // Idempotency check: if running with the same modelPath, return existing status
    if (
      this._status.state === 'running' &&
      this.currentOptions &&
      this.currentOptions.modelPath === opts.modelPath &&
      this.currentOptions.ctx === opts.ctx &&
      this.currentOptions.gpuLayers === opts.gpuLayers &&
      this.isRunning()
    ) {
      return this.status();
    }

    // If already starting the exact same model, reuse in-flight startup promise
    if (
      this._status.state === 'starting' &&
      this.activeStartup &&
      this.currentOptions?.modelPath === opts.modelPath
    ) {
      return this.activeStartup;
    }

    if (this._status.state === 'running' || this._status.state === 'starting') {
      await this.stop();
    }

    const runStart = async (): Promise<LlamaStatus> => {
      this._status.stderrTail = [];
      this.setStatus({
        state: 'starting',
        modelPath: opts.modelPath,
        lastError: undefined,
      });
      this.currentOptions = opts;

      let bin = opts.binaryPath;
      if (!bin) {
        try {
          bin = await this.binaryResolver();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.setStatus({ state: 'error', lastError: msg });
          throw err;
        }
      }

      const port = opts.port ?? (await pickPort(this.env.LLAMACPP_PORT ? Number(this.env.LLAMACPP_PORT) : undefined));
      const args = buildServerArgs({ ...opts, port });

      const child = this.spawnFn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...this.env },
      });
      this.child = child;

      if (child.pid) {
        this.lastPid = child.pid;
        try {
          const pFile = pidFile(this.env);
          ensureDir(path.dirname(pFile));
          fs.writeFileSync(pFile, String(child.pid), { mode: 0o600 });
        } catch {
          /* ignore */
        }
      }

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.trim()) this.pushStderr(line.trim());
        }
      });

      // Race three promises: health ok, child exit, and startup timeout
      let settled = false;
      let startupTimer: NodeJS.Timeout | undefined;
      let pollInterval: NodeJS.Timeout | undefined;

      const exitPromise = new Promise<never>((_, reject) => {
        child.once('exit', (code, signal) => {
          settled = true;
          const tail = this._status.stderrTail.slice(-5).join('; ');
          const exitMsg = tail
            ? `llama-server exited prematurely (code ${code}, signal ${signal}): ${tail}`
            : `llama-server exited prematurely with code ${code ?? signal}`;
          reject(new Error(exitMsg));
        });
        child.once('error', (err) => {
          settled = true;
          reject(new Error(`Failed to spawn llama-server: ${err.message}`));
        });
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        startupTimer = setTimeout(() => {
          settled = true;
          const tail = this._status.stderrTail.slice(-5).join('; ');
          reject(
            new Error(
              `llama-server startup timed out after ${this.startupTimeoutMs}ms. Stderr tail: ${tail || '(none)'}`,
            ),
          );
        }, this.startupTimeoutMs);
      });

      const healthPromise = new Promise<void>((resolve) => {
        const checkHealth = async () => {
          if (settled) return;
          const controller = new AbortController();
          const fetchTimer = setTimeout(() => controller.abort(), 1000);
          try {
            const res = await this.fetchFn(`http://127.0.0.1:${port}/health`, {
              signal: controller.signal,
            });
            clearTimeout(fetchTimer);
            if (res.ok) {
              settled = true;
              resolve();
              return;
            }
          } catch {
            clearTimeout(fetchTimer);
            /* ignore */
          }
          if (!settled) {
            pollInterval = setTimeout(checkHealth, 250);
          }
        };
        checkHealth();
      });

      try {
        await Promise.race([healthPromise, exitPromise, timeoutPromise]);
        settled = true;

        if (startupTimer) clearTimeout(startupTimer);
        if (pollInterval) clearTimeout(pollInterval);

        this.setStatus({
          state: 'running',
          port,
          baseUrl: `http://127.0.0.1:${port}/v1`,
          modelPath: opts.modelPath,
          pid: child.pid,
          startedAt: Date.now(),
          lastError: undefined,
        });

        // Listen for eventual process exit to keep status accurate
        child.on('exit', () => {
          if (this.child === child) {
            this.child = undefined;
            this.lastPid = undefined;
            this.setStatus({
              state: 'stopped',
              port: undefined,
              baseUrl: undefined,
              modelPath: undefined,
              pid: undefined,
              startedAt: undefined,
            });
            const pFile = pidFile(this.env);
            try {
              if (fs.existsSync(pFile)) fs.unlinkSync(pFile);
            } catch {
              /* ignore */
            }
          }
        });

        return this.status();
      } catch (err) {
        settled = true;
        if (startupTimer) clearTimeout(startupTimer);
        if (pollInterval) clearTimeout(pollInterval);

        const msg = err instanceof Error ? err.message : String(err);
        this.setStatus({ state: 'error', lastError: msg });

        // Clean up child process
        try {
          if (child.pid) {
            child.kill('SIGKILL');
            try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ignore */ }
          }
        } catch {
          /* ignore */
        }

        try {
          const pFile = pidFile(this.env);
          if (fs.existsSync(pFile)) fs.unlinkSync(pFile);
        } catch {
          /* ignore */
        }

        this.child = undefined;
        this.lastPid = undefined;
        throw err;
      }
    };

    this.activeStartup = runStart();
    try {
      return await this.activeStartup;
    } finally {
      this.activeStartup = undefined;
    }
  }

  public async stop(): Promise<void> {
    this.setStatus({ state: 'stopping' });
    const pids = findRunningLlamaPids(this.env);
    if (this.child?.pid) pids.add(this.child.pid);
    if (this.lastPid) pids.add(this.lastPid);

    const pFile = pidFile(this.env);

    if (pids.size === 0) {
      this.child = undefined;
      this.lastPid = undefined;
      try {
        if (fs.existsSync(pFile)) fs.unlinkSync(pFile);
      } catch {
        /* ignore */
      }
      this.setStatus({
        state: 'stopped',
        port: undefined,
        baseUrl: undefined,
        modelPath: undefined,
        pid: undefined,
        startedAt: undefined,
      });
      return;
    }

    // 1. Send SIGTERM / taskkill to candidate PIDs
    for (const pid of pids) {
      if (process.platform === 'win32') {
        try {
          await execFileAsync('taskkill', ['/pid', String(pid), '/T', '/F']);
        } catch {
          /* ignore */
        }
      } else {
        try {
          process.kill(pid, 'SIGTERM');
          try { process.kill(-pid, 'SIGTERM'); } catch { /* ignore */ }
        } catch {
          /* ignore */
        }
      }
    }

    // 2. Wait up to stopGraceMs for process to exit
    if (process.platform !== 'win32') {
      const start = Date.now();
      const maxWait = Math.min(this.stopGraceMs, 2500);
      let anyAlive = true;
      while (Date.now() - start < maxWait) {
        anyAlive = false;
        for (const pid of pids) {
          try {
            process.kill(pid, 0);
            anyAlive = true;
            break;
          } catch {
            // dead
          }
        }
        if (!anyAlive) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      // 3. Force kill with SIGKILL if still alive
      if (anyAlive) {
        for (const pid of pids) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            /* ignore */
          }
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            /* ignore */
          }
        }
      }

      // 4. Verification sweep: terminate any remaining or orphaned llama-server processes
      const remaining = findRunningLlamaPids(this.env);
      for (const pid of remaining) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* ignore */
        }
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          /* ignore */
        }
      }
    }

    try {
      if (fs.existsSync(pFile)) fs.unlinkSync(pFile);
    } catch {
      /* ignore */
    }

    this.child = undefined;
    this.lastPid = undefined;
    this.setStatus({
      state: 'stopped',
      port: undefined,
      baseUrl: undefined,
      modelPath: undefined,
      pid: undefined,
      startedAt: undefined,
    });
  }

  /** Synchronous kill for process.on('exit'). Async cleanup is impossible there. */
  public killSync(): void {
    const pids = findRunningLlamaPids(this.env);
    if (this.child?.pid) pids.add(this.child.pid);
    if (this.lastPid) pids.add(this.lastPid);

    for (const pid of pids) {
      if (process.platform === 'win32') {
        try {
          execFileSync('taskkill', ['/pid', String(pid), '/T', '/F']);
        } catch {
          /* ignore */
        }
      } else {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* ignore */
        }
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          /* ignore */
        }
      }
    }

    const pFile = pidFile(this.env);
    try {
      if (fs.existsSync(pFile)) fs.unlinkSync(pFile);
    } catch {
      /* ignore */
    }

    this.child = undefined;
    this.lastPid = undefined;
    this._status.state = 'stopped';
  }

  public async restart(opts: LlamaStartOptions): Promise<LlamaStatus> {
    await this.stop();
    return this.start(opts);
  }
}
