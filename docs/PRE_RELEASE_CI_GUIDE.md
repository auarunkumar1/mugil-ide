# Pre-Release Checklist & GitHub Actions CI Lessons Learned

This document records the architectural root causes, operational lessons, and mandatory verification steps established during the **v0.1.22** release — specifically addressing GitHub Actions CI test hangs and runner stalls.

---

## 🛑 Lessons Learned: Why CI Unittests Hung Past 1 Hour

### 1. HTTP Keep-Alive Socket Leakage in Node 20 & 22
- **The Issue**: In Node.js 18+ (including Node 20 and 22 runtimes used in CI), the HTTP client (`fetch` / `http.Agent`) and server reuse sockets via HTTP Keep-Alive by default.
- **The Failure Mode**: Calling standard `httpServer.close()` only instructs Node to stop accepting *new* connections; existing idle keep-alive sockets remain open until their timeout expires (or indefinitely if kept alive by active agent polling).
- **The Symptom**: Jest finished running all assertions, but the Node event loop never exited because open socket handles remained active. GitHub Actions runners waited indefinitely for the process to exit, running past 1 hour.
- **The Solution**:
  In `packages/cli/src/server/server.ts`, `server.close()` must explicitly invoke:
  ```typescript
  (server as any).closeAllConnections?.();
  (server as any).closeIdleConnections?.();
  ```
  Additionally, all active WebSockets and background pings must be explicitly closed in test teardowns.

### 2. Missing GitHub Actions Workflow Timeouts
- **The Issue**: GitHub Actions jobs without an explicit `timeout-minutes` directive default to **360 minutes (6 hours)**.
- **The Symptom**: A hung test suite consumed hours of GitHub Actions runner credits and stalled concurrent runs in the queue.
- **The Solution**:
  Every workflow job in `.github/workflows/ci.yml` must specify an aggressive hard timeout:
  ```yaml
  jobs:
    test:
      timeout-minutes: 15
  ```

### 3. OpenRouter / Streaming Wire Client Error Bubbling
- **The Issue**: When providers disconnect or send HTTP error status codes (401, 402, 429) during streaming initialization, wire clients without typed error wrappers or explicit usage handlers (`stream_options: { include_usage: true }`) could cause stream readers to stall awaiting termination chunks.
- **The Solution**:
  - Always enforce `stream_options: { include_usage: true }` on streaming POST requests.
  - Wrap provider error payloads with typed domain errors (`OpenRouterError`, `OpenAiError`) rather than generic silent drops.

### 4. `localhost` Is Not Always `127.0.0.1` (v0.1.24 CI failure)
- **The Issue**: The server binds `localhost`, which GitHub runners resolve to **both** `127.0.0.1` and `::1`. A test opened a raw socket to a hard-coded `127.0.0.1`, but Node's happy-eyeballs bind picked `::1` first — the connection was refused (`connect ECONNREFUSED 127.0.0.1:<port>`) while the server itself was healthy. It passed locally because this machine's `localhost` maps to IPv4 only.
- **The Symptom**: One test failed on both Node 20 and 22 (`45 total, 1 failed`) while the build, typecheck and lint steps were green, so the tag shipped with a red CI run.
- **The Solution**:
  - Never hard-code a loopback address in a test; derive it from the bound server: `new URL(server.url).hostname`.
  - Treat a red CI run as a failed release even when the *Release Binaries* workflow is green — it only compiles and uploads.
  - After pushing a tag, confirm **both** workflows are `success` for the tag's commit (`gh run list --limit 4`); amend and force-push the tag if a test-only fix is needed, then re-verify the assets.

---

## 📋 Mandatory Pre-Release CI Verification Checklist

Complete these checks sequentially before executing `node scripts/release.mjs [patch|minor|major] --bump`:

### Phase 1: Local Sanity & Execution Speed
- [ ] **Typecheck Clean**:
  ```bash
  npm run typecheck
  ```
  *(Must exit with 0 errors across all 4 monorepo packages).*
- [ ] **Lint Clean**:
  ```bash
  npm run lint
  ```
  *(Zero ESLint warnings or errors).*
- [ ] **Hermetic Test Suite Speed**:
  ```bash
  npm test
  ```
  - All test suites (34 suites, ~475 tests) must complete in **under 45 seconds**.
  - Jest must exit back to the terminal prompt cleanly without needing `Ctrl+C` or `--forceExit`.
- [ ] **Secret Guard**:
  ```bash
  node scripts/guard-secrets.mjs
  ```
  *(Zero credentials, API keys, or private tokens in tracked files).*

### Phase 2: GitHub Runner Queue State
- [ ] **Inspect In-Flight Runs**:
  ```bash
  gh run list --status in_progress
  gh run list --status queued
  ```
- [ ] **Cancel Stale / Hung Runs**:
  If any runs from prior tags are stuck or stalled, terminate them immediately:
  ```bash
  gh run cancel <RUN_ID>
  ```
  *(Never release a new tag while an identical workflow is orphaned in the runner queue).*

### Phase 3: Release & Post-Push Verification
- [ ] **Execute Release Tool**:
  ```bash
  node scripts/release.mjs patch --bump
  ```
- [ ] **Push Commits and Tags**:
  ```bash
  git push origin master --tags
  ```
- [ ] **Monitor Live Workflows**:
  ```bash
  gh run list --limit 5
  ```
  Verify that both **CI** and **Release Binaries** transition from `in_progress` to `success` (`[ok]`) within 3–4 minutes.
- [ ] **Verify GitHub Release Assets**:
  ```bash
  gh release view v<VERSION>
  ```
  Confirm all six standalone binary assets (`.exe`, `.deb`, `.tar.gz` for Linux and macOS) are attached and downloadable.
