import { SmartCache } from '../src/modules/smart-cache/index.js';
import { MemoryBackend } from '../src/modules/smart-cache/backends.js';
import { cosineSimilarity, LexicalEmbedding } from '../src/modules/smart-cache/embeddings.js';

function makeCache(threshold = 0.85): SmartCache {
  return new SmartCache({
    backend: new MemoryBackend(),
    ttlSeconds: 3600,
    embedding: new LexicalEmbedding(),
    semanticThreshold: threshold,
  });
}

describe('SmartCache', () => {
  it('exact hit after store', async () => {
    const cache = makeCache();
    await cache.store('Write a fibonacci function.', 'function fib(n) {}', 'm');
    const { entry, kind } = await cache.lookup('Write a fibonacci function.');
    expect(kind).toBe('exact');
    expect(entry?.response).toBe('function fib(n) {}');
  });

  it('persists the mock flag on stored entries', async () => {
    const cache = makeCache();
    await cache.store('Write a fibonacci function.', 'fib A', 'model-a', undefined, 'model-a', true);
    const live = await cache.lookup('Write a fibonacci function.', { model: 'model-a' });
    expect(live.kind).toBe('exact');
    expect(live.entry?.mock).toBe(true);
    // Without the flag the entry is explicitly non-mock (authoritative, so the
    // pipeline can serve it even if the text contains the [mock] marker).
    await cache.store('Another prompt.', 'mentions [mock] in text', 'model-a', undefined, 'model-a', false);
    const nonMock = await cache.lookup('Another prompt.', { model: 'model-a' });
    expect(nonMock.entry?.mock).toBe(false);
  });

  it('exact lookup ignores whitespace differences', async () => {
    const cache = makeCache();
    await cache.store('Write a  parser.', 'ok', 'm');
    const { kind } = await cache.lookup('  Write a parser.  ');
    expect(kind).toBe('exact');
  });

  it('semantic hit for a reworded prompt above threshold', async () => {
    // Lexical embeddings are weaker than real ones, so the threshold is
    // intentionally low for this test.
    const cache = makeCache(0.3);
    await cache.store('How do I sort an array of numbers?', 'Use .sort()', 'm');
    const { entry, kind } = await cache.lookup('What is the best way to sort a list of numbers?');
    expect(kind).toBe('semantic');
    expect(entry?.response).toBe('Use .sort()');
  });

  it('misses semantically distinct prompts', async () => {
    const cache = makeCache(0.95);
    await cache.store('How do I sort an array?', 'x', 'm');
    const { entry } = await cache.lookup('What color is the sky?');
    expect(entry).toBeUndefined();
  });

  it('scopes exact entries to the requested model', async () => {
    const cache = makeCache();
    await cache.store('Write a fibonacci function.', 'fib A', 'model-a', undefined, 'model-a');
    const other = await cache.lookup('Write a fibonacci function.', { model: 'model-b' });
    expect(other.entry).toBeUndefined();
    const own = await cache.lookup('Write a fibonacci function.', { model: 'model-a' });
    expect(own.kind).toBe('exact');
    expect(own.entry?.response).toBe('fib A');
  });

  it('semantic hits respect the model scope', async () => {
    const cache = makeCache(0.3);
    await cache.store('How do I sort an array of numbers?', 'Use .sort()', 'm-a', undefined, 'm-a');
    const other = await cache.lookup('What is the best way to sort a list of numbers?', { model: 'm-b' });
    expect(other.entry).toBeUndefined();
    const own = await cache.lookup('What is the best way to sort a list of numbers?', { model: 'm-a' });
    expect(own.kind).toBe('semantic');
    expect(own.entry?.response).toBe('Use .sort()');
  });

  it('partial hit returns the delta', async () => {
    const cache = makeCache();
    await cache.store('Write a function that adds two numbers.', 'add(a, b)', 'm');
    const { kind, delta } = await cache.lookup('Write a function that adds two numbers. Then test it.');
    expect(kind).toBe('partial');
    expect(delta).toContain('Then test it');
  });

  it('expires entries after TTL', async () => {
    const cache = new SmartCache({
      backend: new MemoryBackend(),
      ttlSeconds: 0,
      embedding: new LexicalEmbedding(),
    });
    await cache.store('prompt', 'response', 'm');
    await new Promise((r) => setTimeout(r, 5));
    const { entry } = await cache.lookup('prompt');
    expect(entry).toBeUndefined();
  });

  it('stores and clears', async () => {
    const cache = makeCache();
    await cache.store('a', 'b', 'm');
    await cache.clear();
    const { entry } = await cache.lookup('a');
    expect(entry).toBeUndefined();
  });

  it('namespaces isolate entries between workspaces sharing one backend', async () => {
    const backend = new MemoryBackend();
    const cacheA = new SmartCache({
      backend,
      ttlSeconds: 3600,
      embedding: new LexicalEmbedding(),
      namespace: '/workspace/a',
    });
    const cacheB = new SmartCache({
      backend,
      ttlSeconds: 3600,
      embedding: new LexicalEmbedding(),
      namespace: '/workspace/b',
    });
    // Project A stores an answer for a prompt project B will ask verbatim.
    await cacheA.store('Summarize context.md', 'Project A summary', 'm');
    // Project B must NOT receive project A's answer.
    const bLookup = await cacheB.lookup('Summarize context.md');
    expect(bLookup.entry).toBeUndefined();
    // Project A still gets its own cached answer.
    const aLookup = await cacheA.lookup('Summarize context.md');
    expect(aLookup.kind).toBe('exact');
    expect(aLookup.entry?.response).toBe('Project A summary');
  });

  it('semantic lookups respect the workspace namespace', async () => {
    const backend = new MemoryBackend();
    const cacheA = new SmartCache({
      backend,
      ttlSeconds: 3600,
      embedding: new LexicalEmbedding(),
      semanticThreshold: 0.3,
      namespace: '/workspace/a',
    });
    const cacheB = new SmartCache({
      backend,
      ttlSeconds: 3600,
      embedding: new LexicalEmbedding(),
      semanticThreshold: 0.3,
      namespace: '/workspace/b',
    });
    await cacheA.store('How do I sort an array of numbers?', 'A: use sort', 'm');
    // Reworded query in project B must not hit project A's semantic entry.
    const b = await cacheB.lookup('What is the best way to sort a list of numbers?');
    expect(b.entry).toBeUndefined();
    const a = await cacheA.lookup('What is the best way to sort a list of numbers?');
    expect(a.kind).toBe('semantic');
    expect(a.entry?.response).toBe('A: use sort');
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and 0 for orthogonal', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('handles zero vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe('LexicalEmbedding', () => {
  it('produces unit vectors of fixed dimension', async () => {
    const emb = new LexicalEmbedding();
    const v = await emb.embed('alpha beta gamma');
    expect(v.length).toBe(256);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('is deterministic', async () => {
    const emb = new LexicalEmbedding();
    const a = await emb.embed('same input');
    const b = await emb.embed('same input');
    expect(a).toEqual(b);
  });
});
