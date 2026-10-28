# TODO

## Next Release (Shipped in 0.1.14)

- [x] **Fix Thinking Block Placement & Stream Routing**: Streamed reasoning blocks and `<think>` tags now route live to `onThinking` before the answer delta stream, rendering the reasoning block above the model response and eliminating duplicate thinking printing below answers.
- [x] **Fix Streamed Output Formatting**: Streamed responses are formatted token-by-token using `StreamMarkdown` (headers, bullets, bold, inline code, fenced code blocks) with zero line-buffering delay, ensuring formatted stream output matches terminal presentation while preserving real-time token streaming.
- [x] **Lock User Query Input to UI Text Box**: Locked query input to the `#chat-input` field in the web UI. Disabled stdin on `agentTerm` (preserving Ctrl+C interrupt) and removed `inputBuffer` concatenation on `agent_input` to prevent merging previous terminal characters with current queries.

## Next Release (Shipped in 0.1.15)

- [x] **Autonomous Context Compaction**: Proactive structured compaction digest generated when conversation history approaches budget thresholds (`MUGIL_IDE_HISTORY_BUDGET`), preserving critical project state, file changes, and architectural decisions without manual `/compact` or sudden turn eviction.
- [x] **Deterministic Tool Caching**: Cache idempotent read-only tool calls (`read_file`, `read_skeleton`, `search_code`, `codegraph`) across turns keyed on file mtime and workspace revision counter, invalidated on mutations (`write_file`, `edit_file`, `apply_patch`, `run_command`).
- [x] **Tool Call Resiliency & Error Recovery**: Fixed fatal `ToolError` terminations on malformed tool arguments and empty completions; extended default shell execution timeout to 60s with `MUGIL_IDE_COMMAND_TIMEOUT` support.

## Next Release (Shipped in 0.1.16)

- [x] **Cross-Provider Prompt Caching & Prefix Stability**: Strict byte-level prefix stability and prompt cache breakpoints extended across OpenAI, DeepSeek, and Gemini gateways (beyond existing Anthropic ephemeral cache control).
- [x] **Unified Git Diff & Command Minimization**: Dedicated 1-line context git diff compression and test/build runner noise filter.
- [x] **User-Configurable Token Limits & History Budgets**: Replace hardcoded history turn cuts (`.slice(-20)`) and fixed token caps with user-defined configuration via UI settings, CLI flags, and environment variables (`MUGIL_IDE_TOKEN_LIMIT`, `MUGIL_IDE_HISTORY_BUDGET`, `MUGIL_IDE_MAX_TURNS`).
- [x] **JSON SmartCrusher (Headroom Pattern)**: Structural JSON compression for verbose tool and MCP outputs converting repeating object arrays to compact tabular/TSV formats with null/empty field stripping (`compressJson`).
- [x] **Reversible Compression & Content-Compressed Retrieval (CCR)**: Cache uncompressed raw outputs of oversized tool runs (file reads, build logs) with reference IDs (`[Blob #id]`) and provide on-demand retrieval for the model via `read_blob` tool if deeper context is needed.
- [x] **AST-Aware Code & Signature Minification**: Expand skeleton extraction to prune internal function bodies and boilerplate comments on non-target code files before sending to model context (`read_skeleton`, `read_file` with `skeleton: true`).
- [x] **Origin & WebSocket Security Hardening**: Reject untrusted foreign-origin WebSocket upgrades and HTTP mutations; add strict Content-Security-Policy; whitelist environment variable injection in `/api/keys`; prevent path traversal on `/api/file`.
- [x] **Zero ESLint Errors & Partial Thinking Discarded Fix**: Decouple internal reasoning from conversational prose to eliminate false yellow warnings when models naturally reason before calling tools; resolve all linting issues across workspaces.

## Next Release (Shipped in 0.1.21 — Security Hardening, Sandboxing & Core Engine Audit)

- [x] **Async & Cancellable `run_command` (§3)**: Replaced synchronous execution with non-blocking child process execution and `AbortSignal` cancellation support.
- [x] **Realpath Ancestor Workspace Sandboxing (§2)**: Enforced `fs.realpathSync` in `resolveInWorkspace` across nearest existing ancestors to prevent symlink and junction containment escapes on both existing and new files.
- [x] **Local Server Auth & Session Cookies (§1a)**: Enforced ephemeral session token auth on all routes (`/`, `/api/*`, `/ws`). Unauthenticated requests reject with 401. Replaced cleartext token scraping and query-string WebSocket tokens with `HttpOnly; SameSite=Strict` cookies. Removed `MUGIL_IDE_DISABLE_AUTH` bypass.
- [x] **Provider Base-URL Allowlisting (§1b)**: Restricted `/api/keys` base URLs to approved cloud domains or local loopback (`127.0.0.1`, `localhost`), completely blocking API key exfiltration.
- [x] **Workspace Directory Confinement (§1c)**: Restricted `/api/workspace` targets to prevent selecting system directories or root drives.
- [x] **Request Body 2MB Ceiling (§1e)**: Enforced 2MB payload ceiling on JSON body readers including `/api/model`.
- [x] **Webfetch SSRF Protection (§4)**: Added IPv6 ULA (`fc00::/7`), link-local (`fe80::/10`), loopback, and cloud metadata checks. Added hard-abort on DNS lookup failures and manual hop-by-hop redirect verification.
- [x] **Tool Loop Denial Message Sequence (§5)**: Verified alternating message roles on permission denials via client complete spies.
- [x] **Context Window Budget Overflow Hard Error (§6.2)**: `pipeline.ts` throws explicit `Context overflow` error when `contextRoom <= 0`.
- [x] **Accurate Token Estimation Across All Providers (§6.3, §6.5)**: Unified prompt token and handoff chain estimation (`estimateMessagesTokens`) across all 7 provider clients to account for tool schemas and arguments.
- [x] **Cost and Tier Routing (§6.4)**: `HandoffManager.route()` sorts candidates by `(tier, costPerMTokIn)`.
- [x] **Symmetrical Env Serialization (§6.6)**: `parseEnvFile` symmetrically unescapes double-quoted values using `JSON.parse`.
- [x] **Canonical Tool Schemas (§6.7)**: Anthropic tool definitions sorted alphabetically with canonicalized schemas.
- [x] **Parallel Model Probing (§7.6)**: Probing local and cloud providers concurrently in `/api/models` using `Promise.allSettled`.
- [x] **Hermetic Test Suite (§6.1)**: Cleared ambient `MUGIL_IDE_*` in jest setupFiles.

## Crash Audit 2026-10-26 — fixed in this release (see `crash-audit-26-10-26.md`)
- [x] **Global Error Handlers (crash amplifier)**: `unhandledRejection` / `uncaughtException` log and keep the server serving (`packages/cli/src/index.ts`).
- [x] **Malformed `Host` Header (unauthenticated DoS)**: both `new URL` sites now parse against a fixed base and answer 400 (`parseRequestUrl` in `server.ts`); HTTP handler is wrapped so a stray rejection becomes a 500.
- [x] **Malformed WebSocket Frame**: `ws.on('error')` + `socket.on('error')` on the upgrade socket; frame-level violations terminate only that socket.
- [x] **Session Autosave Failure**: fire-and-forget saves go through `autoSaveSession()` with a one-time warning; `saveSession()` returns `''` on write failure instead of throwing.
- [x] **Fallback PTY Spawn Error**: `child.on('error')` + early-output buffering surface `[Shell failed to start: …]` in the pane; `stdin` EPIPE is swallowed.
- [x] **`/api/graph` O(n²) Stall**: single-pass line-index + binary search, 1 MB per-file cap, one-entry graph cache invalidated with the workspace tool cache (20k symbols: 5 099 ms → ~83 ms).
- [x] **No WebSocket Backpressure**: 8 MB high / 1 MB low watermarks (`MUGIL_IDE_WS_HIGH_WATERMARK` / `_LOW_`), PTY pause/resume, one-time `[output throttled]` notice; agent output is dropped rather than buffered.
- [x] **`run_command` Process Tree**: `spawn(..., { detached: true })` (exec/execFile drops `detached`) + `process.kill(-pid)` on timeout/abort; explicit output cap instead of `maxBuffer` crash.
- [x] **`SmartCache.prefixTrie` Leak**: bounded at `maxTrieEntries` (default 2 000) with a generation flush; backend scan keeps partial lookups correct.

## Provider API path audit (2026-10-28)
- [x] **Cloudflare Workers AI**: direct path `https://api.cloudflare.com/client/v4/accounts/{id}/ai/v1/chat/completions`; AI Gateway now uses its real host `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/openai/chat/completions` (the old `/gateway/accounts/...` path on `api.cloudflare.com` 404s). `CLOUDFLARE_GATEWAY_ID` wires the option through config.
- [x] **Cloudflare model discovery**: `/accounts/{id}/ai/models/search` is now called with `engine.config.cloudflareAccountId`; previously the id was parsed out of the base URL, which never contains `/accounts/`, so the catalog was never probed.
- [x] **OpenCode**: legacy `https://opencode.ai/zen/v1` paths still served; added documented `https://opencode.ai/inference` support (`/openai/v1`, `/anthropic`, `/v1/models`) via `opencodeBaseUrls()`.
- [x] **OpenRouter / OpenAI / Anthropic / Vercel / Together / Ollama / LM Studio**: paths re-probed live (200/401 as expected, no 404s) — unchanged.
## Update-available indicator
- [x] **Header badge**: `⬆ vX.Y.Z` pill next to the version text, backed by `GET /api/update-check` (npm `latest` vs `VERSION`, 6 h cache, 4 s timeout) linking to the release tag.
## Savings indicator (2026-10-28)
- [x] **Savings Always 0%**: denominator was the provider's whole prompt count; now `savedTokens / (savedTokens + compressibleTokens)` over Caveman/RTK refinement, signature stripping, history eviction/compaction, tool-output compression and cache hits. One helper (`inputSavingsPercent`) backs the TUI `/stats`, the Web UI pill and `AskResult.savings`.
## Kill Server button (v0.1.24)
- [x] **Header Control + Warning Modal**: red `⚠ Kill Server` button opens a confirmation dialog (warning icon, list of what terminates) with Cancel focused by default and Esc/Cancel wired up.
- [x] **Authorized `POST /api/shutdown`**: session-token + Origin gated; responds `{ok:true, shuttingDown:true}` then flushes before the listener closes; `SIGINT`/`SIGTERM` share one idempotent shutdown path.
- [x] **No Reconnect After Shutdown**: the WebSocket `onclose` handler shows "Server stopped" plus a final overlay instead of looping on reconnect.

## Planned for Next Release (v0.2.0 — Standalone Launcher & UI Modularization)

- [ ] **Standalone Launcher (SEA / npm link) & Project Folder Management UI**:
  - Add "Open Project Folder" and "Create New Project" modal & file-picker in Web UI when launched standalone or via global CLI.
  - Multi-workspace switching without restarting the Node server.
  - Native binary packaging (Node.js Single Executable Application / Bun compile) for zero-dependency desktop launching.
- [ ] **Extract Web UI Assets**: Move inline HTML/CSS/JS template literal in `html.ts` into static files to drop `unsafe-inline` CSP directive.
- [ ] **OpenAI Wire Client Consolidation**: Unify repetitive provider wire implementations into a single configurable client.
