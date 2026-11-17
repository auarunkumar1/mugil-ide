import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { ensureDir } from './paths.js';

export interface DownloadOptions {
  url: string;
  dest: string;
  sha256?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: (p: { received: number; total?: number; percent?: number; status?: string }) => void;
  fetchFn?: typeof fetch;
  stallTimeoutMs?: number;
  maxRetries?: number;
}

/** Pre-flights disk free space using fs.promises.statfs. */
export async function hasFreeSpace(dir: string, neededBytes: number): Promise<boolean> {
  try {
    ensureDir(dir);
    if (typeof fs.promises.statfs === 'function') {
      const stats = await fs.promises.statfs(dir);
      const freeBytes = stats.bavail * stats.bsize;
      return freeBytes >= neededBytes;
    }
  } catch {
    // If statfs unavailable or throws, assume true
  }
  return true;
}

/**
 * Downloads a file to `dest + '.part'`, verifies its SHA-256 checksum,
 * and atomically renames it to `dest`.
 * Cleans up `.part` on abort or checksum failure.
 */
export async function downloadFile(opts: DownloadOptions): Promise<{ path: string; bytes: number }> {
  const fetchImpl = opts.fetchFn ?? globalThis.fetch;
  const destDir = path.dirname(opts.dest);
  ensureDir(destDir);

  const partFile = `${opts.dest}.part`;

  // Check if destination file already exists and matches hash
  if (fs.existsSync(opts.dest) && opts.sha256) {
    const existingHash = await computeFileSha256(opts.dest);
    if (existingHash.toLowerCase() === opts.sha256.toLowerCase()) {
      const stat = fs.statSync(opts.dest);
      return { path: opts.dest, bytes: stat.size };
    }
  }

  const maxRetries = opts.maxRetries ?? 5;
  const stallTimeoutMs = opts.stallTimeoutMs ?? 25000;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    if (opts.signal?.aborted) {
      if (fs.existsSync(partFile)) {
        try { fs.unlinkSync(partFile); } catch { /* ignore */ }
      }
      throw new Error('Download aborted by signal');
    }

    // Check for resumable download if .part file already exists
    let startByte = 0;
    if (fs.existsSync(partFile)) {
      try {
        const partStat = fs.statSync(partFile);
        startByte = partStat.size;
      } catch {
        startByte = 0;
      }
    }

    const reqHeaders: Record<string, string> = { ...(opts.headers ?? {}) };
    if (startByte > 0) {
      reqHeaders['Range'] = `bytes=${startByte}-`;
    }

    let writeStream: fs.WriteStream | null = null;
    let stallTimer: NodeJS.Timeout | null = null;

    try {
      const internalAbortController = new AbortController();
      const onExternalAbort = () => internalAbortController.abort();
      if (opts.signal) {
        opts.signal.addEventListener('abort', onExternalAbort, { once: true });
      }

      let res: Response;
      try {
        res = await fetchImpl(opts.url, {
          headers: reqHeaders,
          signal: internalAbortController.signal,
        });
      } finally {
        if (opts.signal) {
          opts.signal.removeEventListener('abort', onExternalAbort);
        }
      }

      if (!res.ok && res.status !== 206) {
        // If range request was not satisfiable (416) or unsupported, restart from zero
        if (res.status === 416 || startByte > 0) {
          if (fs.existsSync(partFile)) {
            try { fs.unlinkSync(partFile); } catch { /* ignore */ }
          }
          if (attempt < maxRetries) {
            continue;
          }
        }
        const snippet = (await res.text().catch(() => '')).slice(0, 200);
        throw new Error(`Download failed with HTTP ${res.status} ${res.statusText}: ${snippet}`);
      }

      const isPartial = res.status === 206;
      const contentLength = Number(res.headers.get('content-length')) || 0;
      const total = isPartial ? startByte + contentLength : contentLength;

      // Pre-flight disk space if total size is known
      if (total > 0 && !(await hasFreeSpace(destDir, total - (isPartial ? startByte : 0)))) {
        throw new Error(`Insufficient disk space for download. Needed: ${(total / (1024 * 1024)).toFixed(1)} MB`);
      }

      writeStream = fs.createWriteStream(partFile, {
        flags: isPartial ? 'a' : 'w',
      });

      let received = isPartial ? startByte : 0;
      let lastProgressTime = 0;

      // Emit initial progress if starting or resumed
      if (received > 0 && total > 0) {
        const percent = Math.min(100, Math.round((received / total) * 100));
        opts.onProgress?.({ received, total, percent, status: 'downloading' });
      }

      if (!res.body) {
        throw new Error('Response body is null');
      }

      // Convert fetch ReadableStream to Node.js Readable
      const nodeStream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>);

      const resetStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          nodeStream.destroy(new Error(`Download stream stalled (no data received for ${Math.round(stallTimeoutMs / 1000)}s)`));
        }, stallTimeoutMs);
      };

      resetStallTimer();

      for await (const chunk of nodeStream) {
        resetStallTimer();

        if (opts.signal?.aborted) {
          throw new Error('Download aborted by signal');
        }

        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const canWrite = writeStream.write(buf);
        if (!canWrite) {
          await new Promise<void>((resolve) => writeStream!.once('drain', resolve));
        }
        received += buf.length;

        const now = Date.now();
        if (now - lastProgressTime >= 250 || received === total) {
          lastProgressTime = now;
          const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : undefined;
          opts.onProgress?.({ received, total, percent, status: 'downloading' });
        }
      }

      if (stallTimer) clearTimeout(stallTimer);

      await new Promise<void>((resolve, reject) => {
        writeStream!.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });

      // Verify checksum using streamed reader (memory safe for files of any size)
      if (opts.sha256) {
        opts.onProgress?.({ received, total, percent: 100, status: 'verifying' });
        const calculatedHash = await computeFileSha256(partFile);
        if (calculatedHash.toLowerCase() !== opts.sha256.toLowerCase()) {
          try {
            fs.unlinkSync(partFile);
          } catch {
            /* ignore */
          }
          throw new Error(
            `SHA-256 verification failed! Expected: ${opts.sha256.slice(0, 16)}..., Actual: ${calculatedHash.slice(0, 16)}...`,
          );
        }
      }

      // Atomic promotion
      fs.renameSync(partFile, opts.dest);
      opts.onProgress?.({ received, total, percent: 100, status: 'complete' });
      return { path: opts.dest, bytes: received };
    } catch (err) {
      if (stallTimer) clearTimeout(stallTimer);
      if (writeStream) {
        try { writeStream.close(); } catch { /* ignore */ }
      }

      if (opts.signal?.aborted) {
        if (fs.existsSync(partFile)) {
          try { fs.unlinkSync(partFile); } catch { /* ignore */ }
        }
        throw err;
      }

      const errMsg = err instanceof Error ? err.message : String(err);

      // Do not retry on SHA-256 mismatch (the file is corrupted)
      if (errMsg.includes('SHA-256 verification failed')) {
        throw err;
      }

      if (attempt < maxRetries) {
        let currentSize = 0;
        try {
          if (fs.existsSync(partFile)) currentSize = fs.statSync(partFile).size;
        } catch { /* ignore */ }

        opts.onProgress?.({
          received: currentSize,
          status: `Connection interrupted (${errMsg}). Resuming in 2s (attempt ${attempt}/${maxRetries})...`,
        });

        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      throw err;
    }
  }

  throw new Error(`Download failed after ${maxRetries} attempts`);
}

/** Computes SHA-256 of an existing file on disk. */
export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}
