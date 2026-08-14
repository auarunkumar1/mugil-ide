# Smart Cache Module

Three-layer response cache, checked in order of cost:
1. **exact** — normalized prompt hash
2. **partial** — a stored prompt that is a literal prefix of the current one
   (cached response covers the shared part; only the delta needs a completion)
3. **semantic** — embedding cosine similarity above a threshold (lexical
   bag-of-words fallback when no embeddings API is configured)

Backends: in-memory (default), Redis (`REDIS_URL`), or file
(`MUGIL_IDE_CACHE_DIR`). All entries have a TTL.

**Credits:** Redis for the distributed backend; the exact/semantic caching
pattern from OpenAI's embedding docs. See
[ATTRIBUTIONS.md](../../../../ATTRIBUTIONS.md).
