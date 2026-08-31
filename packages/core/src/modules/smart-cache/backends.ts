import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createClient, createCluster } from 'redis';
import type { CacheEntry } from '../../types.js';

export interface CacheBackend {
  readonly name: string;
  get(key: string): Promise<CacheEntry | undefined>;
  set(entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory backend (default; always available)
// ---------------------------------------------------------------------------

export class MemoryBackend implements CacheBackend {
  readonly name = 'memory';
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxEntries: number;

  constructor(options: { maxEntries?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 2000;
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // Re-insert to refresh LRU order
    this.store.delete(key);
    this.store.set(key, entry);
    return entry;
  }

  async set(entry: CacheEntry): Promise<void> {
    // If key already exists, delete it first to maintain LRU order
    this.store.delete(entry.key);

    // If capacity reached, sweep expired entries first
    if (this.store.size >= this.maxEntries) {
      const now = Date.now();
      for (const [k, e] of this.store.entries()) {
        if (now > e.expiresAt) {
          this.store.delete(k);
        }
      }
    }

    // If still at capacity, evict the oldest entry
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(entry.key, entry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async keys(): Promise<string[]> {
    const now = Date.now();
    const liveKeys: string[] = [];
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      } else {
        liveKeys.push(key);
      }
    }
    return liveKeys;
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Redis backend (degrades gracefully: any failure is swallowed and reported)
// ---------------------------------------------------------------------------

// Minimal surface of the redis client that this backend actually uses. Both
// the single-node client and the cluster client satisfy it, which keeps the
// degraded-fallback logic shared between the two modes.
interface RedisLike {
  isOpen: boolean;
  connect(): Promise<void>;
  quit(): Promise<void>;
  on(event: string, listener: () => void): void;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { PX?: number }): Promise<unknown>;
  del(keys: string | string[]): Promise<unknown>;
  scan(
    cursor: string,
    opts?: { MATCH?: string; COUNT?: number }
  ): Promise<{ cursor: string; keys: string[] }>;
}

export class RedisBackend implements CacheBackend {
  readonly name = 'redis';
  private client: RedisLike | undefined;
  private urls: string[];
  private broken = false;

  constructor(url: string | string[]) {
    // A single URL is a standalone instance; multiple URLs are cluster nodes.
    this.urls = (Array.isArray(url) ? url : [url]).filter(Boolean);
  }

  private async connect(): Promise<RedisLike | undefined> {
    if (this.broken) return undefined;
    if (this.client?.isOpen) return this.client;
    if (this.client) {
      try {
        await this.client.connect();
        return this.client;
      } catch {
        this.broken = true;
        return undefined;
      }
    }
    const isCluster = this.urls.length > 1;
    const client = isCluster
      ? createCluster({ rootNodes: this.urls.map((url) => ({ url })) })
      : createClient({ url: this.urls[0] ?? '' });
    client.on('error', () => {
      // Never crash the engine because Redis is down.
      this.broken = true;
    });
    this.client = client as unknown as RedisLike;
    try {
      await client.connect();
      this.broken = false;
      return this.client;
    } catch {
      this.broken = true;
      return undefined;
    }
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const client = await this.connect();
    if (!client) return undefined;
    try {
      const raw = await client.get(this.prefix(key));
      if (!raw) return undefined;
      const entry = JSON.parse(raw) as CacheEntry;
      if (Date.now() > entry.expiresAt) {
        await client.del(this.prefix(key));
        return undefined;
      }
      return entry;
    } catch {
      return undefined;
    }
  }

  async set(entry: CacheEntry): Promise<void> {
    const client = await this.connect();
    if (!client) return;
    try {
      await client.set(this.prefix(entry.key), JSON.stringify(entry), {
        PX: Math.max(1, entry.expiresAt - Date.now()),
      });
    } catch {
      // Ignore — caller continues with degraded cache.
    }
  }

  async delete(key: string): Promise<void> {
    const client = await this.connect();
    if (!client) return;
    try {
      await client.del(this.prefix(key));
    } catch {
      // ignore
    }
  }

  /**
   * Scans the cache namespace with a SCAN cursor loop instead of the blocking
   * KEYS command, so large caches never stall the Redis server.
   */
  private async scanKeys(
    client: RedisLike,
    onBatch: (keys: string[]) => Promise<void> | void
  ): Promise<void> {
    let cursor = '0';
    do {
      const page = await client.scan(cursor, { MATCH: `${this.prefix('')}*`, COUNT: 100 });
      cursor = page.cursor;
      if (page.keys.length > 0) await onBatch(page.keys);
    } while (cursor !== '0');
  }

  async keys(): Promise<string[]> {
    const client = await this.connect();
    if (!client) return [];
    try {
      const out: string[] = [];
      await this.scanKeys(client, (keys) => {
        for (const k of keys) out.push(k.slice(this.prefix('').length));
      });
      return out;
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    const client = await this.connect();
    if (!client) return;
    try {
      await this.scanKeys(client, async (keys) => {
        await client.del(keys);
      });
    } catch {
      // ignore
    }
  }

  async close(): Promise<void> {
    if (this.client?.isOpen) {
      try {
        await this.client.quit();
      } catch {
        // ignore
      }
    }
  }

  private prefix(key: string): string {
    return `aiide:cache:${key}`;
  }
}

// ---------------------------------------------------------------------------
// File backend (simple JSON-per-entry on disk)
// ---------------------------------------------------------------------------

export class FileBackend implements CacheBackend {
  readonly name = 'file';
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private entryPath(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    try {
      const raw = await fs.readFile(this.entryPath(key), 'utf8');
      const entry = JSON.parse(raw) as CacheEntry;
      if (Date.now() > entry.expiresAt) {
        await this.delete(key);
        return undefined;
      }
      return entry;
    } catch {
      return undefined;
    }
  }

  async set(entry: CacheEntry): Promise<void> {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(this.entryPath(entry.key), JSON.stringify(entry), 'utf8');
    } catch {
      // Ignore — caller continues with degraded cache.
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.entryPath(key));
    } catch {
      // ignore
    }
  }

  async keys(): Promise<string[]> {
    try {
      const names = await fs.readdir(this.dir);
      return names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5));
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    try {
      await fs.rm(this.dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  async close(): Promise<void> {
    // no-op
  }
}

/** Resolves the best backend given the environment, with graceful fallbacks. */
export function createCacheBackend(opts: {
  redisUrl?: string;
  redisClusterUrls?: string[];
  cacheDir?: string;
}): CacheBackend {
  if (opts.redisUrl) {
    return new RedisBackend(opts.redisUrl);
  }
  if (opts.redisClusterUrls && opts.redisClusterUrls.length > 0) {
    return new RedisBackend(opts.redisClusterUrls);
  }
  if (opts.cacheDir) {
    return new FileBackend(opts.cacheDir);
  }
  return new MemoryBackend();
}

export function exactKey(prompt: string): string {
  return createHash('sha256').update(normalizePrompt(prompt)).digest('hex');
}

export function normalizePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim();
}
