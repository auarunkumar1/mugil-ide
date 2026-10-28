import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface PtyInstance {
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (exitCode: number) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  /** Flow control for WebSocket backpressure (optional per backend). */
  pause?: () => void;
  resume?: () => void;
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
      pause: () => ptyProcess.pause(),
      resume: () => ptyProcess.resume(),
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
  // Own process group: closing the Shell tab, or a `yes`/watch loop that
  // keeps producing output, must take the shell's children down with it.
  // Killing only the shell leaves grandchildren holding the stdout pipe open.
  const child: ChildProcessWithoutNullStreams = spawn(shell, [], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(code: number) => void> = [];
  // A spawn failure fires on nextTick, before `startPty` has registered the
  // data/exit callbacks. Buffer early output so the error still reaches the pane.
  let pendingData = '';
  let pendingExit: number | null = null;
  let exited = false;
  const emitData = (data: string): void => {
    if (dataCallbacks.length === 0) {
      pendingData += data;
      return;
    }
    dataCallbacks.forEach((cb) => cb(data));
  };
  const emitExit = (code: number): void => {
    if (exited) return;
    exited = true;
    if (exitCallbacks.length === 0) {
      pendingExit = code;
      return;
    }
    exitCallbacks.forEach((cb) => cb(code));
  };

  // A spawn failure (ENOENT for a stale $SHELL, EACCES, ENOMEM) emits 'error'
  // on the child. Unhandled, that event kills the whole server when the Shell
  // pane opens — surface it in the pane instead.
  child.on('error', (err) => {
    emitData(`\r\n\x1b[31m[Shell failed to start: ${err.message}]\x1b[0m\r\n`);
    emitExit(1);
  });
  // Writing to a shell that already exited raises EPIPE on stdin; unhandled
  // that is another process-killer.
  child.stdin.on('error', () => {
    /* shell is gone — the pane already showed the exit */
  });

  child.stdout.on('data', (chunk) => {
    emitData(chunk.toString('utf-8'));
  });

  child.stderr.on('data', (chunk) => {
    emitData(chunk.toString('utf-8'));
  });

  child.on('exit', (code) => {
    emitExit(code ?? 0);
  });

  return {
    onData: (cb) => {
      dataCallbacks.push(cb);
      if (pendingData) {
        const buffered = pendingData;
        pendingData = '';
        cb(buffered);
      }
    },
    onExit: (cb) => {
      exitCallbacks.push(cb);
      if (pendingExit !== null) cb(pendingExit);
    },
    write: (data) => {
      if (!child.stdin.destroyed) {
        child.stdin.write(data);
      }
    },
    resize: () => {
      // No-op for standard stream fallback
    },
    kill: () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    },
    pause: () => child.stdout.pause(),
    resume: () => child.stdout.resume(),
  };
}
