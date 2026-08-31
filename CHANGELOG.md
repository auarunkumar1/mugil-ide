# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.11] - 2026-08-31

### Added

- **Provider-Side Prompt Caching**: Integrated Anthropic `cache_control: { type: 'ephemeral' }` on system instructions and tool definitions to leverage Anthropic prompt caching discounts on recurring agent loops.
- **Universal Tool Output Compaction**: Automatically passes tool execution returns >400 chars through `compressCommandOutput` and enforces a 16,000 character safety bound to prevent runaway tool outputs from exhausting context.
- **History Turn Compaction**: Added `compactOlderTurns` option to `budgetConversationHistory` using Caveman and RTK strategies on older turns to fit ~25-35% more context in the window.
- **MemoryBackend Bounded LRU & Expired Sweep**: Added `maxEntries` LRU capacity eviction and active expired-key sweeping on `keys()` in `MemoryBackend` to avoid unbounded memory retention.
- **Optimized Partial Prefix Lookup**: Length-pruned candidate matching in `SmartCache.partialLookup` to accelerate prefix cache lookups.
- **Asynchronous Cache Storage**: Added `asyncStore` support to `PipelineOptions` and `AskOptions` to allow non-blocking background embedding generation and storage.
- **Configurable Models Cache TTL**: Made `fetchProviderModels` TTL configurable via `cacheTtlMs` option and `MUGIL_IDE_MODELS_CACHE_TTL` env var, with exported `clearModelsCache()`.
- **Cache Observability & Metrics**: Added `getMetrics()` and `resetMetrics()` to `SmartCache` (`CacheMetrics` tracking lookups, exact/partial/semantic hits, misses, hit rate percentage, and store calls).
- **Dark Theme Custom Scrollbars**: Replaced light browser scrollbars with custom `#30363d` on `#0d1117` cross-browser scrollbars across all panes, viewers, and modals.
- **UI Typography & Zoom Controls**: Increased default UI font sizes for improved readability and added dynamic `A-` / `A+` zoom controls (and `Ctrl + / -` shortcuts) in the header with `localStorage` persistence and automatic xterm terminal font resizing.

## [0.1.10] - 2026-08-26

### Changed

- Web IDE now opens at a random available open port by default instead of fixed port 3000 to prevent EADDRINUSE conflicts.

## [0.1.6] - 2026-08-22

- Added OpenCode Zen (opencode.ai/zen) as a completion provider: `OPENCODE_API_KEY` + optional `OPENCODE_BASE_URL`/`OPENCODE_MODELS`, auto-detected when only its key is set; claude-* models use Zen's Messages endpoint, others chat completions; gpt-*/codex-* (Responses API) not yet supported.

## [0.1.5] - 2026-08-20

### Fixed

- Update all hardcoded version references (branding.ts, registry.json, package.json)
  to stay in sync — previously only branding.ts was bumped, leaving the npm update
  check and registry reporting on the old version.

## [0.1.4] - 2026-08-20

### Fixed

- Update hardcoded `VERSION` constant in branding.ts to match package version.

## [0.1.3] - 2026-08-20

### Added

- **Vercel AI Gateway provider** — OpenAI-compatible chat completions via
  Vercel's AI SDK endpoint; set `VERCEL_API_KEY` and optionally
  `VERCEL_MODELS` / `VERCEL_BASE_URL`.
- **Cloudflare Workers AI provider** — direct Workers AI + AI Gateway
  support for Llama, Qwen, and DeepSeek models; requires both
  `CLOUDFLARE_API_KEY` and `CLOUDFLARE_ACCOUNT_ID`.
- **Together AI provider** — OpenAI-compatible chat completions for Llama,
  DeepSeek, Qwen, and Mistral models; set `TOGETHER_API_KEY` and optionally
  `TOGETHER_MODELS` / `TOGETHER_BASE_URL`.
- All three providers integrate into the existing Auto Handoff manager,
  model routing, fallback chains, and the Accounts & Keys web UI modal.
- `AI_PROVIDER` now accepts `vercel | cloudflare | together` to force a
  provider, with automatic detection falling back to the next available key.

## [0.1.2] - 2026-08-18

### Added

- **Persistent session metrics** — `/stats` (token usage, cache hits, files
  modified) is saved with the auto-saved conversation (session format v2)
  and restored on resume, so metrics survive a reconnect; the auto-save file
  is kept in sync automatically after every turn and after `/undo` / `/reset`.

### Fixed

- **Cross-project isolation** — the auto-saved session and the smart cache
  were global, so closing the app in one project and reopening it in another
  resumed the previous project's conversation (the model kept referencing
  that project's `readme.md` / `context.md` files) and identical prompts
  could serve the other project's cached answers. Both are now scoped per
  workspace: sessions auto-save to `last-session-<workspace>.json`, cache
  keys are namespaced by the workspace directory, and the legacy global
  `last-session.json` is swept up on startup. Named `/session` files remain
  global and explicit.

## [0.1.1] - 2026-08-17

## [0.1.0] - 2026-08-17

Initial development release — first publish to npm and GitHub. The product is
a browser-based autonomous AI IDE (there is no TUI / terminal CLI).

### Added

- **Browser web IDE** — xterm.js two-pane workspace: AI agent terminal + shell
  PTY, searchable file explorer, file viewer, live diff viewer with one-click
  undo, CodeGraph visualization, question-picker and approval modals.
- **Agent tool loop** — 16 workspace tools (`read_file`, `list_files`,
  `search_code`, `codegraph`, `write_file`, `edit_file`, `apply_patch`,
  `run_command`, `todowrite`, `todoread`, `skill`, `webfetch`, `websearch`,
  `lsp`, `question`, `task`) with a bounded multi-turn loop, permission gate
  (`/plan` read-only, `/act` asks before writes), environment-context
  injection, and post-edit typecheck diagnostics.
- **Token-efficiency engine** — prompt refinement, smart cache
  (exact / semantic / partial with Redis or file backends), automatic model
  routing and fallback via OpenRouter, signature/watermark stripping,
  tiktoken-based counting.
- **Sessions & subagents** — auto-save + resume, `/compact` conversation
  summarization, `/session` / `/sessions` / `/resume`, `task` subagents
  (read-only `explore` / full `general`).
- **MCP** — `@mugil-ide/mcp` stdio server (`mugil-ide-mcp` binary) exposing
  the engine as tools, plus an MCP client consuming stdio/HTTP servers as
  `mcp__<server>__<tool>` agent tools (powers `websearch` via Exa).
- **Auto Update Manager** — versioned, updatable module rules with
  check/apply/periodic-watch against a registry + npm version check.
- **Webhooks** — fire-and-forget HTTP notifications on turn/tool events.
- **Packaging** — four npm packages (`mugil-ide`, `@mugil-ide/core`,
  `@mugil-ide/docs`, `@mugil-ide/mcp`) with vendored xterm.js assets for
  fully offline operation; release script with SemVer bumping, git tags, and
  dependency-ordered publishing.

### Security

- Pre-commit secret guard (`scripts/guard-secrets.mjs`) blocks commits that
  contain long-form provider API keys or committed `.env` files.

[0.1.0]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.0

[0.1.1]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.1

[0.1.2]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.2

[0.1.3]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.3

[0.1.4]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.4

[0.1.5]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.5

[0.1.6]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.6

[0.1.10]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.10
[0.1.11]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.11
