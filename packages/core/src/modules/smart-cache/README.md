# Smart Cache Module

Three-layer response cache, checked in order of cost:
1. **exact** — normalized prompt hash
2. **partial** — a stored prompt that is a literal prefix of the current one
   (cached response covers the shared part; only the delta needs a completion)
3. **semantic** — embedding cosine similarity above a threshold (lexical
   bag-of-words fallback when no embeddings API is configured)

Backends: in-memory (default), Redis (`REDIS_URL`), or file
(`MUGIL_IDE_CACHE_DIR`). All entries have a TTL.

**Model-scoped entries.** `lookup(prompt, { model })` and
`store(prompt, response, model, usage, keyModel)` namespace the key by the
requested model, and the partial/semantic layers only match entries stored
under the same scope — so a cached answer produced under one selected model
(e.g. DeepSeek) is never served for another (e.g. a local Ollama model).
`openrouter/auto` is exempt and keeps a shared cache because it routes
dynamically.

**Workspace-scoped entries.** `SmartCacheOptions.namespace` (the engine
passes `process.cwd()`) is folded into every cache key and into the
partial/semantic scope check, so two projects that happen to ask the same
question never receive each other's cached answer — the same isolation the
session auto-save gets.

**Credits:** Redis for the distributed backend; the exact/semantic caching
pattern from OpenAI's embedding docs. See
[ATTRIBUTIONS.md](../../../../ATTRIBUTIONS.md).
