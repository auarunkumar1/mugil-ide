# Partial Cache Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the smart cache from serving concatenated answers for prompts that merely share a short common prefix, while keeping genuine prompt-continuation hits working.

**Architecture:** Add a minimum-prefix guard to `SmartCache.partialLookup` so a "partial" hit requires the cached prompt to be a substantial fraction of the new one. Replace the bare `delta` continuation prompt with one that re-states the shared context so the model can answer the whole question, and record on the cache entry that its response is a concatenation so continuations cannot compound.

**Tech Stack:** TypeScript, Jest (`ts-jest`). No new dependencies.

## Background: the bug

`SmartCache.partialLookup` returns a hit whenever `normalized.startsWith(entry.prompt)` for any stored entry. `Pipeline.runAsk` then discards the user's actual prompt entirely and sends:

```
The following was already answered, continue from where it left off.

<delta>
```

and concatenates `cachedResponse + "\n\n" + newCompletion` as the answer.

Two failure modes follow:

1. **Unrelated prompts collide.** `"fix the parser bug"` is a literal prefix of
   `"fix the parser bug in the tokenizer"`, but also of any other prompt that
   begins with those words — a pasted file header, a shared boilerplate preamble,
   a common instruction block. The cache splices two different answers together
   and the user sees a confident, wrong response.
2. **Compounding.** Each concatenation is stored under the full prompt. A third
   longer prompt then prefixes that stored answer, and the errors accumulate.

## Global Constraints

- **No regression for real continuations.** A prompt that is a genuine extension
  of a previous one must still hit and must still save tokens.
- `partialLookup` is on the hot path for every cache miss. The guard must be
  O(1) per candidate after the existing length pruning — no new embedding work.
- Thresholds are constructor options on `SmartCache`, overridable by env var
  (`MUGIL_IDE_PARTIAL_MIN_RATIO`). Defaults must be conservative.
- `CacheEntry` gains an optional field only — existing persisted cache files
  (including session JSON that shares the cache dir) must keep loading.
- `exact` and `semantic` lookup behaviour is untouched.
- ESLint zero errors; `npm run typecheck` and `npm test` green before each commit.

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/modules/smart-cache/index.ts` | **Modify.** Minimum-prefix guard; `CacheEntry.partial` marker via `store()`; new options. |
| `packages/core/src/pipeline.ts` | **Modify.** Self-contained continuation prompt including the shared prefix. |
| `packages/core/src/index.ts` | **Modify.** Export new option types. |
| `packages/core/tests/smartCache.test.ts` | **Modify.** Guard and marker tests. |
| `packages/core/tests/pipeline.test.ts` | **Modify.** Continuation-prompt tests. |

---

### Task 1: Minimum-Prefix Guard

**Files:**
- Modify: `packages/core/src/modules/smart-cache/index.ts:5-22` (options), `:227-267` (`partialLookup`)
- Test: `packages/core/tests/smartCache.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  ```ts
  export interface SmartCacheOptions {
    // ...existing fields...
    /**
     * Minimum fraction of the new prompt that must already be cached for a
     * partial hit. Default 0.6. Set 1 to disable partial hits entirely.
     */
    partialMinRatio?: number;
    /** Absolute minimum shared-prefix length in characters. Default 40. */
    partialMinChars?: number;
  }
  ```

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/tests/smartCache.test.ts`:

```ts
describe('partial lookup guards', () => {
  const mk = (opts: Partial<SmartCacheOptions> = {}) => {
    const backend = new MemoryBackend();
    return new SmartCache({
      backend,
      ttlSeconds: 3600,
      embedding: new LexicalEmbedding(),
      ...opts,
    });
  };

  it('rejects a shared prefix that is too short a fraction of the new prompt', async () => {
    const cache = mk();
    // 30 chars stored; the new prompt is 300 chars, so 10% overlap.
    await cache.store(
      'fix the parser bug in the lexer',
      'The bug is in scanNumber.',
      'm',
    );
    const res = await cache.lookup(
      'fix the parser bug in the lexer and also rewrite the tokenizer to be iterative instead of recursive please',
    );
    expect(res.kind).not.toBe('partial');
    expect(res.entry).toBeUndefined();
  });

  it('rejects a shared prefix shorter than the absolute floor', async () => {
    const cache = mk();
    await cache.store('fix it', 'answer', 'm');
    const res = await cache.lookup('fix it and also add a test');
    expect(res.kind).not.toBe('partial');
  });

  it('still hits when the shared prefix is substantial', async () => {
    const cache = mk();
    const base =
      'Refactor the tokenizer so that lexNumber no longer allocates a temporary buffer for every character it scans, ';
    await cache.store(base, 'Here is the refactor.', 'm');
    const res = await cache.lookup(base + 'and add property tests for it.');
    expect(res.kind).toBe('partial');
    expect(res.delta).toBe('and add property tests for it.');
  });

  it('honours an explicit partialMinRatio of 1 to disable partial hits', async () => {
    const cache = mk({ partialMinRatio: 1 });
    const base = 'Explain the retry ladder in detail. ';
    await cache.store(base, 'Here it is.', 'm');
    const res = await cache.lookup(base + 'Now do the same for timeouts.');
    expect(res.kind).not.toBe('partial');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && npx jest tests/smartCache.test.ts -t "partial lookup guards"`
Expected: FAIL — the first two currently return `kind: 'partial'`.

- [ ] **Step 3: Add the options**

In `packages/core/src/modules/smart-cache/index.ts`, extend `SmartCacheOptions`:

```ts
export interface SmartCacheOptions {
  backend: CacheBackend;
  ttlSeconds: number;
  embedding?: EmbeddingProvider;
  /** Minimum cosine similarity for a semantic hit. */
  semanticThreshold?: number;
  /**
   * Scopes every cache key to a namespace (e.g. the workspace directory), so
   * one project's cached answers are never served for another project that
   * happens to ask the same question.
   */
  namespace?: string;
  /**
   * Minimum fraction of a new prompt that must already be cached before a
   * partial (continuation) hit is allowed. Without this, any two prompts
   * sharing a short prefix — a pasted file header, a common preamble — spliced
   * two unrelated answers together.
   */
  partialMinRatio?: number;
  /** Absolute floor on the shared prefix, in characters. */
  partialMinChars?: number;
}
```

Add the fields and their defaults to the class:

```ts
  private readonly partialMinRatio: number;
  private readonly partialMinChars: number;
```

```ts
    this.partialMinRatio = resolveRatio(options.partialMinRatio);
    this.partialMinChars = options.partialMinChars ?? 40;
```

Add the helper (module scope, bottom of the file):

```ts
/**
 * Reads the partial-hit ratio: explicit option first, then
 * `MUGIL_IDE_PARTIAL_MIN_RATIO`, then the 0.6 default. Invalid or
 * out-of-range values fall back to the default rather than throwing — a cache
 * guard must never break a turn.
 */
function resolveRatio(explicit: number | undefined): number {
  const raw =
    explicit ??
    (typeof process !== 'undefined' && process.env?.MUGIL_IDE_PARTIAL_MIN_RATIO
      ? Number(process.env.MUGIL_IDE_PARTIAL_MIN_RATIO)
      : undefined);
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0 || raw > 1) return 0.6;
  return raw;
}
```

- [ ] **Step 4: Apply the guard in `partialLookup`**

In `partialLookup`, add a private predicate and use it in both lookup paths:

```ts
  /**
   * True when `candidate` is a long enough prefix of `normalized` to be a
   * genuine continuation rather than a coincidental prefix collision.
   */
  private isContinuation(candidate: string, normalized: string): boolean {
    if (candidate.length < this.partialMinChars) return false;
    if (candidate.length / normalized.length < this.partialMinRatio) return false;
    return normalized.startsWith(candidate);
  }
```

Replace the trie path's `normalized.startsWith(entry.prompt)` check:

```ts
      if (entry && matchesScope(entry, model, this.namespace) && this.isContinuation(entry.prompt, normalized)) {
```

Replace the scan path's check:

```ts
      if (this.isContinuation(entry.prompt, normalized)) {
        best = entry;
      }
```

The existing length-pruning line stays as-is — it already skips candidates that
are not strictly shorter than the query, which `isContinuation` also requires.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/core && npx jest tests/smartCache.test.ts`
Expected: PASS, including the pre-existing partial-lookup tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/smart-cache/index.ts packages/core/tests/smartCache.test.ts
git commit -m "fix(smart-cache): require a substantial prefix for partial cache hits")
```

---

### Task 2: Self-Contained Continuation Prompt

**Files:**
- Modify: `packages/core/src/pipeline.ts:225-232` (`effectivePrompt`)
- Test: `packages/core/tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `CacheLookupResult.delta` / `.entry` (unchanged shapes).
- Produces: no new exported API. The continuation prompt text changes only.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/tests/pipeline.test.ts`, inside `describe('Pipeline', ...)`:

```ts
  it('gives the model the shared context on a partial cache hit, not just the delta', async () => {
    const base =
      'Refactor the tokenizer so that lexNumber no longer allocates a temporary buffer for every character it scans. ';
    const client = {
      mock: false,
      complete: jest.fn().mockResolvedValue({
        provider: 'openai',
        model: 'live-model',
        content: 'Now the tests.',
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        finishReason: 'stop',
      }),
    } as unknown as ProviderClient;
    const cache = new SmartCache({
      backend: new MemoryBackend(),
      ttlSeconds: 3600,
      embedding: new LexicalEmbedding(),
    });
    const pipeline = new Pipeline({
      cache,
      handoff: new HandoffManager({ client, models: MODELS }),
    });

    await pipeline.ask(base);
    const second = await pipeline.ask(base + 'Now add property tests for it.');

    expect(second.cache.kind).toBe('partial');
    const sent = (client.complete as jest.Mock).mock.calls[1]![0] as ChatMessage[];
    const userMessage = sent[sent.length - 1]!.content;
    // The shared prefix is present, so the model can answer the whole question.
    expect(userMessage).toContain('lexNumber no longer allocates');
    expect(userMessage).toContain('Now add property tests for it.');
  });

  it('does not splice responses when the shared prefix is too small', async () => {
    const client = {
      mock: false,
      complete: jest.fn().mockResolvedValue({
        provider: 'openai',
        model: 'live-model',
        content: 'fresh answer',
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        finishReason: 'stop',
      }),
    } as unknown as ProviderClient;
    const cache = new SmartCache({
      backend: new MemoryBackend(),
      ttlSeconds: 3600,
      embedding: new LexicalEmbedding(),
    });
    const pipeline = new Pipeline({
      cache,
      handoff: new HandoffManager({ client, models: MODELS }),
    });

    await pipeline.ask('fix the parser bug in the lexer');
    const second = await pipeline.ask(
      'fix the parser bug in the lexer and also rewrite the tokenizer to be iterative instead of recursive',
    );

    expect(second.cache.kind).not.toBe('partial');
    expect(second.response).toBe('fresh answer');
    expect(second.response).not.toContain('fix the parser bug in the lexer');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && npx jest tests/pipeline.test.ts -t "shared context"`
Expected: the first test FAILS (the sent prompt contains only the delta); the
second PASSES already because Task 1 fixed it.

- [ ] **Step 3: Rewrite `effectivePrompt`**

In `packages/core/src/pipeline.ts`, replace the `effectivePrompt` block:

```ts
    // 3. Build messages and call the handoff manager.
    //
    // A partial cache hit means the stored prompt is a long prefix of this one,
    // so the delta alone is NOT enough context: the model needs the shared
    // prefix to know what "continue from where it left off" refers to. Sending
    // only the delta (the old behaviour) produced answers that ignored the
    // original question entirely.
    let effectivePrompt: string;
    if (cacheLookup.kind === 'partial' && cacheLookup.delta) {
      const shared = cacheLookup.entry?.prompt ?? '';
      effectivePrompt = [
        'This is a continuation of a request you have already partially answered.',
        'Original request (shared prefix):',
        shared,
        '',
        'Additional request:',
        cacheLookup.delta,
        '',
        'Answer ONLY the additional request. Do not repeat the part already answered.',
      ].join('\n');
    } else {
      effectivePrompt = options.noRefine ? prompt : refine.refined;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/core && npx jest tests/pipeline.test.ts`
Expected: PASS, all tests including the 15 pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline.ts packages/core/tests/pipeline.test.ts
git commit -m "fix(pipeline): include shared context in partial-cache continuation prompts"
```

---

### Task 3: Prevent Compounding Continuations

A stored response that is itself a concatenation must not seed another
concatenation, or errors accumulate across three or more turns.

**Files:**
- Modify: `packages/core/src/types.ts:100-116` (`CacheEntry`)
- Modify: `packages/core/src/modules/smart-cache/index.ts:169-195` (`store`)
- Modify: `packages/core/src/pipeline.ts` (the `cache.store(...)` call site)
- Test: `packages/core/tests/smartCache.test.ts`, `packages/core/tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `CacheLookupResult.kind` from Task 1/2.
- Produces:
  ```ts
  // types.ts
  export interface CacheEntry {
    // ...existing fields...
    /** True when `response` is a concatenation of an earlier answer plus a delta. */
    partial?: boolean;
  }
  // smart-cache/index.ts — store() gains a trailing optional arg
  store(
    prompt: string,
    response: string,
    model: string,
    usage?: Usage,
    keyModel?: string,
    mock?: boolean,
    partial?: boolean,
  ): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

Append to `packages/core/tests/pipeline.test.ts`:

```ts
  it('does not let a concatenated answer seed another concatenation', async () => {
    const base = 'Explain the retry ladder in detail, including the backoff schedule. ';
    const client = {
      mock: false,
      complete: jest.fn().mockResolvedValue({
        provider: 'openai',
        model: 'live-model',
        content: 'PART-B',
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        finishReason: 'stop',
      }),
    } as unknown as ProviderClient;
    const cache = new SmartCache({
      backend: new MemoryBackend(),
      ttlSeconds: 3600,
      embedding: new LexicalEmbedding(),
    });
    const pipeline = new Pipeline({
      cache,
      handoff: new HandoffManager({ client, models: MODELS }),
    });

    await pipeline.ask(base);
    const second = await pipeline.ask(base + 'Now cover timeouts.');
    expect(second.response).toContain('PART-B');

    const third = await pipeline.ask(base + 'Now cover timeouts. And then cover cancellation.');
    // The third answer must not stack a second concatenation on top of the
    // second one; at most one prior answer may be prepended.
    expect(third.response.split('PART-B').length - 1).toBeLessThanOrEqual(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx jest tests/pipeline.test.ts -t "seed another concatenation"`
Expected: FAIL — nothing records that the stored response is a concatenation.

- [ ] **Step 3: Add the field and store plumbing**

In `packages/core/src/types.ts`, add to `CacheEntry`:

```ts
  /**
   * True when `response` is an earlier answer concatenated with a continuation.
   * A partial hit is never served on top of a `partial` entry, so spliced
   * answers cannot compound across three or more turns.
   */
  partial?: boolean;
```

In `packages/core/src/modules/smart-cache/index.ts`, extend `store()`:

```ts
  async store(
    prompt: string,
    response: string,
    model: string,
    usage?: Usage,
    keyModel?: string,
    mock?: boolean,
    partial?: boolean,
  ): Promise<void> {
```

and add `partial,` to the constructed `CacheEntry`.

- [ ] **Step 4: Refuse to continue a continuation in `partialLookup`**

In `partialLookup`, treat a `partial` entry as ineligible for both paths. In
the trie path:

```ts
      if (
        entry &&
        !entry.partial &&
        matchesScope(entry, model, this.namespace) &&
        this.isContinuation(entry.prompt, normalized)
      ) {
```

In the scan path, skip partial entries before the prefix test:

```ts
      if (entry.partial) continue;
      if (this.isContinuation(entry.prompt, normalized)) {
        best = entry;
      }
```

- [ ] **Step 5: Record the flag at the pipeline call site**

In `packages/core/src/pipeline.ts`, the `this.cache.store(...)` call gains the
final argument:

```ts
      const storeTask = this.cache.store(
        prompt,
        response,
        completion.model,
        completion.usage,
        cacheModel,
        // Always write an explicit flag: `mock` absent on a completion means
        // a live provider, so the entry must be marked mock:false — otherwise
        // a later run would fall back to the ambiguous [mock] text scan.
        completion.mock ?? false,
        // Mark concatenations so they never seed another concatenation.
        cacheLookup.kind === 'partial',
      );
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/core && npx jest tests/pipeline.test.ts tests/smartCache.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/modules/smart-cache/index.ts packages/core/src/pipeline.ts packages/core/tests
git commit -m "fix(smart-cache): prevent partial-cache answers from compounding"
```

---

### Task 4: Export, Document, Verify

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `SmartCacheOptions` from Task 1 (already exported).
- Produces: `SmartCacheOptions` re-exported from the package root so external
  callers (the `mcp` package) can set the new thresholds.

- [ ] **Step 1: Check whether `SmartCacheOptions` is already exported**

Run: `rtk grep -n "SmartCacheOptions" packages/core/src/index.ts packages/mcp/src`
Expected: if already exported, skip Step 2.

- [ ] **Step 2: Export the options type**

In `packages/core/src/index.ts`, inside the smart-cache export block, add
`SmartCacheOptions` to the type exports if it is not already there.

- [ ] **Step 3: Update the CHANGELOG**

Add to `## [Unreleased]` → `### Fixed`:

```markdown
- **Partial Cache Spliced Unrelated Answers**: A partial (continuation) cache hit fired whenever a stored prompt was *any* literal prefix of the new one, so two prompts sharing a short common opener — a pasted file header, a shared preamble — produced `cachedAnswer + "\n\n" + newCompletion` as a single confident wrong answer. Partial hits now require the cached prompt to cover at least 60% of the new prompt (`MUGIL_IDE_PARTIAL_MIN_RATIO`) and at least 40 characters, and a stored concatenation can never seed another concatenation.
```

Add to `### Changed`:

```markdown
- **Partial Cache Continuation Prompt**: The model is now given the shared prefix alongside the delta instead of the delta alone, so a continuation is answered in the context of the original question.
```

- [ ] **Step 4: Full verification**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all clean; every suite passes.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts CHANGELOG.md
git commit -m "docs: document partial-cache correctness fixes"
```

---

## Self-Review

**Spec coverage:** the short-prefix collision (Task 1), the context-free
continuation prompt (Task 2), compounding concatenations (Task 3), exports and
changelog (Task 4). The `CacheEntry.partial` field is optional, so existing
persisted cache files keep loading.

**Type consistency:** `partialMinRatio` / `partialMinChars` are declared in
`SmartCacheOptions` in Task 1 and read in Task 1's `resolveRatio` and
`isContinuation`. `CacheEntry.partial` is declared in Task 3 and consumed by
`store()` and `partialLookup` in the same task, and set by the pipeline call
site in the same task. `SmartCacheOptions` is re-exported in Task 4.

**Deliberate trade-off:** the 0.6 ratio means a genuine continuation that
rewrites the beginning of its prompt no longer hits the cache. That is the
correct failure direction — a wrong cached answer costs more than a re-run — and
`MUGIL_IDE_PARTIAL_MIN_RATIO` lets a user loosen it.