/**
 * Worker-thread entry for /api/diffs (see diffRunner.ts).
 *
 * The `diff` package's worst case is O(N·M) in lines — two large, dissimilar
 * files can burn hundreds of milliseconds to seconds. Running it here, on a
 * dedicated worker thread, keeps the HTTP server's event loop responsive so a
 * slow diff never stalls other requests (the "connection accepted, no
 * response" hang from the original bug).
 *
 * Plain JS on purpose: worker threads don't go through ts-jest/tsc, and this
 * file is copied verbatim into dist/ by scripts/vendor-xterm.mjs.
 */
import { parentPort } from 'node:worker_threads';
import { createTwoFilesPatch } from 'diff';

parentPort.on('message', (msg) => {
  try {
    const patch = createTwoFilesPatch(msg.file1, msg.file2, msg.before, msg.after, msg.header1, msg.header2);
    parentPort.postMessage({ id: msg.id, patch });
  } catch (err) {
    parentPort.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
});
