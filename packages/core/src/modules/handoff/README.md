# Auto Handoff Module

Routes a request to the cheapest model tier that fits, then automatically hands
off up the ladder when a model fails (rate limit, server error) or the task
outgrows the current model. Talks to OpenRouter's unified chat-completions API;
without an API key it runs in deterministic mock mode so the whole pipeline is
exercisable offline.

**Explicit selections are authoritative.** When `preferredModel` is set (e.g.
the user picked a local Ollama model in the TUI), the chain is pinned to
`[preferred, ...fallbackChain]` and never escalates into the rest of the
ladder — a failed preferred model surfaces an error instead of silently being
answered by a different model. Only auto-routing (no `preferredModel`) walks
`[primary, ...fallbackChain, ...ladder]`.

Clients cover OpenRouter, OpenAI-compatible endpoints (OpenAI, Ollama, LM
Studio, generic local), and Anthropic. `fetchProviderModels()` (see
`models.ts`) probes the active provider's catalog — `/v1/models`, Ollama's
native `/api/tags`, or Anthropic's `/v1/models` — with curated fallback
ladders when offline.

**Credits:** model routing and fallback are built on the
[OpenRouter](https://openrouter.ai) unified model API. See
[ATTRIBUTIONS.md](../../../../ATTRIBUTIONS.md).
