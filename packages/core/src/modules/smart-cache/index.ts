import type { CacheEntry, CacheLookupResult, Usage } from '../../types.js';
import { exactKey, normalizePrompt, type CacheBackend } from './backends.js';
import { cosineSimilarity, LexicalEmbedding, type EmbeddingProvider } from './embeddings.js';

export interface SmartCacheOptions {
  backend: CacheBackend;
  ttlSeconds: number;
  embedding?: EmbeddingProvider;
  /** Minimum cosine similarity for a semantic hit. */
  semanticThreshold?: number;
}

/**
 * Smart Cache System.
 *
 * Three lookup layers, checked in order of cost:
 *
 *  1. `exact`    — normalized prompt hash. Cheap, deterministic.
 *  2. `semantic` — embedding similarity above a threshold. Catches
 *     rewordings without burning an API call.
 *  3. `partial`  — the stored prompt is a prefix of the current one; the
 *     cached response covers the shared part and only the delta needs a
 *     fresh completion.
 */
export class SmartCache {
  private readonly backend: CacheBackend;
  private readonly ttlSeconds: number;
  private readonly embedding: EmbeddingProvider;
  private readonly threshold: number;

  constructor(options: SmartCacheOptions) {
    this.backend = options.backend;
    this.ttlSeconds = options.ttlSeconds;
    this.embedding = options.embedding ?? new LexicalEmbedding();
    this.threshold = options.semanticThreshold ?? 0.85;
  }

  async lookup(prompt: string, options: { model?: string } = {}): Promise<CacheLookupResult> {
    const normalized = normalizePrompt(prompt);
    if (normalized.length === 0) return {};
    const model = options.model;

    // 1. Exact
    const exact = await this.backend.get(cacheKeyFor(normalized, model));
    if (exact) return { entry: exact, kind: 'exact' };

    // 2. Partial — a stored prompt that is a literal prefix of this one is a
    // stronger signal than fuzzy similarity, so it beats semantic.
    const partial = await this.partialLookup(normalized, model);
    if (partial) return partial;

    // 3. Semantic
    const semantic = await this.semanticLookup(normalized, model);
    if (semantic) return { entry: semantic.entry, kind: 'semantic' };

    return {};
  }

  /**
   * Stores a response. `keyModel` scopes the cache entry to a specific
   * requested model (e.g. the model the user selected), so a cached answer
   * produced under one model is never served for another. When omitted the
   * entry is stored unscoped (shared across models) — the historical
   * behavior.
   */
  async store(
    prompt: string,
    response: string,
    model: string,
    usage?: Usage,
    keyModel?: string,
  ): Promise<void> {
    const normalized = normalizePrompt(prompt);
    if (normalized.length === 0) return;
    const now = Date.now();
    const entry: CacheEntry = {
      key: cacheKeyFor(normalized, keyModel),
      prompt: normalized,
      response,
      model,
      createdAt: now,
      expiresAt: now + this.ttlSeconds * 1000,
      usage,
      embedding: await this.embedding.embed(normalized),
    };
    await this.backend.set(entry);
  }

  async clear(): Promise<void> {
    await this.backend.clear();
  }

  async close(): Promise<void> {
    await this.backend.close();
  }

  private async semanticLookup(
    normalized: string,
    model?: string,
  ): Promise<{ entry: CacheEntry } | undefined> {
    const query = await this.embedding.embed(normalized);
    let best: CacheEntry | undefined;
    let bestScore = this.threshold;
    for (const key of await this.backend.keys()) {
      const entry = await this.backend.get(key);
      if (!entry?.embedding) continue;
      if (model && !matchesModelScope(entry, model)) continue;
      const score = cosineSimilarity(query, entry.embedding);
      if (score > bestScore) {
        best = entry;
        bestScore = score;
      }
    }
    return best ? { entry: best } : undefined;
  }

  private async partialLookup(
    normalized: string,
    model?: string,
  ): Promise<CacheLookupResult | undefined> {
    let best: CacheEntry | undefined;
    for (const key of await this.backend.keys()) {
      const entry = await this.backend.get(key);
      if (!entry) continue;
      if (model && !matchesModelScope(entry, model)) continue;
      if (
        normalized.startsWith(entry.prompt) &&
        normalized.length > entry.prompt.length &&
        (!best || entry.prompt.length > best.prompt.length)
      ) {
        best = entry;
      }
    }
    if (!best) return undefined;
    return {
      entry: best,
      kind: 'partial',
      delta: normalized.slice(best.prompt.length).trim(),
    };
  }
}

/** Cache key for a normalized prompt, optionally scoped to a requested model. */
function cacheKeyFor(normalized: string, model?: string): string {
  return model ? exactKey(`${model}\n${normalized}`) : exactKey(normalized);
}

/** True when the entry was stored under the given model scope. */
function matchesModelScope(entry: CacheEntry, model: string): boolean {
  return entry.key === cacheKeyFor(normalizePrompt(entry.prompt), model);
}
