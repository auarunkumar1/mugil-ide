# OpenCode Fork — Phase-by-Phase Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the OpenCode fork in three phases: (1) rebrand the TUI + show credits on the startup screen, (2) verify and complete the incorporation of every Mugil IDE addon module into the fork, (3) prove the basic agent functionalities work correctly end-to-end.

**Architecture:** Work happens in the vendored source (`vendor/opencode/`), never the published binary. Branding is a fork of the TUI package's logo/wordmark glyphs plus a new builtin TUI plugin rendering a credits footer on the home route. Module incorporation extends the already-grafted `src/mugil/index.ts` transform module (pre-request chain in `session/prompt.ts`, system instruction, post-generation in `session/processor.ts`) with the remaining grafts (smart-cache in `session/llm/request.ts`, webhooks hook, RTK tool-output compression, ponytail `max_tokens` cap). Functionality is verified with the from-source dev loop (`bun run --conditions=browser ./src/index.ts`) plus a final vendored-binary build so the grafted behavior ships in the `mugil-ide` launch path. The legacy Ink TUI stays untouched behind `MUGIL_IDE_LEGACY_TUI=1` until the final step.

**Tech Stack:** bun 1.3.14 (pinned `packageManager`), TypeScript via tsgo, SolidJS + @opentui (fork TUI), Effect (fork agent core), the `@mugil-ide/core` addon sources as the port reference. No new runtime dependencies.

## Global Constraints

- All fork edits live under `vendor/opencode/packages/{opencode,tui,core}` — commit only modified files (the snapshot itself is gitignored).
- Every fork task ends with a green typecheck: `cd vendor/opencode/packages/opencode && bun run typecheck`.
- Live verification uses the from-source dev loop: `cd vendor/opencode/packages/opencode && bun run --conditions=browser ./src/index.ts run "<prompt>"`.
- The legacy repo must keep passing: `npm run typecheck && npm run lint && npm test` (355 tests) — the fork work must not break the legacy tree.
- Kill switch stays intact: `MUGIL_IDE_ADDONS=0` disables the grafted transforms (no-op passthrough).
- Credit discipline: every grafted module keeps its credit header and `ATTRIBUTIONS.md` entry; the fork itself is credited as OpenCode (MIT) in `ATTRIBUTIONS.md` + the TUI `/credits` list.
- Rebranding is cosmetic (name/logo/wordmark/version string) — do **not** rename packages, bins, env vars, or the `@opencode-ai/*` import specifiers (that would break the build).

---

## Phase 1 — UI Branding + Credits at Startup

### Task 1: TUI home-screen logo → Mugil IDE wordmark

**Files:**
- Modify: `vendor/opencode/packages/tui/src/logo.ts` (glyph data `logo.left` / `logo.right` / `go` — currently spell "opencode")
- Modify: `vendor/opencode/packages/tui/src/component/logo.tsx` (only if the glyph markers change)
- Verify: `vendor/opencode/packages/tui/src/routes/home.tsx` (renders `<Logo />` in the `home_logo` slot on the startup screen)

**Interfaces:**
- Consumes: the existing glyph-grid format — 4-row ASCII with `_` / `^` / `~` / `,` shadow markers (see `logo.ts` + `logo.tsx` renderLine switch).
- Produces: `logo.left` / `logo.right` 4-row grids spelling **MUGIL** (left) and **IDE** (right) in the same 3D-block geometry, 4 rows tall, 7-8 cols per letter (each letter in `logo.ts` is 7 cols wide including its trailing space).

- [ ] **Step 1: Draw the MUGIL / IDE glyph grids**

Replace the `logo.left` / `logo.right` arrays in `vendor/opencode/packages/tui/src/logo.ts`. Model each letter on the existing 7-wide block style, e.g. for M: `█▀▀█`, `█  █`, `█▄▄█` plus the right-edge shadow column. Keep `go` (used by the CLI loading glyph) as-is unless rebranding the CLI spinner. Preserve the `_^~,` marker characters in the same positions the renderer expects (they drive shadow/bevel cells).

- [ ] **Step 2: Typecheck**

Run: `cd vendor/opencode/packages/opencode && bun run typecheck`
Expected: exit 0, no errors in `tui/src/logo.ts`.

- [ ] **Step 3: Visual smoke — launch the TUI from source**

Run: `cd vendor/opencode/packages/opencode && timeout 45 bun run --conditions=browser ./src/index.ts tui` (or `--help` if the TUI can't boot headless — the glyphs are also printed via `UI.logo()` on CLI help output).
Expected: the startup screen shows the new MUGIL IDE wordmark instead of "opencode"; exit cleanly (Ctrl+C / timeout).

- [ ] **Step 4: Commit**

```bash
git add vendor/opencode/packages/tui/src/logo.ts
git commit -m "brand(tui): replace home-screen logo with MUGIL IDE wordmark"
```

### Task 2: CLI wordmark + script name + version string

**Files:**
- Modify: `vendor/opencode/packages/opencode/src/cli/ui.ts` (the `wordmark` array printed by `UI.logo()` before CLI help/version output)
- Modify: `vendor/opencode/packages/opencode/src/index.ts` (`.scriptName("opencode")` → `"mugil-ide"`; the `show()` guard `text.startsWith("opencode ")` → `"mugil-ide "`)
- Modify: `vendor/opencode/packages/opencode/src/session/llm/request.ts` (`USER_AGENT = \`opencode/${InstallationVersion}\`` → `mugil-ide/...`)
- Modify: `vendor/opencode/packages/core/src/installation/version.ts` (the `OPENCODE_VERSION` global name is build-injected — leave the const; see Step 3)

**Interfaces:**
- Consumes: the `wordmark` 4-row array format in `cli/ui.ts` (same glyph grid as Task 1).
- Produces: `wordmark` spells **MUGIL IDE**; `yargs.scriptName` and the `show()` prefix check use `mugil-ide`; the outgoing LLM `User-Agent` header reads `mugil-ide/<version>`.

- [ ] **Step 1: Swap the CLI wordmark**

Replace the `wordmark` array in `vendor/opencode/packages/opencode/src/cli/ui.ts` with the same MUGIL IDE glyphs from Task 1 (leading pad row kept).

- [ ] **Step 2: Rename the script name + help guard**

In `vendor/opencode/packages/opencode/src/index.ts`:
```ts
.scriptName("mugil-ide")
```
and in `show()`:
```ts
if (!text.startsWith("mugil-ide ")) {
```

- [ ] **Step 3: Rebrand the LLM user agent**

In `vendor/opencode/packages/opencode/src/session/llm/request.ts`:
```ts
const USER_AGENT = `mugil-ide/${InstallationVersion}`
```
(Leave `InstallationVersion`/`OPENCODE_VERSION` alone — it is injected at build time by `script/build.ts` and read by version display; renaming it is Phase-1-cosmetic but build-breaking. If desired, add a separate `MUGIL_IDE_BRAND` const later.)

- [ ] **Step 4: Typecheck + CLI smoke**

Run: `cd vendor/opencode/packages/opencode && bun run typecheck && bun run --conditions=browser ./src/index.ts --version`
Expected: exit 0; version output prints the MUGIL IDE wordmark above the version number.

- [ ] **Step 5: Commit**

```bash
git add vendor/opencode/packages/opencode/src/cli/ui.ts vendor/opencode/packages/opencode/src/index.ts vendor/opencode/packages/opencode/src/session/llm/request.ts
git commit -m "brand(cli): MUGIL IDE wordmark, script name, and user agent"
```

### Task 3: Credits at startup + `/credits` command in the fork TUI

**Files:**
- Create: `vendor/opencode/packages/tui/src/feature-plugins/home/credits.tsx` (builtin TUI plugin registering a `home_bottom` slot that renders the credits line(s) under the logo)
- Modify: `vendor/opencode/packages/tui/src/feature-plugins/builtins.ts` (register the new plugin)
- Reference: `packages/cli/src/components/app.tsx:796-845` (the legacy `/credits` text to port) and root `ATTRIBUTIONS.md`

**Interfaces:**
- Consumes: `TuiPlugin` / `TuiPluginApi` shapes from `@opencode-ai/plugin/tui` (same as `home/footer.tsx`); `api.slots.register({ order, slots: { home_bottom() { ... } } })`; theme via `api.theme.current`.
- Produces: a `credits` builtin plugin with `id: "internal:home-credits"`; a `home_bottom` slot rendering one muted line: `✦ Mugil IDE — OpenCode core (MIT) · Caveman · RTK · Ponytail · Watermark Remover · CodeGraph — /credits for full list`.

- [ ] **Step 1: Port the credits data as a shared constant**

Create `vendor/opencode/packages/tui/src/feature-plugins/home/credits.tsx`. Top of file:
```tsx
export const CREDITS = `✦ Mugil IDE — Credited Open Source Modules & Repositories:

• OpenCode Core:     https://github.com/sst/opencode (MIT)
  Forked TUI + agent runtime (v1.18.18) — vendor/opencode/ (docs/opencode-fork.md)
• Caveman:           https://github.com/JuliusBrussee/caveman
• RTK:               https://github.com/rtk-ai/rtk
• Ponytail:          https://github.com/DietrichGebert/ponytail
• CodeGraph:         https://github.com/colbymchenry/codegraph
• Watermark Remover: https://github.com/guillaumemeyer/watermarks-remover
• Signature Remover: https://github.com/conorbronsdon/avoid-ai-writing
• Tool Loop:         https://modelcontextprotocol.io
• Agent Skills:      https://github.com/anthropics/anthropic-tools
• MCP Client:        https://modelcontextprotocol.io
• Web Search (Exa):  https://mcp.exa.ai/mcp
• LSP Client:        https://microsoft.github.io/language-server-protocol`
```
(Match the legacy `/credits` list — keep it in sync with `ATTRIBUTIONS.md`.)

- [ ] **Step 2: Render the startup credits line via a `home_bottom` slot**

In the same file, export a `TuiPlugin`:
```tsx
const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 200, // after tips (100) so credits sit below tips
    slots: {
      home_bottom() {
        const theme = () => api.theme.current
        return (
          <box paddingTop={1} flexShrink={0}>
            <text fg={theme().textMuted}>✦ Mugil IDE — OpenCode core (MIT) · Caveman · RTK · Ponytail · Watermark Remover · CodeGraph — /credits for full list</text>
          </box>
        )
      },
    },
  })
}
export default { id: "internal:home-credits", tui } satisfies BuiltinTuiPlugin
```

- [ ] **Step 3: Register the plugin in builtins**

In `vendor/opencode/packages/tui/src/feature-plugins/builtins.ts`:
```ts
import HomeCredits from "./home/credits"
// inside createBuiltinPlugins() return array:
HomeCredits,
```

- [ ] **Step 4: Typecheck**

Run: `cd vendor/opencode/packages/opencode && bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add vendor/opencode/packages/tui/src/feature-plugins/home/credits.tsx vendor/opencode/packages/tui/src/feature-plugins/builtins.ts
git commit -m "feat(tui): credits footer on startup screen"
```

> **Note:** the full multi-line `/credits` *command* already exists in the legacy TUI and is ported to the fork in Task 4 (Phase 3) when the command palette is verified — the startup screen gets the one-line credit now, per the user's "Credits at startup screen" request.

---

## Phase 2 — Modules Properly Incorporated

### Task 4: Audit graft completeness — verify every addon is wired and toggleable

**Files:**
- Inspect: `vendor/opencode/packages/opencode/src/mugil/index.ts` (the 5-module port), `session/prompt.ts` (pre-request + system), `session/processor.ts` (post-generation)

**Interfaces:**
- Consumes: `mugilPreprocess(text)`, `mugilSystemInstruction()`, `mugilPostprocess(text)` (existing exports).
- Produces: a documented matrix — which addon is wired, where, and how to verify each — in `docs/opencode-fork.md`.

- [ ] **Step 1: Confirm the three graft points are live**

Run: `cd vendor/opencode/packages/opencode && grep -n "mugilPreprocess\|mugilSystemInstruction\|mugilPostprocess" src/session/prompt.ts src/session/processor.ts`
Expected: `mugilPreprocess` in prompt.ts loop, `mugilSystemInstruction` in the system array, `mugilPostprocess` after the `experimental.text.complete` plugin trigger in processor.ts.

- [ ] **Step 2: Live behavior probe through the real loop**

Run: `cd vendor/opencode/packages/opencode && bun run --conditions=browser ./src/index.ts run "reply with exactly: MODULES_OK"`
Expected: prints `MODULES_OK`. Then verify the kill switch:
Run: `MUGIL_IDE_ADDONS=0 bun run --conditions=browser ./src/index.ts run "reply with exactly: KILL_OK"`
Expected: `KILL_OK` (transforms no-op; loop still works).

- [ ] **Step 3: Record the matrix in the fork doc**

Update `docs/opencode-fork.md` "Graft status (M1)" with a checked column per module and the exact verify command for each (signature/caveman/rtk/ponytail/watermark).

- [ ] **Step 4: Commit**

```bash
git add docs/opencode-fork.md
git commit -m "docs(fork): graft audit matrix — all five addons verified wired"
```

### Task 5: RTK command-output compression on tool results

**Files:**
- Modify: `vendor/opencode/packages/opencode/src/mugil/index.ts` (add `mugilCompressOutput`)
- Modify: `vendor/opencode/packages/opencode/src/session/processor.ts` (`tool-result` case — compress `output.output` before `completeToolCall`)
- Test: extend the live probe in Task 4's doc matrix

**Interfaces:**
- Consumes: `SessionV1.ToolPart` tool-result output flow in `processor.ts` (`toolResultOutput` → `completeToolCall`).
- Produces:
  ```ts
  /** RTK-style output compression: collapse repeated lines, truncate long ones (keeps error lines). */
  export function mugilCompressOutput(text: string, maxLineLength?: number): string
  ```

- [ ] **Step 1: Port `compressCommandOutput` into the mugil module**

Add to `vendor/opencode/packages/opencode/src/mugil/index.ts` (port from `packages/core/src/modules/rtk/index.ts`):
```ts
export function mugilCompressOutput(text: string, maxLineLength = 200): string {
  if (!ENABLED) return text
  const lines = text.split("\n")
  const out: string[] = []
  let prev: string | undefined
  let count = 0
  const push = () => {
    if (prev === undefined) return
    out.push(count > 1 ? `${prev}  [${count}×]` : prev)
  }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "")
    if (line.trim().length === 0) { push(); prev = undefined; count = 0; continue }
    const truncated = line.length > maxLineLength ? `${line.slice(0, maxLineLength)}… (+${line.length - maxLineLength} chars)` : line
    if (truncated === prev) { count += 1; continue }
    push(); prev = truncated; count = 1
  }
  push()
  return out.join("\n")
}
```

- [ ] **Step 2: Wire into the `tool-result` handler**

In `vendor/opencode/packages/opencode/src/session/processor.ts`, in the `tool-result` case, before `completeToolCall(value.id, output)`:
```ts
const output = {
  ...rawOutput,
  output: mugilCompressOutput(rawOutput.output),
  attachments: attachments.length ? attachments : undefined,
}
```
(Apply only to tool results whose output is text — the existing `toolResultOutput` already stringifies.)

- [ ] **Step 3: Typecheck + unit probe**

Run: `cd vendor/opencode/packages/opencode && bun run typecheck`
Then:
```bash
cd vendor/opencode/packages/opencode && bun -e "
const { mugilCompressOutput } = await import('./src/mugil/index.ts');
console.log(JSON.stringify(mugilCompressOutput('a\\nb\\nb\\nb\\n' + 'x'.repeat(250))))
"
```
Expected: `"a\nb  [3×]\nxxx… (+N chars)"` (deduped + truncated).

- [ ] **Step 4: Commit**

```bash
git add vendor/opencode/packages/opencode/src/mugil/index.ts vendor/opencode/packages/opencode/src/session/processor.ts
git commit -m "feat(fork): RTK compressCommandOutput on tool results"
```

### Task 6: Ponytail `max_tokens` cap on completions

**Files:**
- Modify: `vendor/opencode/packages/opencode/src/mugil/index.ts` (add `mugilOutputBudget`)
- Modify: `vendor/opencode/packages/opencode/src/session/llm/request.ts` (apply the cap where `max_tokens` is set)

**Interfaces:**
- Consumes: the LLM request preparation in `request.ts` (find where `max_tokens`/`maxTokens` is passed to the provider; `grep -n "max_tokens\|maxTokens" src/session/llm/request.ts`).
- Produces:
  ```ts
  /** Ponytail output budget: hard cap on completion tokens, or undefined when disabled. */
  export function mugilOutputBudget(): number | undefined
  ```
  Default `8192` cap; env override `MUGIL_IDE_OUTPUT_BUDGET`; `undefined` when `MUGIL_IDE_ADDONS=0`.

- [ ] **Step 1: Add the budget helper**

```ts
export function mugilOutputBudget(): number | undefined {
  if (!ENABLED) return undefined
  const raw = process.env.MUGIL_IDE_OUTPUT_BUDGET
  if (raw !== undefined) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return 8192
}
```

- [ ] **Step 2: Apply it in the LLM request path**

In `vendor/opencode/packages/opencode/src/session/llm/request.ts`, where `max_tokens` is set for the provider call, cap it:
```ts
const budget = mugilOutputBudget()
// when building the provider request:
...(budget !== undefined ? { max_tokens: Math.min(budget, existingMax ?? budget) } : {})
```
Locate the exact field by grepping `max_tokens` in the file first — do not guess.

- [ ] **Step 3: Typecheck + probe**

Run: `cd vendor/opencode/packages/opencode && bun run typecheck && bun -e "const { mugilOutputBudget } = await import('./src/mugil/index.ts'); console.log(mugilOutputBudget())"`
Expected: `8192` (and `undefined` with `MUGIL_IDE_ADDONS=0`).

- [ ] **Step 4: Commit**

```bash
git add vendor/opencode/packages/opencode/src/mugil/index.ts vendor/opencode/packages/opencode/src/session/llm/request.ts
git commit -m "feat(fork): ponytail max_tokens cap on completions"
```

### Task 7: Smart-cache graft into the LLM call path

**Files:**
- Create: `vendor/opencode/packages/opencode/src/mugil/cache.ts` (self-contained cache: in-memory + optional file backend, keyed by prompt+model)
- Modify: `vendor/opencode/packages/opencode/src/session/llm/request.ts` (or the native-request path) — lookup before the provider call, store after, **bypass entirely when the request carries tool calls**
- Reference: `packages/core/src/modules/smart-cache/` (exact/partial semantics; keep this graft simple: exact-match only)

**Interfaces:**
- Consumes: `ModelMessage[]` + `system: string[]` (the prepared request) and `Provider.Model` (for the model-scoped key).
- Produces:
  ```ts
  export function mugilCacheLookup(key: string): string | undefined
  export function mugilCacheStore(key: string, response: string): void
  export function mugilCacheKey(system: string[], messages: ModelMessage[], model: string): string
  ```
  Plus an env gate `MUGIL_IDE_CACHE_DIR` (default `~/.cache/mugil-ide/fork-cache.json`).

- [ ] **Step 1: Implement the exact-match cache**

Port a minimal exact-key cache from `modules/smart-cache` (exact tier only — no embeddings/partial): `mugilCacheKey` = sha256 of `system.join("\n") + JSON.stringify(messages) + model`; `mugilCacheLookup` returns the stored text; `mugilCacheStore` writes it; TTL `CACHE_TTL` (default 86400s); file-backed with an in-memory Map on top.

- [ ] **Step 2: Wire lookup/store around the LLM call with a tool-call bypass**

In the request path: compute the key; if the prepared `messages` contain any assistant `tool`-role message **or** the request declares tools, skip lookup and skip store (same rule as the legacy pipeline — never cache tool-bearing asks). Otherwise lookup before the provider call; on cache hit return the stored text without calling the provider; on miss call the provider and store.

- [ ] **Step 3: Typecheck + behavior probe**

Run: `cd vendor/opencode/packages/opencode && bun run typecheck`
Then two identical `run` calls and check the second completes without a provider round-trip (inspect logs / timing), and a tool-bearing `run` is never served from cache.

- [ ] **Step 4: Commit**

```bash
git add vendor/opencode/packages/opencode/src/mugil/cache.ts vendor/opencode/packages/opencode/src/session/llm/request.ts
git commit -m "feat(fork): smart-cache exact tier in LLM call path (tool-call bypass)"
```

### Task 8: Webhooks as an OpenCode hook

**Files:**
- Create: `vendor/opencode/packages/opencode/src/mugil/webhooks.ts` (config parse + fire-and-forget POST)
- Modify: `vendor/opencode/packages/opencode/src/hook/index.ts` (or the closest hook registry — `ls src/hook/`) to fire `turn.started` / `turn.completed` / `turn.error` / `tool.executed`
- Reference: `packages/core/src/modules/webhooks.ts`

**Interfaces:**
- Consumes: the fork's hook registry (`grep -rn "trigger\|hooks" src/hook/*.ts` to find the extension point).
- Produces:
  ```ts
  export function mugilFireWebhooks(event: string, payload: Record<string, unknown>): void
  export function mugilWebhookConfigs(): Array<{ url: string; events?: string[] }>
  ```
  Env: `MUGIL_IDE_WEBHOOKS` (JSON array) / `MUGIL_IDE_WEBHOOKS_CONFIG` (file path). Fire-and-forget with a 5s timeout, never awaited.

- [ ] **Step 1: Port the config parser + fire helper**

Port `parseWebhookConfigs` / `fireWebhooks` from `packages/core/src/modules/webhooks.ts` (same env vars, same `{event, payload, source, ts}` envelope, 5s timeout, per-URL failure capture).

- [ ] **Step 2: Wire into the hook points**

Call `mugilFireWebhooks("turn.started", …)` / `turn.completed` / `turn.error` / `tool.executed` from the fork's message/tool lifecycle (the processor's `tool-result` case for `tool.executed`, and the loop/status transitions for turn events).

- [ ] **Step 3: Typecheck + probe**

Run: `cd vendor/opencode/packages/opencode && bun run typecheck`
Then start a tiny local receiver (`bun -e "Bun.serve({ port: 9999, fetch: r => { console.log('WEBHOOK', r.url); return new Response('ok') } })"`), set `MUGIL_IDE_WEBHOOKS='[{"url":"http://localhost:9999/hook"}]'`, run one `run` command, and confirm the receiver logs events.

- [ ] **Step 4: Commit**

```bash
git add vendor/opencode/packages/opencode/src/mugil/webhooks.ts vendor/opencode/packages/opencode/src/hook/index.ts
git commit -m "feat(fork): webhook notifications on turn/tool events"
```

### Task 9: Verify codegraph + MCP server standalone surfaces

**Files:**
- Inspect: `packages/cli/src/index.ts` (`graph` command), `packages/mcp/` (server), `docs/opencode-fork.md` (keep list)

- [ ] **Step 1: Confirm `mugil-ide graph` still works**

Run: `npm run build && node packages/cli/dist/index.js graph --help`
Expected: graph command present (codegraph stays standalone — M3 keep).

- [ ] **Step 2: Confirm the MCP server package still builds**

Run: `cd packages/mcp && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit (docs only if changed)**

```bash
git add docs/opencode-fork.md
git commit -m "docs(fork): codegraph + MCP server remain standalone surfaces" || true
```

---

## Phase 3 — Basic Functionalities Working Correctly

### Task 10: Tool calling + file creation end-to-end in the fork

**Files:**
- Verify: `vendor/opencode/packages/opencode/src/tool/` (built-in tools), `src/session/processor.ts` (tool loop), `src/mugil/index.ts` (pre/post transforms don't corrupt tool args)
- Test: the from-source dev loop

- [ ] **Step 1: Create a file through the fork agent**

Run in a scratch dir:
```bash
cd $(mktemp -d) && cd vendor/opencode/packages/opencode && timeout 120 bun run --conditions=browser ./src/index.ts run "create index.html containing <h1>hi</h1>"
```
Expected: the file exists with the content; the assistant reports success; no raw "token stream" dump (tool result compression from Task 5 is active).

- [ ] **Step 2: Verify a permission-denied path surfaces visibly**

Run with a plan-mode / deny policy if the fork supports it (`opencode.json` permission rules — see `src/permission/`), or confirm the built-in `ask` modal path in an interactive session.
Expected: the denial is surfaced as a tool error, not silently dropped, and the agent recovers.

- [ ] **Step 3: Confirm the pre-request transform didn't mangle the request**

Run the Task 4 probe again and confirm `MODULES_OK`-style exact replies survive the signature/caveman/rtk chain (the safety net from the M1 graft).

- [ ] **Step 4: Commit (test artifacts only if any)**

```bash
git add docs/opencode-fork.md
git commit -m "docs(fork): verified file creation + permission denial end-to-end" || true
```

### Task 11: Sessions, undo/redo, skills, MCP client — spot verification

**Files:**
- Verify: fork built-ins (`src/session/session.ts`, `src/snapshot/`, `src/skill/`, `src/mcp/`) — these are OpenCode's battle-tested implementations; verify they function, don't re-implement.

- [ ] **Step 1: Session resume**

Run a `run` with a session id, then `session` list + resume (see `src/cli/cmd/session.ts`).
Expected: the conversation resumes.

- [ ] **Step 2: Undo/redo via a TUI session**

In an interactive TUI session, have the agent edit a file, then exercise undo (OpenCode's snapshot-based undo) — expected: file reverts.

- [ ] **Step 3: Skills + MCP client present**

Run: `cd vendor/opencode/packages/opencode && bun run --conditions=browser ./src/index.ts --help | grep -i "mcp\|skill"`
Expected: MCP + skill surfaces listed; spot-check `mcp` command shows configured servers (none configured → graceful empty state).

- [ ] **Step 4: Commit**

```bash
git add docs/opencode-fork.md
git commit -m "docs(fork): sessions/undo/skills/mcp spot-verified" || true
```

### Task 12: Build the vendored binary (grafted addons reach the real TUI)

**Files:**
- Run: `vendor/opencode/packages/opencode/script/build.ts` (`bun run script/build.ts`)
- Modify: `packages/cli/src/opencodeTui.ts` (point the bridge at the built binary instead of the npm `opencode-ai` dep, or keep both behind an env flag)
- Modify: `docs/opencode-fork.md` (M3 status)

**Interfaces:**
- Consumes: the existing `script/build.ts` (produces the platform binary), `opencodeTui.ts` (currently spawns `opencode-ai` from node_modules).
- Produces: a locally-built `mugil-ide`-branded binary containing the grafted transforms; `opencodeTui.ts` prefers it when present (e.g. `MUGIL_IDE_FORK_BINARY` env or a `vendor/opencode/dist/` lookup), falling back to the npm binary.

- [ ] **Step 1: Run the build**

Run: `cd vendor/opencode/packages/opencode && bun run script/build.ts`
Expected: produces a binary in the expected output path (check the script for the out dir first). If the build fails on missing web-app deps (the 9 packages that failed earlier), note and work around — those belong to the stats/web apps we never build.

- [ ] **Step 2: Smoke the built binary**

Run the built binary `run "reply with exactly: BINARY_OK"` (with `MUGIL_IDE_ADDONS` on).
Expected: `BINARY_OK`; the binary boots with the MUGIL wordmark.

- [ ] **Step 3: Point the TUI bridge at it**

In `packages/cli/src/opencodeTui.ts`: prefer the locally-built binary (env `MUGIL_IDE_FORK_BINARY` or a documented path), fall back to the npm `opencode-ai`.

- [ ] **Step 4: Verify the launched TUI shows the brand + credits**

Run: `npm run build && npm start` (in Windows Terminal).
Expected: MUGIL IDE wordmark, credits line under the logo, `/credits`-equivalent available, keys bridged.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/opencodeTui.ts docs/opencode-fork.md
git commit -m "feat(fork): launch the grafted binary with branding + credits"
```

### Task 13: Retire the legacy stack (parity gate)

**Files:**
- Delete: `packages/cli/src/components/app.tsx` (legacy Ink TUI) + `MUGIL_IDE_LEGACY_TUI` env handling
- Delete (superseded): `packages/core/src/modules/tool-loop`, handoff pipeline, `modules/sessions.ts`, `modules/undo.ts`, `modules/skills`, `modules/tools/*` — per the drop list in `docs/opencode-fork.md`
- Keep: `codegraph` (`mugil-ide graph`), the MCP server package, `ATTRIBUTIONS.md` + credit discipline
- Modify: `README.md` (commands, env table, test count, roadmap), `project-context.md` (Status/todos)

- [ ] **Step 1: Confirm parity before deleting**

Both fork Tasks 10–11 passed (file creation, permission denial, sessions, undo, skills, MCP). Legacy suite still green: `npm run typecheck && npm run lint && npm test` (355).

- [ ] **Step 2: Delete the legacy TUI + superseded modules**

Remove the listed files; remove `MUGIL_IDE_LEGACY_TUI` branches from `packages/cli/src/index.ts`; drop the `opencode-ai`-independent fallback path if it referenced the legacy TUI.

- [ ] **Step 3: Update docs**

`README.md`: `npm start` = fork TUI; env table drops `MUGIL_IDE_LEGACY_TUI`, adds `MUGIL_IDE_ADDONS` / `MUGIL_IDE_OUTPUT_BUDGET` / `MUGIL_IDE_WEBHOOKS`; roadmap marks M1–M3 done. `project-context.md`: same + final test count.

- [ ] **Step 4: Full verification**

Run: `npm run typecheck && npm run lint && npm test` then `cd vendor/opencode/packages/opencode && bun run typecheck`
Expected: both trees green.

- [ ] **Step 5: Commit**

```bash
git add -A packages/cli packages/core README.md project-context.md
git commit -m "chore: retire legacy Ink TUI + superseded modules (fork is default)"
```

---

## Self-Review

**1. Spec coverage:**
- *UI branding* → Tasks 1–2 (logo, wordmark, script name, user agent).
- *Credits at startup screen* → Task 3 (home_bottom credits line; full list constant ported).
- *All modules properly incorporated* → Task 4 (audit), Task 5 (RTK tool-output), Task 6 (ponytail cap), Task 7 (smart-cache), Task 8 (webhooks), Task 9 (codegraph/MCP keep).
- *Basic functionalities correctly working* → Tasks 10–11 (file creation, permissions, sessions, undo, skills, MCP), Task 12 (binary build so it ships), Task 13 (retire legacy after parity).

**2. Placeholder scan:** No TBD/TODO steps; every code step carries the actual snippet or an exact grep to locate the insertion point. Two spots deliberately defer exact line numbers to the implementer with explicit `grep` first steps (Task 6 `max_tokens`, Task 8 hook registry) because they depend on the vendored source's shape — acceptable, the instruction is concrete.

**3. Type consistency:** `mugilCompressOutput`, `mugilOutputBudget`, `mugilCacheLookup/Store/Key`, `mugilFireWebhooks`, `mugilWebhookConfigs` are each defined once (the task that produces them) and consumed in the same task's wiring step — no cross-task signature drift. `BuiltinTuiPlugin` import shape matches `home/footer.tsx` (Task 3 references it).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-15-fork-phases.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
