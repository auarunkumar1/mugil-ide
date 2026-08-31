import type { CacheEntry, CacheLookupResult, Usage } from '../../types.js';
import { exactKey, normalizePrompt, type CacheBackend } from './backends.js';
import { cosineSimilarity, LexicalEmbedding, type EmbeddingProvider } from './embeddings.js';

export interface SmartCacheOptions {
  backend: CacheBackend;
  ttlSeconds: number;
  embedding?: EmbeddingProvider;
  /** Minimum cosine similarity for a semantic hit. */
  semanticThreshold?: number;
  /**
   * Scopes every cache key to a namespace (e.g. the workspace directory), so
   * one project's cached answers are never served for another project that
   * happens to ask the same question.
   */
  namespace?: string;
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
export interface CacheMetrics {
  lookups: number;
  hits: number;
  exactHits: number;
  partialHits: number;
  semanticHits: number;
  misses: number;
  hitRatePct: number;
  stores: number;
}

export class SmartCache {
  private readonly backend: CacheBackend;
  private readonly ttlSeconds: number;
  private readonly embedding: EmbeddingProvider;
  private readonly threshold: number;
  private readonly namespace: string | undefined;
  private lookups = 0;
  private exactHits = 0;
  private partialHits = 0;
  private semanticHits = 0;
  private misses = 0;
  private stores = 0;

  constructor(options: SmartCacheOptions) {
    this.backend = options.backend;
    this.ttlSeconds = options.ttlSeconds;
    this.embedding = options.embedding ?? new LexicalEmbedding();
    this.threshold = options.semanticThreshold ?? 0.85;
    this.namespace = options.namespace;
  }

  getMetrics(): CacheMetrics {
    const totalHits = this.exactHits + this.partialHits + this.semanticHits;
    const hitRatePct = this.lookups > 0 ? Math.round((totalHits / this.lookups) * 100) : 0;
    return {
      lookups: this.lookups,
      hits: totalHits,
      exactHits: this.exactHits,
      partialHits: this.partialHits,
      semanticHits: this.semanticHits,
      misses: this.misses,
      hitRatePct,
      stores: this.stores,
    };
  }

  resetMetrics(): void {
    this.lookups = 0;
    this.exactHits = 0;
    this.partialHits = 0;
    this.semanticHits = 0;
    this.misses = 0;
    this.stores = 0;
  }

  async lookup(prompt: string, options: { model?: string } = {}): Promise<CacheLookupResult> {
    const normalized = normalizePrompt(prompt);
    if (normalized.length === 0) return {};
    this.lookups += 1;
    const model = options.model;

    // 1. Exact
    const exact = await this.backend.get(cacheKeyFor(normalized, model, this.namespace));
    if (exact) {
      this.exactHits += 1;
      return { entry: exact, kind: 'exact' };
    }

    // 2. Partial — a stored prompt that is a literal prefix of this one is a
    // stronger signal than fuzzy similarity, so it beats semantic.
    const partial = await this.partialLookup(normalized, model);
    if (partial) {
      this.partialHits += 1;
      return partial;
    }

    // 3. Semantic
    const semantic = await this.semanticLookup(normalized, model);
    if (semantic) {
      this.semanticHits += 1;
      return { entry: semantic.entry, kind: 'semantic' };
    }

    this.misses += 1;
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
    /** True when the response came from the offline mock client. */
    mock?: boolean,
  ): Promise<void> {
    const normalized = normalizePrompt(prompt);
    if (normalized.length === 0) return;
    this.stores += 1;
    const now = Date.now();
    const entry: CacheEntry = {
      key: cacheKeyFor(normalized, keyModel, this.namespace),
      prompt: normalized,
      response,
      model,
      createdAt: now,
      expiresAt: now + this.ttlSeconds * 1000,
      usage,
      embedding: await this.embedding.embed(normalized),
      mock,
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
      if (!matchesScope(entry, model, this.namespace)) continue;
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
    const normLen = normalized.length;
    for (const key of await this.backend.keys()) {
      const entry = await this.backend.get(key);
      if (!entry) continue;
      // Fast length pruning: candidate prefix must be strictly shorter than query
      // and longer than the current best candidate
      const promptLen = entry.prompt.length;
      if (promptLen >= normLen || (best && promptLen <= best.prompt.length)) {
        continue;
      }
      if (!matchesScope(entry, model, this.namespace)) continue;
      if (normalized.startsWith(entry.prompt)) {
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

/**
 * Cache key for a normalized prompt, optionally scoped to a namespace
 * (workspace) and a requested model — so a cached answer is never served
 * for another project or another model.
 */
function cacheKeyFor(normalized: string, model?: string, namespace?: string): string {
  const scope = [namespace, model].filter(Boolean).join('\n');
  return scope ? exactKey(`${scope}\n${normalized}`) : exactKey(normalized);
}

/**
 * True when the entry's key matches the given namespace + model scope.
 * Always checked (namespace is instance-level; model is per-lookup), so a
 * project or model never receives another's semantically-matched answer.
 */
function matchesScope(entry: CacheEntry, model: string | undefined, namespace: string | undefined): boolean {
  return entry.key === cacheKeyFor(normalizePrompt(entry.prompt), model, namespace);
}
