import { Pipeline } from '../src/pipeline.js';
import { SmartCache } from '../src/modules/smart-cache/index.js';
import { MemoryBackend } from '../src/modules/smart-cache/backends.js';
import { HandoffManager } from '../src/modules/handoff/index.js';
import { OpenRouterClient } from '../src/modules/handoff/openRouter.js';
import { LexicalEmbedding } from '../src/modules/smart-cache/embeddings.js';
import type { ProviderClient } from '../src/modules/handoff/provider.js';
import type { ModelSpec, ToolCall } from '../src/types.js';

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

  it('serves cache entries only for the same explicitly requested model', async () => {
    const pipeline = makePipeline();
    const prompt = 'Refactor this cache key.';
    const first = await pipeline.ask(prompt, { preferredModel: 'cheap-1' });
    expect(first.cache.hit).toBe(false);
    // A different explicitly-requested model must not get the cached answer.
    const second = await pipeline.ask(prompt, { preferredModel: 'other-1' });
    expect(second.cache.hit).toBe(false);
    expect(second.model).toBe('other-1');
    // The same model again hits the cache.
    const third = await pipeline.ask(prompt, { preferredModel: 'cheap-1' });
    expect(third.cache.hit).toBe(true);
  });

  it('respects noCache', async () => {
    const pipeline = makePipeline();
    const prompt = 'Explain recursion.';
    await pipeline.ask(prompt);
    const second = await pipeline.ask(prompt, { noCache: true });
    expect(second.cache.hit).toBe(false);
  });

  it('runs the tool loop when tools are declared and bypasses the cache', async () => {
    const cache = new SmartCache({
      backend: new MemoryBackend(),
      ttlSeconds: 3600,
      embedding: new LexicalEmbedding(),
    });
    const client = {
      mock: false,
      complete: jest
        .fn()
        .mockResolvedValueOnce({
          provider: 'openai',
          model: 'tool-model',
          content: '',
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'call_1', name: 'add', arguments: '{"a":2,"b":3}' }],
        })
        .mockResolvedValueOnce({
          provider: 'openai',
          model: 'tool-model',
          content: '5',
          usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
          finishReason: 'stop',
        })
        .mockResolvedValue({
          provider: 'openai',
          model: 'tool-model',
          content: '5',
          usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
          finishReason: 'stop',
        }),
    };
    const handoff = new HandoffManager({ client: client as unknown as ProviderClient, models: MODELS });
    const pipeline = new Pipeline({ cache, handoff, tokenBudget: 10000 });
    const events: string[] = [];
    const toolRegistry = {
      add: async (call: ToolCall): Promise<string> => {
        const args = JSON.parse(call.arguments) as { a: number; b: number };
        return String(args.a + args.b);
      },
    };
    const tools = [{ name: 'add', description: 'add two numbers', parameters: {} }];

    const result = await pipeline.ask('2 + 3', {
      tools,
      toolRegistry,
      onEvent: (ev) => {
        if (ev.type === 'tool') events.push(ev.name);
      },
    });

    expect(result.response).toBe('5');
    expect(result.toolCalls).toBe(1);
    expect(events).toEqual(['add']);
    expect(result.cache.hit).toBe(false);

    // Cache bypass: a repeat tool-bearing ask must not hit the cache either.
    const second = await pipeline.ask('2 + 3', { tools, toolRegistry });
    expect(second.cache.hit).toBe(false);
  });
});
