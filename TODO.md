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

## Planned for Next Release (v0.2.0 — Standalone Launcher & UI Modularization)

- [ ] **Standalone Launcher (SEA / npm link) & Project Folder Management UI**:
  - Add "Open Project Folder" and "Create New Project" modal & file-picker in Web UI when launched standalone or via global CLI.
  - Multi-workspace switching without restarting the Node server.
  - Native binary packaging (Node.js Single Executable Application / Bun compile) for zero-dependency desktop launching.
- [ ] **Extract Web UI Assets**: Move inline HTML/CSS/JS template literal in `html.ts` into static files to drop `unsafe-inline` CSP directive.
- [ ] **OpenAI Wire Client Consolidation**: Unify repetitive provider wire implementations into a single configurable client.
