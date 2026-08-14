# Mugil IDE

```
 __  __  _   _   ____   _____  _     
|  \/  | | | | | / ___| |_   _| | |    
| |\/| | | |_| | | |  _   | |   | |    
| |  | | |  _  | | |_| |   | |   | |___ 
|_|  |_| |_| |_|  \____|   |_|   |_____|
```

**Mugil IDE** is a production-ready, token-efficient AI IDE that runs as a
CLI (one-shot commands + interactive TUI) and an MCP server. It refines
prompts before they hit the model, caches aggressively (exact / semantic /
partial), routes and hands off models automatically via OpenRouter, and
strips signature boilerplate — all to minimize token cost while maximizing
AI productivity.

> New here? Read **[project-context.md](project-context.md)** first — it's the
> handoff doc: architecture, commands, conventions, and gotchas.

The product is **CLI-only**: all engine features are reachable from the
terminal (the browser frontends were removed to keep the tool fast and
dependency-light).

## Features

The engine is a set of **separate, credited modules** — see
[ATTRIBUTIONS.md](ATTRIBUTIONS.md) and each module's own `README.md`.

| Module | What it does | Inspired by |
| --- | --- | --- |
| **Caveman** | Terse, filler-free prompt compression | [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) |
| **RTK** (Reduced Token Kernel) | Boilerplate stripping, dedupe, command-output compression | [rtk-ai/rtk](https://github.com/rtk-ai/rtk) |
| **Ponytail** | Output minimization — "laziest senior dev" instruction + output budget | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) |
| **Signature Remover** | Strips Anthropic/OpenAI prompt signatures **and** AI-generated code signatures (headers, attribution comments, watermark chars) | Anthropic/OpenAI formats; community de-AI tooling |
| **Watermark Remover** | Strips AI provenance watermarks from generated text — invisible Unicode carriers (zero-width chars, bidi, tag chars, exotic spaces) and vendor attribution lines | [guillaumemeyer/watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover) |
| **Smart Cache** | `exact` → `partial` (prefix + delta) → `semantic` (embedding similarity); memory / Redis / file backends with TTL | Redis; semantic-caching pattern |
| **Auto Handoff** | OpenRouter (primary) / OpenAI / Anthropic clients with cost-based routing and automatic fallback chains; offline mock mode | [OpenRouter](https://openrouter.ai) |
| **Auto Update Manager** | Versioned, updatable module rules (JSON) + check/apply/periodic-watch against a registry + npm version check | — |
| **MCP Server** | Engine modules as MCP tools (`ask`, `refine_prompt`, `count_tokens`, `strip_*`, `compress_command_output`, `list_models`) over stdio | [Model Context Protocol](https://modelcontextprotocol.io) |
| **MD Generator** | Automated markdown docs from source (exports, classes, JSDoc) + token cost of the doc; periodic `--watch` mode | — |
| **Codegraph** | Knowledge graph of a codebase — every symbol, import/dependency edge and same-file call edge — so the agent gets exactly the code it needs in one call | [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) |
| **CLI** | Interactive Ink TUI, one-shot `run`, `update`, `docs` | — |

Everything degrades gracefully: no `OPENROUTER_API_KEY` → deterministic mock
completions; no Redis → file cache in `~/.cache/mugil-ide` (or in-memory in
tests); tiktoken unavailable → heuristic token estimator.

## Getting started

From source:

```bash
npm install
npm run build          # builds all packages
npm test               # 153 unit tests
npm run typecheck
```

Or install globally from npm (once published):

```bash
npm i -g mugil-ide        # provides `mugil-ide` + `mugil-ide-mcp`
mugil-ide --help
```

Packaging / publishing the monorepo:

```bash
npm run pack           # builds everything and packs all four @mugil-ide/* tarballs into dist-packages/
# publish in dependency order: core -> {docs, mcp} -> cli

npm run release        # release plan (dry-run) — see below
```

Releasing a new version:

```bash
npm run release minor              # print the plan (dry-run, default)
npm run release minor -- --bump    # bump versions + pack + git commit/tag
npm run release major -- --publish # ... and npm publish in dependency order
```

### One-shot mode

```bash
node packages/cli/dist/index.js run "Write a recursive fibonacci function in TypeScript"

# options
node packages/cli/dist/index.js run --json --no-refine "prompt"
node packages/cli/dist/index.js run -m anthropic/claude-3.5-sonnet "prompt"
node packages/cli/dist/index.js run --no-ponytail "prompt"        # disable output minimization
node packages/cli/dist/index.js run --output-budget 512 "prompt"  # cap completion tokens
```

`run` prints the model, cache outcome, token savings (original → refined,
with the percentage), applied strategies, usage, and the refined-prompt
diff inline, then the response. With `--json` you get the raw result.

### Interactive TUI

```bash
node packages/cli/dist/index.js
# type prompts, /quit to exit, Ctrl+C also works
```

The TUI shows a live status line while a request runs (pipeline stage + token
counts streaming as they happen) with an animated spinner, and supports
slash commands:

- `/plan` / `/act` — switch between **plan** (numbered plan only, no code)
  and **act** modes; shown in the header
- `/thinking` — show/hide the model's reasoning/thinking output (💭) when the
  provider returns it
- `/quit` / `/exit` — leave

Both preferences persist across sessions in the user env file
(`MUGIL_IDE_TUI_MODE`, `MUGIL_IDE_TUI_THINKING` — same file `login` uses).

### Markdown documentation

```bash
node packages/cli/dist/index.js docs .                        # write DOCUMENTATION.md for the current dir
node packages/cli/dist/index.js docs packages/core -o API.md -g "src/**/*.ts"
node packages/cli/dist/index.js docs . --watch --interval 300  # regenerate periodically
```

`@mugil-ide/docs` scans a project (skipping `node_modules`, `dist`, etc.),
extracts the API surface with lightweight parsers (TypeScript/JavaScript
exports, Python defs/classes, Go funcs/types, Rust fns/structs/enums/traits),
captures preceding doc comments, and writes a markdown doc with a file tree,
per-module symbol listings, and an estimated token cost of the rendered doc.

### MCP server

The engine is also exposed as a **Model Context Protocol** server
(`@mugil-ide/mcp`, stdio) so MCP clients — Claude Desktop, Cursor, agent
runtimes — can use the token-efficient pipeline directly:

```bash
npm run mcp                                # run the stdio server
# or point a client at the executable:  "command": "mugil-ide-mcp"
```

Tools: `count_tokens`, `refine_prompt`, `strip_signatures`,
`strip_code_signatures`, `strip_watermarks`, `codegraph`,
`codegraph_relevant`, `compress_command_output`, `caveman`, `rtk`,
`list_models`, and `ask` (the full strip → refine → cache → handoff
pipeline).

### Updating modules

Every credited module's rules (caveman phrases, rtk patterns, ponytail
ladder, signature patterns) are **versioned JSON data** that modules load at
runtime, preferring a local override store (`MUGIL_IDE_MODULES_DIR` or
`~/.config/mugil-ide/modules`). The Auto Update Manager compares them against a
remote registry and applies newer rules without code changes:

```bash
node packages/cli/dist/index.js update                 # check + apply
node packages/cli/dist/index.js update --check         # report only
node packages/cli/dist/index.js update --watch         # check/apply every interval
node packages/cli/dist/index.js update --watch --interval 3600 --registry https://…

npm run update:check                                   # same as --check
npm run update:watch                                   # periodic updater
```

### API keys — `login` / `logout` / `keys`

`mugil-ide login` registers you with a provider and saves your API key
**safely** to a user-level env file (`~/.config/mugil-ide/.env`, owner-only
permissions — the key is never echoed, logged, or committed):

```bash
mugil-ide login                          # interactive wizard
mugil-ide login -p openrouter            # preselect a provider
mugil-ide keys                           # show configured providers (masked)
mugil-ide logout openai                  # remove one provider's key
mugil-ide logout --all                   # remove every saved key
```

Providers: **OpenRouter (primary)**, OpenAI, Anthropic, plus custom
OpenAI- or Anthropic-compatible endpoints (custom base URL). The engine
picks the provider automatically — OpenRouter wins when its key is set,
then OpenAI, then Anthropic — or force one with `AI_PROVIDER`.

### Code graph — `mugil-ide graph`

Build a knowledge graph of a project (symbols, import edges, same-file call
edges — TS/JS, Python, Go, Rust) and pull the code relevant to a task for
context injection:

```bash
mugil-ide graph .                          # stats: files / symbols / edges
mugil-ide graph . --query "validate cache TTL"   # ranked symbols + snippets
mugil-ide graph . -o graph.json            # serialize the graph
```

Each symbol carries its source snippet (definition → next symbol), so a
`--query` gives the agent the exact code it needs in one call. Call edges
are same-file references; import edges map cross-file dependencies.

### Live mode (real models)

```bash
mugil-ide login                          # save your key once (see above)
node packages/cli/dist/index.js run "prompt"
```

## Environment variables

The npm packages use the `@mugil-ide/*` scope, matching the product brand
**Mugil IDE** (`mugil-ide` CLI command, `mugil-ide-mcp` MCP executable).

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | — | Enables live completions via OpenRouter (primary); absent → next provider or mock mode |
| `OPENROUTER_MODELS` | openrouter/auto, mistral-small, claude-3.5-sonnet | OpenRouter model ladder (cheap → smart) |
| `OPENAI_API_KEY` | — | OpenAI completions (and optional semantic-cache embeddings) |
| `OPENAI_MODELS` | gpt-4o-mini, gpt-4o, gpt-4.1 | OpenAI model ladder |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible endpoint base URL |
| `ANTHROPIC_API_KEY` | — | Anthropic completions |
| `ANTHROPIC_MODELS` | claude-3-5-haiku, claude-3-5-sonnet, claude-sonnet-4 | Anthropic model ladder |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Anthropic-compatible endpoint base URL |
| `AI_PROVIDER` | auto | Force a provider: `openrouter` \| `openai` \| `anthropic` |
| `MUGIL_IDE_ENV_FILE` | `~/.config/mugil-ide/.env` | User env file storing saved API keys |
| `MUGIL_IDE_TUI_MODE` | `act` | Persisted TUI mode: `act` \| `plan` |
| `MUGIL_IDE_TUI_THINKING` | `hide` | Persisted TUI thinking pref: `show` \| `hide` |
| `REDIS_URL` | — | Redis cache (single node); absent → file cache |
| `REDIS_CLUSTER_URLS` | — | Comma-separated node URLs; enables the Redis Cluster backend (used when `REDIS_URL` is unset) |
| `MUGIL_IDE_CACHE_DIR` | `~/.cache/mugil-ide` | File-cache location |
| `CACHE_TTL` | `3600` | Cache entry TTL (seconds) |
| `TOKEN_BUDGET` | `10000` | Max tokens per refined prompt |
| `MUGIL_IDE_MODULES_REGISTRY` | — | Remote module-rules registry URL for `mugil-ide update` |
| `MUGIL_IDE_MODULES_DIR` | `~/.config/mugil-ide/modules` | Where updated module rules are stored |
| `AI_DEBUG` | `false` | Debug logging |

## Architecture

```
packages/
├── core/                     @mugil-ide/core — the engine
│   ├── src/modules/          separate, credited modules
│   │   ├── caveman/          terse prompt compression
│   │   ├── rtk/              reduced token kernel + command-output compression
│   │   ├── ponytail/         output minimization (instruction + budget)
│   │   ├── signature-remover/ prompt + AI-code signature stripping
│   │   ├── watermark-remover/ AI provenance watermark stripping (Layer A)
│   │   ├── codegraph/         code knowledge graph (symbols, imports, calls)
│   │   ├── smart-cache/      exact/partial/semantic cache, backends, embeddings
│   │   ├── handoff/          OpenRouter client + Auto Handoff Manager
│   │   └── overrides.ts      runtime rules override store (update target)
│   ├── src/rules/            versioned rules JSON + module registry
│   ├── src/update/           Auto Update Manager (check/apply/watch)
│   ├── src/token/tokenizer.ts  tiktoken + estimator fallback
│   ├── src/refine.ts         composition: caveman → rtk → truncate-to-budget
│   ├── src/pipeline.ts       strip → refine → cache → handoff → store
│   └── src/config.ts         env-driven config
└── cli/                      mugil-ide — Ink TUI, one-shot runner
└── mcp/                      @mugil-ide/mcp — MCP server exposing the engine as tools
└── docs/                     @mugil-ide/docs — MD Generator (automated + periodic docs)
```

The request path: **signature strip → token refinement (caveman + rtk +
truncate) → cache lookup → model routing/handoff → cache store**, with
Ponytail's output-minimization instruction injected into the system prompt.
Token counts, savings and cache outcomes are surfaced in the CLI and exposed
to MCP clients via `PipelineEvent`s.

## Roadmap

- ✅ Core engine + CLI
- ✅ Credited module split (caveman / rtk / ponytail / signature-remover / smart-cache / handoff)
- ✅ Auto Update Manager (updatable module rules + periodic check/apply)
- ✅ MCP server (`@modelcontextprotocol/sdk`) — engine as tools over stdio
- ✅ MD Generator (`mugil-ide docs`, periodic `--watch`)
- ✅ Redis hardening (SCAN cursor loop instead of blocking `KEYS`, multi-node Cluster support via `REDIS_CLUSTER_URLS`)
- ✅ npm packaging (all four `@mugil-ide/*` tarballs publishable; `mugil-ide` / `mugil-ide-mcp` bins verified from an installed tarball layout)
- ✅ Watermark Remover module (credited to `guillaumemeyer/watermarks-remover`; Layer A Unicode hygiene + vendor attribution-line stripping, wired into the pipeline output)
- ✅ Registration + API-key management — `login`/`logout`/`keys` commands; safe key saving in a user-level env file (0600) for OpenRouter (primary), OpenAI, and Anthropic providers, incl. custom compatible endpoints
- ✅ Codegraph module (credited to `colbymchenry/codegraph`; symbols, import + call edges, context queries via `mugil-ide graph`)
- ✅ Release tooling (`npm run release`: version/bump/pack/tag; `--publish` ships in dependency order)

## License

MIT (placeholder — set before publishing).
