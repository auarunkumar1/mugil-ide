import { HandoffManager } from '../src/modules/handoff/index.js';
import { OpenRouterClient, OpenRouterError } from '../src/modules/handoff/openRouter.js';
import { mockCompletion, type ProviderClient } from '../src/modules/handoff/provider.js';
import type { ChatMessage, CompletionResult, ModelSpec } from '../src/types.js';

const MODELS: ModelSpec[] = [
  { id: 'cheap-1', tier: 'cheap', costPerMTokIn: 0.1, costPerMTokOut: 0.3, contextWindow: 8000 },
  { id: 'smart-1', tier: 'smart', costPerMTokIn: 3, costPerMTokOut: 15, contextWindow: 200000 },
];

describe('OpenRouterClient', () => {
  it('runs in mock mode without an API key', async () => {
    const client = new OpenRouterClient({});
    expect(client.mock).toBe(true);
    const result = await client.complete(
      [{ role: 'user', content: 'hello' }],
      { model: 'cheap-1' },
    );
    expect(result.mock).toBe(true);
    expect(result.content).toContain('hello');
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });

  it('throws a typed retryable error on 429', async () => {
    const client = new OpenRouterClient({
      apiKey: 'sk-test',
      baseUrl: 'https://httpstat.us', // will not be reached
    });
    // Simulate a 429 by stubbing fetch.
    const original = global.fetch;
    global.fetch = (async () =>
      new Response('rate limited', { status: 429 })) as typeof fetch;
    try {
      const err = await client
        .complete([{ role: 'user', content: 'x' }], { model: 'cheap-1' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(OpenRouterError);
      expect((err as OpenRouterError).status).toBe(429);
      expect((err as OpenRouterError).retryable).toBe(true);
    } finally {
      global.fetch = original;
    }
  });
});

describe('HandoffManager', () => {
  it('forwards the abort signal and timeout to the provider', async () => {
    const seen: Array<{ signal?: AbortSignal; timeoutMs?: number }> = [];
    const client = {
      mock: false,
      async complete(
        _messages: ChatMessage[],
        options: { signal?: AbortSignal; timeoutMs?: number },
      ): Promise<CompletionResult> {
        seen.push({ signal: options.signal, timeoutMs: options.timeoutMs });
        return {
          provider: 'openrouter',
          model: 'cheap-1',
          content: 'ok',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      },
    };
    const manager = new HandoffManager({ client: client as unknown as OpenRouterClient, models: MODELS });
    const controller = new AbortController();
    await manager.complete([{ role: 'user', content: 'hi' }], {
      signal: controller.signal,
      timeoutMs: 1234,
    });
    expect(seen[0]!.signal).toBe(controller.signal);
    expect(seen[0]!.timeoutMs).toBe(1234);
  });

  it('does not walk the fallback chain after a user cancel', async () => {
    const attempted: string[] = [];
    const client = {
      mock: false,
      async complete(
        _messages: ChatMessage[],
        options: { model: string },
      ): Promise<CompletionResult> {
        attempted.push(options.model);
        const err = new Error('cancelled by user');
        err.name = 'AbortError';
        throw err;
      },
    };
    const manager = new HandoffManager({ client: client as unknown as OpenRouterClient, models: MODELS });
    await expect(manager.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow('cancelled');
    // An abort is a user decision, not a model failure — retrying other models
    // would restart the request the user just cancelled.
    expect(attempted).toEqual(['cheap-1']);
  });

  it('routes to cheapest model that fits the context', () => {
    const manager = new HandoffManager({ client: new OpenRouterClient({}), models: MODELS });
    expect(manager.route(100).id).toBe('cheap-1');
    expect(manager.route(100, 'smart-1').id).toBe('smart-1');
  });

  it('hands off to the next model when the first fails', async () => {
    const failing = {
      mock: false,
      async complete(
        _messages: ChatMessage[],
        options: { model: string },
      ): Promise<CompletionResult> {
        if (options.model === 'cheap-1') {
          throw new OpenRouterError('upstream', 429, true);
        }
        return {
          provider: 'openrouter',
          model: options.model,
          content: 'from smart',
          usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
        };
      },
    };
    const manager = new HandoffManager({ client: failing as unknown as OpenRouterClient, models: MODELS });
    const result = await manager.complete([{ role: 'user', content: 'hi' }]);
    expect(result.content).toBe('from smart');
    expect(result.attempts[0]).toBe('cheap-1');
    expect(result.attempts[1]).toBe('smart-1');
  });

  it('does not escalate to the ladder when an explicit model is requested', async () => {
    const calls: string[] = [];
    const failing = {
      mock: false,
      async complete(
        _messages: ChatMessage[],
        options: { model: string },
      ): Promise<CompletionResult> {
        calls.push(options.model);
        throw new OpenRouterError('boom', 429, true);
      },
    };
    const manager = new HandoffManager({ client: failing as unknown as OpenRouterClient, models: MODELS });
    await expect(
      manager.complete([{ role: 'user', content: 'hi' }], { preferredModel: 'smart-1' }),
    ).rejects.toThrow('boom');
    expect(calls).toEqual(['smart-1']);
  });

  it('honors an explicit fallbackChain alongside a preferred model', async () => {
    const calls: string[] = [];
    const failing = {
      mock: false,
      async complete(
        _messages: ChatMessage[],
        options: { model: string },
      ): Promise<CompletionResult> {
        calls.push(options.model);
        if (options.model === 'smart-1') {
          throw new OpenRouterError('boom', 429, true);
        }
        return {
          provider: 'openrouter',
          model: options.model,
          content: 'from fallback',
          usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
        };
      },
    };
    const manager = new HandoffManager({ client: failing as unknown as OpenRouterClient, models: MODELS });
    const result = await manager.complete(
      [{ role: 'user', content: 'hi' }],
      { preferredModel: 'smart-1', fallbackChain: ['cheap-1'] },
    );
    expect(calls).toEqual(['smart-1', 'cheap-1']);
    expect(result.content).toBe('from fallback');
  });

  it('forwards tools to the provider client', async () => {
    const client = {
      mock: false,
      complete: jest.fn().mockResolvedValue(mockCompletion([], { model: 'm' }, 'X')),
    };
    const manager = new HandoffManager({ client: client as unknown as ProviderClient, models: [] });
    await manager.complete([{ role: 'user', content: 'hi' }], {
      tools: [{ name: 'add', description: 'add', parameters: {} }],
    });
    expect(client.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tools: [{ name: 'add', description: 'add', parameters: {} }] }),
    );
  });

  it('does not burn the chain on a 400 auth error', async () => {
    const calls: string[] = [];
    const failing = {
      mock: false,
      async complete(
        _messages: ChatMessage[],
        options: { model: string },
      ): Promise<CompletionResult> {
        calls.push(options.model);
        throw new OpenRouterError('invalid key', 400, false);
      },
    };
    const manager = new HandoffManager({ client: failing as unknown as OpenRouterClient, models: MODELS });
    await expect(manager.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow();
    expect(calls.length).toBe(1);
  });
});
