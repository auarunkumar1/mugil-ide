/**
 * Reversible Compression & Content-Compressed Retrieval (CCR)
 * ==========================================================
 * Headroom pattern: stores raw oversized tool outputs in a bounded LRU blob cache
 * and returns a compact structural reference `[Blob #id, N chars]`.
 * The model can inspect exact slices on demand via `read_blob`.
 */

export interface BlobEntry {
  id: string;
  content: string;
  size: number;
  createdAt: number;
}

export class BlobStore {
  private readonly blobs = new Map<string, BlobEntry>();
  private readonly maxEntries: number;
  private seq = 0;

  constructor(maxEntries = 50) {
    this.maxEntries = maxEntries;
  }

  put(content: string): string {
    const id = `blob_${(++this.seq).toString(36)}_${Date.now().toString(36).slice(-4)}`;
    if (this.blobs.size >= this.maxEntries) {
      const oldestKey = this.blobs.keys().next().value;
      if (oldestKey) this.blobs.delete(oldestKey);
    }
    this.blobs.set(id, {
      id,
      content,
      size: content.length,
      createdAt: Date.now(),
    });
    return id;
  }

  get(id: string): BlobEntry | undefined {
    return this.blobs.get(id);
  }

  readChunk(id: string, offset = 0, limit = 2000): { text: string; hasMore: boolean; total: number } | undefined {
    const entry = this.blobs.get(id);
    if (!entry) return undefined;
    const start = Math.max(0, offset);
    const end = Math.min(entry.size, start + Math.max(1, limit));
    return {
      text: entry.content.slice(start, end),
      hasMore: end < entry.size,
      total: entry.size,
    };
  }

  clear(): void {
    this.blobs.clear();
  }
}

export const globalBlobStore = new BlobStore();
