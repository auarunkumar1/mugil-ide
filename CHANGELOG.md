# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.22] - 2026-10-21

### Added

- **First-Run Quick AI Setup & Zero-Key Onboarding**: Automatically detects launches with zero configured API keys and displays a quick-setup modal for 1-click cloud provider configuration (OpenRouter, OpenAI, Anthropic, OpenCode) or free local offline models (Ollama, LM Studio).
- **Setup Warning Banner**: Added persistent warning banner inside session setup when no AI providers are configured, with direct links to account management.

### Fixed

- **Modal Stacking & Z-Index Hierarchy**: Set `#account-modal`, `#welcome-modal`, and `#model-modal` to `z-index: 2000` so account/key management and welcome modals always open in front of `#session-setup-modal` without backdrop collisions.
- **CI Test Suite Keep-Alive Hang**: Wired `closeAllConnections()` and `closeIdleConnections()` into `server.close()` to ensure lingering HTTP keep-alive connections terminate immediately upon test completion.
- **GitHub Actions CI Timeout**: Added hard `timeout-minutes: 15` ceiling on GitHub Actions CI workflow to eliminate runner execution hangs past 1 hour.
- **OpenRouter Streaming Token Usage**: Populated `stream_options = { include_usage: true }` in `OpenAiWireClient.post()` when streaming is active to ensure usage metrics are delivered by providers.
- **Typed OpenRouter HTTP Error Handling**: Added `handleHttpError()` hook and typed `OpenRouterError` to parse and bubble provider error messages cleanly during handoffs.
- **Clean Server URL Token Routing**: Separated pristine base server URL (`server.url`) from authenticated launch link (`server.tokenUrl`), preventing query parameter corruption and CLI duplication.

## [0.1.21] - 2026-10-21

### Security & Sandboxing

- **Local Server Auth & Session Cookies (§1a)**: Enforced session token authentication on all HTTP (`/`, `/api/*`) and WebSocket routes (`/ws`). Unauthenticated requests reject with 401. Replaced cleartext token scraping and query-string WebSocket tokens with `HttpOnly; SameSite=Strict` cookies. Removed `MUGIL_IDE_DISABLE_AUTH` bypass.
- **Provider Base-URL Allowlisting (§1b)**: Constrained `/api/keys` base URLs to verified provider hostnames or local loopback (`127.0.0.1`, `localhost`), completely blocking API key exfiltration.
- **Workspace Directory Confinement (§1c)**: Restricted `/api/workspace` targets to prevent selecting system directories or root drives.
- **Request Body Ceiling (§1e)**: Enforced 2MB payload ceiling on JSON body readers including `/api/model`.
- **Realpath Ancestor Workspace Sandboxing (§2)**: Enforced `fs.realpathSync` in `resolveInWorkspace` across nearest existing ancestors to prevent symlink and junction containment escapes on both existing and new files.
- **Async & Cancellable `run_command` (§3)**: Replaced synchronous execution with non-blocking child process execution and `AbortSignal` cancellation support.
- **Webfetch SSRF Protection (§4)**: Added IPv6 ULA (`fc00::/7`), link-local (`fe80::/10`), loopback, and cloud metadata checks. Added hard-abort on DNS lookup failures and manual hop-by-hop redirect verification.

### Core Engine & Accuracy

- **Context Window Budget Overflow Hard Error (§6.2)**: `pipeline.ts` throws explicit `Context overflow` error when `contextRoom <= 0`.
- **Tool Loop Message Alternation (§5)**: Strict alternating message role enforcement during permission denial sequences.
- **Accurate Token Estimation Across All Providers (§6.3, §6.5)**: Unified prompt token and handoff chain estimation (`estimateMessagesTokens`) across all provider clients to account for tool schemas and arguments.
- **Cost and Tier Routing (§6.4)**: `HandoffManager.route()` sorts candidates by `(tier, costPerMTokIn)`.
- **Symmetrical Env Serialization (§6.6)**: `parseEnvFile` symmetrically unescapes double-quoted values using `JSON.parse`.
- **Canonical Tool Schemas (§6.7)**: Anthropic tool definitions sorted alphabetically with canonicalized schemas.
- **Parallel Model Probing (§7.6)**: Probed local and cloud providers concurrently in `/api/models` using `Promise.allSettled`.
- **Hermetic Test Suite (§6.1)**: Cleared ambient `MUGIL_IDE_*` in jest setupFiles.

### Performance & Architecture

- **Incremental Tool-Loop Sizing (§7)**: Replaced $O(K^2)$ tool-loop token counting with incremental token accumulation across iterations.
- **Single-Pass History Budgeting (§7)**: Eliminated duplicate tokenization passes on turns during conversation budgeting.
- **Codegraph Edge Collection & Snippet Reuse (§7)**: Replaced $O(N^2)$ regex allocations with identifier Set lookups and reused pre-computed snippets.
- **Pure Core Barrel (§8)**: Removed top-level `installOverrideReader()` side effect on barrel import; wired lazy initialization.
- **Unified OpenAI Wire Client (§8)**: Consolidated `openAi`, `openRouter`, `vercel`, `together`, and `cloudflare` onto a shared wire base class in `provider.ts`.
- **Automated Vendored Asset Generation (§8)**: Generated `embeddedVendor.ts` at build time from installed `@xterm/*` dependencies.

## [0.1.20] - 2026-10-21

### Added

- **Configurable Reasoning / Thinking Effort**: Added UI controls for thinking models in the Session Setup modal with four effort tiers: `Off`, `Low`, `Medium (Default / Recommended)`, and `High`.
- **Thinking Model Capability Detection**: Dynamically detects thinking-capable models (Claude 3.7 Sonnet, DeepSeek-R1, OpenAI o1/o3-mini, Gemini 2.5 thinking, QwQ) and presents live support status badge.
- **Multi-Provider Thinking Integration**: Passed `thinkingLevel` through `AgentRepl` and `Pipeline.ask()` to provider clients (Anthropic `budget_tokens`, OpenRouter `reasoning_effort`, OpenAI `reasoning_effort`, Together, Vercel).
- **Thinking Setting Persistence**: Added `MUGIL_IDE_THINKING_LEVEL` support to `/api/config` and persisted into user environment.

## [0.1.19] - 2026-10-21

### Added

- **Visual Directory & Workspace Browser**: Added interactive folder browser modal with quick directory shortcuts (`Home`, `Desktop`, `Documents`, `Downloads`), parent navigation (`⬆ Up`), and subfolder creation to easily point the IDE to any folder on your computer.
- **First-Run Workspace Selector & Project Creator**: Users double-clicking standalone binaries (from `Downloads` or home directory) can immediately select an existing project directory or create a new project from scratch (`mkdir -p`) directly from the Web UI setup modal.
- **Standalone Compiled GitHub Releases & npm Deprecation**: Offboarded distribution from npmjs. Added automated GitHub Actions release workflow cross-compiling click-to-run binaries via Bun for Windows (`.exe`), Linux (`.tar.gz` and `.deb`), and macOS (Apple Silicon & Intel).
- **Favicon & Client Script Syntax Resilience**: Handled `/favicon.ico` with HTTP 204 to eliminate console 404 noise; hardened client script path splitting against regex escape collisions in template literals.

## [0.1.18] - 2026-10-20

### Added

- **Interactive Limit Extension During Agent Turns**: When `ToolLoop` reaches its bounded iteration ceiling, the engine now interactively queries the user mid-turn via the question modal to extend iterations (`+15`, `+30`, or finish now) along with total tokens used, avoiding premature task cutoffs during large refactors, audits, or log writing.
- **Dynamic Session Economics & Sliders**: Added responsive sliders (`<input type="range">`) for Context Budget, Max Output Tokens, Max Tool Iterations, and History Turns, paired with direct number inputs and dynamic single-turn cost calculation ($ USD) based on active model pricing.
- **Workload Quick Presets**: Added one-click workload configuration chips in the Session Setup modal:
  - 💬 **Light Convo**: 8k context, 4k output, 10 tool calls, 20 turns.
  - 🛠 **Deep Development**: 24k context, 8k output, 25 tool calls, 50 turns.
  - 🏗 **Big Codebase & Audit**: 64k context, 16k output, 50 tool calls, 100 turns.
- **Live Session Cost Counter**: Real-time spending tracker (`Spent: $X.XXXX`) in header metric bar and status bar, computing true model catalog input/output usage with free designation for local models.
- **Dual Field Definition & Technical Explanations**: Included clear definitions and technical mechanics under every setting in the setup and configuration modals.
- **Write File Append Support (`append?: boolean`)**: Added optional `append` parameter to `write_file` to support direct logging and incremental markdown generation without repetitive read-modify-write loops.
- **Non-Code Diagnostics Filtering**: Post-edit diagnostics automatically bypass documentation and log files (`.md`, `.log`, `.txt`, `.csv`, `.json`), preventing repo TypeScript compiler errors from confusing agents writing reports.
- **Webfetch Online Access Control**: Added an interactive web access toggle in the Session Setup modal, allowing users to toggle the `webfetch` tool or air-gap agents offline.

## [0.1.17] - 2026-10-20

### Added

- **Configurable Max Output Tokens (`MUGIL_IDE_MAX_OUTPUT_TOKENS`)**: Added `getMaxOutputTokens(env)` pipeline helper and `/api/config` settings integration, allowing users to override model response token limits (up to model context maximum) to eliminate `output was cut off by token limit` errors during large completions.
- **Interactive Pre-Session Setup Modal**: Added setup modal before starting a chat session in the Web UI to configure token budget, max output tokens, and execution mode, with real-time OpenRouter token pricing and estimated cost per turn.
- **Turbo Autonomous Mode**: Added autonomous execution mode (`MUGIL_IDE_TURBO_MODE=1`, `/turbo` command in CLI REPL, and UI header toggle) enabling multi-tool execution loops without per-tool manual confirmation prompts.
- **Streamlined Model Credits Bar**: Replaced wrapped multi-line model attribution with a clean, single-line horizontal strip in the Web IDE.
- **Comprehensive Documentation Rewrite**: Completely refreshed README with accessible layman-friendly explanations, visual architecture tour, and detailed v0.2.0 feature roadmap.

## [0.1.16] - 2026-10-19

### Added

- **JSON SmartCrusher (Headroom Pattern)**: Added `compressJson` in the RTK module, converting repeating uniform object arrays ($\le 15$ keys) into compact tabular TSV format while stripping null/undefined and empty values to compress payload size by up to 70%.
- **Reversible Compression & Content-Compressed Retrieval (CCR)**: Added `BlobStore` / `globalBlobStore` LRU cache for oversized tool outputs (>48,000 chars), returning structural `[Blob #id, N chars]` references with a dedicated `read_blob` tool allowing models to page through specific slices on demand without inflating conversation context.
- **AST-Aware Code Minification**: Expanded `read_file` with an optional `skeleton: true` flag and provided `read_skeleton` tool to prune internal function bodies and retain structural interfaces/declarations on non-target code files.
- **Cross-Provider Prompt Caching & Prefix Stability**: Strict byte-level prefix stability across OpenAI, DeepSeek, Anthropic, and OpenRouter with deterministic recursive key sorting (`canonicalizeJson`) and stable tool name ordering. Exposes provider cache metrics (`usage.cachedTokens`) across both buffered completions and live SSE streams.
- **Unified Git Diff & Command Minimization**: Integrated `compressGitDiff` (1-line context reduction and index hash stripper) and `filterTestBuildNoise` (suppresses passing test lines and verbose asset manifests when test/build failures occur) in the RTK pipeline.
- **Context Token Limiter & History Controls**: Replaced hardcoded `.slice(-20)` history caps with user-configurable limits via `/api/config` and the Web UI `⚡ Token Modules` modal (`MUGIL_IDE_TOKEN_LIMIT`, `MUGIL_IDE_HISTORY_BUDGET`, `MUGIL_IDE_MAX_TURNS`).

### Fixed

- **Tool Call Resend Penalty (Context Inflation)**: Cleared conversational preamble in assistant tool-call messages within the agentic loop (`tool-loop/index.ts`), preventing discarded reasoning chatter from being re-sent as input tokens on subsequent tool iterations.
- **SmartCache Prefix Boundary Precision**: Fixed boundary comparison in `isContinuation()` to avoid rejecting exact candidate prefixes at the `partialMinRatio` boundary due to floating-point precision.
- **History Budget $O(N^2)$ Re-tokenization**: Precomputed `evictedTokens` in `budgetConversationHistory` to replace quadratic token recounting in `agentRepl`.
- **Permission Overrides Diagnostic Visibility**: Added clear terminal warnings when `MUGIL_IDE_TOOL_PERMISSIONS` contains malformed JSON instead of silently falling back to defaults.
- **Thinking Delimiter Robustness**: Enhanced `extractThinkBlock` to handle unclosed `<think>` tags (from token cutoffs) and alternative `[THINKING]` markers.
- **SSE Edge-Case Resiliency**: Extended SSE parser tests and handling for chunked split JSON frames, empty event lines, and corrupted frames.

## [0.1.15] - 2026-10-10

### Added

- **Autonomous Context Compaction**: Automatically generates a structured background digest (`buildAutonomousCompaction`) when conversation history approaches the budget limit (`MUGIL_IDE_HISTORY_BUDGET`), retaining crucial project decisions, file edits, and workflow outcomes without manual `/compact` or silent turn eviction.
- **Deterministic Tool Caching**: Integrated an in-memory caching layer for idempotent read operations (`read_file`, `read_skeleton`, `search_code`, `codegraph`) keyed by target path, file `mtimeMs`, and workspace revision counter, invalidated immediately on mutations (`write_file`, `edit_file`, `apply_patch`, `run_command`).

### Fixed

- **Tool Call Execution & Unhandled Error Resiliency**: Unhandled parsing errors or empty tool-loop completions previously threw fatal `ToolError` exceptions that broke the turn and terminated the conversation flow. Added non-crashing `tryParseToolArguments`, safe `event.args` parsing in REPL event handlers, and a graceful turn outcome fallback when completions produce actions without follow-up text.
- **Configurable Command Execution Timeout**: Long-running package installation commands (such as system package manager runs or complex library installations like `tesseract`, `pip`, or `npm`) were hardcoded to a 15-second timeout, causing premature process terminations. Upgraded default timeout to 60,000ms with override support via `MUGIL_IDE_COMMAND_TIMEOUT` and extended execution buffer to 4MB.

## [0.1.14] - 2026-10-05

### Fixed

- **Terminal Query Input Bundling**: Typing into `agentTerm` accumulated keystrokes into a server-side buffer that concatenated with subsequent `#chat-input` queries. Disabled stdin on `agentTerm` in the web UI (preserving Ctrl+C interrupt support), auto-focused `#chat-input`, and removed buffer concatenation on `agent_input` so queries execute cleanly and independently.
- **Thinking Output Order & Stream Splitting**: Reasoned output and `<think>` blocks were either emitted as part of the answer stream or printed post-turn underneath the assistant answer. Added `thinking` pipeline events, live SSE `<think>` block splitting, and early reasoning rendering so thinking blocks always stream above the model answer.
- **Streamed Output Formatting**: Streamed responses are now formatted token-by-token using `StreamMarkdown` (headers, lists, bold, inline code, fenced code blocks) with zero line-buffering delay, ensuring stream output matches terminal presentation while preserving real-time token streaming.

## [0.1.13] - 2026-10-05

### Fixed

- **Partial Cache Spliced Unrelated Answers**: A partial (continuation) cache hit fired whenever a stored prompt was *any* literal prefix of the new one, so two prompts sharing a short common opener — a pasted file header, a shared preamble — produced `cachedAnswer + "\n\n" + newCompletion` as a single confident wrong answer. Partial hits now require the cached prompt to cover at least 60% of the new prompt (`MUGIL_IDE_PARTIAL_MIN_RATIO`) and at least 40 characters, and a stored concatenation can never seed another concatenation.
- **Output Truncated Mid-Answer (`max_tokens` collapse)**: The prompt-trim budget was doubling as the generation budget. Once history plus tool schemas exceeded `TOKEN_BUDGET`, `max(256, budget − promptTokens − 512)` floored every completion at 256 tokens, cutting replies off mid-sentence with no indication. Generation budget is now sized independently of prompt trimming (`DEFAULT_MAX_OUTPUT_TOKENS=8192`, floor `MIN_MAX_OUTPUT_TOKENS=1024`) and clamped against the routed model's real context window.
- **`maxTokens` Silently Dropped**: Passing ponytail as `{ outputBudget }` discarded a caller-supplied `maxTokens`. Both are caps now; the tighter wins.
- **`finish_reason` Ignored**: Providers reported `length`/`max_tokens` and the value was discarded, presenting partial answers as complete. `AskResult.finishReason`/`truncated` now surface it, the TUI prints a truncation warning, and a new `truncated` pipeline event fires.
- **Truncated Answers Cached Forever**: A length-truncated stub was written to the smart cache and served back as an instant hit on every later identical prompt. Truncated completions are no longer stored.
- **Plan Mode fought itself**: The act-mode system instruction ("execute immediately, never return a plan") was sent in both modes, so plan mode told the model to write and then denied it. Instructions are now mode-aware.
- **Plan Mode Leaked Across Workspaces**: Mode was persisted to the global user env file, so enabling plan mode in one repository made every other repository read-only. Mode is now workspace-scoped (`mode-<workspace>.json`), with `MUGIL_IDE_MODE` still honoured as an explicit override.
- **`run_command` Skipped Prefix Rules**: The bash branch returned before `toolPrefixRules` were applied.
- **Caveman Corrupted Code in Prompts**: `cavemanStrategy` had no code masking (unlike RTK), so its phrase/filler/polite regexes rewrote identifiers, comments, paths and inline code spans. Both strategies now share `codeMask.ts`.
- **RTK Flattened All Newlines**: Prose de-duplication split on `\n` and rejoined with a space, collapsing markdown lists, YAML and diffs into one paragraph. De-duplication is now per line.
- **Prompt Truncation Was Silent**: The `truncate` strategy dropped the tail of long prompts with no signal to the caller. `RefineResult.truncated`/`truncatedTokens` added; the TUI warns when input was cut.
- **`tokensSaved` Grew Quadratically**: History savings were recomputed against the entire trimmed history on every turn. Only turns that actually dropped out of the window are now counted.
- **Uninterruptible Turns**: Completion requests had no timeout and no abort path, so a stalled provider hung the turn and `isProcessing` rejected all further input. `signal`/`timeoutMs` now thread REPL → pipeline → tool loop → handoff → all provider clients (300s default); Ctrl-C cancels the turn, and an abort breaks the handoff ladder instead of retrying other models.
- **Cancelled Turns Left Unattributed Partial Answers**: Pressing Ctrl-C mid-stream printed `■ Turn cancelled.` under a half-written answer with nothing marking it incomplete, so it read like a finished one — and it was never stored, since history, the session file and the cache are all written after the turn completes. Partial streamed text is now labelled as incomplete and unsaved.
- **Ctrl-C Did Not Stop Subagents**: The turn's `AbortSignal` reached the parent provider requests but never the `task` tool, so a running subagent kept calling the provider after the user cancelled. `createWorkspaceTools` now takes a `signal` and forwards it into the subagent loop.
- **Denied-Tool Retry Loop**: A model re-issuing a refused call burned the full iteration budget on full-context resends. Denials are counted per call signature; past the limit the loop tells the model plainly to stop retrying.
- **OpenCode Zen Client User-Agent Fingerprint (`429 FreeUsageLimitError`)**: Injected official `User-Agent: opencode/1.18.27` header into outbound requests (`OpenCodeClient` via Anthropic Messages API and OpenAI Chat Completions, as well as model catalog discovery in `models.ts`), resolving false-positive `429 Too Many Requests` / `FreeUsageLimitError` rejections triggered by upstream client gating on free models. The pinned version now lives in one exported constant (`OPENCODE_USER_AGENT`) shared by both call sites.
- **Smart Cache Session File Resilience**: Guarded `entry.prompt` type check in `SmartCache.partialLookup` when scanning persistent storage keys, preventing `TypeError: Cannot read properties of undefined (reading 'length')` when session files (e.g. `last-session-*.json`) share the cache directory.
- **Provider Headers Passthrough**: Added optional `headers?: Record<string, string>` support to `OpenAiClientOptions` and `AnthropicClientOptions` for upstream header customization without monkey-patching fetch.

### Added

- **Streaming Model Output**: Completions stream token-by-token to the terminal and web UI instead of appearing all at once. Adds SSE parsers for the OpenAI and Anthropic wire formats, an optional `ProviderClient.stream()` with automatic fallback to buffered `complete()` for providers that cannot stream, a `delta` pipeline event, and live REPL rendering. Set `MUGIL_IDE_NO_STREAM=1` or pass `stream: false` to force buffered mode.
- **Streaming Through the OpenCode Zen Gateway**: `OpenCodeClient` composes an OpenAI and an Anthropic client, and TypeScript does not forward an optional interface member through composition, so OpenCode turns silently took the buffered fallback. `stream()` now delegates to whichever composed client `complete()` would use, keeping the same `claude-*` routing and `provider: 'opencode'` re-brand.
- **Turn Cancellation**: `AgentRepl.cancelTurn()` plus Ctrl-C handling in the web terminal; a cancelled turn reports `■ Turn cancelled` instead of an error.
- **Tool-Loop Output Re-Sizing**: The output budget is recomputed each iteration against the context actually accumulated, instead of being fixed from iteration 0.
- **OpenCode Free Models Support**: Verified and configured active free model support for `nemotron-3.5-lightning-free` and `nemotron-3.ultra-free`.

### Changed

- **Partial Cache Continuation Prompt**: The model is now given the shared prefix alongside the delta instead of the delta alone, so a continuation is answered in the context of the original question.
- **Web UI Status Frames Are Rate-Limited**: Each `agent_data` frame used to be followed by a `status` frame carrying the same model/mode/token snapshot. With token-by-token output that was two WebSocket frames and two `JSON.stringify` calls per token. Status frames from the write path are now coalesced to roughly one per 100ms plus a guaranteed trailing frame; model, mode and turn lifecycle events still send immediately, and the `status` message contract is unchanged.
- **Streamed Text Is Not Markdown-Formatted**: Fragments are printed as they arrive, so bullets, headings and code fences render as raw text on the streamed path only. This is inherent — formatting needs the whole answer — and does not affect what is stored or reused.
- **Streamed Display Can Differ From What Is Stored**: Post-processing (`<think>` extraction, watermark stripping) runs on the aggregate after the fragments are already on screen, so a DeepSeek-R1-style model can show a literal `<think>` block that is not in the saved answer. The REPL warns when what is on screen differs from what was stored.
- **`stream_options` Acceptance Unverified on Three Gateways**: Streaming sends `stream_options: { include_usage: true }` on the OpenAI-format clients (OpenAI, OpenRouter, Cloudflare, Together, Vercel); Anthropic reports usage in its own events and sends nothing. Acceptance has been verified live only against OpenAI — Cloudflare Workers AI, Together and Vercel AI Gateway are unverified. The two failure shapes differ and it is worth telling them apart before filing: a gateway that **rejects** the unknown field answers `400`, which is non-retryable, so the handoff ladder breaks immediately and the turn **fails** with a `ProviderError` rather than degrading; a gateway that **ignores** the field degrades to the buffered fallback and streamed token counts become `countTokens` estimates rather than reported counts.
- **Default `TOKEN_BUDGET` 10,000 → 32,000**: The budget now covers a full agentic turn (system prompt + skills + tool schemas + 16k of history) without triggering prompt trimming. It is a prompt-trim budget only; generation is budgeted separately.
- **`todowrite` Allowed in Plan Mode**: Denying it made `todoread` permanently empty. Tracked as `PLAN_TOOLS` rather than a workspace-mutating `WRITE_TOOL`; new `PLAN_TOOLS` export.
- **Tool Policies Derived from Tool Lists**: `defaultPolicyForMode` is now built from `READ_TOOLS`/`WRITE_TOOLS`/`EXEC_TOOLS` instead of a second hand-maintained copy that had drifted.

## [0.1.12] - 2026-09-01

### Added

- **AST / Skeletonized Code Reading (`read_skeleton`)**: Added `read_skeleton` tool for extracting code signatures, interfaces, classes, methods, and functions without internal bodies for 70-80% token savings when exploring files.
- **Smart Cache Prefix Trie ($O(L)$ `partialLookup`)**: Implemented `PrefixTrie` for fast prefix caching and retrieval.
- **Dynamic History Budget**: Added `DEFAULT_HISTORY_BUDGET` (16,000 tokens) and `getHistoryBudget()` supporting `MUGIL_IDE_HISTORY_BUDGET` override and automated older turn compaction.
- **Subagent Output Condensation**: Auto-compresses subagent execution returns in `task` tool via Caveman and RTK before injecting into parent context.

### Changed

- **Relaxed Tool Loop Limits**: Default tool iteration limit raised from 6 to 15 (customizable via `MUGIL_IDE_MAX_TOOL_ITERATIONS`), and max tool output char bound raised from 16k to 48k chars (`MUGIL_IDE_MAX_TOOL_CHARS`).
- **Code Search Grouping & Truncation (`search_code`)**: Grouped search hits by file header and capped match line lengths with truncation indicators to eliminate redundant headers and keep searches token-efficient.
- **Stats Observability**: Surfaced Smart Cache lookup counts and hit rate percentage in `/stats`.
- **Terminal REPL Cleanup**: Removed ASCII art banner and cursor shimmer animation from terminal REPL startup for cleaner terminal output.
- **Web UI Header Robustness**: Updated top-left header logo container and `<header>` with responsive auto-height and text wrapping (`word-break: break-word`, `overflow-wrap: anywhere`), preventing header and logo clipping when long model names span multiple lines.

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
[0.1.12]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.12

[0.1.13]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.13

[0.1.14]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.14

[0.1.15]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.15

[0.1.16]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.16

[0.1.17]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.17
[0.1.18]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.18
[0.1.19]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.19
[0.1.20]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.20
[0.1.21]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.21

[0.1.22]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.22
