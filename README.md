<div align="center">

# Mugil IDE — Token-Efficient AI Coding Agent & Local-First Browser IDE

### An open-source AI coding agent for your browser, with local LLM support and up to 40–70% lower token costs on compressible work.

[![GitHub Release](https://img.shields.io/github/v/release/auarunkumar1/mugil-ide?label=release&color=1f6feb&style=flat-square)](https://github.com/auarunkumar1/mugil-ide/releases)
[![CI](https://github.com/auarunkumar1/mugil-ide/actions/workflows/ci.yml/badge.svg)](https://github.com/auarunkumar1/mugil-ide/actions/workflows/ci.yml)
[![Tests: 784 Passing](https://img.shields.io/badge/tests-784%20passing-3fb950.svg?style=flat-square)](https://github.com/auarunkumar1/mugil-ide)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Platforms: Windows · macOS · Linux](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-brightgreen.svg?style=flat-square)](https://github.com/auarunkumar1/mugil-ide/releases)
[![Node: 20 | 22](https://img.shields.io/badge/node-20%20%7C%2022-339933.svg?style=flat-square)](https://nodejs.org/)
[![Local AI](https://img.shields.io/badge/local%20AI-llama.cpp%20%7C%20Ollama%20%7C%20LM%20Studio-8957e5.svg?style=flat-square)](#local-ai-and-hybrid-routing)
[![MCP](https://img.shields.io/badge/MCP-client%20%26%20server-blueviolet.svg?style=flat-square)](#model-context-protocol-mcp)
[![Telemetry: none](https://img.shields.io/badge/telemetry-none-2ea043.svg?style=flat-square)](#security-and-privacy)

</div>

**Mugil IDE** is an open-source AI coding agent and browser-based developer environment. It reads, edits, tests, and debugs real repositories through a tool-driven agent loop — while a token-efficiency pipeline trims prompts, compresses noisy tool output, caches repeated work, and keeps an honest per-turn ledger of what you spend.

It is designed for developers who want **cloud-model capability without cloud-only assumptions**. Run it fully offline with the built-in `llama.cpp` runtime, connect Ollama or LM Studio, or hand complex work to OpenCode Go, OpenRouter, OpenAI, Anthropic, or another supported provider. The same browser UI, tools, permissions, diffs, and secret protection apply in every mode.

---

## Table of Contents

- [What is Mugil IDE?](#what-is-mugil-ide)
- [At a glance](#at-a-glance)
- [Why Mugil IDE?](#why-mugil-ide)
- [Quick start](#quick-start)
- [Feature highlights](#feature-highlights)
- [Local AI and hybrid routing](#local-ai-and-hybrid-routing)
- [Supported providers and protocols](#supported-providers-and-protocols)
- [Security and privacy](#security-and-privacy)
- [How token savings work](#how-token-savings-work)
- [Compatibility](#compatibility)
- [Configuration](#configuration)
- [CLI and MCP](#cli-and-mcp)
- [What is new in v0.6.0](#what-is-new-in-v060)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License and attributions](#license-and-attributions)

---

## What is Mugil IDE?

Mugil IDE is not just a chat box or an autocomplete layer. It is a full **agent harness** around a language model:

- **A real coding loop.** The agent can inspect files, search a codebase, read symbols and AST skeletons, apply patches, run commands, collect diagnostics, and verify its own work.
- **A browser IDE.** Open a terminal-style agent pane, file explorer, split diff viewer, and CodeGraph inspector in a normal browser tab. No Electron or Tauri shell required.
- **A token-efficient context engine.** Prompts and tool output are cleaned before they reach the model, and repeated work is served from a multi-tier cache where safe.
- **A local-first runtime.** Built-in `llama.cpp`, plus automatic detection of Ollama and LM Studio, so you can keep working without a cloud key.
- **A privacy boundary.** Credentials are vaulted locally, outbound payloads are sanitized, and secret-bearing turns can be forced to stay local.
- **An open protocol citizen.** Use it as an MCP client, run it as an MCP server, and route models through native Chat Completions, Anthropic Messages, or OpenAI Responses protocols.

In short: **a practical AI coding agent for people who care about cost, privacy, and owning their toolchain.**

---

## At a glance

| | |
| --- | --- |
| **License** | MIT |
| **Interface** | Browser-based IDE + CLI + standalone binaries |
| **Platforms** | Windows x64, Linux x64/arm64, macOS arm64/x64 |
| **Local models** | Built-in `llama.cpp`; Ollama; LM Studio |
| **Cloud providers** | OpenCode Go/Zen, OpenRouter, OpenAI, Anthropic, Vercel AI Gateway, Cloudflare Workers AI, Together AI |
| **Wire protocols** | OpenAI Chat Completions, Anthropic Messages, OpenAI Responses |
| **Extensibility** | MCP client and server; skills; custom tools |
| **Security** | Local secret vault, fail-closed egress guard, no telemetry |
| **Best for** | Cost-sensitive developers, local/offline workflows, browser-first and mobile-adjacent development |

---

## Why Mugil IDE?

### Spend less on the same work

AI coding agents often waste context on filler, repeated logs, entire files, and stale conversation. Mugil IDE compresses the parts that can be compressed, caches the parts that repeat, and keeps your generation budget separate from your history budget.

### Work offline when you need to

The built-in `llama.cpp` runtime can download and run GGUF models directly. Ollama and LM Studio are detected automatically. You can also mix local and cloud models: draft locally, audit in the cloud, or keep the entire turn local.

### Keep secrets out of the cloud

Pasted keys, `.env` values, bearer tokens, private keys, and secrets in tool output are replaced with local vault tokens before they reach a model. In the default `local-only` mode, a secret-bearing turn is refused if the active provider is remote.

### Use the tools you already trust

Mugil IDE supports OpenCode Go and Zen, OpenRouter, OpenAI, Anthropic, Vercel AI Gateway, Cloudflare, Together AI, and local OpenAI-compatible endpoints. It does not lock you into one model vendor.

### Stay in the browser

The UI is served by a local Node server with vendored assets. It works on desktop, tablet, and phone browsers, and can stream a session to another device on your network with a QR code.

---

## Quick start

### Option 1 — Standalone binary (recommended)

Download the latest executable for your OS from **[GitHub Releases](https://github.com/auarunkumar1/mugil-ide/releases)**.

```bash
# Linux (x64)
chmod +x mugil-ide-linux-x64
./mugil-ide-linux-x64

# macOS (Apple Silicon)
chmod +x mugil-ide-darwin-arm64
./mugil-ide-darwin-arm64

# Windows (PowerShell)
.\mugil-ide-windows-x64.exe
```

Available artifacts include Windows x64, Linux x64, Linux arm64, macOS arm64, macOS x64, a Debian package, and `SHA256SUMS.txt`.

### Option 2 — Run from source

Requirements: **Node.js 20 or 22**.

```bash
git clone https://github.com/auarunkumar1/mugil-ide.git
cd mugil-ide
npm install
npm run build
npm start
```

The server opens the browser IDE automatically. If it does not, use the URL printed in the terminal.

### Option 3 — 100% offline with the built-in `llama.cpp` runtime

No cloud key, no Ollama, no LM Studio, and no Python required:

```bash
mugil-ide llamacpp download qwen2.5-coder-1.5b
mugil-ide
```

Then choose the local model in the model picker or the **Manage GGUF Models** dialog.

### Option 4 — Use Ollama or LM Studio

Start your local daemon, then launch Mugil IDE:

```bash
# Ollama
ollama serve

# In another terminal
mugil-ide
```

Mugil IDE probes `http://localhost:11434/v1` for Ollama and `http://localhost:1234/v1` for LM Studio.

---

## Feature highlights

### Token-efficient context engine

A multi-stage pipeline runs before prompts reach a model:

- **Caveman-style prompt compression** removes conversational filler while preserving intent.
- **RTK output filtering** deduplicates repeated errors, strips ANSI noise, and collapses build/test logs.
- **Ponytail-style output discipline** encourages small, surgical diffs instead of boilerplate.
- **Signature and watermark removal** cleans model output before it is stored or written.
- **Smart caching** reuses exact, prefix, and semantically similar requests where safe.
- **AST skeletons and tool pruning** keep large codebases and local models within their context windows.
- **Provider prompt caching** uses stable JSON and Anthropic cache breakpoints where available.
- **Per-turn token ledger** reports prompt, completion, reasoning, cached, and cache-write tokens alongside cost or allowance source.

The savings target is **up to 40–70% of compressible input**, not a fixed guarantee. The UI reports measured savings rather than an optimistic marketing number.

### Autonomous coding tools

Mugil IDE ships with a focused set of workspace tools:

| Category | Tools |
| --- | --- |
| Inspection and AST | `read_file`, `read_symbol`, `read_skeleton`, `search_code`, `list_files`, `codegraph`, `read_blob` |
| Editing | `edit_file`, `apply_patch`, `write_file` |
| Execution | `run_command` with process-group timeouts and output filtering |
| Swarms | `task` for scoped subagents |
| External and media | `generate_image`, `webfetch`, `websearch`, MCP tools |

Every tool call respects the active permission policy: **Act** asks before dangerous actions, **Plan** is read-only, and **Turbo** runs autonomously.

### Browser IDE with real diffs and undo

- xterm.js agent terminal with streaming Markdown, tables, code highlighting, and reasoning output
- live split-pane diff viewer
- hunk-by-hunk review and reversion
- byte-exact undo for text and binary assets
- interactive step debugger for tool calls
- session history, named sessions, and resume
- remote device streaming over LAN with a QR code

### Model Context Protocol (MCP)

Mugil IDE can consume external MCP servers as tools and can run as an MCP server for other clients:

```bash
# Run Mugil IDE as an MCP server
mugil-ide-mcp
```

MCP schemas are loaded lazily to avoid paying thousands of tokens of schema overhead on every turn.

---

## Local AI and hybrid routing

Mugil IDE treats local models as first-class providers, not a fallback.

### Built-in `llama.cpp`

- pinned upstream runtime with checksum verification
- automatic OS/architecture selection
- CPU and GPU execution
- curated GGUF catalog plus custom model import
- lifecycle commands: `status`, `download`, `start`, `stop`, `import`
- browser-based model manager with download progress and disk usage

### External local daemons

- **Ollama** at `http://localhost:11434/v1`
- **LM Studio** at `http://localhost:1234/v1`
- any OpenAI-compatible local endpoint via `LOCAL_BASE_URL`

### Hybrid local coder + cloud auditor

Use a small local model for fast exploration, AST summaries, and draft edits; hand architectural reviews, large refactors, or ambiguous failures to a stronger cloud model. Tool pruning and context budgeting adapt automatically for small local context windows.

---

## Supported providers and protocols

| Provider | Notes |
| --- | --- |
| **OpenCode Go** | `/inference/go`; plan-aware routing, usage and allowance tracking, native Responses/Messages/Chat support |
| **OpenCode Zen** | pay-as-you-go endpoint with automatic Go fallback handling |
| **OpenRouter** | reasoning effort, provider routing requirements, typed errors, `Retry-After` handling, GitHub attribution |
| **OpenAI** | Chat Completions and Responses-style models |
| **Anthropic** | native Messages client with thinking budgets |
| **Vercel AI Gateway** | namespaced model IDs and real provider pricing |
| **Cloudflare Workers AI** | direct API and AI Gateway paths |
| **Together AI** | OpenAI-compatible models and reasoning |
| **llama.cpp** | built-in local runtime |
| **Ollama / LM Studio** | auto-detected local daemons |
| **Custom local** | any OpenAI-compatible `LOCAL_BASE_URL` |

Protocol selection follows the live model catalog where available: Chat Completions, Anthropic Messages, or OpenAI Responses. That means GPT/Grok-style models are not forced through a chat-completions translation when their native protocol is available.

---

## Security and privacy

Mugil IDE is built for local-first use:

- **No telemetry.** The IDE does not phone home.
- **In-memory secret vault.** Detected credentials are replaced with `[MUGIL_SECRET_TYPE_N]` tokens. Real values stay in process memory and are never written to session files, cache, logs, or webhooks.
- **Known-key registry.** Configured provider keys are registered as exact known secrets at startup and on reconfiguration.
- **Local-only default.** With `MUGIL_IDE_SECRET_POLICY=local-only`, a secret-bearing turn requires a local provider client. If the active client is remote, the turn fails closed instead of sending anything.
- **Explicit redact mode.** Set `MUGIL_IDE_SECRET_POLICY=redact` if you want to send vault placeholders to a cloud model.
- **Outbound guard.** Media prompts, web search, `webfetch`, remote MCP calls, webhooks, provider headers, and provider request bodies are sanitized before egress.
- **Provider keys are credentials, not context.** A provider key is sent only in its own authorization header; it is never placed in model-visible content.

Read the full threat model in [SECURITY.md](SECURITY.md) and [docs/security/architecture.md](docs/security/architecture.md).

---

## How token savings work

Mugil IDE reduces cost in four places:

1. **Before the model:** prompt refinement, deduplication, history compaction, and AST/tool-schema pruning.
2. **Around the model:** exact, prefix, and semantic caching where a request is safe to reuse.
3. **After the model:** removal of signatures, disclaimers, and duplicate formatting before storage.
4. **Across providers:** prompt caching, cache-aware token accounting, and fail-fast handling of quota or entitlement errors so fallback chains do not burn tokens.

The result is not “free tokens.” It is **less waste per turn**, with a visible ledger so you can see what was sent, what was cached, and what it cost.

---

## Compatibility

### Operating systems and binaries

| Platform | Artifact |
| --- | --- |
| Windows x64 | `mugil-ide-windows-x64.exe` |
| Linux x64 | `mugil-ide-linux-x64.tar.gz` |
| Linux arm64 | `mugil-ide-linux-arm64.tar.gz` |
| Debian/Ubuntu x64 | `mugil-ide-linux-amd64.deb` |
| macOS Apple Silicon | `mugil-ide-darwin-arm64.tar.gz` |
| macOS Intel | `mugil-ide-darwin-x64.tar.gz` |

### Development and CI

- Node.js **20** and **22** in CI
- TypeScript 5.x
- Linux CI runners
- Windows/macOS/Linux binary compilation through GitHub Actions

### Browser

A modern desktop or mobile browser with WebSocket support. The UI is served locally and assets are vendored, so it works without a CDN.

---

## Configuration

Settings can be changed in the Web UI or in `~/.config/mugil-ide/.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | auto-detected | `opencode`, `openrouter`, `openai`, `anthropic`, `vercel`, `cloudflare`, `together`, `ollama`, `lmstudio`, `llamacpp`, or `local` |
| `OPENCODE_API_KEY` | — | OpenCode Go or Zen API key |
| `OPENCODE_BASE_URL` | auto | Optional explicit OpenCode base URL |
| `OPENROUTER_API_KEY` | — | OpenRouter API key |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `VERCEL_API_KEY` | — | Vercel AI Gateway key (`AI_GATEWAY_API_KEY` also accepted) |
| `CLOUDFLARE_API_KEY` | — | Cloudflare Workers AI key |
| `TOGETHER_API_KEY` | — | Together AI key |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama endpoint |
| `LMSTUDIO_BASE_URL` | `http://localhost:1234/v1` | LM Studio endpoint |
| `LLAMACPP_BASE_URL` | `http://127.0.0.1:8080/v1` | Built-in llama.cpp endpoint |
| `LOCAL_BASE_URL` | `http://localhost:8000/v1` | Generic local OpenAI-compatible endpoint |
| `MUGIL_IDE_MODEL` | provider default | Preferred model ID |
| `MUGIL_IDE_TOKEN_LIMIT` | `64000` | Context budget for multi-turn history |
| `MUGIL_IDE_MAX_OUTPUT_TOKENS` | `32768` | Maximum generation ceiling |
| `MUGIL_IDE_HISTORY_BUDGET` | `64000` | History token budget |
| `MUGIL_IDE_MAX_TURNS` | `100` | Turns kept before compaction |
| `MUGIL_IDE_MODE` | `act` | Default workflow: `act` (confirm changes) or `plan` (read-only) |
| `MUGIL_IDE_PROVIDER_V2` | `1` | Enable Provider Core v2 clients and native protocol adapters |
| `MUGIL_IDE_SECRET_POLICY` | `local-only` | `local-only` or `redact` |
| `MUGIL_IDE_LOCAL_ENDPOINTS` | `loopback` | `loopback` or `private-lan` |
| `MUGIL_IDE_SKILLS_DIR` | `~/.config/mugil-ide/skills` | Global skills directory |
| `MUGIL_IDE_IMAGE_MODEL` | `bfl/flux-2-klein-4b` | Default image model for Vercel AI Gateway |

See the Web UI setup dialog and [CONTRIBUTING.md](CONTRIBUTING.md) for the complete development configuration.

---

## CLI and MCP

```bash
# Start the browser IDE
mugil-ide

# One-shot headless prompt
mugil-ide run "Write a binary search in TypeScript"

# Specific model and thinking level
mugil-ide run -m deepseek-v4.1-flash -t high "Refactor auth middleware"

# JSON output with token accounting
mugil-ide run --json "Explain this stack trace"

# Generate project documentation
mugil-ide docs . -o DOCUMENTATION.md

# Local llama.cpp lifecycle
mugil-ide llamacpp status
mugil-ide llamacpp download qwen2.5-coder-1.5b
mugil-ide llamacpp start
mugil-ide llamacpp stop

# Run the MCP server
mugil-ide-mcp
```

---

## What is new in v0.6.0

v0.6.0 is the **Provider Core v2** release:

- **OpenCode correctness:** real plan/usage detection, Go/Zen fallback, quota fast-fail, free-model preservation, and native user-agent identification.
- **Native protocols:** catalog-driven Chat Completions, Anthropic Messages, and OpenAI Responses routing; reasoning continuity across tool loops.
- **OpenRouter hardening:** reasoning parameters, typed errors, mid-stream error handling, `Retry-After` support, and correct attribution.
- **Fail-closed secrets:** local-only default, exact known-key registry, request-body sanitization, outbound guards, and non-blocking discovery alerts.
- **Token ledger:** reasoning, cached, cache-write, cost, allowance, and billing-source reporting.
- **Terminal rendering:** width-aware streaming Markdown with tables, syntax highlighting, links, task lists, CJK/emoji widths, and live resize.
- **Local AI parity:** llama.cpp, Ollama, and LM Studio remain first-class alongside cloud providers.

See [CHANGELOG.md](CHANGELOG.md) for the complete release history and [docs/PRE_RELEASE_CI_GUIDE.md](docs/PRE_RELEASE_CI_GUIDE.md) for the release checklist.

---

## FAQ

### What is Mugil IDE?

Mugil IDE is an open-source AI coding agent and browser IDE. It combines a tool-driven coding loop, token-efficient context handling, local LLM support, and a privacy-focused secret boundary.

### Is Mugil IDE free and open source?

Yes. The project is MIT-licensed. You can use it with your own provider keys, local models, or a mix of both.

### Does it work fully offline?

Yes, with the built-in `llama.cpp` runtime or a local Ollama/LM Studio server. No cloud key is required for local-only operation.

### Which local models are supported?

Any GGUF model supported by the bundled `llama.cpp` runtime, plus models served by Ollama, LM Studio, or another OpenAI-compatible local endpoint.

### Does it work with OpenCode Go or OpenRouter?

Yes. OpenCode Go and Zen use plan-aware routing and usage tracking; OpenRouter supports reasoning effort, provider routing requirements, and typed error handling.

### How does token saving work?

Mugil IDE reduces prompt filler, compresses noisy tool output, prunes unnecessary tool schemas, uses AST skeletons, and caches safe repeated work. The UI reports measured savings rather than a fixed promise.

### Are my secrets sent to the cloud?

Not in cleartext. Detected secrets are vaulted as local placeholders. With the default `MUGIL_IDE_SECRET_POLICY=local-only`, a secret-bearing turn is refused if the active provider is remote. `redact` mode explicitly allows placeholders to reach a cloud model.

### Is Mugil IDE a VS Code extension?

No. It is a browser-first IDE served by a local Node process, with standalone binaries for Windows, macOS, and Linux. It is not an Electron/Tauri desktop wrapper or a VS Code extension.

### How is it different from a typical AI coding assistant?

It focuses on **token economics, local-first operation, explicit tool permissions, and local-only secret handling**, rather than only chat completion. The agent can run tools, show diffs, and undo changes, while the provider layer is open to multiple clouds and local runtimes.

### Does it collect telemetry?

No. The IDE does not send usage telemetry.

---

## Contributing

Contributions are welcome. Before opening a pull request:

```bash
npm install
npm run typecheck
npm run lint
npm test
node scripts/guard-secrets.mjs
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) for architecture, test conventions, and opt-in live provider smoke tests. Report security issues according to [SECURITY.md](SECURITY.md).

---

## License and attributions

Mugil IDE is released under the [MIT License](LICENSE).

It builds on the ideas and work of the open-source community, including Caveman, RTK, Ponytail, Avoid AI Writing, Watermarks Remover, CodeGraph, and OpenCode. See [ATTRIBUTIONS.md](ATTRIBUTIONS.md) for complete credits and licenses.

<div align="center">

**Built for developers who want capable AI coding without giving up cost control, local models, or privacy.**

[GitHub](https://github.com/auarunkumar1/mugil-ide) · [Releases](https://github.com/auarunkumar1/mugil-ide/releases) · [Issues](https://github.com/auarunkumar1/mugil-ide/issues) · [Security](SECURITY.md)

</div>
