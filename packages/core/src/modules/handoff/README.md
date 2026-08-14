# Auto Handoff Module

Routes a request to the cheapest model tier that fits, then automatically hands
off up the ladder when a model fails (rate limit, server error) or the task
outgrows the current model. Talks to OpenRouter's unified chat-completions API;
without an API key it runs in deterministic mock mode so the whole pipeline is
exercisable offline.

**Credits:** model routing and fallback are built on the
[OpenRouter](https://openrouter.ai) unified model API. See
[ATTRIBUTIONS.md](../../../../ATTRIBUTIONS.md).
