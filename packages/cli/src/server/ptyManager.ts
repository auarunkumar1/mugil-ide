import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface PtyInstance {
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (exitCode: number) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

export interface PtyOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
  shell?: string;
}

/**
 * Creates a PTY or shell process with fallback.
 */
export async function createPtySession(options: PtyOptions = {}): Promise<PtyInstance> {
  const isWindows = process.platform === 'win32';
  const defaultShell = isWindows
    ? (process.env.COMSPEC || 'powershell.exe')
    : (process.env.SHELL || '/bin/bash');

  const shell = options.shell || defaultShell;
  const cols = options.cols || 80;
  const rows = options.rows || 24;
  const cwd = options.cwd || process.cwd();
  const env = { ...process.env, ...options.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };

  // Escape hatch: force the child_process fallback (used by tests; also useful
  // when node-pty misbehaves on a given machine). NOTE: node-pty's Windows
  // kill() leaks its named-pipe sockets, which hangs graceful shutdown/jest.
  if (process.env.MUGIL_IDE_PTY_BACKEND === 'child') {
    return createFallbackPty(shell, cwd, env);
  }

  // 1. Try node-pty dynamic import if installed
  try {
    const nodePty = await import('node-pty');
    const ptyProcess = nodePty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: env as Record<string, string>,
      useConpty: false,
    });

    return {
      onData: (cb) => ptyProcess.onData(cb),
      onExit: (cb) => ptyProcess.onExit(({ exitCode }) => cb(exitCode)),
      write: (data) => ptyProcess.write(data),
      resize: (c, r) => ptyProcess.resize(c, r),
      kill: () => ptyProcess.kill(),
    };
  } catch {
    // 2. Fallback to child_process spawn
    return createFallbackPty(shell, cwd, env);
  }
}

/** Plain child_process spawn — no real TTY semantics, but clean teardown. */
function createFallbackPty(
  shell: string,
  cwd: string,
  env: Record<string, string | undefined>,
): PtyInstance {
  const child: ChildProcessWithoutNullStreams = spawn(shell, [], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(code: number) => void> = [];

  child.stdout.on('data', (chunk) => {
    const str = chunk.toString('utf-8');
    dataCallbacks.forEach((cb) => cb(str));
  });

  child.stderr.on('data', (chunk) => {
    const str = chunk.toString('utf-8');
    dataCallbacks.forEach((cb) => cb(str));
  });

  child.on('exit', (code) => {
    exitCallbacks.forEach((cb) => cb(code ?? 0));
  });

  return {
    onData: (cb) => dataCallbacks.push(cb),
    onExit: (cb) => exitCallbacks.push(cb),
    write: (data) => {
      if (!child.stdin.destroyed) {
        child.stdin.write(data);
      }
    },
    resize: () => {
      // No-op for standard stream fallback
    },
    kill: () => child.kill(),
  };
}
