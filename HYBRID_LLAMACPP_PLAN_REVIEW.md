# Review: HYBRID_LLAMACPP_MASTER_PLAN.md

**Verdict:** Right instinct, wrong artifact. As a *pitch* it's 8/10. As an *implementable plan* it's 5/10 — it re-specifies work already specified in `llama-cpp.md`, contradicts that plan on two product decisions, names tools that don't exist, and its central savings numbers are unmeasured. The best idea in it (0-RAM algorithmic pre-flight) is buried under a 1.5B model that doesn't earn its keep.

Evidence below was gathered by reading the repo and running measurements, not by reading the plan charitably.

---

## 1. Blockers (fix before anyone writes code)

### 1.1 It's a plan on top of an unimplemented plan
`llama-cpp.md` (574 lines of task-by-task spec) covers Tasks 1–10: provider plumbing, hardware probe, catalog, downloader, binary extraction, supervisor, CLI, routes, UI, deprecation. **None of it exists:**

```
$ grep -rl "llamacpp" packages/*/src packages/*/tests
(no files)
$ grep -n "LLAMACPP" .env.example
(nothing)
```

The master plan's Task 2–3 then re-specify six of those modules in four checklist lines each. Two sources of truth for `paths.ts`, `hardware.ts`, `catalog.ts`, `download.ts`, `binary.ts`, `server.ts`. That is how you get a `vendor/` layout that differs between the two docs and a debug session at midnight.

Worse: the master plan **omits `llama-cpp.md` Task 1 entirely** — the `llamacpp` provider kind, `loadConfig()` arm, `createClient()` arm, `UnifiedWireClient` kind, `ALLOWED_BASE_VARS`. Without it, "Local-Only Mode runs a 30B MoE locally" cannot work: `packages/cli/src/providers.ts` has ten provider entries (`openrouter, openai, anthropic, vercel, cloudflare, together, opencode, ollama, lmstudio, openai-custom`) and `llamacpp` is not one of them. The master plan's flagship tier depends on a task it never mentions.

**Fix:** Master plan keeps only phases that `llama-cpp.md` doesn't cover. Reference, never restate.

### 1.2 Direct contradiction on Ollama
| Source | Says |
|---|---|
| Master plan Pillar 2 + Tenets | "Ollama and LM Studio are NOT deprecated and NOT sunset… no deprecation notices" |
| Master plan Task 6 | "no deprecation notices" |
| `llama-cpp.md` DoD #4 | "with a visible deprecation notice on Ollama" |
| `llama-cpp.md` Task 10 | "Deprecation of Ollama (start the clock)" + CHANGELOG `### Deprecated` + sunset runway "v0.6 removal of the `ollama` provider arm" |

Both files are currently untracked (`git status` → `?? llama-cpp.md`, `?? HYBRID_LLAMACPP_MASTER_PLAN.md`), so this is a free decision — no shipped behaviour depends on either. Pick one, delete the other's text.

My read: **the master plan is right.** Evidence that a deprecation notice would contradict shipped, user-facing reality today:

- `README.md:21` — "Works seamlessly with **free local models** (Ollama, LM Studio)…"
- `README.md:68-72` — a whole "1-click auto-connect for local models" section whose example is `ollama run qwen2.5-coder:7b`
- `README.md:458` — `OLLAMA_BASE_URL` documented as a first-class knob
- `packages/cli/src/providers.ts:60` — `ollama` is a peer of every cloud provider, with no deprecation flag anywhere in the codebase

Deprecating a *working* provider in v0.5 to promote a runtime that does not exist yet (`grep -rl llamacpp packages/*/src` → nothing) is a self-inflicted support burden. `llama-cpp.md` Task 10 and DoD #4 should go.

### 1.3 Task 5 hooks state that no task creates
> "Integrate `LocalPreflight` into `Pipeline.ask` when `topology === 'hybrid-orchestrated'`."

```
$ grep -rn "topology" packages/*/src
(nothing)
```

No `topology` field in `AppConfig`, no `/api/llamacpp/*` route, no mode selector. The plan's own Task 6 adds the UI dropdown *after* Task 5 consumes the value. Sequencing is inverted, and the config field is never added by any task.

### 1.4 The tool-pruning bundles name tools that don't exist
Risk 2 lists `['list_files', 'grep_search', 'find_files']`, `['run_command', 'read_terminal']`, `['dispatch_webhook', 'mcp_tool_execute']`.

Real tool names (`packages/core/src/modules/tools/workspaceTools.ts`):

```
read_file, read_symbol, read_skeleton, list_files, search_code, codegraph,
write_file, edit_file, apply_patch, run_command, todowrite, todoread, skill,
webfetch, websearch, lsp, read_blob, question, task, generate_image
```

`grep_search`, `find_files`, `read_terminal`, `dispatch_webhook`, `mcp_tool_execute` **do not exist**. If this lands as an allowlist, the pruning silently deletes `search_code` (the actual grep) and keeps nothing.

Three more classification errors in the same table:

- **`CORE_EDITING` omits `write_file`.** `['read_file','edit_file','apply_patch']` means the model can modify existing files but cannot *create* one. "Refactor auth middleware" is fine; "add a test file" is impossible. `write_file` is 145 tokens — it belongs in the immutable core.
- **`read_blob` is filed under `MEDIA`.** It's not media; it's CCR (content-compressed retrieval) for oversized tool output that got truncated — a core-loop tool. Putting it behind "media explicitly requested" means a pruned-away recovery path.
- **`generate_image` is the biggest single win and is gated the wrong way.** It's 336 tokens — 11% of the whole schema payload, and the largest of the 20 — yet it's only *removed* when media isn't mentioned. That part is right; the plan just never says so, and the 3.5k headline hides that the easy 336 is free.

Measured per-tool token costs (tiktoken, `JSON.stringify`), so the table can be built on data:

```
generate_image 336 | read_file 233 | lsp 200 | run_command 187 | todowrite 188 |
task 188 | apply_patch 181 | question 153 | write_file 145 | list_files 135 |
read_blob 134 | edit_file 132 | websearch 130 | search_code 118 | webfetch 117 |
read_symbol 114 | read_skeleton 98 | codegraph 92 | skill 85 | todoread 57
```

### 1.5 The "Open-Door Contract" has no escalation path
The plan promises: *"If you require additional files, call `read_file`."* But pruning removes a tool's **schema** from the request, and a model cannot call a function it was never told about. If it hallucinates one anyway:

`packages/core/src/modules/tool-loop/index.ts:388-391`
```ts
const executor = registry[activeCall.name];
if (!executor) {
  return { content: `Error: unknown tool "${activeCall.name}"`, ok: false, ...none };
}
```

It does not crash (the throw at `:181` only covers declared-but-unregistered tools), it silently burns an iteration and the model usually retries the same call. Nothing in the plan re-widens the bundle mid-loop, and "Zero broken code, zero regression" (Risk 1.3) rests on that missing mechanism.

**Good news — the fix is small.** `createWorkspaceTools()` returns `tools` (schemas) *and* `toolRegistry` (executors) separately (`workspaceTools.ts:840`), and `agentRepl.ts:1413-1414` merges both. Prune only the schema array; keep the registry whole. Then in the loop's unknown-tool branch, look up the name in the **full** catalog, append its schema to the outgoing request, and return `ToolError: 'not currently enabled — retry'`. That is a ~15-line change to `tool-loop/index.ts` plus a `toolCatalog` option on `AskOptions`, and it turns Risk 1.3 from a promise into a mechanism. Specify it in the plan or drop the claim.

---

### 1.6 What checks out (verified, not assumed)

So the rest reads as fair:

- Pinned build **`b12451` exists** and both docs cite it consistently. Checksums in `llama-cpp.md` match the GitHub release API exactly: `6604b91d…274cbf` (ubuntu-x64, 23.5 MB), `a1141628…45d936` (macos-arm64, 17.0 MB), `d719d720…65f17` (ubuntu-cuda-12.8, 200 MB).
- All eight asset names in `llama-cpp.md`'s map are real (`llama-b12451-bin-{ubuntu-x64, ubuntu-cuda-12.8-x64, ubuntu-arm64, ubuntu-vulkan-x64, macos-arm64, macos-x64, win-cpu-x64, win-cuda-12.4-x64}`).
- `llama-server` speaking the OpenAI wire format really does mean zero new provider client — `UnifiedWireClient` already has the seam.
- The 0-RAM algorithmic pre-flight needs nothing new: `scanSecrets()`, `shannonEntropy()`, `buildCodeGraph()`, `queryCodeGraph()`, `extractCodeSkeleton()` all exist and work.
- Measured cost of the CodeGraph cache: cold build 118 ms / 167 files / 551 symbols, query 24 ms, cached rebuild **0 ms**. Pre-flight latency budget is realistic.

---

## 2. Factual errors (measured)

### 2.1 "toolPruning saves 3,500 tokens/turn" — measured: 2,185 to 2,462
```
all 20 workspace tool defs                              3,008 tok
plan's CORE_EDITING (read_file, edit_file, apply_patch)   546 tok  -> saves 2,462
recommended core (+write_file, +read_blob)                823 tok  -> saves 2,185
```
So the ceiling is **2,462** and the *recommended* configuration saves **2,185**. Either way, 3,500 is not achievable before MCP tools are counted. Cheap to fix: say 2.2k–2.5k and cite the test that asserts it.

### 2.2 "hybridRecon ~20,000 tokens/task" is unfalsifiable
There is no code that can observe tokens a cloud model *would have* spent. You are inventing a counterfactual and adding it to a bank of measured numbers, then dividing by billed tokens. That bucket will inflate the headline % forever and nobody can audit it. Either (a) drop it, or (b) label it "estimated (counterfactual)" in the UI, visually distinct.

### 2.3 The "denominator fix" misdiagnoses the current code
The plan calls `inputSavingsPercent`'s denominator "distorted". `packages/core/src/savings.ts` says the opposite, in a comment written by whoever fixed it:

> "Measuring against the whole request (system prompt + tool schemas + history, tens of thousands of tokens) diluted any real module saving to 0%, which is what the status bar used to show."

The plan's replacement formula reintroduces exactly that denominator ("ActualBilledTokens") and will re-break the status bar to ~0%. **The real bug is narrower and the plan half-sees it:** `agentRepl.ts:1664` adds an *output-side* estimate (Ponytail, 0.5 × `completionTokens`) into `optimisticTokensSaved`, then `optimisticSavingsPercent` divides by *input* tokens. Apples over oranges. Fix that one line-pair; don't replace the formula.

Also: "bounded in 0–99%" is false as written, and the existing code can violate it. Measured:

```
inputSavingsPercent(3000, 0)      -> 100   // session where every turn was a cache hit
inputSavingsPercent(800, 2000)    -> 29    // normal turn
inputSavingsPercent(3800, 2000)   -> 66    // normal + cache hit (kept carries over)
inputSavingsPercent(0, 0)         -> 0     // guarded
```

Because `compressibleTokens` is a session accumulator, a session that is *mostly* cache hits drifts toward 100% and the first non-cached turn snaps it back down. Not a crash, but the counter visibly lies on cheap sessions. The fix is a `Math.min(99, …)` clamp at the display path (`savings.ts`), not a new formula arguing about denominators.

### 2.4 "~1,200-token capsule" vs measured reality
Measured skeletons (`extractCodeSkeleton` + tiktoken):

| file | tokens |
|---|---|
| `savings.ts` | 259 |
| `pipeline.ts` | 1,106 |
| `cli/src/index.ts` | 3,230 |
| `core/src/config.ts` | 4,518 |
| `cli/terminal/agentRepl.ts` | 4,556 |
| **5 files** | **13,669** |

The plan's own test asserts "AST outlines for top lexical hits **under 1,500 tokens**". For real files that's unachievable without symbol-level extraction and a hard truncation budget — which the plan doesn't specify. As written the test cannot pass, and the capsule will either be empty or 10× the promised size.

### 2.5 CodeGraph anchor quality is worse than the plan assumes
Ran the real function on this repo:

```
"Refactor Auth Middleware"  -> scores 5,4,4,4,4   (top hit: Tokenizer — wrong)
"fix the bug"               -> scores 15,14,11,11,9
"why does shutdown hang"    -> scores 5,4,4,3,2
```

`queryCodeGraph` is a crude lexical accumulator (`codegraph/index.ts:403`): name-match 4, path 2, raw substring occurrences. Generic words dominate. So the plan's confidence gate ("< 15 → enable EXPLORATION") fires on almost every natural-language prompt, i.e. pruning mostly does nothing, *and* the "top-5 deterministic anchors" are frequently wrong. Determinism ≠ relevance. The mitigation offered — "the local SLM only acts as a re-ranker" — means spending a 1.5B model (~980 MB + server + startup + 1 inference) to reorder five possibly-irrelevant symbols.

### 2.6 Tier thresholds contradict the catalog (on one axis)
Plan Tier 1: "≥16 GB VRAM / 32 GB+ RAM → 30B MoE". Catalog (`llama-cpp.md` Task 3): that model is **18.5 GB of weights, `minRamGb: 24`**.

- RAM axis: **fine.** 32 ≥ 24, the recommendation holds.
- VRAM axis: **broken.** 18.5 GB of weights do not fit in 16 GB of VRAM; you get partial offload and single-digit tok/s. Either raise the bar to ≥20 GB VRAM or keep Tier 1 RAM-only and say so.

Also note `recommendModels()` filters on `availableRamGb` (system RAM), not VRAM — so the plan's VRAM-based tiering is a *different axis* than the catalog's gating, and the two can disagree in either direction on a machine with a big GPU and small RAM.

Third, smaller: the diagram gates hybrid entry at "≤ 16 GB RAM" while Risk 3's code gates the SLM at `totalmem <= 8GB || freemem < 1.5GB`. A 12 GB box is "hybrid" per the diagram and "SLM-eligible" per the code — consistent only by accident.

### 2.7 `os.freemem()` is the wrong signal on Linux
The RAM gate (`os.freemem() < 1.5GB`) uses Node's `freemem`, which on Linux reports `MemFree` — it excludes reclaimable page cache. A 16 GB laptop that has read a few files will report < 1.5 GB free and silently fall back to the "0-RAM" path while 10 GB is available. Read `/proc/meminfo` `MemAvailable` on Linux, `os.free`/`vm_stat` on macOS. Also note the plan's condition is `totalmem <= 8GB || freemem < 1.5GB` — an 8 GB box with 6 GB free is *forced* off the SLM by the first clause; the diagram implies the gate is the second clause only.

### 2.8 Diagram is internally inconsistent
- `CheckRAM{Free RAM < 1.5GB?}` → `|Yes: Safe Headroom|` — yes/no labels are swapped; "yes" means *insufficient* headroom.
- `Prune["Keeps only edit_file (saves 3.5k tokens)"]` contradicts Risk 2's immutable `CORE_EDITING` of three tools.
- `NeuralSLM & AlgorithmicSLM -->` drawn three times; it's a valid mermaid shorthand but reads as three sequential stages.
- The diagram never uses the primitives that actually exist for this job: `read_skeleton` and `read_symbol`. It says "extracts AST skeletons" without naming the two functions that already do it (`workspaceTools.ts:81,101`).

### 2.9 "~35 sibling libraries"
True for the CUDA tarball, not for the 23.5 MB CPU one. The policy ("extract the whole directory, chmod every `.so`/`.dylib`/`.dll`") is what matters and it's already in `llama-cpp.md` Task 5, with the real failure mode quoted (`error while loading shared libraries`). Cut the number, keep the policy, don't restate it.

---

## 3. Design gaps the plan doesn't cover

1. **`sessions.ts` will silently drop the new buckets.** `packages/core/src/modules/sessions.ts:232-238` rebuilds `savingsBreakdown` field-by-field (`caveman`, `yagni`, `cache`, `mcp`). Add `toolPruning`/`hybridRecon` to the interface, and resumed sessions lose them. Task 1 doesn't mention this file.
2. **The Web UI is where users see the counter, and Task 1 doesn't touch it.** `packages/cli/src/server/html.ts:3703` re-renders the breakdown by hand (`bd.caveman`, `sp-caveman`/`sp-yagni`/… DOM nodes), and `:3694-3700` carries a *fallback* `%` formula in raw JS for when the server-computed `optimisticSavingsPct` is absent. Adding two buckets means editing `agentRepl.ts:786-795` (terminal), `server.ts:1964-1972` (server), **and** `html.ts:3693-3720` (browser, untyped) — or the pill silently shows the old four. Good news: the server already computes both percentages centrally (`server.ts:1964-1972`, with a comment saying it exists so terminal and web "can never disagree"), so the html fallback can just be deleted.
3. **Required vs optional fields is unresolved.** Ten sites construct or serialise a `SavingsBreakdown`: `savings.ts:24` (default), `pipeline.ts:249,301`, `tool-loop/index.ts:192`, `history.ts:98`, `agentRepl.ts:1636,1652,1657`, `html.ts:3703`, `sessions.ts:232`. Making the fields required breaks all ten; optional works because `sumSavingsBreakdowns` already uses `?? 0`. Choose "optional + default" — one type change instead of ten edits. (Note `html.ts:3703` is raw JS in a template string, so TypeScript won't even tell you it's stale.)
4. **Secret-vault hazard the plan creates.** `pipeline.ts` already runs `globalSecretVault.tokenize()` on the prompt and there is a `secretChokePoints` test. Masks flowing into a *patch* is new: if the cloud model emits `[MUGIL_SECRET_1]` inside an `edit_file` payload, resolving it locally writes a live credential into source. Needs an explicit "never resolve secrets into file writes" guard. Meanwhile `semanticPrivacyGuard.ts` (a local SLM DLP scanner) duplicates `scanSecrets()` + `shannonEntropy()` in `modules/security/secretScanner.ts`. **Cut it.**
5. **No measurement harness.** The entire thesis is "90% token efficiency, 1-shot correct". There is no acceptance test that runs N canned tasks cloud-only vs hybrid and reports billed tokens *and* pass rate. Without it, nobody can tell whether the SLM is paying for itself or eating the savings in bad capsules and retries.
6. **No rollback story.** No feature flag, no "hybrid off" kill switch beyond a dropdown that doesn't exist yet. If the capsule pipeline misbehaves in the field the only exit is a code revert.
7. **Duplicate test file names.** Master plan: `savings.test.ts` (exists), `hardware.test.ts`, `hybridOrchestration.test.ts`, `cli/tests/shutdown.test.ts`. `llama-cpp.md`: everything in `packages/core/tests/llamacpp.test.ts`. Two plans → two homes for the hardware probe tests.
8. **Task 5's shutdown restates `llama-cpp.md` Task 8**, which explicitly warns: *"SIGINT/SIGTERM handlers already exist (`packages/cli/src/index.ts:345-346`)… do not add duplicates"*. The one genuinely new and good contribution is "deadline-bounded" — and it should be filed as a **bug** against existing code:

```ts
// packages/cli/src/index.ts:312
const shutdown = async () => {
  try { await server.close(); await engine.backend.close(); }
  finally { process.exit(0); }
};
```

To be fair, `server.close()` **is** already hardened — `server.ts:2331-2336` calls `wss.close()`, `diffRunner.dispose()`, `closeAllConnections()`, `closeIdleConnections()`. So the socket-leak theory is wrong and I withdraw it. What's genuinely missing is a **deadline**: nothing bounds `engine.backend.close()` (Redis `quit()` on a dead link waits on nothing in particular), and there's no child-process kill because there's no child yet. `process.exit(0)` in `finally` covers the hang case only because it runs after an unbounded `await`. ~10 lines to add `Promise.race([close, timeout])`. Worth doing on its own merits — but it is a *pre-existing nicety*, not a reason to gate a vendor story on it. The plan is right that the seam should exist; it's wrong to present it as new work. Also note `llama-cpp.md` Task 8 already flags the duplicate-handler trap.

---

## 4. The economics: what the plan optimizes vs. what hurts

Measured fixed per-turn overhead in the CLI agent loop (`agentRepl.ts:1439` + `pipeline.ts:341`), tiktoken:

```
ACT_MODE_INSTRUCTION          98 tok
ponytailInstruction()        155 tok
DEFAULT_SYSTEM_PROMPT         20 tok
20 tool schemas (JSON)     3,008 tok
                          ---------
fixed cost per turn        3,281 tok   <- 92% of it is the tool schemas
recommended core schemas     823 tok   (read_file, write_file, edit_file,
                                        apply_patch, read_blob)
pruning saves              2,185 tok/turn
```

That is the strongest argument for tool pruning in the whole document, and the plan doesn't make it: the tool schemas are ~92% of the fixed prompt cost, and 15-17 of the 20 tools are irrelevant to any given turn. Pruning is not a nice-to-have; it is the largest constant-factor win available that touches no user content, and it needs no SLM.

Now the hybrid claim. Assumptions stated explicitly, because the plan states none:

- Cloud recon loop: ~20k prompt tokens @ $3/M ~= **$0.06/task** (assumption, unmeasured)
- Hybrid: 1.2k capsule ~= **$0.004** + local SLM (electricity, 1-3 s latency)
- Break-even first-try rate: `0.004 + (1-p)(0.06) = 0.06` => **p ~= 6%**

So on *token cost* the hybrid wins almost immediately. Which means **cost is not the binding constraint - correctness and latency are.** A bad capsule doesn't cost tokens; it costs a wrong patch, a user-visible failure, and a repair loop whose tokens dwarf the original 20k. The plan's answer to that risk is the phrase "1-Shot Perfect Diff", resting on a 1.2k context and a lexical anchor that answered `"Refactor Auth Middleware"` with `Tokenizer`. That is the claim to defend, and the document doesn't defend it.

Latency, separately: a 1.5B Q4 model on a CPU-only laptop realistically generates 8-15 tok/s. A 400-token pre-flight analysis is 30-50 s of wall clock *before* the cloud request is even sent. The plan budgets zero for this and advertises a `< 300 ms` discovery step - which measures only CodeGraph (24 ms measured here), not the SLM round-trip it sits behind.

Counter-proposal worth taking seriously: **skip the SLM, keep the pruning, keep the capsule.** Pruning alone is a measured 2,185–2,462 tokens/turn with zero new processes, zero new failure modes, no added latency, and it is implementable today.

---

## 5. Cut list (YAGNI, in dependency order)

| Cut | Why | Replaced by |
|---|---|---|
| `semanticPrivacyGuard.ts` (SLM DLP) | Duplicates `scanSecrets()` + `shannonEntropy()` | Existing scanner + vault, applied to the capsule formatter |
| Local SLM as "re-ranker" of 5 CodeGraph hits | ~980 MB + a server + latency to reorder a list that's usually wrong | Better lexical scoring (IDF / damp generic tokens); or just hand the cloud the exploration tool |
| New `calculateSessionEfficiency` formula | Reintroduces the denominator the existing comment explains was removed on purpose | Fix the input/output unit mismatch at `agentRepl.ts:1664` |
| `hybridRecon` as a *measured* bucket | Unobservable counterfactual | Label "estimated", or drop |
| Duplicated tier thresholds / hardware numbers | Diverges from the catalog (`minRamGb: 24` vs "16 GB VRAM") | One source: `llama-cpp.md` `hardware.ts` + `catalog.ts` |
| Restated Task 2/3/8 specs | Two sources of truth for six files | `llama-cpp.md` verbatim |
| `llama-cpp.md` Task 10 (Ollama deprecation) | Contradicts the slower, correct "zero forced sunsets" stance; promotes a provider that doesn't exist yet | Nothing — keep Ollama first-class |

---

## 6. Recommended sequencing

**Phase A — ship in ~2 days, no new processes.**
Real tool names, immutable `CORE_EDITING`, `toolPruning` bucket (optional field), `sessions.ts`, all three savings displays unified, one test asserting 3,008 → 823. Fix the Ponytail unit mismatch. Fix the deadline-less `shutdown()`. This captures ~80% of the claimed benefit with ~5% of the risk, and it makes the counter honest *before* you add a bucket that can't be audited.

**Phase B — `llama-cpp.md` Tasks 1–8, verbatim.** Provider kind → hardware → catalog → downloader → binary → supervisor → CLI → routes. Do not re-spec. Do not do Task 10.

**Phase C — hybrid capsule, minimum viable.** One function `buildCapsule(graph, prompt, budgetTokens)`: symbol-level extraction (`read_symbol`/`read_skeleton`) with a hard budget and explicit truncation notice. No SLM, no DLP module. Then **measure**: run 20 canned refactor tasks cloud-only vs hybrid, record billed tokens + pass rate + wall-clock. Publish both numbers or delete the phase.

---

## 7. Scorecard

| Dimension | Score | Note |
|---|---|---|
| Vision / north star | 9/10 | Local-first, no sunset, honest savings — correct direction |
| Originality vs. existing plan | 3/10 | ~60% is `llama-cpp.md` restated with less detail |
| Internal consistency | 4/10 | Ollama stance, diagram, prune-vs-editable, tier thresholds |
| Factual accuracy | 4/10 | Invented tool names, 3.5k→2.2–2.5k, 1.2k capsule vs 13.7k skeletons |
| Risk analysis | 6/10 | Right risks named; mitigations 1 and 2 are unimplementable as written |
| Testability | 5/10 | One assertion (skeletons < 1,500 tok) cannot pass |
| Economics | 3/10 | Optimizes the non-binding constraint; no measurement plan |
| **Overall as implementation spec** | **5/10** | Fix blockers §1.1–1.5 and it becomes an 8/10 |

**The one-line version:** keep the 0-RAM algorithmic pre-flight and the permanent Ollama/LM Studio stance; delete the SLM re-ranker, the DLP module, the new savings formula, and every paragraph that re-specifies `llama-cpp.md`; then prove the capsule works with a measured A/B before writing `orchestrator.ts`.
