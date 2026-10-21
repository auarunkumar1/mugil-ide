import {
  Pipeline,
  MIN_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_TOOL_ITERATIONS,
  getMaxOutputTokens,
  getMaxToolIterations,
} from '../src/pipeline.js';
import { SmartCache } from '../src/modules/smart-cache/index.js';
import { MemoryBackend } from '../src/modules/smart-cache/backends.js';
import { HandoffManager } from '../src/modules/handoff/index.js';
import { OpenRouterClient } from '../src/modules/handoff/openRouter.js';
import { LexicalEmbedding } from '../src/modules/smart-cache/embeddings.js';
import type { ProviderClient } from '../src/modules/handoff/provider.js';
import type { ChatMessage, ModelSpec, ToolCall } from '../src/types.js';

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

  it("serves a cached live response whose text contains '[mock]'", async () => {
    const client = {
      mock: false,
      complete: jest.fn().mockResolvedValue({
        provider: 'openai',
        model: 'live-model',
        content: 'The [mock] marker is part of the real answer.',
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        finishReason: 'stop',
      }),
    };
    const cache = new SmartCache({
      backend: new MemoryBackend(),
      ttlSeconds: 3600,
      embedding: new LexicalEmbedding(),
    });
    const handoff = new HandoffManager({ client: client as unknown as ProviderClient, models: MODELS });
    const pipeline = new Pipeline({ cache, handoff, tokenBudget: 10000 });
    const prompt = 'When is the [mock] token literal safe in prose?';

    const first = await pipeline.ask(prompt);
    expect(first.cache.hit).toBe(false);
    expect(client.complete).toHaveBeenCalledTimes(1);

    // The entry is flagged mock:false, so the substring in its text must not
    // be mistaken for a stale offline response under this live provider.
    const second = await pipeline.ask(prompt);
    expect(second.cache.hit).toBe(true);
    expect(second.provider).toBe('cache');
    expect(second.response).toBe('The [mock] marker is part of the real answer.');
    expect(client.complete).toHaveBeenCalledTimes(1);
  });

  it('discards cached mock responses when running with a live provider', async () => {
    const cache = new SmartCache({
      backend: new MemoryBackend(),
      ttlSeconds: 3600,
      embedding: new LexicalEmbedding(),
    });
    // 1) Store a mock response using the offline mock client.
    const mockHandoff = new HandoffManager({ client: new OpenRouterClient({}), models: MODELS });
    const mockPipeline = new Pipeline({ cache, handoff: mockHandoff, tokenBudget: 10000 });
    const prompt = 'Explain the offline fallback.';
    const first = await mockPipeline.ask(prompt);
    expect(first.mock).toBe(true);

    // 2) Same cache, live provider: the stale mock entry must be ignored and
    //    the provider called instead.
    const liveClient = {
      mock: false,
      complete: jest.fn().mockResolvedValue({
        provider: 'openai',
        model: 'live-model',
        content: 'real live answer',
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        finishReason: 'stop',
      }),
    };
    const liveHandoff = new HandoffManager({ client: liveClient as unknown as ProviderClient, models: MODELS });
    const livePipeline = new Pipeline({ cache, handoff: liveHandoff, tokenBudget: 10000 });
    const result = await livePipeline.ask(prompt);
    expect(result.cache.hit).toBe(false);
    expect(result.response).toBe('real live answer');
    expect(liveClient.complete).toHaveBeenCalledTimes(1);
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
        if (ev.type === 'tool-result') events.push(`${ev.name}:${ev.ok}:${ev.result}`);
      },
    });

    expect(result.response).toBe('5');
    expect(result.toolCalls).toBe(1);
    expect(events).toEqual(['add', 'add:true:5']);
    expect(result.cache.hit).toBe(false);

    // Cache bypass: a repeat tool-bearing ask must not hit the cache either.
    const second = await pipeline.ask('2 + 3', { tools, toolRegistry });
    expect(second.cache.hit).toBe(false);
  });

  it('forwards the permission gate and feeds denials back to the model', async () => {
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
          content: 'blocked',
          usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
          finishReason: 'stop',
        }),
    };
    const handoff = new HandoffManager({ client: client as unknown as ProviderClient, models: MODELS });
    const pipeline = new Pipeline({
      cache: new SmartCache({ backend: new MemoryBackend(), ttlSeconds: 3600, embedding: new LexicalEmbedding() }),
      handoff,
      tokenBudget: 10000,
    });
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
      permission: async () => false,
      onEvent: (ev) => {
        if (ev.type === 'tool') events.push(`${ev.name}:${ev.args ?? ''}`);
      },
    });

    expect(result.response).toBe('blocked');
    expect(result.toolCalls).toBe(1);
    expect(events).toEqual(['add:{"a":2,"b":3}']);
    // The tool result the model saw must be the denial, not the executor output.
    const messages = (client.complete as jest.Mock).mock.calls[1]![0] as ChatMessage[];
    expect(messages[messages.length - 1]).toMatchObject({
      role: 'tool',
      content: expect.stringContaining('Permission denied'),
    });
  });

  it('fires turn.completed webhooks with the result payload', async () => {
    const pipeline = makePipeline();
    const calls: { url: string; event: string; payload: Record<string, unknown> }[] = [];
    const webhookFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as {
        event: string;
        payload: Record<string, unknown>;
      };
      calls.push({
        url: typeof input === 'string' ? input : input.toString(),
        event: body.event,
        payload: body.payload,
      });
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const result = await pipeline.ask('hello', {
      noCache: true,
      webhooks: [{ url: 'https://hooks.example.com/x', events: ['turn.completed'] }],
      webhookFetch,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.event).toBe('turn.completed');
    expect(calls[0]!.payload.model).toBe(result.model);
    expect(calls[0]!.payload.usage).toEqual(result.usage);
    expect(calls[0]!.payload.toolCalls).toBe(0);
  });

  it('fires turn.error webhooks when the ask fails', async () => {
    const client = {
      mock: false,
      complete: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as ProviderClient;
    const handoff = new HandoffManager({ client, models: MODELS });
    const pipeline = new Pipeline({
      cache: new SmartCache({ backend: new MemoryBackend(), ttlSeconds: 3600, embedding: new LexicalEmbedding() }),
      handoff,
      tokenBudget: 10000,
    });
    const events: string[] = [];
    const webhookFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      events.push(JSON.parse(init?.body as string).event);
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    await expect(
      pipeline.ask('doomed', { noCache: true, webhooks: [{ url: 'https://hooks.example.com/e' }], webhookFetch }),
    ).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(events).toContain('turn.started');
    expect(events).toContain('turn.error');
  });

  describe('output budget', () => {
    /** Runs one ask with a deliberately tiny prompt budget; returns the max_tokens sent. */
    async function captureMaxTokens(
      history: ChatMessage[],
      askOptions: Partial<Parameters<Pipeline['ask']>[1]> = {},
    ): Promise<number> {
      const client = {
        mock: false,
        complete: jest.fn().mockResolvedValue({
          provider: 'openai',
          model: 'live-model',
          content: 'answer',
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          finishReason: 'stop',
        }),
      } as unknown as ProviderClient;
      const pipeline = new Pipeline({
        cache: new SmartCache({
          backend: new MemoryBackend(),
          ttlSeconds: 3600,
          embedding: new LexicalEmbedding(),
        }),
        handoff: new HandoffManager({
          client,
          models: [{ id: 'cheap-1', tier: 'cheap', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 128_000 }],
        }),
        // Deliberately tiny: the prompt budget must NOT cap generation.
        tokenBudget: 1000,
      });
      await pipeline.ask('hi', { history, noCache: true, ...askOptions });
      return (client.complete as jest.Mock).mock.calls[0]![1].maxTokens as number;
    }

    it('does not shrink max_tokens when history overflows the prompt budget', async () => {
      const overflow: ChatMessage[] = [
        { role: 'user', content: 'x'.repeat(20_000) },
        { role: 'assistant', content: 'y'.repeat(20_000) },
      ];
      const maxTokens = await captureMaxTokens(overflow);
      // The old maths floored this at 256 and cut every reply off mid-sentence.
      expect(maxTokens).toBeGreaterThanOrEqual(MIN_MAX_OUTPUT_TOKENS);
      expect(maxTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });

    it('still honours an explicit maxTokens under an overflowing history', async () => {
      const overflow: ChatMessage[] = [
        { role: 'user', content: 'x'.repeat(20_000) },
        { role: 'assistant', content: 'y'.repeat(20_000) },
      ];
      await expect(captureMaxTokens(overflow, { maxTokens: 3000 })).resolves.toBe(3000);
    });

    it('supports getMaxOutputTokens with defaults and MUGIL_IDE_MAX_OUTPUT_TOKENS', () => {
      expect(getMaxOutputTokens({})).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
      expect(getMaxOutputTokens({ MUGIL_IDE_MAX_OUTPUT_TOKENS: '16384' })).toBe(16384);
      expect(getMaxOutputTokens({ MUGIL_IDE_OUTPUT_BUDGET: '4096' })).toBe(4096);
    });

    it('supports getMaxToolIterations with defaults and MUGIL_IDE_MAX_TOOL_ITERATIONS', () => {
      expect(getMaxToolIterations({})).toBe(DEFAULT_MAX_TOOL_ITERATIONS);
      expect(getMaxToolIterations({ MUGIL_IDE_MAX_TOOL_ITERATIONS: '35' })).toBe(35);
    });

    it('takes the tighter of an explicit maxTokens and a ponytail outputBudget', async () => {
      const client = {
        mock: false,
        complete: jest.fn().mockResolvedValue({
          provider: 'openai',
          model: 'live-model',
          content: 'answer',
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          finishReason: 'stop',
        }),
      } as unknown as ProviderClient;
      const pipeline = new Pipeline({
        cache: new SmartCache({
          backend: new MemoryBackend(),
          ttlSeconds: 3600,
          embedding: new LexicalEmbedding(),
        }),
        handoff: new HandoffManager({ client, models: MODELS }),
      });
      await pipeline.ask('hi', { noCache: true, maxTokens: 6000, ponytail: { outputBudget: 2000 } });
      expect((client.complete as jest.Mock).mock.calls[0]![1].maxTokens).toBe(2000);

      await pipeline.ask('hi again', { noCache: true, maxTokens: 2000, ponytail: { outputBudget: 6000 } });
      expect((client.complete as jest.Mock).mock.calls[1]![1].maxTokens).toBe(2000);
    });

    it('flags a length-truncated completion and refuses to cache it', async () => {
      const client = {
        mock: false,
        complete: jest
          .fn()
          .mockResolvedValueOnce({
            provider: 'openai',
            model: 'live-model',
            content: 'a partial answer',
            usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
            finishReason: 'length',
          })
          .mockResolvedValue({
            provider: 'openai',
            model: 'live-model',
            content: 'a full answer',
            usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
            finishReason: 'stop',
          }),
      } as unknown as ProviderClient;
      const cache = new SmartCache({
        backend: new MemoryBackend(),
        ttlSeconds: 3600,
        embedding: new LexicalEmbedding(),
      });
      const pipeline = new Pipeline({ cache, handoff: new HandoffManager({ client, models: MODELS }) });

      const first = await pipeline.ask('explain the retry ladder');
      expect(first.truncated).toBe(true);
      expect(first.finishReason).toBe('length');

      // The stub must not be served back as a cache hit.
      const second = await pipeline.ask('explain the retry ladder');
      expect(second.cache.hit).toBe(false);
      expect(second.response).toBe('a full answer');
      expect(second.truncated).toBe(false);
    });
  });

  it('emits delta events while streaming and stops when stream is false', async () => {
    const streaming = {
      mock: false,
      complete: jest.fn().mockResolvedValue({
        provider: 'openai',
        model: 'm',
        content: 'streamed',
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        finishReason: 'stop',
      }),
      stream: jest.fn(async (_m: unknown, _o: unknown, h: any) => {
        h?.onDelta?.('str');
        h?.onDelta?.('eamed');
        return {
          provider: 'openai',
          model: 'm',
          content: 'streamed',
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
          finishReason: 'stop',
        };
      }),
    };
    const mk = () =>
      new Pipeline({
        cache: new SmartCache({
          backend: new MemoryBackend(),
          ttlSeconds: 3600,
          embedding: new LexicalEmbedding(),
        }),
        handoff: new HandoffManager({ client: streaming as unknown as ProviderClient, models: MODELS }),
      });

    const seen: string[] = [];
    const result = await mk().ask('hello', {
      noCache: true,
      onEvent: (e) => {
        if (e.type === 'delta') seen.push(e.text);
      },
    });
    expect(seen).toEqual(['str', 'eamed']);
    expect(result.response).toBe('streamed');
    expect(streaming.complete).not.toHaveBeenCalled();

    const seenOff: string[] = [];
    await mk().ask('hello', {
      noCache: true,
      stream: false,
      onEvent: (e) => {
        if (e.type === 'delta') seenOff.push(e.text);
      },
    });
    expect(streaming.complete).toHaveBeenCalledTimes(1);
    // Fallback path still emits deltas, just not incrementally.
    expect(seenOff).toEqual(['streamed']);
  });

  it('honours MUGIL_IDE_NO_STREAM=1 as the global streaming kill switch', async () => {
    const streaming = {
      mock: false,
      complete: jest.fn().mockResolvedValue({
        provider: 'openai',
        model: 'm',
        content: 'buffered',
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        finishReason: 'stop',
      }),
      stream: jest.fn(),
    };
    const pipeline = new Pipeline({
      cache: new SmartCache({
        backend: new MemoryBackend(),
        ttlSeconds: 3600,
        embedding: new LexicalEmbedding(),
      }),
      handoff: new HandoffManager({ client: streaming as unknown as ProviderClient, models: MODELS }),
    });

    process.env.MUGIL_IDE_NO_STREAM = '1';
    try {
      const seen: string[] = [];
      await pipeline.ask('hello', {
        noCache: true,
        onEvent: (e) => {
          if (e.type === 'delta') seen.push(e.text);
        },
      });
      expect(streaming.stream).not.toHaveBeenCalled();
      expect(seen).toEqual(['buffered']);
    } finally {
      delete process.env.MUGIL_IDE_NO_STREAM;
    }
  });

  it('honours MUGIL_IDE_NO_STREAM=1 on the tool-bearing branch too', async () => {
    const client = {
      mock: false,
      complete: jest.fn().mockResolvedValue({
        provider: 'openai',
        model: 'tool-model',
        content: 'buffered',
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        finishReason: 'stop',
      }),
      stream: jest.fn(),
    };
    const pipeline = new Pipeline({
      cache: new SmartCache({
        backend: new MemoryBackend(),
        ttlSeconds: 3600,
        embedding: new LexicalEmbedding(),
      }),
      handoff: new HandoffManager({ client: client as unknown as ProviderClient, models: MODELS }),
    });
    const tools = [{ name: 'add', description: 'add two numbers', parameters: {} }];
    const toolRegistry = {
      add: async (call: ToolCall): Promise<string> => {
        const args = JSON.parse(call.arguments) as { a: number; b: number };
        return String(args.a + args.b);
      },
    };

    // The tool loop builds its own run options, so only a check inside
    // streamCompletion itself reaches this branch.
    process.env.MUGIL_IDE_NO_STREAM = '1';
    try {
      const seen: string[] = [];
      const result = await pipeline.ask('2 + 3', {
        tools,
        toolRegistry,
        noCache: true,
        onEvent: (e) => {
          if (e.type === 'delta') seen.push(e.text);
        },
      });
      expect(client.stream).not.toHaveBeenCalled();
      expect(client.complete).toHaveBeenCalledTimes(1);
      expect(seen).toEqual(['buffered']);
      expect(result.response).toBe('buffered');
    } finally {
      delete process.env.MUGIL_IDE_NO_STREAM;
    }
  });

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

  it('throws when prompt exceeds context window', async () => {
    const pipeline = makePipeline();
    // 8,000 words + margin (1024) exceeds 8000 contextWindow
    const hugePrompt = 'word '.repeat(8000);
    await expect(pipeline.ask(hugePrompt, { noCache: true })).rejects.toThrow(/Context overflow/);
  });
});
