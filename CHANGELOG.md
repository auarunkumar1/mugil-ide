# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.2] - 2026-11-14

### Added
- **`grounded-craft` Anti-Runaway & "Lazy Smart" Engineering Skill**:
  - Implemented the `grounded-craft` skill bundled in the Curated Skill Gallery (`CURATED_GALLERY_SKILLS`) for optional 1-click workspace installation via the Web UI or CLI.
  - **Thinking Model Runaway Defense**: Implemented strict convergence protocols targeting reasoning models (DeepSeek Flash, DeepSeek-R1, MiniMax, MiMo) to stop unbounded meta-cognitive loops and hour-long reflection stalls during code audits and feature additions.
  - **The "Lazy Smart" Senior Developer Persona**: Anchored the agent in customer-first utility, anti-ivory-tower ("anti-ponytail") engineering, minimal moving parts, and exploring battle-tested open-source prior art before reinventing the wheel.
  - **Senior Developer Drift Nudge Engine**: Added real-time trajectory monitoring with standardized alerts (`[Senior Nudge: Scope Drift]`, `[Senior Nudge: Wheel Reinvention]`, `[Senior Nudge: Over-engineering]`, `[Senior Nudge: Orphan UI Control]`) to keep development strictly on the agreed path.
  - **Zero-Orphan UI Invariants**: Mandated 5-point semantic contracts across all interactive controls (buttons, inputs, selects, modals) ensuring every element has concrete customer meaning, controlled bindings, client-side validation, and a 4-state visual lifecycle (`idle`, `loading/disabled`, `success`, `error`).
  - **Compact Contract First**: Enforced concise ~60–150 token contract specifications mapping UI triggers to registered backend API routes before generating code, curbing token bloat and eliminating multi-turn repair thrashing.
  - **Automated Static Verification Scanner**: Added zero-dependency static analysis tool (`scripts/verify-grounded-craft.mjs`) and 7-test suite (`tests/test-grounded-craft.mjs`) detecting dead buttons (`() => {}`, `console.log`, `alert()`), orphan inputs, unwired client fetch calls, and unmounted Express/FastAPI routers.

### Changed
- **Pure Browser IDE Philosophy & Roadmap Alignment**:
  - Dropped Native Desktop Shell Packaging (Tauri/Electron) from the roadmap in `README.md`, firmly establishing Mugil IDE's core architecture as a lightweight, mobile-ready, OS-agnostic pure browser IDE accessible instantly on Linux, macOS, Windows, iOS, and Android.


## [0.4.1] - 2026-11-13

### Added
- **Mobile Responsive Architecture & Single-Pane Navigation**:
  - Implemented full-screen single-pane mobile layout using absolute containment (`#files-pane`, `#chat-pane`, `#diff-pane`), eliminating horizontal stacking and granting 100% viewport width to the active view on screens $\le 768\text{px}$.
  - Side panels (`#files-pane`, `#diff-pane`) initialize with `.mobile-hidden` on mobile viewports while desktop layout automatically restores `display: flex !important` above $768\text{px}$.
  - Added dedicated touch-friendly bottom dock (`#mobile-dock`, 52px height) with iOS home indicator safe-area padding (`env(safe-area-inset-bottom)`) for instant one-touch switching between Agent, Terminal, Files, Diff, and Stream views.
  - Automatically switched to the full-screen file viewer when tapping any file in the mobile file explorer.
- **Mobile Top Bar & Touch Dropdown Menus**:
  - Eliminated top bar overflow clipping by setting `<header>` to `overflow: visible !important; position: relative !important; z-index: 1500 !important;` on mobile devices.
  - Styled `.menu-dropdown-content` with viewport-fixed positioning (`position: fixed !important; top: 46px !important; right: 8px !important; z-index: 5000 !important; max-height: calc(100dvh - 60px) !important; overflow-y: auto !important; -webkit-overflow-scrolling: touch !important;`).
  - Streamlined mobile header into a clean 1-line layout (`☁️ MUGIL IDE` rainbow logo on left, `🎨 Theme ▾` and `☰ Menu ▾` on right), hiding desktop ribbon clutter and redundant stream buttons.
  - Added full IDE controls to `#header-menu-dropdown` on mobile: Session Setup & Limits, Stream Session (QR Code), Kill Server, Switch Model, Turbo Mode, Step Debugger, Agent Mode, Generate Image, Pluggable Extensions, Accounts, Switch Workspace, Token Modules, and Credits.
  - Added mutual closing (`toggleMenuDropdown` closes theme menu and vice-versa) and combined `pointerdown` and `click` outside touch dismissal.
  - Raised `.modal-overlay` z-index to `6000 !important` on mobile, ensuring modals render above headers and dropdowns.
- **Dual-Stack LAN & Loopback Socket Binding**:
  - Node HTTP and WebSocket servers bind dual-stack across all network interfaces by default (`server.listen(port)` omitting explicit host), accepting incoming connections simultaneously from localhost (`127.0.0.1` and `::1`) and local Wi-Fi / LAN IP addresses (`192.168.x.x`).
  - Added automated fallback binding to `0.0.0.0` for Linux kernels with IPv6 disabled (`EAFNOSUPPORT`).
  - Exported canonical base URL (`server.url`) as `http://localhost:${port}` for browser launching while exposing detected LAN endpoints in `server.networkUrls`.
- **Cross-Device Session Authentication & Token Resilience**:
  - Implemented token persistence via browser `sessionStorage` and `localStorage` (`mugil_token`) on remote connected devices.
  - Patched browser `fetch` to automatically attach the `x-mugil-token` header to all API requests on network devices.
  - Attached token query parameter (`?token=...`) to WebSocket handshake URLs (`/ws?token=...`) to guarantee seamless reconnects on mobile browser refreshes.
  - Configured session cookies with `SameSite=Lax` to allow LAN cross-origin navigation.
- **File Picker Interaction Polish**:
  - Single-click selects items with visual highlighting (`var(--accent)`), updating selected path and summary status.
  - Double-click (or dedicated `Open →` button) opens and enters subfolders.

## [0.4.0] - 2026-11-13

### Added
- **Remote Device Streaming via Secret Link & QR Code**:
  - Live session streaming to phones, tablets, and secondary devices on the local network without complex port forwarding or third-party relay servers.
  - Zero-dependency pure-TypeScript ISO/IEC 18004 Model 2 QR Code engine (`packages/cli/src/server/qr.ts`) generating both high-contrast SVGs for browser modals and ANSI half-blocks for terminal banners. Fully verified against iOS/Android camera scanners with standard Level M format BCH polynomial masking and alignment patterns.
  - Automatic non-internal IPv4 LAN address discovery (`getLocalNetworkAddresses`) with network URL generation and session token security authentication (`?token=...`).
  - Terminal startup banner displaying network streaming URLs and terminal ANSI QR code when launched with `mugil-ide ui --remote` (`-r`) or `MUGIL_IDE_REMOTE=1`.
  - Header `📱 Stream` modal (`#remote-stream-modal`) showing real-time connected client count, 1-click secret link copy, and responsive QR code.
  - Multi-client WebSocket session broadcaster (`connectedClients` set + `replayBuffer`) streaming live agent output, tool calls, thinking updates, and status updates to all connected browser sessions.
  - `GET /api/session/remote-stream` REST endpoint returning stream connection details, active client counts, and vector QR markup.
- **Three-Pane Collapsible Responsive Layout & Mobile/Tablet Navigation**:
  - 3-pane flexible layout dividing the workspace into:
    - Left Sidebar (`#files-pane`): File Explorer and CodeGraph, collapsible via header `[📁 Files]` toggle or internal `[✕]`.
    - Center Pane (`#chat-pane`): AI Assistant conversation cards, thinking stream, terminal, and user input; smoothly expands to 100% of workspace when side panels are collapsed.
    - Right Sidebar (`#diff-pane`): File Viewer & Diff Viewer with auto-uncollapse on file selection or diff generation, collapsible via header `[🔍 Diff]` toggle or internal `[✕]`.
  - Resilient draggable divider handles (`#resizer-files`, `#resizer-diff`) with minimum width boundaries.
  - Mobile dock navigation (`#mobile-dock`) with dedicated view switches (`Agent`, `Terminal`, `Files`, `Diff`) for phone/tablet screens (`@media (max-width: 768px)`).
  - Strictly prevents vertical stacking on mobile screens: side panels start collapsed, granting the Chat view 100% screen real estate, with each panel occupying 100% viewport width when active.
- **Multi-Line Prompt Textarea**:
  - Increased prompt input height to comfortable 5-6 lines (`#chat-input` textarea, min-height 92px) with auto-resizing.
  - Pressing `Enter` submits the prompt; pressing `Shift+Enter` inserts clean newlines for complex multi-line instructions.
- **Modern Thinking Stream & Turn Cards**:
  - Collapsible real-time reasoning container (`#thinking-container`) with live elapsed execution timer, pulse indicator, and token metrics.
  - Modern Agent View mode (`#modern-agent-view`) rendering structured user turn cards, real-time assistant responses, and inline tool execution badges alongside raw xterm terminal toggle (`[✨ Modern View]` / `[💻 Raw Terminal]`).
  - Auto-scroll lock with floating `↓ New Output` indicator pill when scrolled up to inspect previous turns.
- **Multi-Theme Engine**:
  - 5 high-contrast designer palettes: **GitHub Dark** (Default), **Nordic (Nord)**, **OLED Dark (True Black)**, **Dracula**, and **Cyberpunk Neon**.
  - Synchronized xterm.js terminal emulator palette and CSS custom properties dynamically applied on selection.
  - Header `🎨 Theme` dropdown with persistent user preference in `localStorage`.
- **Intuitive Folder Picker Interaction**:
  - Single-click selection with visual highlighting (`var(--accent)`), updating selected path and summary status.
  - Double-click (or dedicated `Open →` button) to navigate into subfolders.
  - Background click deselects subfolder item back to current directory.
  - Integrated subfolder creation directly inside selected or current path.

## [0.3.2] - 2026-11-08
### Added
- **`process-auditor` Universal Business Logic & Multi-Industry Skill**: Added a comprehensive workspace business process verification skill (`.agents/skills/process-auditor`) covering 10 distinct industry verticals:
  - **ERP & Supply Chain**: 3-way matching (PO vs. GRN vs. Bill), inventory depletion timing, and negative stock guards.
  - **Banking & FinTech**: Double-entry equilibrium ($\sum \text{Dr} = \sum \text{Cr}$), concurrency locks against double spending, overdraft ceilings, and immutable WORM audit logs.
  - **Healthcare & Hospital Management (HMS)**: Doctor consultation attestation, drug-allergy interaction checks, prescription-only dispensing, and discharge gate locks.
  - **Hospitality & Hotel PMS**: Room cleanliness state machine (`DIRTY` $\to$ `INSPECTED` $\to$ `OCCUPIED`), overbooking guards, split folios, and daily Night Audit rollovers.
  - **Logistics & Fleet Transport**: Consignment Notes (LR / Bill of Lading), GVWR gross vehicle weight limits, driver hours of service (HOS), and mandatory Proof of Delivery (POD) before billing.
  - **Manufacturing & Engineering**: Bill of Materials (BOM) locking on active Work Orders, WIP cost absorption accounting, scrap variance tracking, and QA/QC quarantine gates.
  - **Retail POS & Grocery**: Blind cash counts, fiscal Z-reports, weigh scale barcodes, and FEFO expiry rotation.
  - **Construction & Contracting**: Bill of Quantities (BOQ) over-measurement guards, Retention Money trust accounting (5–10%), and Variation Orders.
  - **Events & Catering**: Guaranteed headcount locks (attrition defense), advance deposit escrow, and Banquet Event Order (BEO) revision broadcast.
  - **Tax Audit & Print Formats**: Gapless sequential numbering, statutory multi-tier tax splits (GST/VAT), currency in words, and print CSS layout standards (`@media print`, page-break protection).
- **Automated Multi-Industry Auditor & Test Suite**: Included standalone scanner `scripts/verify-business-logic.mjs` with `--industry` filtering and a 10-vertical paired test suite `tests/test-industry-audits.mjs` verifying zero false positives on compliant code and 100% detection of business process violations.

### Security
- **A symlinked `SKILL.md` can no longer exfiltrate files**: `discoverSkills` rejects symlinked skill directories and symlinked `SKILL.md` files and verifies the real path stays inside its tier, so a cloned repo pointing `SKILL.md` at `~/.ssh/id_rsa` is skipped entirely.
- **Trigger-injected skills are budgeted**: `triggeredSkillsBlock` caps the *total* injected instructions at 12k chars across all matched skills, so a prompt hitting several broad triggers degrades gracefully instead of throwing `Context overflow` and killing the turn.
- **URL skill installs are SSRF-guarded**: `installFromUrl` goes through the new shared `guardedFetch` (`modules/security/restrictedNet.ts`), refusing loopback/private/link-local/cloud-metadata hosts and re-checking every redirect hop. `isRestrictedIp` was extracted from `webfetch` so both use one implementation.
- **Non-markdown bodies are rejected**: a GitHub URL that resolves to an HTML page now fails with a clear error instead of installing HTML as a skill, and `github.com/.../blob/.../SKILL.md` URLs are rewritten to `raw.githubusercontent.com`.
- **Local skill imports are filtered**: `installFromPath` copies entries itself instead of `fs.cpSync` — `.git`, `node_modules`, `.env*`, symlinks and files over 1 MB are skipped, so credentials and VCS data cannot be dragged into a git-tracked path.
### Changed
- Project- and user-supplied skills are marked `[workspace skill]` / `[global skill]` in `skillsContextBlock`, and the block warns that their instructions are untrusted content. Built-in skills stay unmarked.
- `matchSkillTriggers` matches on word boundaries, so `tdd` no longer fires on `stddev`.
- Frontmatter parsing handles YAML block scalars (`description: >` / `|`) and block lists (`- item`), covering the standard Claude SKILL.md shape.
- Gallery list responses omit `content` (25 KB → 8 KB); the Web UI fetches a single body when previewing.
- Uninstalling a skill that doesn't exist no longer creates `.mugil/skills` as a side effect.
- `hasScripts` / `hasReferences` are true only when the directory actually holds files.
### Fixed
- An unparseable `.mugil/config.json` is no longer silently rewritten (dropping every other key); toggling a skill refuses with an actionable error instead.
- Built-in skills no longer report `installed: true` in the gallery and credits UI, which made a fresh workspace look pre-populated.
- Reinstalling a gallery skill in the Web UI asks for confirmation instead of unconditionally overwriting local edits.
- The Web UI Skills tab gained a 🗑 Uninstall button for workspace and global skills.
- `@mugil-ide/core` now ships `ATTRIBUTIONS.md`, so installed users get the full credits table instead of the 10-entry fallback.
- Corrected gallery attribution metadata: `owasp-guard` is CC-BY-SA-4.0 (was Apache-2.0), `database-schema` uses the PostgreSQL license (was MIT), TDD / code-review-critic / legacy-refactorer now credit their concept sources instead of a dead or unrelated repo, and `dependency-auditor`, `docker-packager`, `github-actions-ci` point at repositories that exist.

## [0.3.1] - 2026-11-08

### Added

- **Curated Open-Source Skills Gallery**: Bundled catalog of 16 battle-tested skills (`system-architect`, `api-designer`, `database-schema`, `playwright-e2e`, `mutation-tester`, `owasp-guard`, `dependency-auditor`, `code-review-critic`, `legacy-refactorer`, `docker-packager`, `github-actions-ci`, `git-workflow-pro`, `changelog-generator`, `web-vitals-optimizer`, `test-driven-development`, `process-auditor`) with full upstream author attribution, license identifiers, and templates.
- **Universal Skill Installer Engine** (`installFromGallery`, `installFromUrl`, `installFromPath`, `uninstallSkill`): 1-click installation from the gallery into workspace (`.mugil/skills`) or global (`~/.config/mugil-ide/skills`), installation from GitHub tree/raw URLs, and local directory importing with path traversal sandboxing.
- **Dedicated Open-Source Credits & Attributions Page**: Header `☰ Menu` item and modal (`#credits-modal`) listing full authors, canonical upstream repositories, and licenses for agent skills, core engine modules (Caveman, RTK, Ponytail, OpenCode, CodeGraph, etc.), and libraries.
- **Credits REST & CLI Suite**: `GET /api/credits`, `GET /api/skills/gallery`, `GET /api/skills/gallery/:id`, `POST /api/skills/install`, `DELETE /api/skills/:name`, plus REPL slash commands `/gallery [category]`, `/skill-install <id|url>`, `/skill-uninstall <name>`, and `/credits [category]`.
- **Skills Gallery Web UI**: Dedicated "Skills Gallery" tab in the Extensions modal with category filter chips (Architecture, Testing, Security, Refactoring, DevOps, Git, Performance), keyword search, instruction preview drawer, and 1-click install buttons.

## [0.3.0] - 2026-11-08

### Added

- **Multi-tier skills discovery**: skills now resolve across four tiers — workspace (`.mugil/skills`, `.agents/skills`, `.claude/skills`), global (`~/.config/mugil-ide/skills`, override with `MUGIL_IDE_SKILLS_DIR`), and built-in skills shipped with `@mugil-ide/core` (`security-auditor`, `test-driven-development`). A higher tier shadows a lower one by name.
- **Extended skill frontmatter**: `version`, `author`, `tags`, `triggers`, `tools` alongside `name`/`description`, plus `hasScripts`/`hasReferences` detection for bundled `scripts/` and `references/`.
- **Skills REST suite**: `GET /api/skills`, `GET /api/skills/:name` (document body + asset listing), `POST /api/skills/toggle` (persisted in `.mugil/config.json`), `POST /api/skills/create` (scaffolds `.mugil/skills/<name>` or the global tier).
- **CLI skill commands**: `/skills` (table with source, state and assets), `/skill <name> [on|off]`, `/skill-create <name> [description]`.
- **Trigger-based auto-activation**: a prompt matching a skill's `triggers` gets that skill's instructions injected into the turn's context block, so the obvious case costs no `skill` tool call.
- **Live skills registry drawer**: the Web UI modal now loads `/api/skills`, renders source badges (Workspace / Global / Built-in), toggles skills, opens an instruction viewer with the asset list, and creates new skills from a form.
- **Ephemeral secret vault** (`SecretVault`): detected credentials are replaced with `[MUGIL_SECRET_<TYPE>_<N>]` tokens while the real value stays in process memory only — never written to history, the session file or the response cache.
- **Secret scanner** (`scanSecrets` / `hasSecrets` / `shannonEntropy`): 20+ signatures covering OpenAI (incl. `sk-proj-`), Anthropic, OpenRouter, Google, AWS, GitHub, Slack, Stripe, Hugging Face, bearer/basic auth headers, database connection-string passwords, PEM private keys, and CLI password/`--api-key` flags. Placeholder values in docs and fixtures are rejected, and a cheap hint pre-filter keeps the scan off the per-token hot path.
- **Three secret choke points**: user input is tokenized at ingestion (CLI REPL, and in the Web UI after a confirmation), tool output is tokenized in `ToolLoop.execute` before it is fed back, and `HandoffManager.complete()` / `stream()` re-scan every message and tool-call argument before any remote provider call.
- **Local-only secret resolution**: `run_command` substitutes real values into the command line in-process; the output is re-tokenized before the model sees it.
- **Web UI secret pre-flight linter**: the chat input warns about detected credentials before sending, naming each type found.

### Changed

- `skillsContextBlock` only advertises enabled skills, and the `skill` tool refuses to load a disabled one.
- `@mugil-ide/core` now publishes its bundled `skills/` directory.

## [0.2.0] - 2026-11-08

### Added

- **Delta Mode Error Diagnostics (RTK DeltaCache)**: In-memory error signature cache across test/build runs (`npm test`, `pytest`, `cargo test`, `tsc`). Isolates resolved, new and unchanged failures and collapses repeated stack traces. A red run with no parsable failures no longer reports "all resolved", and caches are scoped per workspace.
- **Auto-Tiered File Reader & Surgical `read_symbol` Tool**: Code files >300 lines read without line ranges return an outline skeleton with line anchors; non-code formats are read in full, and a fallback preview reports omitted lines. Adds `read_symbol(path, symbol)` for surgical extraction of one function, class or method.
- **Lazy MCP Schema Pruning**: Deferred tool discovery via `list_mcp_tools` and `call_mcp`, eliminating 2,000–5,000 static tokens of schema overhead per turn.
- **Offline Vector Semantic Cache**: Optional 384-dimensional hashed subword projection (`MUGIL_IDE_EMBEDDING_PROVIDER=onnx`), ~5-8ms per embed, zero network calls. Real ONNX inference requires `onnxruntime-node` plus `MUGIL_IDE_ONNX_MODEL_PATH`; the default path is deterministic lexical hashing, not a learned model.
- **Interactive Step Debugger**: Full step-through interface to pause, inspect, edit tool call arguments, skip, or abort operations before execution via the Web UI modal and WebSocket breakpoint protocol.
- **Multi-File Split Diff Review & Hunk-by-Hunk Staging**: Per-hunk acceptance or reversion via `POST /api/diff/hunk-apply`. Hunks are applied positionally with the `diff` package and reverted with `reversePatch`; every apply is journaled for undo. Working-tree only (no `git add`).
- **Multi-Workspace Folder Management UI**: Added "Open Project Folder" and "Create New Project" modal and directory switcher without restarting the Node server (`/api/workspace/switch`, `/api/workspace/create`).
- **Worktree Squad Library**: `WorktreeSquadManager` creates/removes isolated Git worktrees under `.mugil/worktrees/<id>` (gitignored). Not wired into the `task` tool yet, which still runs subagents in-process.
- **Pluggable Extension & Skill Registry Drawer**: Visual modal to inspect, enable, and configure agent skills, custom tools, and external MCP servers.
- **Web UI Hardening & Lint Cleanup**: Fixed the four lint errors that made CI red on the release commit, and removed the unused `bundle.css`/`bundle.js` build step (`/assets/bundle.*` was served but never referenced).
- **Provider Wire Clients**: `OpenAiWireClient` remains the shared base for OpenAI-compatible providers; `UnifiedWireClient` is an additional name-based factory for callers that want it.
- **Comprehensive Test Suite Expansion**: 590 passing tests across all packages (515 core, 56 cli, 10 docs, 9 mcp), hermetic by default (ambient provider API keys and the user env file are cleared in `setupEnv`).

### Fixed

- **`/api/diff/hunk-apply` containment**: the route now resolves paths through the shared `resolveInsideWorkspace` helper, so lexical and symlink escapes out of the workspace are rejected with 400 (previously it was the only write route without the check).
- **Hunk application correctness**: hunks are applied with the `diff` package (`parsePatch`/`applyPatch`, `fuzzFactor: 0`) instead of a first-substring `String.replace`. This fixes both wrong-function edits when a block appears twice and corruption from `$&`/`$1` expansion in added lines. Revert uses `reversePatch`.
- **Staging UI was a no-op**: the viewer passed the bare `@@` header as the hunk payload; it now forwards the header plus its body lines, and surfaces a console warning when a hunk no longer matches.
- **Plan mode could call arbitrary MCP tools**: the lazy gateway's `call_mcp`/`list_mcp_tools` carry no `mcp_` prefix for the plan-mode prefix rule, so they are now classified explicitly (denied in plan, `call_mcp` asks in act). `read_symbol` joined `READ_TOOLS`.
- **Step Debugger was unreachable**: `PipelineOptions.stepDebugger` is now plumbed into every `ToolLoop` (parent turn and `task` subagents), defaulting to the process-wide instance the Web UI toggles. With the debugger enabled and no observer attached, `intercept()` approves instead of hanging the turn.
- **Auto-tier destroyed data in non-code files**: skeletonization is limited to code extensions, and the head fallback now reports `… N of M lines omitted` and no longer claims to be a "structural skeleton".
- **`read_symbol` over-ran symbols ~10x**: brace counting now ignores comments, strings, template literals and regex literals, only starts once the parameter list closes, and stops at expression-bodied arrows.
- **Delta Mode reported success on a broken build**: a run whose output looks failed but yields no parsed failures no longer clears the cache ("All N resolved"), and the default cache is scoped per workspace so a folder switch cannot fake a fix.
- **Lazy MCP gateway dropped all but the first server** when no connector was injected; it now connects the whole config list eagerly.
- **CI lint was red** on the release commit (4 unused-variable errors).
- **Non-hermetic tests**: `setupEnv` also clears ambient provider API keys and points `MUGIL_IDE_ENV_FILE` at a non-existent path, so a developer's real keys can no longer turn "mock mode" tests into live calls.
- **`read_symbol` is now exposed over MCP**, matching the agent tool.
- **Docs corrected**: worktree squads are a library not yet wired into `task`, the embedding fallback is a hashed lexical projection (not a learned model), and the tool count is 20.
- **Removed dead assets**: the `bundle.css`/`bundle.js` build step and `/assets/bundle.*` route produced files nothing referenced. `.mugil/` is now gitignored.

## [0.1.26] - 2026-11-07

### Added

- **Image Generation Provider & Model Selectors**: Interactive dropdown selectors for Provider (`Auto`, `Pollinations AI`, `OpenAI`, `Together AI`, `OpenRouter`, `Vercel AI Gateway`, `Offline Mock`) and Model directly in the Image Generation UI modal (`packages/cli/src/server/html.ts`), complete with dynamic provider-specific recommended presets and custom model ID entry.
- **Targeted Provider Dispatch & Credential Diagnostics**: Core `generateImage()` supports explicit `provider` targeting and `model` overrides. Explicit selections validate provider API keys (flagging missing credentials in the placeholder diagnostic instead of silently cascading to another live provider), while `auto` retains the zero-friction multi-tier fallback cascade.
- **Workspace Tool & MCP Parameters**: Exposed `provider` and `model` parameters on the agent's `generate_image` workspace tool and MCP server tool schemas.
- **Exported Provider Metadata**: Added `IMAGE_PROVIDERS`, `ImageProviderOption`, and `ImageModelOption` in `@mugil-ide/core` defining standard model catalogs and UI dropdown options.
- **Autonomous Image Generation Tool (`generate_image`)**: Dispatches across configured providers (Vercel AI Gateway, OpenRouter, OpenAI, Together, and keyless Pollinations AI) with responsive vector SVG fallback. Supports prompt, path, size, and style parameters.
- **Image Generation UI Modal**: Accessible via the header ribbon button and dropdown menu, allowing users to configure prompts, target paths, dimensions, and visual styles directly from the web interface.
- **Truth in Asset Format & Extension Matching**: `sniffImageFormat()` detects PNG, JPEG, WebP, GIF, and SVG from magic bytes. `writeAsset()` ensures file extensions always match written byte format rather than arbitrary input filenames. Vector wrappers for raster formats in `.svg` files preserve genuine MIME types.
- **Provider Status & Honest Error Boundaries**: `generate_image` clearly warns if fallback vector placeholders are produced instead of actual models. The Web UI highlights fallbacks with visual warnings and detailed provider failure diagnostics.
- **Token Savings Breakdown Popover**: Clicking the ribbon's Savings pill now reveals a granular breakdown across Caveman, YAGNI AST Skeletons, Smart Cache, and MCP/RTK compression.
- **Regression Test for Web UI Inline Scripts**: Automated test asserting all inline `<script>` tags in `html.ts` compile without syntax errors via `new Function()`.

### Changed

- **Unified Workspace Path Containment (`resolveInsideWorkspace`)**: Centralized path resolution in `packages/core/src/modules/tools/paths.ts` enforcing both lexical containment and symlink/junction escape detection, shared across workspace tools and server endpoints (`/api/generate-image`, `/api/file`).
- **Binary File Diffing**: `/api/diffs` flags binary modifications with `binary: true` and skips diff patch computation, displaying "Binary file changed" in the diff viewer instead of base64 text dumps.
- **Full Binary Undo Support**: Binary file edits (images, audio, video, pdf) are captured in base64 within the session journal and accurately restored byte-for-byte upon `/undo`.
- **Vercel AI Gateway Model**: Updated default model to `bfl/flux-2-klein-4b` (overridable via `MUGIL_IDE_IMAGE_MODEL`).
- **OpenAI Image Generation**: Defaulted to `gpt-image-1` with automatic dimension clamping and omitted `response_format` for `gpt-image-*` models.
- **Pollinations AI Retry**: Automatic retry on 402/429/503 status codes.
- **Safe `/api/generate-image` Endpoint**: Body capped at 2 MB via `readJsonBody`, strict symlink traversal prevention, pre-write snapshotting of all plausible format extensions, and undo journal integration.

## [0.1.25] - 2026-10-29

### Changed

- **Big-Codebase Token Presets**: Default limits raised across the board so large repositories no longer truncate prompts or cut replies off mid-file. `DEFAULT_HISTORY_BUDGET` 16,000 → 64,000, `DEFAULT_MAX_OUTPUT_TOKENS` 8,192 → 32,768, prompt-trimming `TOKEN_BUDGET` 32,000 → 128,000, `DEFAULT_MAX_HISTORY_TURNS` 50 → 100 and `DEFAULT_MAX_TOOL_ITERATIONS` 20 → 40.
- **Workload Presets Rebalanced**: Light (32k context / 8k output), Deep (64k / 32k), and Big Codebase & Audit (128k / 64k, 60 tool calls) — sliders now allow up to 256k context and 128k output.

### Fixed

- **CodeGraph Missed Most Exports**: The TypeScript rules only matched arrow-function consts, so `export const LIMIT = 64_000`, `export const X: T = …`, default/abstract classes, generator and generic functions were absent from the graph (37+ symbols in this repo alone). Rules bumped to `1.0.1`; `export namespace` / `export const enum` are covered too.
- **Empty CodeGraph Snippets**: Two symbols declared on one line left the first with `snippet: ""`; a snippet now always includes the declaration line.
- **Stale `/api/graph`**: The graph cache is now invalidated per request, so external edits (`git checkout`, another editor) show up without restarting.

## [0.1.24] - 2026-10-28

### Added

- **Kill Server Button**: A red `⚠ Kill Server` header control opens a confirmation modal (warning icon plus a list of what will be terminated), then stops the backend through the session-token- and Origin-gated `POST /api/shutdown`. The UI shows a final "Server stopped" screen instead of reconnecting forever; `SIGINT`/`SIGTERM` share the same idempotent shutdown path.
- **Update-Available Indicator**: A `⬆ vX.Y.Z` pill appears beside the header version when a newer release exists, backed by `GET /api/update-check` (npm `latest` vs the running `VERSION`, six-hour cache, four-second timeout, never throws). The pill links to the matching GitHub release tag.
- **Cloudflare AI Gateway Support**: `CLOUDFLARE_GATEWAY_ID` routes Workers AI through the documented gateway host and paths.
- **OpenCode `/inference` Base**: The documented modern base (`https://opencode.ai/inference` → `/openai/v1`, `/anthropic`, `/v1/models`) is supported alongside the legacy `zen/v1` base.
- **WebSocket Flow Control**: PTY pause/resume above an 8 MB socket watermark with one-time `[output throttled]` / `[output resumed]` notices, configurable via `MUGIL_IDE_WS_HIGH_WATERMARK` and `MUGIL_IDE_WS_LOW_WATERMARK`.

### Fixed

- **Savings Indicator Always Read 0%**: The status-bar pill divided the tokens removed by the modules by the provider's _whole_ prompt count — system prompt, tool schemas and history, tens of thousands of tokens no module touches — so refinement alone rounded to zero. Savings are now `savedTokens / (savedTokens + compressibleTokens)` (Caveman/RTK refinement, signature stripping, history eviction, tool-output compression, cache hits), so an ordinary Caveman run reports a real percentage.
- **Crash Audit 2026-10-26** (all nine findings from `crash-audit-26-10-26.md`): global `unhandledRejection`/`uncaughtException` handlers keep the server serving; a malformed `Host` header answers 400 instead of killing the process; malformed WebSocket frames terminate only their own socket; session autosave can no longer reject out of a turn; a failed fallback-PTY spawn surfaces `[Shell failed to start: …]`; `/api/graph` is linear-time (20 000 symbols: 5 099 ms → 83 ms) with a per-file size cap and a revision-keyed cache; WebSocket output is flow-controlled; `run_command` timeouts kill the whole process group; and the `SmartCache` prefix trie is bounded.
- **Cloudflare Gateway URL**: Requests went to `api.cloudflare.com/gateway/accounts/…` (404); they now use `gateway.ai.cloudflare.com/v1/{account}/{gateway}/openai/chat/completions`.
- **Cloudflare Model Catalog**: Discovery parsed the account id out of a base URL that never contains `/accounts/`, so the catalog was never listed; the id is now passed from config.
- **`run_command` Backgrounded Processes**: `exec` silently ignores `detached`, so timeouts left `nohup … &` grandchildren alive; it now spawns its own process group and kills the group.

## [0.1.23] - 2026-10-26

### Added

- **Stop Button for Agent Streams**: The web UI now has a dedicated `■ Stop` control beside the prompt box (and `Esc` as a shortcut). It aborts the in-flight turn — the streaming completion, the tool loop, or a running subagent — without closing the session or the terminal.
- **Live Busy State over WebSocket**: `status` frames now carry a `busy` flag, so the Stop button mirrors the server's real state (visible while a turn runs, hidden the moment it settles or the socket drops) instead of being inferred from keystrokes.
- **`cancel_turn` WebSocket Frame**: A first-class, idempotent cancel message. The Ctrl-C terminal path is preserved; both converge on the same `AgentRepl.cancelTurn()` abort.
- **Pending-Prompt Cleanup on Cancel**: Cancelling a turn settles any open permission or `question` prompt immediately (approvals deny, questions dismiss) and emits `dismiss_prompts` so the modals close. Previously the turn could stay blocked on the 120s prompt timeout after the user had already stopped it.
- **Vercel AI Gateway Pricing & Context Metadata**: `fetchProviderModels` now reads the gateway catalog's real `pricing`, `context_window`, and `supported_parameters` instead of flattening every model to `cost 0 / 128k`, so smart-routing cost estimates work for this provider.
- **Version Shown in the Web UI**: The header carries a `v0.1.23` badge linking to the matching GitHub release, and the page title includes the version, so a running build is identifiable at a glance instead of only via `--version`. Both come from `VERSION` in `@mugil-ide/core`, so they cannot drift from the package version.
- **Busy Indicator in the Status Bar**: A pulsing `● Working…` label sits beside the connection dot while a turn streams (with a `prefers-reduced-motion` fallback), so in-flight work stays visible even when the Stop button is off-screen.

### Fixed

- **Vercel AI Gateway Base URL**: The Vercel provider pointed at `https://api.vercel.ai/v1`, which is not a Gateway host (it answers `404 DEPLOYMENT_NOT_FOUND`). It now defaults to `https://ai-gateway.vercel.sh/v1` in the client, the config loader, model discovery, and `.env.example`.
- **Vercel Model IDs**: Gateway model ids are namespaced `creator/model`; the bare ids in the default ladder (`gpt-4o-mini`, `claude-3-5-sonnet-latest`, `deepseek-r1`) do not exist there, so every default handoff would have failed. The ladder now uses `openai/gpt-4o-mini`, `anthropic/claude-haiku-4.5`, `openai/gpt-4o`, `anthropic/claude-sonnet-4.5`, and `deepseek/deepseek-r1`.
- **Vercel Base-URL Allowlist**: `POST /api/keys` rejected the correct Gateway host as an exfiltration attempt (`400 Disallowed Base URL`). `ai-gateway.vercel.sh` and `vercel.sh` are now allowlisted alongside the existing `vercel.com` entries.
- **Vercel "Get Key" Link**: The Accounts & Keys row pointed at `vercel.com/integrations`; it now links to the AI Gateway's own API-keys page (`vercel.com/dashboard/ai-gateway/api-keys`), where gateway keys are minted.
- **`AI_GATEWAY_API_KEY` Alias**: Vercel documents its key under `AI_GATEWAY_API_KEY`; it is now accepted as an alias for `VERCEL_API_KEY` by the config loader, the `/models` discovery probe, and `GET /api/models`, so following Vercel's own snippet no longer silently falls back to mock mode — or hides every Vercel model from the picker.

### Changed

- **CI Can No Longer Hang for Hours**: Added a workflow `concurrency` group with `cancel-in-progress` (a superseded push cancels the stale run), per-step `timeout-minutes` budgets, and a `timeout` wrapper around `npm test` so a leaked handle kills the step instead of idling to the job ceiling. A previous run sat blocked for 1h12m before being cancelled by hand.
- **Release Artifacts Are Verified Before Publishing**: The release workflow now checks that all five binaries exist, are plausibly sized, and carry the expected CPU architecture (`PE32+` / `x86-64` / `aarch64` / `arm64` / `x86_64`), runs the native build's `--version` against the tag, and publishes `SHA256SUMS.txt`. A failed compile now fails the release instead of being silently omitted.
- **Release Notes Come From the CHANGELOG**: `scripts/release-notes.mjs` extracts the tag's `CHANGELOG.md` section for the release body, falling back to a compare link when the section is missing.

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

- **Partial Cache Spliced Unrelated Answers**: A partial (continuation) cache hit fired whenever a stored prompt was _any_ literal prefix of the new one, so two prompts sharing a short common opener — a pasted file header, a shared preamble — produced `cachedAnswer + "\n\n" + newCompletion` as a single confident wrong answer. Partial hits now require the cached prompt to cover at least 60% of the new prompt (`MUGIL_IDE_PARTIAL_MIN_RATIO`) and at least 40 characters, and a stored concatenation can never seed another concatenation.
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

- Added OpenCode Zen (opencode.ai/zen) as a completion provider: `OPENCODE_API_KEY` + optional `OPENCODE_BASE_URL`/`OPENCODE_MODELS`, auto-detected when only its key is set; claude-* models use Zen's Messages endpoint, others chat completions; gpt-_/codex-_ (Responses API) not yet supported.

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
[0.1.23]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.23
[0.1.25]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.25
[0.1.24]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.24
[0.1.26]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.1.26
[0.3.0]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.3.0

[0.3.1]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.3.1
[0.3.2]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.3.2
[0.4.0]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.4.0
[0.4.1]: https://github.com/auarunkumar1/mugil-ide/releases/tag/v0.4.1
