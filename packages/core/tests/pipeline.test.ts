import { Pipeline } from '../src/pipeline.js';
import { SmartCache } from '../src/modules/smart-cache/index.js';
import { MemoryBackend } from '../src/modules/smart-cache/backends.js';
import { HandoffManager } from '../src/modules/handoff/index.js';
import { OpenRouterClient } from '../src/modules/handoff/openRouter.js';
import { LexicalEmbedding } from '../src/modules/smart-cache/embeddings.js';
import type { ModelSpec } from '../src/types.js';

const MODELS: ModelSpec[] = [
  { id: 'cheap-1', tier: 'cheap', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 8000 },
];

function makePipeline(): Pipeline {
  const cache = new SmartCache({
    backend: new MemoryBackend(),
    ttlSeconds: 3600,
    embedding: new LexicalEmbedding(),
  });
  const client = new OpenRouterClient({});
  const handoff = new HandoffManager({ client, models: MODELS });
  return new Pipeline({ cache, handoff, tokenBudget: 10000 });
}

describe('Pipeline', () => {
  it('refines, calls the (mock) model and reports usage', async () => {
    const pipeline = makePipeline();
    const result = await pipeline.ask(
      'Hi! Please could you write a function that sorts a list of numbers? Thanks!',
    );
    expect(result.mock).toBe(true);
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.model).toBe('cheap-1');
    expect(result.cache.hit).toBe(false);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });

  it('hits the cache on the second identical ask', async () => {
    const pipeline = makePipeline();
    const prompt = 'Write a binary search in TypeScript.';
    await pipeline.ask(prompt);
    const second = await pipeline.ask(prompt);
    expect(second.cache.hit).toBe(true);
    expect(second.cache.kind).toBe('exact');
    expect(second.provider).toBe('cache');
  });

  it('refines verbose prompts and reports savings', async () => {
    const pipeline = makePipeline();
    const verbose =
      'Hello there! In order to fix this issue, please could you kindly investigate the memory leak? Thank you in advance!';
    const result = await pipeline.ask(verbose, { noCache: true });
    expect(result.refine.refinedTokens).toBeLessThanOrEqual(result.refine.originalTokens);
    expect(result.refine.appliedStrategies.length).toBeGreaterThan(0);
  });

  it('respects noCache', async () => {
    const pipeline = makePipeline();
    const prompt = 'Explain recursion.';
    await pipeline.ask(prompt);
    const second = await pipeline.ask(prompt, { noCache: true });
    expect(second.cache.hit).toBe(false);
  });
});
