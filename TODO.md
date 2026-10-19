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

## Planned for Next Release (v0.2.0 — Standalone Launcher, Security & Async Execution)

- [ ] **Async & Cancellable `run_command`**: Replace synchronous execution with non-blocking child process streaming and `AbortSignal` support.
- [ ] **Realpath Workspace Sandboxing**: Enforce `fs.realpathSync` to prevent symlink and Windows 8.3/junction containment escapes.
- [ ] **Local Auth & Session Tokens**: Generate an ephemeral session token on server startup required for all local API access.
- [ ] **Webfetch SSRF Protection**: Guard against requests targeting private or link-local network ranges (`169.254.169.254`, `127.0.0.1`, RFC 1918 CIDRs).
- [ ] **Parallel Model Probing**: Probe local and cloud providers concurrently in `/api/models` using `Promise.allSettled`.
- [ ] **Standalone Launcher (SEA / npm link) & Project Folder Management UI**:
  - Add "Open Project Folder" and "Create New Project" modal & file-picker in Web UI when launched standalone or via global CLI.
  - Multi-workspace switching without restarting the Node server.
  - Native binary packaging (Node.js Single Executable Application / Bun compile) for zero-dependency desktop launching.
