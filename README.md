# Mugil IDE

```
 __  __  _   _   ____   _____  _
|  \/  | | | | | / ___| |_   _| | |
| |\/| | | |_| | | |  _   | |   | |
| |  | | |  _  | | |_| |   | |   | |___
|_|  |_| |_| |_|  \____|   |_|   |_____|
```

**Mugil IDE** is a token-efficient autonomous AI IDE that runs as a
**browser-based web IDE** (xterm.js two-pane UI) and an MCP stdio server. It
refines prompts before they hit the model, caches aggressively (exact /
semantic / partial), routes and hands off models automatically via
OpenRouter, and strips signature boilerplate — all to minimize token cost
while maximizing AI productivity.

The product is **browser-only** — there is **no TUI and no terminal CLI**. The
Ink TUI was deleted and the console REPL retired; all interactive use happens
in the browser (the local server opens your default browser automatically).
The terminal front-end (xterm.js) is **vendored into the package**, so an
installed client runs fully offline — no CDN, no Node-gyp surprises.

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
| **Smart Cache** | `exact` → `partial` (prefix + delta) → `semantic` (embedding similarity); memory / Redis / file backends with TTL; entries can be scoped to the requested model so one model's answer is never served for another | Redis; semantic-caching pattern |
| **Auto Handoff** | OpenRouter (primary) / OpenAI / Anthropic / Ollama / LM Studio / local clients with cost-based routing and fallback chains; an explicitly selected model is authoritative (no silent ladder fallback); tool declarations forwarded in each provider's wire format; offline mock mode | [OpenRouter](https://openrouter.ai) |
| **Tool Loop** | Bounded agentic function calling with **16 workspace tools** (`read_file`, `list_files`, `search_code`, `codegraph`, `write_file`, `edit_file`, `apply_patch`, `run_command`, `todowrite`, `todoread`, `skill`, `webfetch`, `websearch`, `lsp`, `question`, `task`), error capture for unknown/failed tools, a forced final summary after `maxIterations`, and a full cache bypass for tool-bearing asks. Module-level extras (permission gate, env-context injection, skills prompt injection, post-edit diagnostics, MCP client, sessions) — see **Tool loop wiring** below | [OpenCode](https://github.com/sst/opencode) · [Pi](https://github.com/earendil-works/pi) — established coding-agent patterns |
| **Auto Update Manager** | Versioned, updatable module rules (JSON) + check/apply/periodic-watch against a registry + npm version check | — |
| **MCP Server** | Engine modules as MCP tools (`ask`, `refine_prompt`, `count_tokens`, `strip_*`, `compress_command_output`, `list_models`) over stdio | [Model Context Protocol](https://modelcontextprotocol.io) |
| **MCP Client** | Consumes stdio / streamable-HTTP MCP servers as `mcp__<server>__<tool>` tools (lazy per-session connection, soft failures). **Wired** — powers `websearch` (Exa) and surfaces `MUGIL_IDE_MCP_SERVERS` / `MUGIL_IDE_MCP_CONFIG` servers as agent tools (ask-gated in act mode, denied in plan) | [Model Context Protocol](https://modelcontextprotocol.io) · OpenCode MCP consumption |
| **MD Generator** | Automated markdown docs from source (exports, classes, JSDoc) + token cost of the doc; periodic `--watch` mode | — |
| **Codegraph** | Knowledge graph of a codebase — every symbol, import/dependency edge and same-file call edge — so the agent gets exactly the code it needs in one call | [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) |
| **CLI package** | The browser-only web IDE server (HTTP + WebSocket, xterm.js two-pane UI) + non-interactive utilities (`run`, `graph`, `docs`, `update`, `keys`, `logout`) | — |

Everything degrades gracefully: no `OPENROUTER_API_KEY` → deterministic mock
completions; no Redis → file cache in `~/.cache/mugil-ide` (or in-memory in
tests); tiktoken unavailable → heuristic token estimator.

### Tool loop wiring

The engine modules are built and unit-tested, but **only a subset is wired
into the shipped web client** today:

- **In the agent loop**: `read_file`, `list_files`, `search_code`, `codegraph`,
  `write_file`, `edit_file`, `apply_patch`, `run_command`, `todowrite`,
  `todoread`, `skill`, `webfetch` — always available (writes/edits are
  undoable via the web UI). `websearch` (needs `MUGIL_IDE_ENABLE_EXA=1`) and
  `lsp` (needs `MUGIL_IDE_ENABLE_LSP=1` + a language server on PATH) are
  env-gated. `question` shows a **browser picker modal** (the agent asks,
  you click an option, the answer feeds back into the loop). `task` runs
  **subagents** (read-only `explore` / full `general` modes) with the
  engine's handoff; subagent tool calls stream as dim status lines.
- **Permission gate (wired)**: every tool call is gated `allow`/`ask`/`deny`
  per mode — `/plan` (read-only: writes/edits/commands denied outright) vs
  `/act` (asks first). `ask`-gated calls (writes, edits, commands, MCP)
  trigger an **approval modal** in the browser; deny/allow feeds back to the
  model as a `Permission denied` tool result. Per-mode overrides can be set
  via `MUGIL_IDE_TOOL_PERMISSIONS` in the user env file.
- **Environment-context injection (wired)**: the system prompt carries cwd,
  platform, date, and any `AGENTS.md` / `CLAUDE.md` found walking up from
  the workspace.
- **Post-edit diagnostics (wired)**: `MUGIL_IDE_TOOL_DIAGNOSTICS=1` runs
  `tsc --noEmit` after writes/edits and feeds errors back to the model.
- **MCP client consumption (wired)**: `MUGIL_IDE_MCP_SERVERS` /
  `MUGIL_IDE_MCP_CONFIG` servers surface as `mcp__<server>__<tool>` tools
  (ask-gated in act mode, denied in plan mode, soft connection failures).
- **Sessions (wired)**: every turn auto-saves to `MUGIL_IDE_CACHE_DIR` and
  the latest session resumes on launch; `/session <name>`, `/sessions`,
  `/resume <name>`, `/clear-session` manage named sessions.
- **`/compact` (wired)**: summarizes the conversation via a dedicated model
  call and continues from the summary.
- **Skills prompt injection (wired)**: `skillsContextBlock(cwd)` lists
  available `.agents/skills` / `.claude/skills` in the system prompt.

## Getting started

From source:

```bash
npm install
npm run build          # builds all packages
npm test               # 335 unit tests
npm run typecheck
npm run smoke:question-picker   # real-browser smoke of the question-picker modal (needs Chrome)
npm run smoke:diff-viewer       # real-browser smoke of the Diff Viewer tab (needs Chrome)
```

Or install globally from npm:

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

The `mugil-ide` tarball ships compiled `dist/` **including the vendored
xterm.js assets**, so an installed client serves its UI fully offline.

## Web IDE (the product)

```bash
mugil-ide              # starts the server and opens your default browser
mugil-ide ui --port 3000 --no-open
```

The two-pane interface has:

- **Left pane** — the AI assistant terminal (xterm.js) and a shell PTY
  terminal (`node-pty` with a `child_process` fallback; spawned **lazily** on
  first use of the shell pane), plus clickable turn
  chips and a quick-prompt input bar. When the agent asks a structured
  mid-task question, a **picker modal** appears — click an option (or press
  Esc to dismiss) and the answer is fed back to the agent. When the agent
  wants to write/edit/run a command in act mode, a **🔒 approval modal**
  shows the exact tool call with Allow / Deny.
- **Right pane** — a searchable file explorer, a file viewer, a live diff
  viewer with 1-click undo, and the visual CodeGraph.
- **Header** — active model caption, Model Selector, **Accounts & Keys**
  modal, token-savings gauge, undo, stats, clear.

Slash commands (type them in the quick input / agent terminal):

`/help`, `/models`, `/model <name|number>`, `/plan` (read-only), `/act`
(asks before writes), `/undo`, `/graph`, `/stats`, `/history`, `/reset`,
`/clear`, `/compact` (summarize and continue), `/session <name>` (save),
`/sessions` (list), `/resume <name>` (restore), `/clear-session` (wipe).

Preferences persist in the user env file (`MUGIL_IDE_MODEL`, `AI_PROVIDER`,
provider keys — written by the web UI).

### One-shot mode

```bash
node packages/cli/dist/index.js run "Write a recursive fibonacci function in TypeScript"

# options
node packages/cli/dist/index.js run --json --no-refine "prompt"
node packages/cli/dist/index.js run -m anthropic/claude-3.5-sonnet "prompt"
node packages/cli/dist/index.js run -t medium "prompt"           # thinking level: off | low | medium | high
node packages/cli/dist/index.js run --no-ponytail "prompt"        # disable output minimization
node packages/cli/dist/index.js run --output-budget 512 "prompt"  # cap completion tokens
```

`run` prints the model, cache outcome, token savings (original → refined,
with the percentage), applied strategies, usage, and the refined-prompt
diff inline, then the response. With `--json` you get the raw result.

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

The engine also contains an **MCP client** module (stdio and streamable-HTTP
servers, `mcp__<server>__<tool>` namespacing, soft failures). It powers the
`websearch` tool (Exa AI's hosted MCP) and surfaces user-configured servers
(`MUGIL_IDE_MCP_SERVERS` / `MUGIL_IDE_MCP_CONFIG`) as agent tools in the
loop — ask-gated in act mode, denied in plan mode.

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

### API keys — Accounts modal / `keys` / `logout`

API keys are configured in the web UI's **Accounts & Keys** modal, which saves
them **safely** to a user-level env file (`~/.config/mugil-ide/.env`, owner-only
permissions — the key is never echoed, logged, or committed):

```bash
mugil-ide keys                           # show configured providers (masked)
mugil-ide logout openai                  # remove one provider's key
mugil-ide logout --all                   # remove every saved key
```

Providers: **OpenRouter (primary)**, OpenAI, Anthropic, plus **Ollama**,
**LM Studio**, and generic local OpenAI-compatible endpoints — connect any of
them from the Accounts modal (local providers default to
`http://localhost:11434/v1`, `:1234/v1`, `:8000/v1`). The engine picks the
provider automatically — OpenRouter wins when its key is set, then OpenAI,
then Anthropic — or force one with `AI_PROVIDER`
(`openrouter | openai | anthropic | ollama | lmstudio | local`).

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
# add a key in the web UI's Accounts & Keys modal, or edit ~/.config/mugil-ide/.env
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
| `AI_PROVIDER` | auto | Force a provider: `openrouter` \| `openai` \| `anthropic` \| `ollama` \| `lmstudio` \| `local` |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama endpoint (local AI) |
| `OLLAMA_MODELS` | llama3.2, deepseek-r1:8b, qwen2.5-coder, mistral | Ollama model ladder |
| `LMSTUDIO_BASE_URL` | `http://localhost:1234/v1` | LM Studio endpoint |
| `LOCAL_BASE_URL` | `http://localhost:8000/v1` | Generic local / OpenAI-compatible endpoint |
| `MUGIL_IDE_ENV_FILE` | `~/.config/mugil-ide/.env` | User env file storing saved API keys |
| `MUGIL_IDE_MODEL` | first model in ladder | Persisted model selection (written by the web UI's model selector) |
| `MUGIL_IDE_TOOL_PERMISSIONS` | — | Per-mode permission overrides JSON (`{"act":{"write_file":"deny"}}`) — applied by the session driver on top of mode defaults; env-file editing only |
| `MUGIL_IDE_TOOL_DIAGNOSTICS` | `false` | Post-edit `tsc --noEmit` feedback fed back to the model (`1` to enable — the client honors it) |
| `MUGIL_IDE_MCP_SERVERS` / `MUGIL_IDE_MCP_CONFIG` | — | MCP servers to consume (JSON / JSON file) — surfaced as `mcp__*` agent tools (ask-gated in act mode, denied in plan) |
| `MUGIL_IDE_ENABLE_EXA` | `false` | Enable the `websearch` agent tool (delegates to Exa AI's hosted MCP, no key needed) |
| `MUGIL_IDE_EXA_API_KEY` | — | Optional Exa API key (sent as `x-api-key`) to lift `websearch` rate limits |
| `MUGIL_IDE_WEBHOOKS` | — | JSON array of webhook endpoints to notify on pipeline events (`turn.started` / `tool.executed` / `turn.completed` / `turn.error`) — **wired** |
| `MUGIL_IDE_WEBHOOKS_CONFIG` | — | JSON file with the same webhook array (env value wins on URL conflicts) |
| `MUGIL_IDE_ENABLE_LSP` | `false` | Enable the `lsp` agent tool (`goToDefinition`/`findReferences`/`hover` via `typescript-language-server` on PATH) |
| `MUGIL_IDE_PTY_BACKEND` | `auto` | Shell-pane PTY backend: `auto` (node-pty → child_process fallback) or `child` (always plain child_process; clean teardown on Windows) |
| `MUGIL_IDE_QUESTION_TIMEOUT_MS` | `120000` | Mid-task question-picker timeout (test hook used by `npm run smoke:question-picker`) |
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
│   │   ├── tool-loop/        bounded agentic function-calling loop
│   │   ├── tools/            workspace tools + permissions + diagnostics + context
│   │   ├── skills/           SKILL.md discovery + lazy loading
│   │   ├── mcp-client/       MCP client (stdio + streamable HTTP)
│   │   ├── lsp/              stdio LSP client (goToDefinition/findReferences/hover)
│   │   ├── webhooks.ts       fire-and-forget pipeline-event notifications
│   │   ├── sessions.ts       named session persistence (auto-save/resume + /session commands)
│   │   ├── undo.ts           tool-edit undo/redo snapshots
│   │   ├── overrides.ts      runtime rules override store (update target)
│   │   └── ...
│   ├── src/rules/            versioned rules JSON + module registry
│   ├── src/update/           Auto Update Manager (check/apply/watch)
│   ├── src/token/tokenizer.ts  tiktoken + estimator fallback
│   ├── src/refine.ts         composition: caveman → rtk → truncate-to-budget
│   ├── src/pipeline.ts       strip → refine → cache → handoff → store
│   └── src/config.ts         env-driven config
├── cli/                      mugil-ide — browser-only web IDE server (xterm.js UI) + utilities
│   ├── src/server/           HTTP + WebSocket server, xterm.js UI, PTY manager
│   ├── src/terminal/         agent session driver (rendered in the browser)
│   ├── src/providers.ts      provider definitions + key masking
│   └── scripts/vendor-xterm.mjs  vendors xterm.js into dist/vendor (offline)
├── mcp/                      @mugil-ide/mcp — MCP server exposing the engine as tools
└── docs/                     @mugil-ide/docs — MD Generator (automated + periodic docs)
```

The request path: **signature strip → token refinement (caveman + rtk +
truncate) → cache lookup → model routing/handoff → cache store**, with
Ponytail's output-minimization instruction injected into the system prompt.
When a request declares tools (`AskOptions.tools` + `toolRegistry`), the
cache is bypassed and handoff becomes a **bounded tool loop**: the model's
tool calls are executed and fed back until it answers without tools, with a
forced final summary after `maxIterations`. Token counts, savings, tool-call
progress and cache outcomes are surfaced in the web UI and exposed to MCP
clients via `PipelineEvent`s (`{ type: 'tool' }` fires per executed call).
Webhooks fire on `turn.started` / `tool.executed` / `turn.completed` /
`turn.error` (env-configured, fire-and-forget, never slow the loop).

## Roadmap

Done and shipped:

- ✅ Core engine + web IDE (browser-only, xterm.js, vendored offline assets)
- ✅ Credited module split (caveman / rtk / ponytail / signature-remover / smart-cache / handoff)
- ✅ Auto Update Manager (updatable module rules + periodic check/apply)
- ✅ MCP server (`@modelcontextprotocol/sdk`) — engine as tools over stdio
- ✅ Web tools — `webfetch` (HTML→text, capped, http(s) only) + `websearch` (Exa AI hosted MCP, `MUGIL_IDE_ENABLE_EXA=1`)
- ✅ Tool-edit undo — `write_file`/`edit_file`/`apply_patch` before/after snapshots, `/undo` in the web UI
- ✅ Webhook integrations — fire-and-forget HTTP notifications on turn/tool events (env-configured)
- ✅ Multi-file `apply_patch` — OpenCode-style `*** Add/Update/Delete/Move` directives (undoable)
- ✅ LSP code intelligence — stdio LSP client (`goToDefinition`/`findReferences`/`hover`, `MUGIL_IDE_ENABLE_LSP=1`)
- ✅ Skills module — `.agents/skills`/`.claude/skills` discovery + the `skill` agent tool
- ✅ Subagent delegation (`task` tool: read-only `explore` / full `general` modes, nested bounded loop) + the `question` tool with a browser picker (WS round-trip, timeout-safe)
- ✅ Tool **permissions** — `allow`/`ask`/`deny` gate with `/plan` (read-only) and `/act` (asks first) modes, browser approval modal, `MUGIL_IDE_TOOL_PERMISSIONS` per-mode overrides; subagents share the gate
- ✅ Environment-context injection — `AGENTS.md`/`CLAUDE.md` + cwd/platform/date in the system prompt
- ✅ Post-edit `tsc --noEmit` **diagnostics** fed back to the model (`MUGIL_IDE_TOOL_DIAGNOSTICS=1`)
- ✅ MD Generator (`mugil-ide docs`, periodic `--watch`)
- ✅ Redis hardening (SCAN cursor loop instead of blocking `KEYS`, multi-node Cluster support via `REDIS_CLUSTER_URLS`)
- ✅ npm packaging (all four `@mugil-ide/*` tarballs publishable; `mugil-ide` / `mugil-ide-mcp` bins verified from an installed tarball layout)
- ✅ Watermark Remover module (credited to `guillaumemeyer/watermarks-remover`; Layer A Unicode hygiene + vendor attribution-line stripping, wired into the pipeline output)
- ✅ API-key management — `keys`/`logout` commands + web UI Accounts modal; safe key saving in a user-level env file (0600)
- ✅ Codegraph module (credited to `colbymchenry/codegraph`; symbols, import + call edges, context queries via `mugil-ide graph`)
- ✅ Release tooling (`npm run release`: version/bump/pack/tag; `--publish` ships in dependency order)
- ✅ **MCP client consumption** — user-configured servers as `mcp__*` agent tools (ask-gated in act mode, denied in plan; soft connection failures)
- ✅ **Session persistence** — auto-save/resume + `/session` `/sessions` `/resume` `/clear-session`
- ✅ **`/compact`** conversation summarization (dedicated model call, continues from the summary)
- ✅ Skills **prompt injection** (`skillsContextBlock` descriptions in the system prompt)

## License

MIT — see [LICENSE](LICENSE) (Copyright (c) 2026 Mugil IDE Contributors).
All four `@mugil-ide/*` packages declare `"license": "MIT"` and publish the
root LICENSE with each tarball.
