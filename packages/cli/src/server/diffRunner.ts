/**
 * Off-thread diff computation for the /api/diffs endpoint.
 *
 * `createTwoFilesPatch` (the `diff` package) is worst-case O(N·M) in lines —
 * two large, dissimilar files can block the event loop for hundreds of
 * milliseconds to seconds. This module runs the patch computation on a
 * dedicated worker thread (`./diffWorker.js`, plain JS by design since worker
 * threads don't go through tsc/ts-jest) so slow diffs never stall other
 * requests on the server.
 *
 * The runner is deliberately defensive:
 *  - lazy single worker per server (respawned after a crash),
 *  - a synchronous fallback if the worker can't spawn or never answers
 *    (bounded by the caller's size cap, so the fallback is ~1s worst case),
 *  - a 10s safety-net timeout so a wedged worker can never hang the endpoint.
 */
import { Worker } from 'node:worker_threads';
import { createTwoFilesPatch } from 'diff';

export interface DiffPatchRequest {
  file1: string;
  file2: string;
  before: string;
  after: string;
  header1: string;
  header2: string;
}

export interface DiffRunner {
  /** Computes a two-file patch off the event loop (worker thread). */
  computePatch(request: DiffPatchRequest): Promise<string>;
  /** Terminates the worker and rejects any in-flight requests. */
  dispose(): void;
}

const WORKER_URL = new URL('./diffWorker.js', import.meta.url);

export function createDiffRunner(): DiffRunner {
  let worker: Worker | null = null;
  let seq = 0;
  let failed = false;
  const pending = new Map<number, { resolve: (patch: string) => void; reject: (err: Error) => void }>();

  function rejectAll(err: Error): void {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  }

  /** Synchronous fallback — callers cap input size, so this stays ~1s worst case. */
  function syncPatch(request: DiffPatchRequest): string {
    return createTwoFilesPatch(request.file1, request.file2, request.before, request.after, request.header1, request.header2);
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(WORKER_URL);
    // An idle worker must never keep the server (or jest) alive on its own.
    worker.unref();
    worker.on('message', (msg: { id: number; patch?: string; error?: string }) => {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error));
      else entry.resolve(msg.patch ?? '');
    });
    worker.on('error', (err) => {
      failed = true;
      rejectAll(err);
    });
    worker.on('exit', (code) => {
      worker = null;
      if (code !== 0) {
        failed = true;
        rejectAll(new Error(`diff worker exited with code ${code}`));
      }
    });
    return worker;
  }

  return {
    computePatch(request) {
      if (failed) return Promise.resolve(syncPatch(request));
      const id = ++seq;
      return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          ensureWorker().postMessage({ id, ...request });
        } catch {
          pending.delete(id);
          failed = true;
          resolve(syncPatch(request));
        }
        // Safety net: a wedged worker must never hang the endpoint.
        const timer = setTimeout(() => {
          if (pending.delete(id)) {
            failed = true;
            resolve(syncPatch(request));
          }
        }, 10_000);
        timer.unref();
      });
    },
    dispose() {
      rejectAll(new Error('diff worker disposed'));
      if (worker) {
        worker.terminate().catch(() => {});
        worker = null;
      }
    },
  };
}
