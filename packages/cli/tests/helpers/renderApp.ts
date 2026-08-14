/**
 * Minimal Ink test renderer. ink-testing-library v3's fake stdin only emits
 * 'data' events, but ink 5 consumes input via the Node readable-stream
 * protocol ('readable' event + read()), so keystrokes never reached the app.
 * This helper provides a real Readable-based fake stdin instead.
 *
 * `renderApp` resolves only once ink has attached its 'readable' listener,
 * so writes are never dropped. `stdin.write` delivers the text first and
 * waits for it to appear in the rendered frame before delivering the Enter
 * key — mimicking real typing where React has re-rendered with the new input
 * value before submit runs (ink-text-input submits the prop value, so a
 * premature Enter submits a stale empty string).
 */
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { render as inkRender } from 'ink';
import type { ReactNode } from 'react';

const WAIT_TIMEOUT_MS = 2000;

class FakeStdout extends EventEmitter {
  frames: string[] = [];
  private last = '';
  columns = 100;
  rows = 24;

  write = (frame: string): boolean => {
    this.frames.push(frame);
    this.last = frame;
    return true;
  };

  lastFrame = (): string => this.last;
}

class FakeStderr {
  write = (): boolean => true;
}

class FakeStdin extends Readable {
  isTTY = true;
  ref = (): void => {};
  unref = (): void => {};
  setRawMode = (): void => {};
  _read(): void {}

  write = (data: string): boolean => {
    const parts = data.split(/(\r|\n)/).filter(Boolean);
    const pushNext = (): void => {
      const part = parts.shift();
      if (part === undefined) return;
      this.push(Buffer.from(part));
      if (parts.length === 0) {
        process.nextTick(pushNext);
        return;
      }
      // Mimic human typing: give React time to commit the typed text and
      // flush the input-handler re-subscription before delivering Enter.
      // ink-text-input submits the value captured in its closure, so a
      // premature Enter submits the stale empty string.
      setTimeout(pushNext, 150);
    };
    pushNext();
    return true;
  };
}

export interface RenderResult {
  rerender: (node: ReactNode) => void;
  unmount: () => void;
  cleanup: () => void;
  stdin: FakeStdin;
  stdout: FakeStdout;
  lastFrame: () => string;
  frames: () => string[];
}

export async function renderApp(node: ReactNode): Promise<RenderResult> {
  const stdout = new FakeStdout();
  const stderr = new FakeStderr();
  const stdin = new FakeStdin();
  const instance = inkRender(node, {
    stdout,
    stderr,
    stdin,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  // Wait until ink has mounted and attached its 'readable' input listener,
  // so subsequent writes are never dropped.
  const ready = await new Promise<boolean>((resolve) => {
    const started = Date.now();
    const poll = (): void => {
      if (stdin.listenerCount('readable') > 0) {
        resolve(true);
        return;
      }
      if (Date.now() - started > WAIT_TIMEOUT_MS) {
        resolve(false);
        return;
      }
      setImmediate(poll);
    };
    poll();
  });
  if (!ready) {
    instance.unmount();
    throw new Error('Ink app did not become input-ready in time');
  }
  return {
    rerender: instance.rerender,
    unmount: instance.unmount,
    cleanup: instance.cleanup,
    stdin,
    stdout,
    lastFrame: stdout.lastFrame,
    frames: () => stdout.frames,
  };
}
