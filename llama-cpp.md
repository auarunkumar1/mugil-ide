# Vendored llama.cpp Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or execute tasks in order. Steps use checkbox (`- [ ]`) syntax. One task = one commit. `npm run typecheck`, `npm test`, `npm run lint` green before every commit.

**Goal:** Make Mugil IDE able to run local models _by itself_ — no Ollama, no LM Studio. The app downloads (or is pointed at) a `.gguf` model, vendors a pinned `llama-server` binary into its own data dir, supervises it as a child process, and routes completions to it through the existing OpenAI-compatible wire client. The existing **Kill Server** button must stop the IDE _and_ the LLM process together. Ollama support is deprecated now, removed later.

**Architecture:** `llama-server` speaks the OpenAI wire format, so **no new provider client is written**. We add one provider kind (`llamacpp`) that is just a base URL, plus three genuinely new things: (1) a **binary installer** that vendors llama.cpp releases per platform into `~/.config/mugil-ide/vendor/llama.cpp/b<build>-<variant>/`, (2) a **catalog + downloader** for GGUF weights with hardware-matched recommendations and sha256 verification, and (3) a **supervisor** (`LlamaServerManager`) owned by the CLI process, stopped by the same `onShutdown` hook the Kill Server button already calls.

**Tech Stack:** TypeScript, Node 20 (`node:child_process`, `node:fs`, `node:os`, global `fetch`, `ReadableStream` for download progress), Jest (`ts-jest`), existing `UnifiedWireClient` / `fetchProviderModels` / web-UI HTML.

**The user journey we are building (keep this in view):**

1. First launch, no keys. Welcome modal shows a **Built-in model** card instead of "install Ollama first".
2. It reads the machine ("11.7 GB RAM · 8 cores · no GPU"), offers 2–3 sized-for-you models with sizes and licences.
3. One click downloads (progress bar) → one click starts (`llama-server` on 127.0.0.1:8080) → provider flips to `llamacpp` and the IDE just works.
4. They type in the terminal / chat and get streamed answers, tool calls included.
5. They click **Kill Server**: IDE gone, model gone, `pgrep llama-server` is empty.

Everything below exists to make those five sentences true.

---

## Definition of Done

1. From a cold machine with **nothing installed**, a user clicks one button in the welcome modal, waits for a download, and chats with a local model inside Mugil IDE.
2. **Kill Server** stops the IDE _and_ the local model — verified by `pgrep -af llama-server` returning nothing afterwards.
3. Ctrl+C, `kill -9`, and a crashed parent all leave **zero** orphaned `llama-server` processes.
4. Ollama and LM Studio still work exactly as before, with a visible deprecation notice on Ollama.
5. No new npm dependency, no binary or weights in the npm tarball, `npm test` + `typecheck` + `lint` green.

If a task does not move one of those five, it is out of scope for v1.

## Non-Goals (say no on purpose)

- ❌ Bundling the llama.cpp binary or any `.gguf` inside the npm tarball (`files: ["dist"]`) — that is 300 MB–4 GB per publish. "Vendored" = **fetched once into the app's own data dir, pinned, checksummed, and owned by the app**, not shipped in the package.
- ❌ A llama.cpp C++ build system, cmake, or compiling from source. Prebuilt release assets only, with a user override.
- ❌ Replacing Ollama joins in the same release. Ollama keeps working; it just prints a deprecation notice.
- ❌ Embeddings/smart-cache backend on llama.cpp (existing embedding path stays).
- ❌ Multi-model serving / model hot-swap without restart. One model per `llama-server` process.
- ❌ Surfacing or documenting llama-server's own chat web UI. We only use its HTTP API; users who want it can hit the port directly, we never advertise it.

## Global Constraints

- **Node >= 20.** No new npm dependencies. `node:child_process`, `node:net`, `node:fs/promises`, `node:crypto`, `node:os` only.
- **Loopback only.** `llama-server` binds `127.0.0.1`. Never `0.0.0.0`, never a LAN-reachable port. Existing `isValidProviderBaseUrl()` already rejects non-loopback hosts for local base vars — `LLAMACPP_BASE_URL` joins that list.
- **No orphaned processes.** Four layers: the Kill Server button → `shutdown()` stops it; the existing SIGINT/SIGTERM handlers → same `shutdown()`; `process.on('exit')` does a best-effort synchronous kill; a stale `llama-server.pid` is reaped at next startup (survives `kill -9`).
- **The Kill Server contract does not change.** `POST /api/shutdown` → `options.onShutdown()` → today's `shutdown()` in `packages/cli/src/index.ts`. We only widen `shutdown()` to stop the LLM first. No new endpoint, no new auth path.
- **Every network fetch is abortable and progress-reportable** (`AbortSignal.timeout` for probes, streaming body for downloads), and every download is **sha256-verified** before it is used.
- **Downloads are atomic:** write to `<file>.part`, `rename()` on success, delete `.part` on abort. Never leave a half-written `.gguf` where `readdir()` can see it. (Byte-range resume is a documented follow-up — v1 retries from zero.)
- **Disk safety:** check free space before a download; refuse with a clear message instead of filling the user's disk.
- **Zero behaviour change for existing providers.** If `AI_PROVIDER` is not `llamacpp`, nothing spawns, nothing downloads, no startup cost beyond reading one config value.
- **No telemetry on hardware probing.** `os.totalmem()`/`os.cpus()` only; `nvidia-smi` is only run if it exists on `PATH`.
- ESLint zero errors; `npm run typecheck` and `npm test` green. `.ts` sources with `.js` ESM import specifiers.

---

## File Structure

| File                                                                                       | Responsibility                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/modules/llamacpp/hardware.ts`                                           | **Create.** Pure-ish hardware probe → `HardwareProfile` (total/available RAM, cores, arch, `gpu: 'cuda'\|'metal'\|'cpu'`, VRAM when detectable). No spawning except an optional `nvidia-smi` lookup.                                                     |
| `packages/core/src/modules/llamacpp/catalog.ts`                                            | **Create.** Static curated `MODEL_CATALOG` + `recommendModels(profile)` ranking. Data only, no I/O.                                                                                                                                                      |
| `packages/core/src/modules/llamacpp/paths.ts`                                              | **Create.** `appDataDir()`, `modelsDir()`, `vendorRoot()`, `vendorDir(build, variant)`, `pidFile()` — the single answer to "where does Mugil put local files", rooted at `dirname(userEnvPath())`, with `MUGIL_IDE_MODELS_DIR` overriding model storage. |
| `packages/core/src/modules/llamacpp/binary.ts`                                             | **Create.** `resolvePlatformBuild()`, `ensureLlamaServerBinary()` (vendor/checksum/extract/chmod), `LLAMA_CPP_BUILD` pin.                                                                                                                                |
| `packages/core/src/modules/llamacpp/download.ts`                                           | **Create.** `downloadFile()` — streaming fetch → `.part` → sha256 → rename, with `onProgress` and `signal`. Used for both binaries and weights.                                                                                                          |
| `packages/core/src/modules/llamacpp/server.ts`                                             | **Create.** `LlamaServerManager` — start/stop/status/health, port pick, arg builder, stderr ring buffer, pid file.                                                                                                                                       |
| `packages/core/src/modules/llamacpp/models.ts`                                             | **Create.** `listInstalledModels()`, `deleteInstalledModel()`, `resolveModelPath(fileOrId)` — `.gguf` discovery in `modelsDir()`.                                                                                                                        |
| `packages/core/src/modules/llamacpp/index.ts`                                              | **Create.** Public surface re-exports.                                                                                                                                                                                                                   |
| `packages/core/src/modules/llamacpp/README.md`                                             | **Create.** Module doc in the repo's existing style (see `smart-cache/README.md`, `handoff/README.md`): the process lifecycle, why loopback, why one model per process.                                                                                  |
| `packages/core/src/config.ts`                                                              | **Modify.** `CompletionProvider` gains `'llamacpp'`; `AppConfig` gains `llamacppBaseUrl`, `llamacppModelPath`, `llamacppCtx`, `llamacppGpuLayers`.                                                                                                       |
| `packages/core/src/index.ts`                                                               | **Modify.** `createClient()` arm for `llamacpp`; export the `llamacpp` module.                                                                                                                                                                           |
| `packages/cli/src/providers.ts`                                                            | **Modify.** `llamacpp` entry with `deprecated?: boolean`; mark `ollama` deprecated.                                                                                                                                                                      |
| `packages/cli/src/server/server.ts`                                                        | **Modify.** `/api/models` probe, `/api/llamacpp/*` routes (status/install/start/stop/download/models), `LLAMACPP_BASE_URL` in base-var allowlist.                                                                                                        |
| `packages/cli/src/index.ts`                                                                | **Modify.** Own the `LlamaServerManager`, wire `createShutdownHandler`, add a synchronous `on('exit')` child kill, `mugil-ide llamacpp` subcommand.                                                                                                      |
| `packages/cli/src/shutdown.ts`                                                             | **Create.** `createShutdownHandler(deps)` — the ordered, deadline-bounded, idempotent "stop LLM → close server → close backend → exit" sequence. Pulled out of `index.ts` purely so it is unit-testable.                                                 |
| `packages/core/src/modules/handoff/models.ts`                                              | **Modify.** `fetchProviderModels()` must gain `'llamacpp'` in the existing `lmstudio`/`local`/`openai` OpenAI-compatible branch (`models.ts:194`) — otherwise it falls through every branch and returns `[]`.                                            |
| `packages/core/src/modules/handoff/unifiedWireClient.ts`                                   | **Modify.** `UnifiedProviderKind` + both `Record<Kind, …>` maps are exhaustive, so the new kind is a **compile error** until added — a cheap guard rail, not extra work.                                                                                 |
| `packages/cli/src/terminal/agentRepl.ts`                                                   | **Modify.** The terminal `/models` scan (`agentRepl.ts:627-656`) gains a `llamacpp` probe under the same "only if already running" rule as `/api/models`.                                                                                                |
| `packages/cli/src/server/html.ts`                                                          | **Modify.** "Built-in local AI" card in the welcome modal + Accounts modal; kill-server modal copy.                                                                                                                                                      |
| `packages/core/tests/llamacpp.test.ts`                                                     | **Create.** Hardware ranking, catalog recommendation, arg builder, pid-file reaping, download `.part` semantics (fake `fetch`).                                                                                                                          |
| `packages/cli/tests/llamacppServer.test.ts`                                                | **Create.** Route tests against a stubbed manager singleton.                                                                                                                                                                                             |
| `packages/cli/tests/shutdown.test.ts`                                                      | **Create.** Ordering / idempotency / deadline tests for `createShutdownHandler` — the Kill-Server contract, without HTTP or real processes.                                                                                                              |
| `llama-cpp.md` (this file), `README.md`, `ATTRIBUTIONS.md`, `CHANGELOG.md`, `.env.example` | **Modify.** Document flags, licenses (llama.cpp MIT; per-model licenses), deprecation notice.                                                                                                                                                            |

---

## Design Notes (read before Task 1)

**Where the bytes live.** Single app data dir, one helper for all of it:

```
~/.config/mugil-ide/            (already used by env.ts — override MUGIL_IDE_ENV_FILE)
├── .env
├── vendor/llama.cpp/b<BUILD>-cpu/.installed
├── vendor/llama.cpp/b<BUILD>-cpu/llama-b<BUILD>/llama-server[.exe]
├── vendor/llama.cpp/b<BUILD>-cpu/llama-b<BUILD>/libllama.so, libggml*.so, …
├── models/*.gguf              (override with MUGIL_IDE_MODELS_DIR)
└── llama-server.pid
```

**Pinned build.** `export const LLAMA_CPP_BUILD = 12451` (or newer at implementation time) in `binary.ts`, with an asset map per `process.platform`/`process.arch`. **Verified against the real release on 2026-11-17** — Linux/macOS ship **`.tar.gz`**, Windows ships **`.zip`**, and the tarball contains a single top-level directory (`llama-b<B>/`) holding `llama-server` _plus ~35 sibling `.so`/`.dylib` files_ (`libllama.so`, `libggml-cpu-*.so`, `libmtmd.so`, …). **Extract the whole directory, not just the binary** — copying `llama-server` alone produces `error while loading shared libraries`.

```
https://github.com/ggml-org/llama.cpp/releases/download/b<BUILD>/<asset>
```

Confirmed assets at `b12451` (size / sha256 from the release API — good enough to pin, and re-check at implementation time):

| Platform              | Asset                                          | Size    | sha256           |
| --------------------- | ---------------------------------------------- | ------- | ---------------- |
| linux x64             | `llama-b12451-bin-ubuntu-x64.tar.gz`           | 23.5 MB | `6604b91d…74cbf` |
| linux x64 + CUDA 12.8 | `llama-b12451-bin-ubuntu-cuda-12.8-x64.tar.gz` | 200 MB  | (fetch)          |
| linux arm64           | `llama-b12451-bin-ubuntu-arm64.tar.gz`         | 19.1 MB | (fetch)          |
| linux x64 Vulkan      | `llama-b12451-bin-ubuntu-vulkan-x64.tar.gz`    | 36.4 MB | (fetch)          |
| macOS arm64           | `llama-b12451-bin-macos-arm64.tar.gz`          | 17.0 MB | `a1141628…d936`  |
| macOS x64             | `llama-b12451-bin-macos-x64.tar.gz`            | 12.8 MB | (fetch)          |
| win x64 CPU           | `llama-b12451-bin-win-cpu-x64.zip`             | 25.2 MB | `4743c1ad…46e`   |
| win x64 CUDA 12.4     | `llama-b12451-bin-win-cuda-12.4-x64.zip`       | 320 MB  | (fetch)          |

There is **no Hugging Face mirror of the binaries** (the `ggml-org/llama.cpp` HF repo is not a public file host — it returns 401). Single source, so a GitHub outage means "already installed" or "use `LLAMA_SERVER_BIN`". State that in the error message instead of pretending a fallback exists.

**GPU builds are opt-in in v1.** The default asset per platform is the plain CPU build (small, always runs). The CUDA/Vulkan bundles are 5–10× larger and CUDA additionally needs a matching `cudart-*` bundle — automatic selection would mean a 200 MB+ download and a driver-version guess on behalf of a user who may not have an NVIDIA GPU at all. So: `probeHardware()` reports the GPU, the UI **says** "CPU build — a CUDA build would be ~5× faster", and `mugil-ide llamacpp install-binary --variant cuda` (or `LLAMACPP_VARIANT=cuda`) opts in. Apple Silicon is the exception: the single macOS arm64 asset already uses Metal, no variant needed.

`LLAMA_SERVER_BIN=/path/to/llama-server` short-circuits everything — the escape hatch for ROCm/SYCL/self-compiled builds. Honour it everywhere, including in tests.

**Port.** Prefer `LLAMACPP_PORT`, else scan `8080–8199` for a free port (`net.listen` probe, then close). Store the chosen port; `llamacppBaseUrl` becomes `http://127.0.0.1:<port>/v1`. (Note: the upstream default is 9931 — do not rely on it, we always pass `--port` explicitly.) If the manager is not running the provider is "not configured" and the models list is empty — never spawn implicitly from a `/api/models` probe.

**Health.** Poll `GET /health` every 250 ms up to `LLAMACPP_STARTUP_TIMEOUT_MS` (default 120 s — loading a 30 B model from spinning rust is slow). A naive `await spawn` races model loading.

Verified on `b12451` by actually running the binary (do this again if you bump the pin):

- `GET /health` → `{"status":"ok"}` (HTTP 200). `/v1/health` also answers — use `/health`, it is the documented one.
- Started **with `-m <model>`**, the server binds the port _after_ the model finishes loading, so `health == ready`. That is the invariant the supervisor relies on.
- Started **without `-m`**, this build enters **router mode**: it listens immediately, logs `security: router mode enabled`, and `GET /v1/models` returns `{"data":[],"object":"list"}`. Health would say "ok" with no model loaded. Consequence: **always pass `-m`**, and never treat health as model-readiness in a code path that might have skipped it.
- A missing/corrupt model makes the process exit with **code 1** and stderr ending in `error loading model` / `srv server_run_i: exiting due to model loading error`. So `start()` must race (a) health success, (b) child `exit`, (c) the timeout — whichever fires first — and surface `stderrTail` when it is the exit branch. Health alone will just poll until the timeout and hide the real reason.
- With no `--api-key`, the log warns `security: no API key is set and CORS allows all origins`. That is exactly why the bind is pinned to `127.0.0.1`: loopback is the security boundary here, not a key.

**Args.** Pure `buildServerArgs(opts)` so it is unit-testable. All flags below verified present in `llama-server --help` at `b12451`:

```
-m <modelPath> --host 127.0.0.1 --port <port> -c <ctx> -ngl <gpuLayers> -a mugil --jinja [-t <threads>]
```

(Everything is always passed except `-t`, which only appears when `LLAMACPP_THREADS` is set.)

- `-a mugil` (`--alias`) sets the model alias, so `/v1/models` reports `mugil` instead of an absolute file path — the UI then shows a readable name and the model picker has a stable id to send back.
- `--jinja` is **on by default** in this build (`--jinja, --no-jinja … default: enabled`) — pass it anyway, explicitly, because it is the flag that makes chat templates + tool calling work and a future default flip must not silently degrade us to plain text.
- `-ngl 999` on Metal/CUDA/Vulkan, `0` for CPU builds, `LLAMACPP_GPU_LAYERS` when set.
- `-t` is left at llama.cpp's own default (`-1` = auto) unless `LLAMACPP_THREADS` is set — hardcoding `os.cpus().length` oversubscribes on SMT and hurts more than it helps.
- Do **not** pass `--no-webui`: the flag has already been renamed once (`--no-ui` is the new alias), it saves a few MB of static assets we ignore anyway, and a renamed flag is a startup failure on the pinned build. Leave it out.
- Do **not** pass `--api-key`: the server is loopback-bound and the IDE's own session token gates the browser. A second secret would have to be persisted and rotated for no gain.
- Do **not** pass `--models-dir` / `--models-preset`: those enable upstream's multi-model "router mode", which is a different lifecycle (models loaded on demand, unloaded by upstream). Out of scope, and mixing it with our one-model-per-process supervisor would produce two owners of the same port.

**Kill semantics.** `llama-server` is spawned **not detached**, so it dies with us on SIGKILL of the parent in the common case. Belt and braces: `child.kill('SIGTERM')` → wait `LLAMACPP_STOP_GRACE_MS` (default 5 000) → `SIGKILL`; on Windows `taskkill /pid <pid> /T /F` (a plain `.kill()` leaves the process tree alive there). `process.on('exit')` does a synchronous `kill` because async is impossible there.

**Provider kind.** `'llamacpp'` is an OpenAI-compatible kind: `DEFAULT_BASE_URLS.llamacpp = 'http://127.0.0.1:8080/v1'`, `DEFAULT_ENV_VARS.llamacpp = ''`, treated as local (no key). `createClient()` returns `new OpenAiClient({ apiKey: 'llamacpp', baseUrl: config.llamacppBaseUrl })` — mirroring the Ollama arm exactly.

**Hardware → recommendation.** Rank catalog entries by `minRamGb` ≤ `availableRamGb` and a `quality` integer, choosing `Q4_K_M` as the default quant on CPU/unknown GPU and `Q5_K_M`/`Q6_K` when VRAM allows. Always present a "smallest that works" option first for the user who just wants it to run today.

**One job at a time.** A module-level in-flight flag guards binary installs and model downloads: a second `POST` while one is running returns `409 { error: 'already downloading <name>' }` rather than starting a competing 4 GB transfer. The UI disables the buttons, but the server is the authority.

**All the knobs, in one place** (document these in `.env.example` once, in Task 1):

| Var                           | Default                                | Meaning                                                     |
| ----------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| `AI_PROVIDER=llamacpp`        | —                                      | Select the built-in provider.                               |
| `LLAMACPP_BASE_URL`           | `http://127.0.0.1:8080/v1`             | Loopback only; set by the manager after `start`.            |
| `LLAMACPP_MODEL_PATH`         | —                                      | Model to load on `mugil-ide ui` without touching the UI.    |
| `LLAMACPP_CTX`                | `8192`                                 | `-c`.                                                       |
| `LLAMACPP_GPU_LAYERS`         | auto                                   | `-ngl`.                                                     |
| `LLAMACPP_THREADS`            | auto                                   | `-t`.                                                       |
| `LLAMACPP_PORT`               | scan 8080-8199                         | `--port`.                                                   |
| `LLAMACPP_VARIANT`            | `cpu` (`metal` implied on macOS arm64) | Which binary bundle to vendor: `cpu` \| `cuda` \| `vulkan`. |
| `LLAMA_SERVER_BIN`            | —                                      | Use this binary, download nothing.                          |
| `MUGIL_IDE_MODELS_DIR`        | `<appData>/models`                     | Where `.gguf` files live.                                   |
| `LLAMACPP_STARTUP_TIMEOUT_MS` | `120000`                               | Health-poll deadline.                                       |
| `LLAMACPP_STOP_GRACE_MS`      | `5000`                                 | SIGTERM → SIGKILL grace.                                    |

**WS progress is additive.** Reuse the existing websocket: `{ type: 'llamacpp_progress', phase: 'binary'|'model', percent, label }`. The HTML client must ignore unknown `type`s (it already switches on type), so an older open tab degrades to no progress bar — acceptable, no version handshake needed.

**Reuse map — do not rebuild these, they already exist:**

| Need                                  | Already there                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| App data dir + user `.env` read/write | `packages/core/src/env.ts` — `userEnvPath()`, `readUserEnv()`, `writeUserEnv()` (atomic, 0600)               |
| Persist the chosen provider           | `writeUserEnv({ AI_PROVIDER: 'llamacpp', ... })` in the `/api/keys` handler path                             |
| Broadcast progress to every tab       | `broadcastPayload(...)` — `server.ts:224`                                                                    |
| File picker UI                        | `GET /api/fs/browse` — `server.ts` (already used by the workspace dialog)                                    |
| HTML escaping                         | `escapeHtml()` in `html.ts`                                                                                  |
| Provider list/rows UI                 | `renderProviders()` in `html.ts`                                                                             |
| Local-model probing shape             | the Ollama/LM Studio blocks in `/api/models` (`server.ts:454-490`) — copy their shape                        |
| Key masking                           | `maskKey()` in `providers.ts`                                                                                |
| Deprecation flag rendering            | extend `ProviderDef` with `deprecated?: boolean`; nothing else                                               |
| Process kill on Windows               | the existing `ptyManager` already deals with Windows process-tree teardown — read it before writing your own |

Nothing model-shaped ever enters the repo: the vendor dir and `models/` both live under `~/.config/mugil-ide/`, outside the workspace, and `.gitignore` already has `vendor/` as a second net. If you find yourself adding `*.gguf` to `.gitignore`, something went wrong upstream in this design.

## Sequencing

Tasks 1–5 are independent enough to run in parallel (different files, no shared symbol beyond `HardwareProfile`). Do 1 → (2, 3, 4 in parallel) → 5 → 6 → 7 → 8 → 9 → 10 → 11. Task 8 depends on 5+6+7; Task 9 depends on 8's routes existing; Task 11 depends on everything.

Rough sizing (folklore, not a promise): 1 small, 2 tiny, 3 medium (data entry + checksums), 4 medium, 5 medium, 6 **largest** (lifecycle edge cases), 7 small, 8 medium, 9 medium, 10 small, 11 manual. If you only have time for the spine, do **1, 4, 5, 6, 8, 11-minimum** — a hand-placed `.gguf` plus `LLAMA_SERVER_BIN` still delivers "local model, killed by one button", and the catalog/UI can follow.

---

## Task 1: Provider kind + config plumbing (no process, no download)

**Files:**

- Create: `packages/core/src/modules/llamacpp/paths.ts` (tiny — every later task needs `appDataDir()`, so it lands first)
- Modify: `packages/core/src/config.ts`, `packages/core/src/index.ts`, `packages/core/src/modules/handoff/models.ts`, `packages/core/src/modules/handoff/unifiedWireClient.ts`, `packages/cli/src/providers.ts`, `.env.example`
- Test: `packages/core/tests/llamacpp.test.ts` (new, starts with config + paths cases)

**Interfaces:**

- Produces: `CompletionProvider` includes `'llamacpp'`; `AppConfig.llamacppBaseUrl: string` (default `http://127.0.0.1:8080/v1`), `llamacppModelPath?: string`, `llamacppCtx: number` (default `8192`), `llamacppGpuLayers?: number`.
- Produces: `PROVIDERS` entry `{ id: 'llamacpp', label: 'Built-in llama.cpp (vendored, nothing to install)', keyVar: 'LLAMACPP_BASE_URL', url: 'http://127.0.0.1:8080/v1', custom: true }`.
- Produces: `ProviderDef` gains an optional `deprecated?: boolean` (rendered in Task 10; declaring it now keeps `providers.ts` a one-pass edit).

**Steps:**

- [ ] Add `'llamacpp'` to `CompletionProvider` and the `AI_PROVIDER` resolution chain in `loadConfig()` (the ternary ladder at `config.ts:640`) — `llamacpp` first after `ollama` so the file stays readable.
- [ ] Add the four `AppConfig` fields to the return object at `config.ts:728` next to `ollamaBaseUrl`/`lmstudioBaseUrl`, parsing `Number(merged.LLAMACPP_CTX)` with an `Number.isFinite` fallback (same pattern as `tokenBudget`). A `NaN` ctx must never reach `llama-server`.
- [ ] `createClient()` (`core/src/index.ts:490`): add the `llamacpp` arm beside the Ollama one.
- [ ] `fetchProviderModels()`: extend the `provider === 'lmstudio' || provider === 'local' || provider === 'openai'` condition at `models.ts:194` with `|| provider === 'llamacpp'`.
- [ ] `unifiedWireClient.ts`: add `'llamacpp'` to `UnifiedProviderKind`, `DEFAULT_BASE_URLS`, `DEFAULT_ENV_VARS` (the compiler will tell you when you miss one).
- [ ] `packages/cli/src/index.ts`: the `logout`/`keys` argument lists (`index.ts:160` arg description, `index.ts:167-168` var map) are hand-written allowlists — add `llamacpp` / `LLAMACPP_BASE_URL` or the new provider will be invisible to those commands.
- [ ] `.env.example`: document the knobs table from Design Notes next to `OLLAMA_BASE_URL`/`LMSTUDIO_BASE_URL`.
- [ ] `paths.ts`: `appDataDir()` = `dirname(userEnvPath())` (so `MUGIL_IDE_ENV_FILE` moves everything together), `modelsDir()` = `MUGIL_IDE_MODELS_DIR || join(appDataDir(), 'models')`, `vendorRoot()`/`vendorDir(build, variant)`, `pidFile()`. Create dirs lazily (`mkdirSync(..., { recursive: true, mode: 0o700 })`) at first write, not at import — importing config must not touch the disk.
- [ ] Test: `AI_PROVIDER=llamacpp` → provider `llamacpp` + default base URL; `LLAMACPP_CTX=4096` → `4096`; `LLAMACPP_CTX=abc` → `8192`; `fetchProviderModels({provider:'llamacpp'})` against a fake `/v1/models` returns the parsed spec; `MUGIL_IDE_ENV_FILE=/tmp/x/.env` → `modelsDir()` starts with `/tmp/x`; `MUGIL_IDE_MODELS_DIR=/m` wins over it.

**Verify:** `npm run typecheck && npm test -w @mugil-ide/core -- llamacpp`.

---

## Task 2: Hardware profile

**Files:** Create `packages/core/src/modules/llamacpp/hardware.ts`. Test in `packages/core/tests/llamacpp.test.ts`.

**Interfaces:**

```ts
export interface HardwareProfile {
  platform: NodeJS.Platform;
  arch: string;
  totalRamGb: number;
  availableRamGb: number; // totalRamGb * 0.6 when we cannot know better
  cpuCores: number;
  gpu: 'metal' | 'cuda' | 'cpu'; // 'vulkan' is opt-in via LLAMACPP_VARIANT only
  vramGb?: number; // only when confidently detected
}
export function probeHardware(overrides?: Partial<HardwareProfile>): Promise<HardwareProfile>;
```

- [ ] RAM from `os.totalmem()`, cores from `os.cpus().length`, rounded DOWN to 0.1 GB.
- [ ] `darwin` + `arm64` → `metal`. Otherwise look for `nvidia-smi` on `PATH` (probe via `execFile('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'])` with a 1 500 ms timeout); parse → `cuda` + `vramGb`. Not found / throws / times out → `cpu`. Never let a missing binary reject.
- [ ] Do not attempt AMD/Intel GPU detection in v1 — there is no portable, dependency-free way to do it reliably, and a wrong guess costs the user a 200 MB download. `LLAMACPP_VARIANT=vulkan` is the manual escape hatch and the UI hint says so.
- [ ] `overrides` parameter exists so tests and `/api/llamacpp/status` can be deterministic. **No test shells out.**
- [ ] Test: `darwin`+`arm64` → metal; failed `nvidia-smi` degrades to cpu without throwing; rounding never rounds up (a 7.9 GB box must not be offered a model needing 8 GB).

---

## Task 3: Curated catalog + recommendation

**Files:** Create `packages/core/src/modules/llamacpp/catalog.ts`. Test in `packages/core/tests/llamacpp.test.ts`.

**Interfaces:**

```ts
export interface CatalogModel {
  id: string; // stable slug, e.g. 'qwen2.5-coder-7b-instruct-q4km'
  label: string; // 'Qwen2.5 Coder 7B Instruct (Q4_K_M)'
  hfRepo: string; // 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF'
  hfFile: string; // 'qwen2.5-coder-7b-instruct-q4_k_m.gguf'
  sizeBytes: number;
  minRamGb: number;
  quant: string; // 'Q4_K_M'
  paramsB: number;
  quality: number; // 1..10, tie-break only
  minLlamaBuild: number; // e.g. b4000 — refuse older pinned builds
  license: string; // 'apache-2.0' | 'llama3.1' | ...
  contextWindow: number;
  supportsTools: boolean;
  sha256?: string;
}
export const MODEL_CATALOG: CatalogModel[];
export function recommendModels(
  profile: HardwareProfile,
  opts?: { limit?: number },
): CatalogModel[];
export function catalogEntry(id: string): CatalogModel | undefined;
```

- [ ] **Seed the ladder with these verified entries** (repo / file / size / sha256 pulled from the HF API on 2026-11-17 — no guessing; verify once more at implementation time and note any drift in the commit message):

  | id                            | label                            | hfRepo                                      | hfFile                                     | bytes       | ≈GB   | minRamGb | quant  | paramsB        | quality | tools |
  | ----------------------------- | -------------------------------- | ------------------------------------------- | ------------------------------------------ | ----------- | ----- | -------- | ------ | -------------- | ------- | ----- |
  | `qwen2.5-coder-1.5b-q4km`     | Qwen2.5 Coder 1.5B (Q4_K_M)      | `unsloth/Qwen2.5-Coder-1.5B-Instruct-GGUF`  | `Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf`  | 986048032   | 0.92  | 3        | Q4_K_M | 1.5            | 3       | ✅    |
  | `qwen3-4b-instruct-2507-q4km` | Qwen3 4B Instruct 2507 (Q4_K_M)  | `unsloth/Qwen3-4B-Instruct-2507-GGUF`       | `Qwen3-4B-Instruct-2507-Q4_K_M.gguf`       | 2497281120  | 2.33  | 6        | Q4_K_M | 4              | 5       | ✅    |
  | `qwen2.5-coder-7b-q4km`       | Qwen2.5 Coder 7B (Q4_K_M)        | `unsloth/Qwen2.5-Coder-7B-Instruct-GGUF`    | `Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf`    | 4683073504  | 4.36  | 8        | Q4_K_M | 7              | 7       | ✅    |
  | `qwen2.5-coder-7b-q5km`       | Qwen2.5 Coder 7B (Q5_K_M)        | `unsloth/Qwen2.5-Coder-7B-Instruct-GGUF`    | `Qwen2.5-Coder-7B-Instruct-Q5_K_M.gguf`    | 5444831200  | 5.07  | 10       | Q5_K_M | 7              | 8       | ✅    |
  | `gemma3-12b-q4km`             | Gemma 3 12B (Q4_K_M)             | `ggml-org/gemma-3-12b-it-GGUF`              | `gemma-3-12b-it-Q4_K_M.gguf`               | 7300574976  | 6.80  | 12       | Q4_K_M | 12             | 8       | ❌    |
  | `qwen3-coder-30b-a3b-q4km`    | Qwen3 Coder 30B-A3B MoE (Q4_K_M) | `unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF` | `Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf` | 18556689568 | 17.28 | 24       | Q4_K_M | 30 (3B active) | 10      | ✅    |

  Pinned sha256 (the HF LFS oid, which equals the file's sha256 — confirmed via the `x-linked-etag` header):
  `5ecd6f45e137154099741291848db7415b5effa1ae69228f20dacea31dbf5ce4` (1.5B),
  `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597` (Qwen3 4B),
  `9a961bb225cb2b9fd84b2297df0d53089895c049d7d9dc5f5f8aebbcd3247872` (7B Q4),
  `8a025f8bae85617ac95209d9211cbfb2a7142b129a201fa2c2c140ed34661113` (7B Q5),
  `7bb69bff3f48a7b642355d64a90e481182a7794707b3133890646b1efa778ff5` (Gemma 12B),
  `fadc3e5f8d42bf7e894a785b05082e47daee4df26680389817e2093056f088ad` (30B MoE).

- [ ] `minRamGb` above is `ceil(≈GB) + 4` (weights + KV cache + a browser + a Node process) — do not copy the file size into it. Alias `unsloth/…` over `Qwen/…` (the official repos split into `-00001-of-0000N` shards for some quants, which would drag shard-joining into v1).
- [ ] `supportsTools: false` for Gemma (no native tool-calling template). Keep it for ladder variety, but the picker must show "no tool calling" so nobody blames the agent loop. Anything `supportsTools: false` still works for plain chat.
- [ ] URL helper: `downloadUrl(m) => https://huggingface.co/${m.hfRepo}/resolve/main/${m.hfFile}?download=true`. A HEAD returns `302 → CDN` with `x-linked-etag` equal to the sha256 — that is why the checksums above are trustworthy; the downloader must follow redirects (default `fetch` behaviour) and compute the hash itself.
- [ ] `isGated(m)` for licences that require HF auth; the UI then asks for a token and passes it as an `Authorization` header, and the token is never persisted. Gemma carries Google's terms — surface a one-line licence note in the picker.
- [ ] `recommendModels()`: filter `minRamGb <= profile.availableRamGb`, sort by `quality` desc, always append the single smallest entry so a low-RAM box is never left with an empty list. VRAM, when known, may promote a larger model but must never exclude a RAM-fitting one.
- [ ] Test: an 8 GB profile never gets the 12 B or 30 B; a 3 GB profile still gets exactly one model; entries are internally consistent (`sizeBytes > 0`, `minRamGb * 1e9 > sizeBytes`, `minLlamaBuild <= LLAMA_CPP_BUILD`, ids unique).

---

## Task 4: Downloader (shared by binary + weights)

**Files:** Create `packages/core/src/modules/llamacpp/download.ts`. Test in `packages/core/tests/llamacpp.test.ts` with a stubbed `fetch`.

**Interfaces:**

```ts
export interface DownloadOptions {
  url: string;
  dest: string;
  sha256?: string;
  headers?: Record<string, string>; // HF token for gated repos
  signal?: AbortSignal;
  onProgress?: (p: { received: number; total?: number; percent?: number }) => void;
}
export async function downloadFile(opts: DownloadOptions): Promise<{ path: string; bytes: number }>;
export async function hasFreeSpace(dir: string, neededBytes: number): Promise<boolean>;
```

- [ ] Stream `res.body` to `dest + '.part'` (`fs.createWriteStream` or an async iterator + `appendFile`); `onProgress` throttled to ~4 Hz so a WS client is not flooded.
- [ ] Verify sha256 while streaming (incremental `createHash`) → mismatch deletes the `.part` and throws with expected/actual (truncated hex in the message).
- [ ] `rename(dest + '.part', dest)` only after verification. `AbortError` → delete `.part`, rethrow. Non-2xx → include status + first 200 chars of body.
- [ ] Pre-flight free space with `statfs`; `ENOSPC` mid-download must also clean up.
- [ ] Test: happy path writes and renames; bad checksum leaves no file; abort leaves no `.part`; `onProgress` called with monotonically increasing `received`.

---

## Task 5: Binary installer (the "vendored" part)

**Files:** Create `packages/core/src/modules/llamacpp/binary.ts`. Test in `packages/core/tests/llamacpp.test.ts`.

**Interfaces:**

```ts
export const LLAMA_CPP_BUILD = 12451; // bump deliberately, never "latest"
export function vendorDir(variant?: BinaryVariant): string; // <appData>/vendor/llama.cpp/b<BUILD>-<variant>
export function binaryPath(): string; // <vendorDir>/llama-b<BUILD>/llama-server[.exe]
export function isInstalled(): boolean; // bin exists + executable + .installed marker
export type BinaryVariant = 'cpu' | 'cuda' | 'vulkan';
export async function ensureLlamaServerBinary(opts?: {
  variant?: BinaryVariant; // default LLAMACPP_VARIANT || 'cpu' (macOS arm64: metal, single asset)
  onProgress?: (p: { phase: 'download' | 'extract'; percent?: number }) => void;
  signal?: AbortSignal;
}): Promise<string>; // returns absolute binary path
```

- [ ] `LLAMA_SERVER_BIN` env short-circuits: validate it exists and is executable, return it, download nothing. This is also the test seam.
- [ ] Asset map keyed by `platform-arch-variant` (`linux-x64-cpu`, `linux-x64-cuda`, `linux-x64-vulkan`, `darwin-arm64` (metal, no variant), `darwin-x64`, `win32-x64-cpu|cuda|vulkan`), using the names confirmed in Design Notes: `.tar.gz` on Linux/macOS, `.zip` on Windows. Throw a _specific, actionable_ error for unsupported combos naming `LLAMA_SERVER_BIN`.
- [ ] Vendor dir includes the variant (`.../b<BUILD>-<variant>/`) so switching CPU↔CUDA does not silently reuse the other build. `.installed` records build+variant.
- [ ] **Extraction, no dependency:** shell out to the system `tar` — `execFile('tar', ['-xzf', archive, '-C', vendorDir()])` on Linux/macOS, and on Windows `tar -xf <zip> -C <dir>` (Windows 10 1809+ bundles bsdtar, which reads zip). One code path, zero npm deps, and it preserves the ~35 sibling `.so`/`.dylib` files. Assert the extracted `llama-server` exists after the call; if `tar` is missing (rare minimal containers), fail with "install tar or set LLAMA_SERVER_BIN".
- [ ] **Extract the whole release directory**, then `chmod 0o755` on the binary and every sibling `.so`/`.dylib`/`.dll`. A binary copied without its libs fails with `error while loading shared libraries` — call this out in a code comment so nobody "optimises" it later.
- [ ] Delete the downloaded archive after successful extraction (23–320 MB of dead weight otherwise).
- [ ] Write `.installed` (containing the build number) only after extraction + chmod succeed. `isInstalled()` requires both the binary and the marker, so an interrupted install re-downloads instead of running a broken binary.
- [ ] Test: env override path returned verbatim; unsupported platform throws with the override hint; extraction failure leaves no `.installed` marker and a retry re-downloads.

---

## Task 6: Supervisor — `LlamaServerManager`

**Files:** Create: `hardware.ts` dep, `server.ts`. Test in `packages/core/tests/llamacpp.test.ts` (fake spawn; **no real process**).

**Interfaces:**

```ts
export interface LlamaStartOptions {
  modelPath: string;
  ctx?: number; // default 8192 (config.llamacppCtx)
  gpuLayers?: number; // default: 999 on metal/cuda/vulkan builds, else 0
  port?: number; // default: scan 8080-8199
  threads?: number; // default: unset → llama.cpp auto (-1)
  alias?: string; // default 'mugil' → shows up in /v1/models
  binaryPath?: string;
}
export interface LlamaStatus {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  port?: number;
  baseUrl?: string;
  modelPath?: string;
  pid?: number;
  startedAt?: number;
  lastError?: string;
  stderrTail: string[]; // last 20 lines
}
export class LlamaServerManager {
  constructor(opts?: { spawnFn?: SpawnLike; binaryResolver?: () => Promise<string> });
  static instance(): LlamaServerManager; // process-wide singleton
  status(): LlamaStatus;
  start(opts: LlamaStartOptions): Promise<LlamaStatus>;
  stop(): Promise<void>;
  killSync(): void; // synchronous SIGKILL, for process.on('exit') only
  restart(opts: LlamaStartOptions): Promise<LlamaStatus>;
  onStateChange(cb: (s: LlamaStatus) => void): () => void;
}
export function buildServerArgs(o: LlamaStartOptions & { port: number }): string[];
export async function pickPort(preferred?: number): Promise<number>;
export async function reapStaleProcess(): Promise<void>;
```

- [ ] `spawnFn`/`binaryResolver` injection so tests never touch the disk or fork.
- [ ] `start()`: if already running with the same model+flags → return status (idempotent). If running with different flags → `stop()` then start.
- [ ] Missing model file → `state:'error'`, `lastError: 'model file not found: <path>'`, no spawn attempt.
- [ ] Bind failure / immediate exit → capture `stderrTail` last 20 lines into `lastError` **without** the full log (a token budget applies to error strings too).
- [ ] `start()` races three promises: health-ok, child-exit, timeout (`LLAMACPP_STARTUP_TIMEOUT_MS`). Exit → reject with the stderr tail (the real cause, e.g. `error loading model`). Timeout → kill the child, report `'error'` with the tail, never leave a zombie. Health-only polling hides both failures behind a 120 s wait — do not do that.
- [ ] Write `llama-server.pid` on spawn, unlink on exit. `reapStaleProcess()` at boot: read the pid file; if a live `llama-server` still owns it, SIGTERM it; if the pid is dead, just unlink. **Never kill a pid you did not spawn unless the cmdline matches `llama-server`** (`/proc/<pid>/cmdline` on Linux; `ps -p <pid> -o command=` elsewhere) — a recycled pid must not get shot.
- [ ] `stop()`: SIGTERM → grace → SIGKILL (taskkill `/T /F` on Windows) → unlink pid file → state `'stopped'`. Idempotent, `await stop()` twice is safe, and a stop during `'starting'` cancels the health poll.
- [ ] Test: arg builder covers default/cpu/gpu-layers/ctx/alias; double `start` spawns once; **child exits during startup → `'error'` with the stderr tail and no 120 s wait**; health never ok → timeout path kills the child; `stop()` on a stopped manager is a no-op; `reapStaleProcess()` with a bogus pid unlinks without killing; a pid whose cmdline is _not_ `llama-server` is left alone.

---

## Task 7: Model store + `llamacpp` CLI command

**Files:** Create `packages/core/src/modules/llamacpp/models.ts`; modify `packages/cli/src/index.ts` (`logout`-style small command).

**Interfaces:**

```ts
export { modelsDir } from './paths.js'; // MUGIL_IDE_MODELS_DIR || <appData>/models
export async function listInstalledModels(): Promise<
  Array<{ file: string; path: string; sizeBytes: number }>
>;
export async function deleteInstalledModel(file: string): Promise<void>; // refuses paths outside modelsDir()
```

- [ ] CLI: `mugil-ide llamacpp status | install-binary | list | pull <catalogId> | start <file|id> | stop | rm <file>`. Thin wrappers over the manager/installer; `pull` prints a percent line, `start` prints the base URL and then does **not** exit until Ctrl+C (Ctrl+C stops both), `--json` on `status`/`list` for scripting.
- [ ] `deleteInstalledModel` resolves and asserts the path stays inside `modelsDir()` (path-traversal guard, same spirit as the existing fs routes).
- [ ] Test: `modelsDir()` honours the env override; `deleteInstalledModel('../.ssh/id_rsa')` throws.

---

## Task 8: Server routes + Kill Server integration (**the acceptance criterion**)

**Files:** Modify `packages/cli/src/server/server.ts`, `packages/cli/src/index.ts`.

**Routes (all behind the existing session-token + Origin gate — no new auth):**

| Route                               | Behaviour                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/llamacpp/status`          | `{ status, hardware, binaryInstalled, models: [...] }`                                                                                                                          |
| `POST /api/llamacpp/install-binary` | Kick off `ensureLlamaServerBinary()`; progress over the existing WS as `{type:'llamacpp_progress', phase, percent}`. 409 if already installed.                                  |
| `POST /api/llamacpp/download`       | `{ catalogId }` → sha256-checked download into `modelsDir()`, progress over WS. Rejects unknown ids. Rejects when free space is short.                                          |
| `POST /api/llamacpp/start`          | `{ file }` (or catalogId) → `start()`, then `engine.config.provider='llamacpp'`, `llamacppBaseUrl=status.baseUrl`, persist via `writeUserEnv`, `engine.reconfigure()`.          |
| `POST /api/llamacpp/stop`           | `stop()`; restore the provider that was active before `start` (kept in a module-level `previousProvider` variable — first-run fallback is `mock`), persist it, `reconfigure()`. |

- [ ] Progress goes out on the helper that already exists: `broadcastPayload(JSON.stringify({ type: 'llamacpp_progress', ... }))` (`server.ts:224`). Do not open a second socket or an SSE stream for this.
- [ ] `/api/models`: add a probe next to the Ollama/LM Studio ones — but **only if the manager is already running** (`LlamaServerManager.instance().status().state === 'running'`), else emit `{isLocal: true, models: []}`. No implicit spawn from a models list.
- [ ] `ALLOWED_BASE_VARS`: add `'LLAMACPP_BASE_URL'`; `engine.config.llamacppBaseUrl` assignment in the `/api/keys` handler. **Do not** add a `DOMAIN_MAP` entry — `isValidProviderBaseUrl()` already returns `true` for any loopback host before consulting the map, so a non-loopback `LLAMACPP_BASE_URL` is rejected for free. Add a test pinning that.
- [ ] `packages/cli/src/index.ts`: construct the manager (lazy singleton), `await reapStaleProcess()` at startup, and extend the existing `shutdown()` through a **testable seam**, not inline (inline is untestable without HTTP and `process.exit`):
  ```ts
  // packages/cli/src/shutdown.ts (new, small)
  export interface ShutdownDeps {
    stopLlama: () => Promise<unknown>;
    closeServer: () => Promise<unknown>;
    closeBackend: () => Promise<unknown>;
    exit?: (code: number) => void;
    graceMs?: number;
  }
  export function createShutdownHandler(deps: ShutdownDeps): () => Promise<void>;
  ```
  `createShutdownHandler` awaits `stopLlama()` first (deadline-bounded), then `closeServer()`, then `closeBackend()`, then `exit(0)`; each step is individually try/caught and the whole thing is idempotent (a second call is a no-op). `launchUi` wires it: `createShutdownHandler({ stopLlama: () => llama.stop(), closeServer: () => server.close(), closeBackend: () => engine.backend.close(), exit: process.exit })` and passes it as `onShutdown`.
  Kill the LLM **before** closing the HTTP server so the UI sees one coherent shutdown, and never let a stuck child block the exit — that is the whole point of the deadline.
- [ ] SIGINT/SIGTERM handlers **already exist** (`packages/cli/src/index.ts:345-346`) and call `shutdown()` — do not add duplicates; they inherit the LLM shutdown for free. Add only `process.on('exit')` for a synchronous best-effort child kill (async is impossible there): `llama.killSync()`.
- [ ] Tests (no real spawn, no HTTP):
  - `createShutdownHandler` calls the three closes **in order** `stopLlama → closeServer → closeBackend` and then `exit(0)` (record call order in an array).
  - A `stopLlama` that rejects still reaches `closeServer`; a hanging `stopLlama` is abandoned after `graceMs` and shutdown completes.
  - Two concurrent calls still close each thing once.
  - Route level: stub the manager singleton; `POST /api/llamacpp/start` with an unknown file → 400, with a valid one → 200 and `engine.config.provider === 'llamacpp'`.

---

## Task 9: UI — the local-AI card, progress, and honest copy

**Files:** Modify `packages/cli/src/server/html.ts`.

- [ ] Welcome modal, "Local AI" box: new top card **"📦 Built-in model (llama.cpp — nothing to install)"** above the Ollama/LM Studio buttons, with: hardware line ("12 GB RAM · 8 cores · CPU"), a recommended-models `<select>` (from `/api/llamacpp/status`), a Download button showing percent, then a Start button. One primary action at a time; disable the rest while a download runs.
- [ ] "Use a file on disk…" link under the model `<select>` → the existing `/api/fs/browse` modal → `POST /api/llamacpp/start { file }` with the chosen absolute path. This is the "point at your own model" path; it needs no catalog entry and no download.
- [ ] Accounts & Keys modal: a `llamacpp` provider row whose "Connect" opens the same card; status pill shows `🟢 Running · <model> · :8080` when live, `⚪ No model loaded` otherwise, plus a Stop button.
- [ ] Ollama button: badge **"deprecated — will be removed in a future version"** (muted, not scary), tooltip "Prefer the built-in option above; Ollama keeps working for now."
- [ ] Kill Server modal copy — this is the user-visible promise:
  > This stops **the Mugil IDE server and its local model server** (llama.cpp). … The shell terminal and any running agent turn are terminated.
- [ ] Server-stopped overlay: "The Mugil IDE backend and the local llama.cpp server have exited."
- [ ] Accessibility: `role="progressbar"` + `aria-valuenow` on the download bar, `aria-live="polite"` on the status line, focus moves to the download button when the card opens. No colour-only state (that is why the pills keep ☑/⚪ glyphs and text).
- [ ] Keep the HTML builder's existing escaping helpers; any model label/user filename interpolated into innerHTML goes through `escapeHtml()`.

---

## Task 10: Deprecation of Ollama (start the clock, don't break it)

- [ ] `PROVIDERS` entry for `ollama` gains `deprecated: true`; `renderProviders()` and the welcome card render the badge from that flag (no hardcoded strings).
- [ ] One-time console notice on startup when `provider === 'ollama'`: `Ollama support is deprecated and will be removed in a future release. Try the built-in llama.cpp option: mugil-ide llamacpp start`. **Once per process**, not per request.
- [ ] `README.md`: a "Local models" section — built-in llama.cpp first, Ollama/LM Studio marked legacy. `ATTRIBUTIONS.md`: llama.cpp (MIT) + each catalog model's license, and a line stating we ship no weights.
- [ ] `CHANGELOG.md`: `### Added` built-in llama.cpp; `### Deprecated` Ollama.
- [ ] Sunset runway (documented, not implemented — YAGNI until the date): v0.5 deprecation warnings, v0.6 removal of the `ollama` provider arm, the two probe blocks, and `DEFAULT_OLLAMA_MODELS`. Note that `providerClients.test.ts` / `unifiedWireClient.test.ts` / `providerClients` fixtures referencing `ollama` are the deletion checklist.

---

## Task 11: End-to-end verification (manual, documented in the PR body)

Only after 1–10 are green:

- [ ] `npm run typecheck && npm test && npm run lint` clean.
- [ ] Linux x64, cold cache: welcome → Built-in card → download smallest model → start → ask a question in the IDE → answer streams. Repeat with tool calling ("read package.json and tell me the version").
- [ ] Click **Kill Server** → `pgrep -af llama-server` returns nothing and `lsof -i :<port>` is empty. **This is the pass/fail gate.**
- [ ] Ctrl+C in the launching terminal → same, no orphans.
- [ ] Kill the IDE with `kill -9` → next launch's `reapStaleProcess()` kills the leftover `llama-server`.
- [ ] `LLAMA_SERVER_BIN=/usr/local/bin/llama-server` → nothing downloaded, server starts from the override.
- [ ] `AI_PROVIDER=openrouter` → zero llamacpp work at startup, no port scan, no probe.
- [ ] Point at a user-provided `.gguf` from the model picker ("Use a file on disk") → starts.
- [ ] Note the macOS/Windows verification gaps explicitly in the PR if you cannot test them; do not claim them green.

---

## Risks & Mitigations

| Risk                                                       | Mitigation                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release asset names move between builds                    | Pin `LLAMA_CPP_BUILD`; `LLAMA_SERVER_BIN` override; a unit test asserting the platform map has an entry for `linux-x64`, `darwin-arm64`, `win32-x64`, and a clear error message otherwise.                    |
| 4 GB download on a user's metered connection               | Explicit click; size + licence + quant shown before download; cancel button wired to `AbortSignal`; byte-range resume explicitly deferred (v1 restarts from zero) and stated in the UI copy.                  |
| Model too large → OOM mid-conversation                     | `minRamGb` gate + a warning badge in the picker; `lastError` surfaces llama.cpp's own `failed to allocate` line from `stderrTail`.                                                                            |
| Orphaned `llama-server`                                    | Four-layer cleanup in Task 6 + the `kill -9` verification in Task 11.                                                                                                                                         |
| Archive extraction drags in a dependency                   | Settled: system `tar` (GNU tar on Linux, bsdtar on macOS, bundled bsdtar on Windows 10 1809+). One code path for `.tar.gz` and `.zip`, zero npm deps. Missing-`tar` machines fall back to `LLAMA_SERVER_BIN`. |
| Binary copied without its ~35 sibling libs                 | Extract the whole release directory and only then resolve the path; a test asserts `isInstalled()` is false when the marker is missing, so a half-copy can never be launched.                                 |
| The plan's pinned build/sha256 drift before implementation | Re-query the release API at implementation time; the checksums here were read on 2026-11-17 and are a starting point, not gospel. Any change goes in the commit message.                                      |
| We ship a model whose licence we did not read              | `CatalogModel.license` is required and rendered in the picker; `ATTRIBUTIONS.md` lists each one; Gemma is flagged for its Google terms.                                                                       |
| Loopback binding bypassed                                  | `127.0.0.1` hardcoded in the arg builder; `isValidProviderBaseUrl` rejects non-loopback for `LLAMACPP_BASE_URL`; both asserted in tests.                                                                      |
| Gated HF models                                            | `isGated()` → UI asks for a token; token is passed to `downloadFile` as a header and never logged or persisted in the model entry.                                                                            |
| We accidentally sunset Ollama too early                    | Removal is deferred to v0.6 and gated on the documented checklist; only warnings ship now.                                                                                                                    |

## Decisions I made for you (flip any of these and the plan shifts)

The brief left these open; each is a fork in the road, so they are stated rather than buried:

1. **"Vendored" = fetched once into the app's data dir, not shipped in the npm tarball.** Shipping a binary or weights would mean a 300 MB–4 GB publish per platform, and npm tarballs are the wrong distribution channel for that. If you actually want it inside the package, say so — it changes packaging, CI, and the `files` field, and it makes every release enormous.
2. **`llama-server`, not a custom llama.cpp binding.** It is a prebuilt binary that already speaks the OpenAI wire format, so it reuses every line of the existing provider/streaming/tool-calling stack. A `node-ffi`/N-API binding would be a C++ build system we explicitly ruled out.
3. **CPU binary by default; GPU builds opt-in** (`LLAMACPP_VARIANT`). Automatic CUDA download for a user who may not have an NVIDIA GPU is a worse first-run than a slower one that works.
4. **Curated catalog (6 entries) instead of a live Hugging Face search.** A search UI needs ranking, gating, quant picking, and shard handling — a product in itself. Six verified entries with checksums covers the ladder from 3 GB to 24 GB RAM.
5. **One model per process, no hot-swap.** Restarting `llama-server` to switch models is a 2–20 s wait; hot-swap is a whole feature with its own lifecycle bugs.
6. **Ollama deprecation is warnings-only in this release.** Actual removal is v0.6 with a documented checklist, because removing it in the same version that introduces the replacement leaves users with no working local path if llama.cpp misbehaves on their machine.

## Self-Review

- **Requirement coverage:** point-at-a-file ✓ (Tasks 6/8: `POST /api/llamacpp/start { file }`, picker "use a file on disk"); download links for the user's hardware ✓ (Tasks 2/3/9); runs alongside our app server ✓ (Task 6/8); kill both with the existing button ✓ (Task 8 call-order test + Task 11 gate); sunset Ollama later ✓ (Task 10).
- **Reuse over rewrite:** `llama-server` is OpenAI-compatible, so the provider is a base URL plus one `createClient()` arm — no new wire client, no new streaming code, no new model-fetch code.
- **Type consistency:** `CompletionProvider` gains `'llamacpp'` once (Task 1) and every later task consumes it unchanged; `LlamaStatus`/`HardwareProfile`/`CatalogModel` are defined once and referenced by the routes and the HTML.
- **Deferred on purpose:** multi-model serving, model hot-swap, ROCm/SYCL builds, embeddings on llama.cpp, and the actual Ollama removal — all listed as non-goals or dated follow-ups rather than half-built.

## Start here

```bash
# Task 1 first — it is the only task every other one imports.
npm run typecheck          # baseline: must be green before you touch anything
```

Then Task 2, 3, 4 can go in parallel; Task 5 after 4; Task 6 is the long one; 7 → 8 → 9 → 10 → 11 in order. Commit per task. If you get stuck on the pinned build, stop and re-read the "Health" and "Pinned build" notes — they contain the only facts in this plan that were verified by running the real binary, and everything else depends on them.
