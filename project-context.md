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
  `HandoffManager` (cost-based routing, fallback chains, offline mock mode).
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
TypeScript 5.9.3, npm workspaces. Testing: Jest 29.7.0 + ts-jest (+ supertest
for the MCP stdio tests; ESM packages need `--experimental-vm-modules` via
`cross-env`). Quality: ESLint 9.39.5 + typescript-eslint (flat config),
Prettier 3.9.6.

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
embeddings), `handoff` (OpenRouter client, cost-based routing, fallback chains,
offline mock), `pipeline` (signature → refine → cache → handoff → store,
streaming `PipelineEvent`s), `refine` (caveman → rtk → truncate), `token`
(lazy tiktoken + estimator), `update` (UpdateManager check/apply/watch),
`branding`, `browser.ts` (browser-safe entry), `config` / `createEngine`.

**Surface packages** — CLI (`run` / TUI / `graph` / `login` / `logout` /
`keys` / `update` / `docs`) and MCP (12 tools over stdio).

## Commands

```bash
npm install
npm run build         # all packages
npm run typecheck     # all packages
npm run test          # 153 tests across 4 packages (incl. cli command + TUI suites)
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
| `AI_PROVIDER` | Force the completion provider: `openrouter` \| `openai` \| `anthropic` |
| `MUGIL_IDE_ENV_FILE` | User env file storing saved API keys (default `~/.config/mugil-ide/.env`) |
| `MUGIL_IDE_TUI_MODE` / `MUGIL_IDE_TUI_THINKING` | Persisted TUI prefs: plan/act mode + show/hide thinking (written by `/plan` `/act` `/thinking`) |
| `REDIS_URL` / `REDIS_CLUSTER_URLS` | Redis cache (single / multi-node cluster) |
| `MUGIL_IDE_CACHE_DIR` | File-cache location (default `~/.cache/mugil-ide`) |
| `CACHE_TTL`, `TOKEN_BUDGET` | Cache TTL (s), per-prompt token budget |
| `MUGIL_IDE_MODULES_REGISTRY` | Remote rules registry for `mugil-ide update` |
| `MUGIL_IDE_MODULES_DIR` | Local rules override store (`~/.config/mugil-ide/modules`) |
| `NODE_ENV` | `test` makes caches hermetic; controls override-store gating |

## Conventions & gotchas (learned the hard way)

1. **`.js` import specifiers everywhere** (NodeNext style) point at `.ts`
   sources.
2. **Module-system split**: core/docs are CJS; cli/mcp are ESM
   (`"type": "module"`). ESM packages need `jest.config.cjs` and the mcp tests
   require `cross-env NODE_OPTIONS=--experimental-vm-modules` (Windows-safe).
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
`/plan` `/act` modes, `/thinking` show/hide). **153 tests pass.**

### Pending todos

1. **Test gaps** — the CLI package has **no tests yet** (`"no tests yet"`);
   the `login` wizard has no automated coverage (env layer + provider clients
   are covered in core).

## Verification loop

After any change: `npm run typecheck && npm run lint && npm test`, then
`npm run build` and a smoke run of the affected surface, e.g.:

```bash
node packages/cli/dist/index.js run "In order to fix the bug, please review."
node packages/cli/dist/index.js keys  # masked provider keys + env file path
npm run pack && # temp-prefix install test when packaging changed
  npm install --prefix .smoke/global --no-audit ./dist-packages/*.tgz
```
