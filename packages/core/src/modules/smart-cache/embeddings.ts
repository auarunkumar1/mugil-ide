import { createHash } from 'node:crypto';

/**
 * Embedding providers power the semantic cache layer. The default
 * implementation is fully offline: a hashed bag-of-words feature vector with
 * cosine similarity. When an OpenAI-compatible embeddings endpoint is
 * configured (OPENAI_API_KEY), a remote provider can be used instead, and any
 * failure transparently falls back to lexical similarity.
 */
export interface EmbeddingProvider {
  readonly name: string;
  embed(text: string): Promise<number[]>;
}

const FEATURE_DIM = 256;

/** Deterministic hashed bag-of-words vector, normalized to unit length. */
export class LexicalEmbedding implements EmbeddingProvider {
  readonly name = 'lexical';

  async embed(text: string): Promise<number[]> {
    const vector = new Float64Array(FEATURE_DIM);
    const tokens = text
      .toLowerCase()
      .match(/[a-z0-9_]+/g)
      ?? [];
    for (const token of tokens) {
      const h = createHash('sha256').update(token).digest();
      const idx = h.readUInt32BE(0) % FEATURE_DIM;
      vector[idx]! += 1;
    }
    const norm = Math.sqrt(Array.from(vector).reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return Array(FEATURE_DIM).fill(0);
    return Array.from(vector, (v) => v / norm);
  }
}

/** OpenAI-compatible `/embeddings` client; guarded so failures fall back. */
export class RemoteEmbedding implements EmbeddingProvider {
  readonly name = 'remote';

  constructor(
    private opts: { apiKey: string; model: string; baseUrl: string },
  ) {}

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.opts.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({ model: this.opts.model, input: text }),
    });
    if (!res.ok) {
      throw new Error(`embedding request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding) throw new Error('embedding response missing data');
    return embedding;
  }
}

/** Cosine similarity between two vectors (both assumed unit-length or raw). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Builds the embedding provider. Prefers the remote endpoint when a key is
 * configured; always falls back to lexical on any error.
 */
export function createEmbeddingProvider(opts: {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}): EmbeddingProvider {
  const lexical = new LexicalEmbedding();
  if (!opts.apiKey) return lexical;
  const remote = new RemoteEmbedding({
    apiKey: opts.apiKey,
    model: opts.model ?? 'text-embedding-3-small',
    baseUrl: opts.baseUrl ?? 'https://api.openai.com/v1',
  });
  return {
    name: `remote-with-lexical-fallback (${remote.name})`,
    async embed(text: string): Promise<number[]> {
      try {
        return await remote.embed(text);
      } catch {
        return lexical.embed(text);
      }
    },
  };
}
