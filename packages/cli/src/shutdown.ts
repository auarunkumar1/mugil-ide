export interface ShutdownDeps {
  stopLlama: () => Promise<unknown>;
  closeServer: () => Promise<unknown>;
  closeBackend: () => Promise<unknown>;
  exit?: (code: number) => void;
  graceMs?: number;
}

/**
 * Creates an ordered, deadline-bounded, idempotent shutdown handler.
 * Sequence: stopLlama -> closeServer -> closeBackend -> exit(0).
 */
export function createShutdownHandler(deps: ShutdownDeps): () => Promise<void> {
  let isShuttingDown = false;
  const graceMs = deps.graceMs ?? 8_000;
  const exitFn = deps.exit ?? process.exit;

  return async (): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    const runWithTimeout = async (fn: () => Promise<unknown>, label: string) => {
      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${graceMs}ms`)), graceMs);
      });
      try {
        await Promise.race([fn(), timeoutPromise]);
      } catch {
        // Individual step failure must not prevent subsequent shutdown steps
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    // 1. Stop local LLM server first so port and memory are released
    await runWithTimeout(() => deps.stopLlama(), 'stopLlama');

    // 2. Close HTTP/WS server
    await runWithTimeout(() => deps.closeServer(), 'closeServer');

    // 3. Close cache/Redis backend
    await runWithTimeout(() => deps.closeBackend(), 'closeBackend');

    // 4. Terminate process cleanly
    exitFn(0);
  };
}
