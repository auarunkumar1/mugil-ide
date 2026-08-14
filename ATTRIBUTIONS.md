# Attributions

The Mugil IDE engine is built as separate, focused modules. Several of them
implement ideas that were popularized by specific open-source projects and
authors — those are credited below, in the module header comments, and in each
module's `README.md`. Where a license is stated it is the upstream project's
own; check the linked repository for the authoritative version.

| Module | Concept | Creator / Project | Upstream | License |
| --- | --- | --- | --- | --- |
| **Caveman** | Terse, filler-free prompting — "why use many token when few token do trick" | Julius Brussee — `JuliusBrussee/caveman` (Claude Code skill cutting ~65% of output tokens; also compresses inputs) | https://github.com/JuliusBrussee/caveman | Skill: MIT; proxy/engine: BSL-1.1 |
| **RTK — Reduced Token Kernel** | Compressing redundant tool/command output and prompt context before it reaches the model | `rtk-ai/rtk` — "Rust Token Killer", a CLI proxy that compresses command output (git status/diff/log, test output, grep) for 60–90% fewer tokens | https://github.com/rtk-ai/rtk | See upstream repo |
| **Ponytail** | Output minimization — make the agent the "laziest senior dev in the room": smallest solution that works (YAGNI ladder), ~54% less code on real agentic sessions | Dietrich Gebert — `DietrichGebert/ponytail` | https://github.com/DietrichGebert/ponytail | See upstream repo |
| **Signature Remover** (prompt side) | Stripping identity preambles and message-format signatures ("You are Claude…", `Human:`/`Assistant:` markers, "As an AI language model…") | Anthropic (message format), OpenAI (ChatGPT preamble family) | https://docs.anthropic.com · https://platform.openai.com | n/a (formats) |
| **Signature Remover** (code side) | Removing AI-generated attribution headers, AI-attribution comments and invisible watermark characters from code | Community "de-AI" tooling: `conorbronsdon/avoid-ai-writing`, `wiltodelta/remove-ai-watermarks` and the clean-paste watermark strippers | https://github.com/conorbronsdon/avoid-ai-writing · https://github.com/wiltodelta/remove-ai-watermarks | See upstream repos |
| **Watermark Remover** | Stripping AI provenance watermarks from generated text — invisible Unicode carriers (zero-width chars, bidi, tag chars, exotic spaces) and vendor attribution lines; its "Layer B" (statistical token-sampling marks) is documented as a best-effort rewrite pass | Guillaume Meyer — `guillaumemeyer/watermarks-remover` (agent skill + Python scripts stripping multi-vendor AI provenance marks: Claude, Gemini/SynthID-Text, OpenAI surfaces) | https://github.com/guillaumemeyer/watermarks-remover | See upstream repo |
| **Codegraph** | Pre-built knowledge graph of a codebase — every symbol, call edge and dependency — so the agent gets the exact code it needs in one call | Colby McHenry — `colbymchenry/codegraph` | https://github.com/colbymchenry/codegraph | See upstream repo |
| **Smart Cache** | Exact + semantic + partial caching; distributed backend | Redis (backend), semantic-caching pattern from OpenAI embedding docs | https://redis.io · https://platform.openai.com/docs/guides/embeddings | Redis: BSD-3 |
| **Auto Handoff** | Model routing and automatic fallback across providers | OpenRouter (unified model API) | https://openrouter.ai | n/a (service) |
| **Tokenizer** | Byte-pair-encoding token counting | OpenAI `tiktoken` (cl100k_base) | https://github.com/openai/tiktoken | MIT |

## Notes

- This project's own code is original; the modules above are *inspired by* the
  listed projects and reimplement the ideas in TypeScript for this codebase,
  they are not copies of upstream source.
- If you are the author of one of the projects above and would like the
  attribution adjusted, please open an issue.
