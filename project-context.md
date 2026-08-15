# Mugil IDE — Project Context (handoff)

> Everything you need to pick this project back up. Written for the next
> engineer (or AI agent) continuing development.

## What this is

**Mugil IDE** — a token-efficient AI IDE that runs as a CLI (Commander +
Ink TUI) plus an MCP server. It refines prompts before they hit a model
(caveman → rtk → truncate), caches aggressively (exact / partial /
semantic), auto-routes models through OpenRouter with fallback chains,
strips AI/Anthropic prompt signatures, minimizes output (ponytail),
generates markdown docs periodically, and self-updates its module rules.

The browser frontends (React WebApp + Live Diff WebView) were **stripped
out** — this is now a CLI-only product. Every engine feature (token
efficiency, cache, handoff, updates, docs, MCP) is reachable from the
terminal; the CLI's `run` command prints the refined-prompt diff inline.

Product brand is **Mugil IDE** (`mugil-ide` / `mugil-ide-mcp` bins); the npm
packages use the `@mugil-ide/*` scope to match.

## Repository layout

npm workspaces monorepo — packages in `packages/*`, root is private.

| Package | Name (npm) | Module system | Role |
| --- | --- | --- | --- |
| `packages/core` | `@mugil-ide/core` | CJS | Engine: credited modules, cache, handoff, pipeline, tokenizer, update manager, branding, browser entry |
| `packages/cli` | `mugil-ide` | ESM | Commander CLI + Ink TUI. Bin: `mugil-ide` |
| `packages/mcp` | `@mugil-ide/mcp` | ESM | MCP stdio server. Bin: `mugil-ide-mcp` |
| `packages/docs` | `@mugil-ide/docs` | CJS | MD Generator (`mugil-ide docs`) |

### Core module tree (`packages/core/src`)

- `modules/caveman` `modules/rtk` `modules/ponytail` `modules/signature-remover`
  `modules/watermark-remover` `modules/codegraph` — the six credited modules. Each has a credit header, a
  `README.md`, and an entry in root `ATTRIBUTIONS.md`. All are **rules-driven**:
  regex/instruction data lives in `src/rules/*.json` (+ `registry.json`) and is
  updatable at runtime.
- `modules/overrides.ts` — **browser-safe** rules loader (cache + revision
  counter + injectable reader). `modules/overridesNode.ts` — the fs-backed
  store (`readOverrideSync` / `writeOverrideSync` / `overrideDir` +
  `installOverrideReader`). **Never add static `node:*` imports to
  `overrides.ts`** — it ships to browsers if a GUI is ever re-added.
- `modules/smart-cache` — `backends.ts` (memory / file / Redis + Redis Cluster
  via `REDIS_CLUSTER_URLS`; SCAN cursor loop, not `KEYS`), `embeddings.ts`
  (lexical fallback + OpenAI-compatible remote).
- `modules/handoff` — provider clients (`OpenRouterClient`, `OpenAiClient`,
  `AnthropicClient` behind a shared `ProviderClient` interface) +
  `HandoffManager` (cost-based routing, fallback chains, offline mock mode)
  and `models.ts` (`fetchProviderModels` — per-provider catalog probes for
  OpenRouter / OpenAI / Anthropic / Ollama / LM Studio / local endpoints,
  with an in-memory 60s cache and curated fallback ladders when offline).
- `contextResolver.ts` — `resolveFileContext()`: `@file` / `@path` attachment
  support used by the TUI prompt box (resolves paths relative to the cwd and
  injects file contents).
- `update/updateManager.ts` — check / apply / periodic watch against a module
  registry + npm registry.
- `token/tokenizer.ts` — tiktoken loaded **lazily** (type-only import + guarded
  `require`); degrades to a deterministic estimator in browsers.
- `refine.ts` — composition layer (caveman → rtk → truncate-to-budget).
- `pipeline.ts` — `Pipeline.ask()` emitting `PipelineEvent`s (`AskOptions.onEvent`).
- `browser.ts` — browser-safe engine entry (no Node builtins, no tiktoken).
  Retained for a possible future GUI/desktop shell; nothing ships it today.
- `branding.ts` — `BANNER_ART` / `getBanner()` (the module pads rows
  programmatically; keep widths aligned if you copy the banner anywhere).
- `config.ts` — `loadConfig()` from env, merged with the user env file
  (defaults < file < process.env); `createEngine()` in `index.ts` (barrel)
  calls `installOverrideReader()` at load.
- `env.ts` — user-level env file layer (`~/.config/mugil-ide/.env`): dotenv
  parser, atomic 0600 write, delete — used by `mugil-ide login` / `logout` / `keys`.

## Technology inventory (installed versions)

**Runtime & toolchain** — Node.js ≥ 20 (engines; smoke-tested on Node 24),
TypeScript 5.9.3, npm workspaces. Testing: Jest 29.7.0 + ts-jest in core,
cli and mcp (+ supertest for the MCP stdio tests; ESM packages — cli, mcp —
need `--experimental-vm-modules` via `cross-env`; the CLI TUI tests use a
custom `tests/helpers/renderApp.ts` fake stdin — see gotcha 7). Quality:
ESLint 9.39.5 + typescript-eslint (flat config), Prettier 3.9.6.

**CLI** (`mugil-ide`) — commander 12.1.0; ink 5.2.1 (React 18.3.1)
+ ink-text-input 6.0.0 (TUI); dotenv 16.6.1; diff 5.2.2 (terminal prompt
diffs in `run`).

**Engine** (`@mugil-ide/core`) — tiktoken 1.0.22 (cl100k_base, lazy-loaded WASM,
falls back to a chars/4 estimator); redis 4.7.1 (SCAN cursor loops — never
blocking `KEYS`; single-node + Cluster via `createCluster` /
`REDIS_CLUSTER_URLS`). Everything else is stdlib (crypto, fs, http, os, path).

**MCP server** (`@mugil-ide/mcp`) — @modelcontextprotocol/sdk 1.30.0; zod 3.25.76.

**Docs generator** (`@mugil-ide/docs`) — zero third-party deps (own glob matcher +
regex parsers for TS/JS, Python, Go, Rust).

## Modules (credited + subsystems)

**Credited token-efficiency modules** — each has a credit header, a `README.md`,
and an `ATTRIBUTIONS.md` entry; rules live in versioned JSON and are updatable:

| Module | Origin credit | Function |
| --- | --- | --- |
| `caveman` | JuliusBrussee/caveman | Terse, filler-free prompt compression |
| `rtk` | rtk-ai/rtk | Boilerplate stripping, dedupe, `compressCommandOutput` |
| `ponytail` | DietrichGebert/ponytail | Output minimization ("laziest senior dev" ladder + output budget) |
| `signature-remover` | Anthropic/OpenAI formats + community de-AI tooling | Strips prompt signatures + AI code signatures/watermarks |
| `watermark-remover` | guillaumemeyer/watermarks-remover | Strips AI provenance watermarks (Layer A: invisible Unicode, bidi, tags, exotic spaces, vendor attribution lines) |
| `codegraph` | colbymchenry/codegraph | Code knowledge graph: symbols, import edges, same-file call edges, source snippets, context queries |

**Engine subsystems** (`packages/core/src`) — `smart-cache` (exact → partial →
semantic; memory / file / Redis(+Cluster) backends; lexical + OpenAI-compatible
embeddings; **model-scoped keys** — see gotcha 9), `handoff` (OpenRouter /
OpenAI / Anthropic / Ollama / LM Studio / local clients, cost-based routing,
fallback chains, offline mock; an explicitly requested model is
**authoritative** and never silently escalates into the ladder — see
gotcha 9; `tools` forwarded to provider clients in each provider's wire
format), `tool-loop` (bounded agentic function-calling loop: registry-driven
execution, error capture, forced final answer — see gotchas 11–12),
`pipeline` (signature → refine → cache → handoff → store, streaming
`PipelineEvent`s incl. `{ type: 'tool' }`), `refine` (caveman → rtk →
truncate), `token` (lazy tiktoken + estimator), `update`
(UpdateManager check/apply/watch), `branding`, `browser.ts` (browser-safe
entry), `config` / `createEngine` (incl. `modelSupportsTools` + catalog
`supportsTools` from OpenRouter `supported_parameters`).

**Surface packages** — CLI (`run` / TUI / `graph` / `login` / `logout` /
`keys` / `update` / `docs`) and MCP (12 tools over stdio).

## Commands

```bash
npm install
npm run dev           # build and launch the interactive TUI
npm start             # launch the interactive TUI directly
npm run build         # all packages
npm run typecheck     # all packages
npm run test          # 192 tests across 4 packages (incl. cli command + TUI suites)
npm run lint          # eslint (flat config, eslint.config.mjs)
npm run pack          # build + pack all four tarballs into dist-packages/
npm run release       # release plan (dry-run) — --bump / --publish for real
npm run update:check  # module/npm update check via the CLI
npm run mcp           # run the MCP stdio server directly
```

Run the CLI from source (build first): `node packages/cli/dist/index.js …`
Commands: `run`, `graph`, `login`, `logout`, `keys`, `update`, `docs`, and
bare invocation = TUI.

## Environment variables

See `.env.example`. The important ones:

| Var | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Live completions via OpenRouter (primary); absent → next provider or mock mode |
| `OPENROUTER_MODELS` | OpenRouter model ladder (cheap → smart) |
| `OPENAI_API_KEY` / `OPENAI_MODELS` / `OPENAI_BASE_URL` | OpenAI completions + ladder + compatible-endpoint base URL |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODELS` / `ANTHROPIC_BASE_URL` | Anthropic completions + ladder + compatible-endpoint base URL |
| `AI_PROVIDER` | Force the completion provider: `openrouter` \| `openai` \| `anthropic` \| `ollama` \| `lmstudio` \| `local` |
| `OLLAMA_BASE_URL` / `OLLAMA_MODELS` | Ollama endpoint (default `http://localhost:11434/v1`) + model ladder; `OLLAMA_API_KEY` is set to `local` on connect |
| `LMSTUDIO_BASE_URL` / `LMSTUDIO_MODELS` | LM Studio endpoint (default `http://localhost:1234/v1`) + ladder |
| `LOCAL_BASE_URL` / `LOCAL_MODELS` | Generic local/OpenAI-compatible endpoint (default `http://localhost:8000/v1`) + ladder |
| `MUGIL_IDE_ENV_FILE` | User env file storing saved API keys (default `~/.config/mugil-ide/.env`) |
| `MUGIL_IDE_TUI_MODE` / `MUGIL_IDE_TUI_THINKING` | Persisted TUI prefs: plan/act mode + show/hide thinking output (written by `/plan` `/act` `/thinking-view`) |
| `MUGIL_IDE_MODEL` / `MUGIL_IDE_THINKING_LEVEL` | Persisted TUI model selection + thinking level (`off` \| `low` \| `medium` \| `high`; written by `/model` `/thinking`) |
| `REDIS_URL` / `REDIS_CLUSTER_URLS` | Redis cache (single / multi-node cluster) |
| `MUGIL_IDE_CACHE_DIR` | File-cache location (default `~/.cache/mugil-ide`) |
| `CACHE_TTL`, `TOKEN_BUDGET` | Cache TTL (s), per-prompt token budget |
| `MUGIL_IDE_MODULES_REGISTRY` | Remote rules registry for `mugil-ide update` |
| `MUGIL_IDE_MODULES_DIR` | Local rules override store (`~/.config/mugil-ide/modules`) |
| `NODE_ENV` | `test` makes caches hermetic; controls override-store gating |

## Provider setup flow (`/accounts`)

Type `/accounts` (aliases `/account`, `/login`) in the TUI to open the
`AccountsMenu` (`packages/cli/src/components/accounts.tsx`) — an in-TUI
superset of the standalone `mugil-ide login` wizard. It renders as a modal
(the chat input is hidden until you close it with Esc / `q` or the
"← Back to Chat" entry). Both UIs share one source of truth: the
`PROVIDERS` table in `packages/cli/src/components/login.tsx`.

| Provider | Kind | Flow | Defaults |
| --- | --- | --- | --- |
| OpenRouter (primary) | remote | paste API key | — |
| OpenAI | remote | paste API key | `https://api.openai.com/v1` |
| Anthropic | remote | paste API key | `https://api.anthropic.com` |
| Ollama (Local AI) | local | port / endpoint probe | `http://localhost:11434/v1` (:11434) |
| LM Studio (Local AI) | local | port / endpoint probe | `http://localhost:1234/v1` (:1234) |
| Custom Local / OpenAI Endpoint | local | port / endpoint probe | `http://localhost:8000/v1` (:8000) |

Each row shows its connection state — `[Connected: <masked key or base URL>]`
(via `maskKey`: first 4 + `••••` + last 4) or `[Not Configured]`. A provider
counts as connected when it is the active `config.provider`, its key var is
set in the user env file, or the matching `*ApiKey` is in config.

**Remote flow** (OpenRouter / OpenAI / Anthropic): select the provider →
paste the API key (masked `•` input) → Enter. `handleKeySubmit` writes
`{ <KEY_VAR>: key, AI_PROVIDER: <id> }` (plus the base URL if one was
entered) to the user env file **and** `process.env`, then calls
`onKeyUpdated()` → `ChatApp.reloadConfig()` → `engine.reconfigure()` — the
new provider is live immediately. Success screen shows "API key saved!".

**Local flow** (Ollama / LM Studio / local): select the provider →
"Connect <label>:" shows the default endpoint; Enter accepts the default
port, or type a port number (→ `http://localhost:<port>/v1`) or a full URL
(`/v1` is appended when missing). `handlePortSubmit` writes
`{ AI_PROVIDER: <id>, <BASE_VAR>: endpoint, <KEY_VAR>: 'local' }`, then
probes the endpoint with `fetchProviderModels()` (OpenAI-style `/v1/models`
first, Ollama's native `/api/tags` as a fallback):

- models found → their IDs are written to `<MODELS_VAR>` (e.g.
  `OLLAMA_MODELS`) and the success screen reports "Discovered N model(s): …";
- reachable but empty / probe error → endpoint saved anyway, with a hint to
  pick a model via `/model` afterwards.

Either way `onKeyUpdated()` fires, so config and the handoff ladder reload
with the discovered catalog, and `/model` then lists the real local models
(see gotcha 9 — an explicit selection survives the refresh).

Everything persists in the user env file (`MUGIL_IDE_ENV_FILE`, default
`~/.config/mugil-ide/.env`, 0600) — the same store `mugil-ide login` /
`keys` / `logout` use — and `AI_PROVIDER` is always written, so the chosen
provider takes effect without restarting. Provider precedence still applies:
when no `AI_PROVIDER` is set, OpenRouter wins if its key is present, then
OpenAI, then Anthropic (see `loadConfig()` in `config.ts`).

## Conventions & gotchas (learned the hard way)

1. **`.js` import specifiers everywhere** (NodeNext style) point at `.ts`
   sources.
2. **Module-system split**: core/docs are CJS; cli/mcp are ESM
   (`"type": "module"`). ESM packages (cli, mcp) need `jest.config.cjs` and
   their tests run via `cross-env NODE_OPTIONS=--experimental-vm-modules`
   (Windows-safe).
3. **Overrides gating**: the fs store is only consulted when
   `MUGIL_IDE_MODULES_DIR` is set or `NODE_ENV !== 'test'`. Update-manager tests
   are hermetic (tmp dir + `resetStore()`) — an earlier version leaked a test
   fixture into the real home store and silently broke caveman's rules. Keep it
   hermetic.
4. **Browser safety (dormant)**: `overrides.ts` and `tokenizer.ts` must stay
   free of static Node builtins — they back the browser-safe `browser.ts`
   entry. If a GUI is ever re-added, rebuild and grep the client bundle for
   `node:fs|node:os|node:path|node:module`; any hit breaks it at runtime.
5. **Shell escaping**: writing JSON fixtures with regexes through bash heredocs
   corrupts `\b` etc. (becomes backspace). Use `JSON.stringify` in a generator
   file instead — see the update-manager smoke history.
6. **Credit discipline**: every technique module credits its origin in its
   header + `ATTRIBUTIONS.md`. Keep that up when adding modules.
7. **Ink 5 input in tests**: `ink-testing-library` v3 is **incompatible with
   ink 5** — its fake stdin only emits `'data'`, but ink 5 consumes input via
   the Node readable-stream protocol (`readable` event + `read()`), and it
   lacks `stdin.ref()`/`unref()`. The CLI's TUI tests use a custom helper
   (`tests/helpers/renderApp.ts`) with a real `Readable`-based fake stdin
   that (a) resolves only after ink attaches its input listener, (b) pushes
   text and `\r` as separate chunks — Node merges synchronous pushes into one
   `read()` — (c) tracks and cleans up timers on unmount to prevent open-handle
   leaks, and (d) strips ANSI escape codes (`stripAnsi`) in `lastFrame()` so
   style/color codes do not break substring assertions. Tests use async
   `waitFor(...)` polling rather than static sleep timers. Note the input
   placeholder literally contains `/model · /thinking · /accounts · /plan`,
   so don't try to detect typing via frame contents.
8. **Logo ASCII Art & Pseudo-3D**: `LOGO_GRID` glyphs in `branding.ts` have
   strictly uniform width per row (64 chars total per row) to ensure clean
   monospace alignment across terminals. `MugilLogo` implements pseudo-3D
   directional surface lighting (top/left highlights, base/right drop shadows),
   a traveling specular sheen beam, and disables animation timers during
   `NODE_ENV === 'test'`.
9. **Model selection is authoritative — never silently swapped**: three layers
   enforce that a user-picked model is what actually answers. (a) `HandoffManager`
   pins the chain to `[preferred, ...fallbackChain]` when `preferredModel` is
   set — it does **not** escalate into the rest of the ladder on failure, so a
   failed local model surfaces an error instead of a DeepSeek response from the
   fallback ladder. Only auto-routing (no `preferredModel`) walks the full
   ladder. (b) `SmartCache` scopes entries by the requested model
   (`lookup(prompt, { model })` / `store(..., keyModel)`) — a cached answer
   produced under one selection is never served for another; `openrouter/auto`
   stays shared because it routes dynamically. (c) The TUI never clobbers an
   explicit pick: background catalog refreshes only replace the *untouched
   config default*, `reloadConfig()` only resets the selection when the provider
   actually changed, and catalog matching ignores Ollama's `:latest` tag alias
   (`llama3.2` ↔ `llama3.2:latest`).
10. **Dropdown navigation clamps, it does not wrap**: `Dropdown`'s ↑/↓ clamp at
    the ends instead of wrapping around. Wrap-around + a leading pseudo-item
    ("✏ Custom Model ID…") used to jump the cursor there on a single ↓ press;
    Enter then launched the custom-model screen mid-conversation and swallowed
    the user's typing ("the UI breaks"). The custom entry now sits at the *end*
    of the model list, and the initial highlight always lands on a real model.
    Note the dropdown can open with the small config-default catalog while the
    real provider catalog is still loading — keep Enter safe at that size too.
11. **Tool-bearing requests bypass the cache entirely**: when `AskOptions.tools`
    is set, `Pipeline.ask` skips both cache lookup and cache store. A cached
    hit would skip tool execution — wrong for side-effectful tools and stale
    for any tool whose result may have changed. `AskResult.cache.hit` is
    always `false` for tool-bearing asks.
12. **The tool loop is bounded, and always ends in text**: `ToolLoop` runs at
    most `maxIterations` (default 6) model rounds. When the model keeps
    requesting tool calls past the limit, the loop forces one final completion
    *without* tools ("provide your final answer now"), so a caller never gets
    back an empty string. Unknown tool names and executor exceptions are fed
    back to the model as `Error: ...` tool results so it can recover, and a
    declared tool with no registry entry throws `ToolError` before any request
    is sent.

## Status / roadmap

All spec milestones are shipped: CLI + engine, credited module split (now
including the watermark remover), Auto Update Manager, MCP server, MD
Generator, Redis hardening (SCAN + cluster), in-browser engine entry
(retained, unused), npm packaging (verified via temp-prefix install of the
four tarballs), **multi-provider auth** — `login` / `logout` / `keys` with
safe env-file key storage plus OpenAI/Anthropic provider clients — and the
**codegraph** module (symbols, import + call edges, context queries), release
tooling (`npm run release`: bump/pack/tag, `--publish` in dependency order),
and TUI polish (animated working spinner, live pipeline/token streaming,
`/plan` `/act` modes, thinking levels via `/thinking` (off/low/medium/high),
`/thinking-view` show/hide, `/model` selection dropdown with custom model IDs,
`/accounts` provider & local-AI setup menu (Ollama / LM Studio / local
endpoints), `/clear-cache`, `@file` attachment, pseudo-3D logo with specular
wave and monospace alignment), plus **function calling with a bounded agentic
tool loop** — `AskOptions.tools`/`toolRegistry` run `ToolLoop` (registry
execution, unknown-tool/exception capture, forced no-tools final answer, cache
bypass; OpenAI-family + Anthropic wire formats; `supportsTools` auto-detected
from the catalog), plus **automated CLI + TUI test suites**
(spawned-binary command tests + ink-rendered ChatApp behavior tests).
**192 tests pass.**

### Pending todos

1. **Publish to npm** — release tooling is in place (`npm run release`:
   bump/pack/tag, `--publish` in dependency order) and the dry-run plan was
   verified, but no version has been bumped, tagged, or published yet. Needs
   an npm account + auth (`npm login`) and a decision on the license
   (README says MIT placeholder).
2. **`LoginWizard` component coverage** — the `login` command is covered
   end-to-end via spawned-binary tests (incl. its piped/no-TTY path) and the
   env layer + provider clients have core-level tests, but the wizard UI
   itself has no component-level TUI tests (only `ChatApp` does). Could be
   rendered with `tests/helpers/renderApp.ts` the same way.

## Verification loop

After any change: `npm run typecheck && npm run lint && npm test`, then
`npm run build` and a smoke run of the affected surface, e.g.:

```bash
node packages/cli/dist/index.js run "In order to fix the bug, please review."
node packages/cli/dist/index.js keys  # masked provider keys + env file path
npm run pack && # temp-prefix install test when packaging changed
  npm install --prefix .smoke/global --no-audit ./dist-packages/*.tgz
```
