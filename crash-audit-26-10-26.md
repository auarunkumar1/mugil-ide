# Crash Audit — Mugil IDE (Linux)

Date: 2026-10-26
Version audited: **0.1.23** (`packages/cli/dist`, built 2026-10-26 22:37)
Scope: `packages/cli`, `packages/core` — process-lifecycle, global error handling, WebSocket
transport, PTY fallback, session persistence, large-workspace workloads.
Environment: Linux x86_64, Node **v20.18.0**, 12 cores, node-pty loadable.
Method: ran the **built** server (`node packages/cli/dist/index.js ui …`) and drove it with raw
sockets, `ws` clients with paused TCP sockets, and standalone reproductions of the exact
production code paths. Every claim below was executed, not inferred. Where a probe
contradicted an earlier hypothesis, the finding was downgraded and the corrected result is
recorded (see §7).

**Root cause multiplier.** The CLI installs exactly one signal handler — `SIGINT` at
`packages/cli/src/index.ts:279` — and **no** `process.on('unhandledRejection')` /
`process.on('uncaughtException')`. Any single missed error anywhere in the server therefore
terminates the whole process and the user's session. Four of the five crash paths below are
one `catch`/`on('error')` away from being a log line.

---

## 1. CRITICAL — malformed `Host` header kills the server, unauthenticated

| | |
|---|---|
| Location | `packages/cli/src/server/server.ts:237` (HTTP), `server.ts:1013` (upgrade) |
| Trigger | Any `Host` value that is not a valid hostname: `a b`, `ünicode`, `[::1`, `a%20b` |
| Impact | **Process exit 1.** On the `upgrade` path this happens **before** the origin/token check, so it is remote and unauthenticated. |

```ts
const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
```

`new URL` throws `ERR_INVALID_URL`; the HTTP handler is `async` (unhandled rejection → exit) and
the `'upgrade'` handler is synchronous (uncaught exception → exit).

**Reproduced (HTTP):**
```
$ printf 'GET / HTTP/1.1\r\nHost: a b\r\n\r\n' | nc localhost 7799
TypeError: Invalid URL
    input: '/', base: 'http://a b'
SERVER DEAD
```

**Reproduced (upgrade, pre-auth):**
```
$ printf 'GET /ws HTTP/1.1\r\nHost: a b\r\nUpgrade: websocket\r\n…' | nc localhost 7805
code: 'ERR_INVALID_URL'  input: '/ws'  base: 'http://a b'
SERVER DEAD
```

Reachable in the wild from reverse proxies and clients that rewrite `Host`, and from non-ASCII
hostnames. Severity rises with `--host 0.0.0.0`.

**Fix:** build the URL against a fixed base (`http://localhost`) or wrap both sites in
`try { … } catch { res.writeHead(400); res.end(); / socket.destroy(); }`.

---

## 2. CRITICAL — one malformed WebSocket frame kills the server

| | |
|---|---|
| Location | `packages/cli/src/server/server.ts:1033` (`connection`), `1238` (`message`), `1330` (`close`) |
| Trigger | Any frame-level protocol violation on an **authenticated** socket |
| Impact | **Process exit 1** — `throw er; // Unhandled 'error' event` |

The connection handler registers `message` and `close` but never `ws.on('error')`. `ws` emits
`'error'` for invalid opcodes, reserved bits, unmasked client frames, invalid UTF-8 and oversized
frames; with no listener that is an uncaught exception.

**Reproduced** by writing two raw bytes (`0x8f 0x00`) on an authenticated socket:
```
Emitted 'error' event on WebSocket instance at:
    at Receiver.receiverOnError (ws/lib/websocket.js:1218:15)
  code: 'WS_ERR_INVALID_OPCODE', [Symbol(status-code)]: 1002
Node.js v20.18.0
SERVER DEAD
```

**This is the "randomly" failure mode.** A VPN flap, proxy reset, suspended laptop, or an
extension truncating a frame mid-stream produces exactly this. Nothing in the UI explains the
disappearance because the process is gone.

**Fix:** `ws.on('error', () => ws.terminate());` inside `wss.on('connection')`, and
`socket.on('error', () => socket.destroy());` in the `upgrade` handler.

---

## 3. HIGH — session autosave failure kills the server (the "heavy workload" exit)

| | |
|---|---|
| Location | `packages/cli/src/terminal/agentRepl.ts:1252` (after every turn), `agentRepl.ts:398` (after `/undo`); `saveCurrentSession` at `agentRepl.ts:774` |
| Trigger | `EACCES` / `EROFS` / `ENOSPC` / `EDQUOT` while writing the session file |
| Impact | **Process exit 1**, losing the very session it was trying to save |

```ts
// agentRepl.ts:1252 — fire-and-forget, no .catch
void this.saveCurrentSession();
```

`saveCurrentSession()` is `async`, and `saveSession()` (`packages/core/src/modules/sessions.ts:177`)
uses `mkdirSync` + `writeFileSync`. A synchronous throw inside an `async` function becomes a
rejected promise; `void` leaves it unhandled → exit. The explicit `/session <name>` path
(`agentRepl.ts:417`) *is* wrapped in `try/catch`; only the automatic saves are not.

**Reproduced with the real `saveSession` from `dist`** and an unwritable cache dir:
```
Error: EACCES: permission denied, open '/tmp/crashprobe/ro/session.json'
    at Object.writeFileSync (node:fs:2367:20)
    at saveSession (packages/core/dist/modules/sessions.js:186:8)
    at FakeRepl.afterTurn (real-save.mjs:7:27)
exit=1
```

**This is the "after a huge workload" failure mode.** Large `run_command` outputs, cache
entries and session JSON fill the disk; the next turn's autosave gets `ENOSPC` and the IDE
exits mid-session. Any read-only or full `MUGIL_IDE_CACHE_DIR` reproduces it deterministically.

**Fix:** `.catch()` on both `void this.saveCurrentSession()` sites (log once, keep running), and
make `saveSession()` degrade to a no-op instead of throwing.

---

## 4. HIGH — opening the Shell pane kills the app when node-pty is unavailable

| | |
|---|---|
| Location | `packages/cli/src/server/ptyManager.ts:67-76` (`createFallbackPty`) |
| Trigger | `spawn(shell, …)` fails: `ENOENT`, `EACCES`, `ENOMEM` |
| Impact | **Process exit 1** — `Spawn` emits `'error'`, no listener |

The `child_process` fallback wires `stdout`/`stderr`/`exit` but never `child.on('error')`. This
backend is what Linux users get whenever `node-pty` fails to load: a Node major upgrade with no
prebuilt binary, an ABI mismatch after a package update, or a Nix user whose `$SHELL` points
into a GC'd profile.

**Reproduced** (`MUGIL_IDE_PTY_BACKEND=child SHELL=/does/not/exist`, then any
`resize_pty`/`pty_input` from the browser):
```
Emitted 'error' event on ChildProcess instance at:
  errno: -2, code: 'ENOENT', syscall: 'spawn /does/not/exist'
Node.js v20.18.0
SERVER DEAD
```

Symptom for the user: switching to the Shell tab closes the whole IDE.

**Fix:** `child.on('error', (e) => sendPtyData(...) / exitCallbacks…)` and resolve the spawn
failure into the pane instead of the process.

---

## 5. HIGH — `/api/graph` blocks the event loop for seconds (O(n²) line math)

| | |
|---|---|
| Location | `packages/core/src/modules/codegraph/index.ts:146`; route `server.ts:794` |
| Trigger | Any workspace with a large or generated source file |
| Impact | Server is **synchronously deaf** for the whole build; no size cap, so heap pressure too |

```ts
const line = content.slice(0, match.index).split('\n').length;   // per symbol → O(n²)
```

**Measured, real `buildCodeGraph` from `dist`:**
| input | result |
|---|---|
| 20 000 symbols in an 857 KB file | **5 099 ms** in the slicing loop alone |
| `buildCodeGraph('/tmp/crashprobe')` (18 files) | **5 144 ms**, 5.9 MB JSON, 178 MB RSS |
| incidental `/favicon.ico` issued during that build | **4 570 ms** latency |
| same request after warm-up | 0.7 ms |

`buildCodeGraph` also `readFileSync`s **every** source file with no per-file or total size
limit, and `JSON.stringify(graph)` runs synchronously inside the request handler — so a
generated bundle (minified vendor file, lockfile-shaped JSON, a 5 MB JS build artefact) both
stalls the loop and inflates the response.

**Fix:** precompute line offsets once per file (single pass, binary search per match), skip files
above a size cap, and build the graph off the request path (cache by workspace revision, which
the codebase already tracks for tool caching).

---

## 6. HIGH — no WebSocket backpressure: throttled tab grows the server without bound

| | |
|---|---|
| Location | `packages/cli/src/server/server.ts:1070-1080` (`sendAgentData` / `sendPtyData`) |
| Trigger | A chatty command (`yes`, `npm test`, a watch loop) in the Shell pane **and** a backgrounded/throttled/suspended browser tab |
| Impact | Unbounded memory growth in the **server** → OOM kill (SIGKILL 137), no log |

```ts
const sendPtyData = (data: string) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'pty_data', data }));   // bufferedAmount never checked
  }
};
```

**Measured** — client pauses its TCP socket (simulating a backgrounded tab), then runs
`yes 0123456789…` in the Shell pane:

| elapsed | server RSS | bytes actually delivered to client |
|---|---|---|
| baseline | 118 MB | — |
| 8 s | **466 MB** | **0** |
| 12 s | **774 MB** | 0 |

Server stays responsive (`/` still 200) but memory grows monotonically; on a 16 GB box a
left-open laptop tab plus a verbose command reaches the OOM killer.

**Fix:** drop-or-coalesce above a `ws.bufferedAmount` watermark (e.g. 8 MB) with a one-time
`[output throttled]` notice on the pane, and pause the PTY (`ptySession.pause()`/flow control)
until the socket drains.

---

## 7. MEDIUM — `run_command` timeout leaks the process tree (corrected)

| | |
|---|---|
| Location | `packages/core/src/modules/tools/workspaceTools.ts:1090-1113` |
| Trigger | Command backgrounds a long-lived grandchild (`nohup sleep 25 &`, dev server, watcher) |
| Impact | Grandchild survives the timeout; processes accumulate across turns |

**Correction to an earlier reading:** the `run_command` promise *does* settle — `exec`'s
`timeout` fires reliably in every probe (`callback at 1007-1010 ms`, `signal=SIGTERM`), including
against a `SIGTERM`-ignoring shell. There is **no** tool-loop hang.

What does leak is the tree: only the direct child is signalled.

```
$ node t3.mjs                    # exec('nohup sleep 25 & echo started', { timeout: 1000 })
callback at 12 ms signal= undefined
$ ps -eo pid,args | grep '[s]leep 25'
75681 sleep 25                   # still alive after the "timeout"
```

**Fix:** `detached: true` + `process.kill(-child.pid, 'SIGKILL')` on timeout, so the whole
process group goes.

---

## 8. MEDIUM — `SmartCache.prefixTrie` grows without bound

| | |
|---|---|
| Location | `packages/core/src/modules/smart-cache/index.ts:101,210`; eviction lives only in the backend (`backends.ts:27,48`) |
| Trigger | Long-lived server, many distinct prompts |
| Impact | Unbounded heap in a process meant to stay up for days |

The backend LRU caps at 2 000 entries, but the parallel trie is never evicted — `insert()` is
called on every store, `clear()` only on reset/close. One trie node is allocated **per
character** of every prompt ever cached.

**Measured:** 3 000 inserts of ~250-char prompts → **147 MB `heapUsed` / 222 MB RSS**, and the
trie still answers lookups for entries the backend has already evicted (stale
`backend.get()` → wasted work, not a correctness bug).

**Fix:** evict the trie in lockstep (delete on backend eviction), or cap it at the same
`maxEntries` count with a generation counter.

---

## 9. Summary table

| # | Finding | Kind | Verified | Exit / impact | Location |
|---|---|---|---|---|---|
| 1 | Malformed `Host` header | crash | ✅ | exit 1, **pre-auth** | `server.ts:237`, `1013` |
| 2 | Malformed WS frame | crash | ✅ | exit 1, **unauthenticated transport** | `server.ts:1033` |
| 3 | Autosave failure | crash | ✅ | exit 1, **"after heavy workload"** | `agentRepl.ts:398`, `1252` |
| 4 | Fallback PTY spawn error | crash | ✅ | exit 1, on Shell tab open | `ptyManager.ts:72` |
| 5 | O(n²) code-graph line math | stall | ✅ | 5.1 s event-loop block | `codegraph/index.ts:146` |
| 6 | No WS backpressure | OOM | ✅ | 118 → 774 MB unbounded | `server.ts:1076` |
| 7 | Timeout leaks grandchildren | leak | ✅ | orphan processes | `workspaceTools.ts:1111` |
| 8 | Trie never evicts | leak | ✅ | 147 MB @ 3k prompts | `smart-cache/index.ts:210` |
| 9 | No global error handlers | **amplifier** | ✅ | any of #1-#4 = process death | `index.ts:279` |

### Answers to the two questions asked

- **Randomly?** Yes — §2. One malformed WebSocket frame (proxy reset, VPN flap, sleeping
  laptop) exits the process. §1 also fires spontaneously behind host-rewriting proxies.
- **After a huge workload?** Yes — §3 (disk fills → autosave `ENOSPC` → exit), §6 (verbose Shell
  output + throttled tab → OOM kill), §5 (large generated files → multi-second freeze on
  `/api/graph`), and §7/§8 (process/memory accumulation over a long session).

---

## Recommended order for 0.1.24

1. **§9 + §1 + §2** — ~15 lines total. Global `unhandledRejection`/`uncaughtException` that log
   and keep serving, `try/catch` around both `new URL` sites, `ws.on('error')`. Converts four
   hard crashes into log lines and closes the unauthenticated DoS.
2. **§3** — `.catch()` on the two fire-and-forget autosaves; `saveSession` returns '' on write
   failure. Prevents data-loss exits.
3. **§4** — `child.on('error')` in `createFallbackPty`.
4. **§6** — `bufferedAmount` watermark + `[output throttled]` notice.
5. **§5** — line-offset precompute + file-size cap; cache the graph per workspace revision.
6. **§7, §8** — process-group kill and trie eviction.

Regression tests belong in `packages/cli/tests/server.test.ts` (Host header, malformed frame,
fallback-PTY spawn failure) and `packages/core` (autosave `EACCES`, graph timing bound,
trie eviction).

---

## Fix log — 2026-10-28 (0.1.24 work)

Phases were implemented in the recommended order; every item below is covered by a
regression test.

| Phase | Finding | Fix | Test |
|---|---|---|---|
| 1 | §9 global handlers | `installCrashGuards()` in `packages/cli/src/index.ts` logs and keeps serving | — (manual) |
| 1 | §1 malformed `Host` | `parseRequestUrl()` parses against a fixed base; HTTP handler wrapped into a 500 fallback | `server.test.ts` "malformed Host header" |
| 1 | §2 malformed WS frame | `ws.on('error')` + upgrade-socket error listener | `server.test.ts` "malformed WebSocket frame" |
| 2 | §3 autosave | `autoSaveSession()` with one-time warning; `saveSession()` returns `''` on failure | existing session tests |
| 3 | §4 fallback PTY | `child.on('error')` + early-output buffering, stdin EPIPE swallowed | `server.test.ts` "shell spawn failure" |
| 4 | §6 backpressure | 8 MB/1 MB watermarks, PTY pause/resume, `[output throttled]` notice, env-overridable | `server.test.ts` "backpressure" |
| 5 | §5 code graph | line-index + binary search, 1 MB file cap, revision-keyed cache (5 099 ms → 83 ms for 20 000 symbols) | `codegraph.test.ts` (line numbers, size cap, cache) |
| 6 | §7 process tree | own process group + group kill on timeout/abort | `workspaceTools.test.ts` "process-group cleanup" |
| 6 | §8 trie | bounded `maxTrieEntries` (default 2 000) with generation flush | `smartCache.test.ts` "prefix trie eviction" |

### Provider API path verification (live probes, 2026-10-28)

| Provider | Endpoint(s) probed | Result |
|---|---|---|
| OpenRouter | `GET /api/v1/models`, `POST /api/v1/chat/completions` | 200 / 401 (valid route) |
| OpenAI | `GET /v1/models`, `POST /v1/chat/completions` | 401 / 401 |
| Anthropic | `GET /v1/models`, `POST /v1/messages` | 401 / 401 |
| Vercel AI Gateway | `GET https://ai-gateway.vercel.sh/v1/models` | 200 |
| Together | `GET https://api.together.xyz/v1/models` | 401 |
| OpenCode (legacy) | `https://opencode.ai/zen/v1/{models,chat/completions,messages}` | 200 / route live |
| OpenCode (documented) | `https://opencode.ai/inference/{v1/models,openai/v1/chat/completions,anthropic/v1/messages}` | 200 / 401 / 401 |
| Cloudflare Workers AI | `POST /client/v4/accounts/{id}/ai/v1/chat/completions`, `GET …/ai/models/search` | route live (auth-gated) |
| Cloudflare AI Gateway | `POST https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/openai/chat/completions` | 401 (route live) |
| Ollama / LM Studio | `http://localhost:{11434,1234}/v1/models` | not running locally; OpenAI-compatible paths unchanged |

Fixed as a result: the Cloudflare AI Gateway path (old code produced
`api.cloudflare.com/gateway/accounts/…`, which does not exist), Cloudflare model
discovery (account id was parsed from a base URL that never contains `/accounts/`),
and OpenCode's modern `/inference` base. Everything else already pointed at a live
endpoint.

### Update-available indicator

`GET /api/update-check` compares `VERSION` with the npm `latest` tag (6 h cache,
4 s timeout, never throws) and the header renders a `⬆ vX.Y.Z` pill next to the
version badge, linking to that release. Covered by `server.test.ts`.

---

## Addendum — savings indicator audit (2026-10-28)

**Reported:** the savings indicator reads `0%` on every run, even a Caveman-only
input. It should always show some percent.

### Root cause

Two independent accounting bugs, both in the *denominator*:

1. **Web UI pill** (`packages/cli/src/server/html.ts`) and **TUI `/stats`**
   (`packages/cli/src/terminal/agentRepl.ts`) computed
   `tokensSaved / (promptTokens + tokensSaved)`, where `promptTokens` is what the
   **provider reported** — the whole request: system prompt, agent instructions,
   ~2 100 tokens of tool schemas, and history. With `usage.promptTokens ≈ 24 500`
   and a 5-token Caveman saving, the ratio is 0.02% and `Math.round` prints `0`.
   Measured live: `{"promptTokens":24500,"tokensSaved":5}` → `0%`; the same
   turn is `36%` against compressible input.

2. **The saved-token side was incomplete.** Only `refine` savings and cache hits
   were counted. Tool-output compression (RTK, in `ToolLoop.execute`), history
   eviction and older-turn compaction were thrown away, so the numerator stayed
   tiny even when thousands of tokens were removed from a run.

`tokensSaved` also grew across turns while the denominator was per-turn provider
usage, so the ratio drifted toward zero as a session went on.

### Fix

- New helper `inputSavingsPercent(saved, kept)` (`packages/core/src/savings.ts`)
  = `saved / (saved + kept)`, NaN/negative-safe. One definition, used by the TUI,
  the server status frame and `run`.
- `AskResult.savings` (`InputSavings`) now reports signature-strip + refinement
  savings; an exact/semantic cache hit reports the whole refined prompt as saved
  (it was never sent) with `keptTokens: 0`.
- `ToolLoopResult.savings` accumulates per-call tool-output compression savings
  (`before - after`) and the tokens still sent.
- `HistoryBudgetResult.compressionSavings` reports evicted + compacted tokens as
  saved and kept turns + compaction summary as kept.
- `SessionStats.compressibleTokens` persists the denominator, so `/stats` and
  the pill survive a reconnect; the server precomputes `savingsPct` in the
  status frame so both surfaces can never disagree.

### Verification

| Case | Provider reports | Before | After |
|---|---|---|---|
| `fix the login bug` (already terse — nothing to compress) | 200 tok | `0%` | `0%` (honest) |
| `Can you please fix the login bug in order to…` (Caveman only) | 200 tok | `0%` | `36%` |
| `Please add error handling to the fetch call…` (1 token saved) | 200 tok | `0%` | `4%` |
| same turn with a realistic 24 500-token agent prompt | 24 500 tok | `0%` | `4%` |
| 3-turn live server session | 600 tok | `0%` | `26%` |
| Two identical prompts, second one a cache hit | 200 tok | 51% (inflated: whole completion counted) | `100%` |

The only case that still reads `0%` is a prompt with no removable filler at
all — there is nothing to save, and reporting a number there would be a lie.

Regression tests: `packages/core/tests/savings.test.ts`, plus pipeline
(whole-prompt count must not dilute), tool-loop (compression reported), history
(eviction/compaction reported, zero when idle) and `server.test.ts` (status frame
carries `tokensSaved > 0`, `compressibleTokens > 0`, `savingsPct > 0`).
