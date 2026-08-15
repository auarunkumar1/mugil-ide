# OpenCode Fork — Migration Plan

> **Decision (2026-08-15):** fork the agent core + TUI from
> [sst/opencode](https://github.com/sst/opencode) (MIT) v1.18.18, and retain
> the Mugil IDE addon modules as grafted extensions. The hand-rolled Ink TUI
> was producing broken/garbled rendering on the user's terminal; rebuilding
> on a battle-tested base is cheaper than continuing to fight it.

## What is vendored where

| Path | Contents |
| --- | --- |
| `vendor/opencode/` | OpenCode **v1.18.18 source snapshot** (the fork base; MIT, `LICENSE` inside). Gitignored — the full snapshot is ~141 MB; re-fetch with the command below, and commit only the specific files you modify when grafting. |
| `node_modules/opencode-ai` | The published `opencode-ai` npm package (prebuilt platform binaries) — what `mugil-ide` launches **today**. |
| `packages/cli/src/opencodeTui.ts` | Bridge: `mugil-ide` (bare invocation) spawns the OpenCode TUI, bridging the user env file (`~/.config/mugil-ide/.env`) into the child env. |
| `packages/cli/src/components/app.tsx` | Legacy Ink TUI — **kept** behind `MUGIL_IDE_LEGACY_TUI=1` until parity is reached, then deleted. |

## Why this works without a build

OpenCode is a ~30-package Effect-based monorepo (bun workspaces, native
`node-pty` postinstall, turbo). Building it from source on this machine is not
practical today. The published `opencode-ai` package ships prebuilt binaries
for win32/darwin/linux × x64/arm64, and its provider SDKs
(`@openrouter/ai-sdk-provider`, OpenAI, Anthropic) read the standard
`OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `*_BASE_URL`
env vars — exactly what our user env file stores. So the env bridge in
`opencodeTui.ts` makes the saved keys work with zero reconfiguration.

**Windows note:** OpenCode's own troubleshooting docs recommend Windows
Terminal / WSL for terminal rendering issues — Ink TUIs (including the legacy
ChatApp here) render poorly on legacy Windows consoles. Run the TUI in
Windows Terminal.

## What OpenCode gives us (for free)

- Battle-tested TUI: virtualized message list, themes, `/undo` `/redo`,
  session picker, plan/act modes, tool permissions, approval modals.
- Agent core: provider router, tool loop, subagents, skills, MCP client,
  bash tool, `apply_patch`, LSP, web tools.
- Config: `~/.config/opencode/opencode.json` (or `opencode auth login`).

## How the addon modules graft on (Mugil IDE → OpenCode)

OpenCode exposes extension points: **providers** (`packages/opencode/src/provider/`),
**transforms** (`provider/transform.ts`), **hooks** (`packages/opencode/src/hook/`),
and **tools** (`packages/opencode/src/tool/`). Graft targets:

| Mugil module | Graft point | Status |
| --- | --- | --- |
| `signature-remover` | Pre-request prompt transform (user prompt → LLM). | ✅ Grafted (see Graft status above) |
| `caveman` + `rtk` | Pre-request prompt refinement / command-output compression (tool result transform). | ✅ Grafted — pre-request chain + `mugilCompressOutput` on tool results |
| `ponytail` | Output-minimization system instruction + completion `max_tokens` cap (LLM call options). | ✅ Grafted — system instruction + `mugilOutputBudget` cap (default 8192, `MUGIL_IDE_OUTPUT_BUDGET`) |
| `watermark-remover` | Post-generation transform (strip AI provenance marks from assistant text). | ✅ Grafted (see Graft status above) |
| `smart-cache` | Response cache keyed by prompt+model in the LLM call path (`session/llm/`). | ✅ Grafted — exact tier (`src/mugil/cache.ts`), tool-call bypass, file backend |
| `codegraph` | Keep as standalone `mugil-ide graph` command + optional custom tool. | ✅ Keep — verified building + running |
| `webhooks` | Port to an OpenCode **hook** (`hook/*`) firing on message/tool events. | ✅ Grafted — `src/mugil/webhooks.ts` mapped from `session.next.*` events |
| `modules/sessions.ts` | Superseded by OpenCode's session store. | Drop |
| MCP server (`@mugil-ide/mcp`) | Standalone product — OpenCode is an MCP *client*, not server. | Keep |
| `modules/undo.ts`, `skills`, `tools/*` | Superseded by OpenCode's built-ins (better tested). | Drop |

## Roadmap

- **M0 — done.** `mugil-ide` launches the OpenCode TUI with bridged keys.
  Legacy TUI behind `MUGIL_IDE_LEGACY_TUI=1`. All 355 tests still pass
  (they exercise the legacy components directly).
- **M1 — graft engine addons.** ✅ Done — see "Graft status (M1)" below.
  Signature/caveman/rtk run as a pre-request chain, ponytail is a system
  instruction, watermark removal is post-generation.
- **M2 — remaining addon grafts.** ✅ Done (2026-08-15): RTK
  `compressCommandOutput` on tool results, ponytail `max_tokens` cap,
  smart-cache exact tier in the LLM call path, and webhooks mapped from the
  `session.next.*` event bus. All typecheck-clean and probed live.
- **M3 — retire legacy.** Delete `packages/cli/src/components/app.tsx` +
  `packages/core/src/modules/tool-loop` + handoff pipeline once parity is
  proven; keep `codegraph`, MCP server, and the crediting/attribution
  discipline (each grafted module keeps its credit header + `ATTRIBUTIONS.md`
  entry).

## Build status (M0 — done, M1 done)

- `bun@1.3.14` installed globally (matches OpenCode's `packageManager` pin).
- `bun install` in `vendor/opencode/` succeeds: **406 packages installed**.
  9 packages fail to download on transient registry errors (`world-atlas`,
  `motion-dom`, `i18n-iso-countries`, …) — all belong to the web/stats apps we
  will never build; the agent core + TUI are unaffected. Re-run `bun install`
  to fetch them if ever needed.
- The agent runs **from source**:
  `bun run --cwd packages/opencode --conditions=browser ./src/index.ts`
  (verified: `--help` shows the full command tree; `run "…"` completed a live
  completion against a provider and returned the answer).
- The binary build is `bun run script/build.ts` (packages/opencode) — only
  needed to ship a standalone binary; grafting work uses the from-source run.

## Graft status (M1)

✅ **Engine addons grafted** into the vendored source (`vendor/opencode/packages/opencode/src/mugil/`):

| Addon | Graft point | Effect |
| --- | --- | --- |
| Signature Remover | `session/prompt.ts` loop — pre-request | Strips Anthropic/OpenAI identity & format preambles from the current user message |
| Caveman | same pre-request chain | Terse phrasing ("in order to" → "to"), filler/polite removal |
| RTK | same pre-request chain | Boilerplate/intro stripping + sentence dedupe (code blocks preserved) |
| Ponytail | `session/prompt.ts` system array | Output-minimization instruction appended to the system prompt |
| Watermark Remover | `session/processor.ts` `text-end` | Strips invisible unicode carriers + vendor attribution lines from final assistant text; AI code-signature headers also stripped |

Implementation notes:
- Self-contained module (`src/mugil/index.ts`) — no cross-package imports; rule JSONs copied to `src/mugil/rules/`.
- Pre-request chain is guarded: the signature rules' greedy preamble patterns can consume a whole period-less line (faithful to upstream), so the composition layer falls back to compression-only rather than ever destroying a user request.
- Kill switch: `MUGIL_IDE_ADDONS=0` disables all transforms (no-op passthrough).
- Verified: `bun run typecheck` clean; live agent loop (`run "reply with exactly: GRAFT_OK"`) returns `GRAFT_OK` through the grafted pipeline.

## Graft audit (Phase 2, 2026-08-15)

All five addons re-verified at the module level (no provider needed):

| Addon | Probe | Result |
| --- | --- | --- |
| Signature | `mugilStripSignatures('As an AI language model, I am writing this prompt. …')` | preamble stripped ✓ |
| Caveman | `mugilCaveman('…in order to… please…')` | → `…to ask you to fix the bug.` ✓ |
| RTK | `mugilRtk('Hello! Hello! I need help. I need help.')` | → `Hello! I need help.` ✓ |
| Watermark + code sigs | `mugilPostprocess('This response was generated by AI.<zwsp>\n// Generated by Copilot\nconst x = 1;')` | → `const x = 1;` ✓ |
| Ponytail | `mugilSystemInstruction()` | returns the minimisation ladder ✓ |
| Kill switch | fresh process with `MUGIL_IDE_ADDONS=0` | pre/post passthrough, system `undefined` ✓ |
| Graft points | `grep mugil src/session/{prompt,processor}.ts` | pre-request L1195, system L1278, post-gen L528 ✓ |

Note: the live `run` loop probe needs a configured provider — with the user's API keys removed (2026-08-15) the loop boots but cannot route, so module-level probes are used until keys are re-added.

## Commands

```bash
npm install                 # includes opencode-ai (prebuilt binary)
npm start                   # mugil-ide → OpenCode TUI (bridged keys)
MUGIL_IDE_LEGACY_TUI=1 npm start   # legacy Ink TUI (temporary)
node packages/cli/dist/index.js run "prompt"   # one-shot stays on our pipeline

# Run the vendored agent from source (dev loop for grafting):
bun run --cwd vendor/opencode/packages/opencode --conditions=browser ./src/index.ts

# Re-fetch the vendored source snapshot (pinned tag):
mkdir -p vendor/opencode
curl -sL https://github.com/sst/opencode/archive/refs/tags/v1.18.18.tar.gz | \
  tar -xzf - -C vendor/opencode --strip-components=1
```

## Credit

OpenCode is MIT — see `vendor/opencode/LICENSE`. Every grafted addon keeps
its upstream credit in `ATTRIBUTIONS.md` per the project's credit discipline.
