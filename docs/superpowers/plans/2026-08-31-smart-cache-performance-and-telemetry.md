# Plan: Smart Cache Performance Optimizations & Telemetry (Next Update)

**Goal**: Resolve identified memory, algorithmic complexity, latency, and observability bottlenecks in `SmartCache`, `MemoryBackend`, and model probing.

---

## Targeted Improvements

### 1. `MemoryBackend` Bounded LRU & Sweep
- **Problem**: `MemoryBackend.keys()` does not evict expired entries; map is unbounded.
- **Solution**:
  - Filter expired entries during `keys()`.
  - Add configurable `maxEntries` (default: 2,000) with LRU eviction policy when capacity is reached.
  - Optional periodic interval sweep (e.g. every 5 minutes) to reclaim memory from abandoned sessions.

### 2. Prefix Tree (Trie) for `partialLookup`
- **Problem**: `partialLookup` iterates over all keys $O(N)$ doing prefix substring checks.
- **Solution**:
  - Maintain an in-memory Prefix Trie alongside cache entries.
  - Perform $O(L)$ prefix traversal where $L$ is prompt length, returning the longest stored prefix in constant time relative to cache size $N$.

### 3. Asynchronous Non-Blocking `store()`
- **Problem**: `store()` awaits `this.embedding.embed(normalized)` synchronously before the response is returned to the caller.
- **Solution**:
  - Decouple cache storage from the critical return path using an asynchronous write queue (`setImmediate` / microtask).
  - Return response to user immediately while embedding generation and backend storage complete in the background.

### 4. Configurable Model Cache TTL
- **Problem**: `CACHE_TTL_MS = 60_000` is hardcoded in `models.ts`.
- **Solution**:
  - Add `cacheTtlMs?: number` to `FetchModelsOptions`.
  - Support `MUGIL_IDE_MODELS_CACHE_TTL` environment variable.

### 5. Comprehensive Cache Telemetry & Observability
- **Problem**: Only boolean `cache.hit` is emitted; no aggregate hit/miss ratios, TTL utilization, or latency metrics.
- **Solution**:
  - Add `SmartCache.getMetrics(): CacheMetrics`:
    ```ts
    interface CacheMetrics {
      lookups: number;
      exactHits: number;
      partialHits: number;
      semanticHits: number;
      misses: number;
      hitRate: number; // percentage
      tokensSavedTotal: number;
      evictions: number;
      activeEntries: number;
    }
    ```
  - Surface these metrics in the `/stats` command, web UI stats modal, and webhook events.
