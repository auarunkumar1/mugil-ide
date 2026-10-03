import {
  iterateSseEvents,
  parseAnthropicSse,
  parseOpenAiSse,
  streamCompletion,
  streamFromChunks,
} from '../src/modules/handoff/stream.js';
import { HandoffManager } from '../src/modules/handoff/index.js';
import { ProviderError, type ProviderClient, type ProviderCompleteOptions } from '../src/modules/handoff/provider.js';
import { OpenAiClient } from '../src/modules/handoff/openAi.js';
import { AnthropicClient } from '../src/modules/handoff/anthropic.js';
import { OpenRouterClient } from '../src/modules/handoff/openRouter.js';
import { VercelClient } from '../src/modules/handoff/vercel.js';
import { TogetherClient } from '../src/modules/handoff/together.js';
import { CloudflareClient } from '../src/modules/handoff/cloudflare.js';
import type { ChatMessage, CompletionResult, ModelSpec } from '../src/types.js';

const MSGS: ChatMessage[] = [{ role: 'user', content: 'hi' }];

describe('iterateSseEvents', () => {
  it('reassembles events split across chunk boundaries', async () => {
    const stream = streamFromChunks(['data: {"a":', '1}\n\n', 'data: [DONE]\n\n']);
    const events: string[] = [];
    for await (const ev of iterateSseEvents(stream)) events.push(ev.data);
    expect(events).toEqual(['{"a":1}', '[DONE]']);
  });

  it('handles CRLF line endings and ignores comment lines', async () => {
    const stream = streamFromChunks([': keep-alive\r\n\r\ndata: one\r\n\r\n']);
    const events: string[] = [];
    for await (const ev of iterateSseEvents(stream)) events.push(ev.data);
    expect(events).toEqual(['one']);
  });

  it('reads the event name when present', async () => {
    const stream = streamFromChunks(['event: ping\ndata: {}\n\n']);
    const seen: Array<{ event?: string; data: string }> = [];
    for await (const ev of iterateSseEvents(stream)) seen.push(ev);
    expect(seen[0]!.event).toBe('ping');
    expect(seen[0]!.data).toBe('{}');
  });
});

describe('parseOpenAiSse', () => {
  it('accumulates content deltas, tool calls, finish reason and usage', async () => {
    const stream = streamFromChunks([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.ts\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":9,"completion_tokens":4,"total_tokens":13}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const deltas: string[] = [];
    const out = await parseOpenAiSse(stream, { onDelta: (t) => deltas.push(t) });

    expect(deltas).toEqual(['Hel', 'lo']);
    expect(out.content).toBe('Hello');
    expect(out.finishReason).toBe('tool_calls');
    expect(out.usage).toEqual({ promptTokens: 9, completionTokens: 4, totalTokens: 13 });
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0]!.name).toBe('read_file');
    expect(out.toolCalls[0]!.arguments).toBe('{"path":"a.ts"}');
  });

  it('captures reasoning_content deltas separately', async () => {
    const stream = streamFromChunks([
      'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"out"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const out = await parseOpenAiSse(stream);
    expect(out.thinking).toBe('think');
    expect(out.content).toBe('out');
  });

  it('ends cleanly on [DONE] with no trailing newline', async () => {
    const stream = streamFromChunks(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n', 'data: [DONE]']);
    await expect(parseOpenAiSse(stream)).resolves.toMatchObject({ content: 'x' });
  });
});

describe('parseAnthropicSse', () => {
  it('accumulates text, thinking and tool_use blocks', async () => {
    const stream = streamFromChunks([
      'event: message_start\ndata: {"message":{"usage":{"input_tokens":11}}}\n\n',
      'event: content_block_delta\ndata: {"delta":{"type":"thinking_delta","thinking":"hmm"}}\n\n',
      'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hi"}}\n\n',
      'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":" there"}}\n\n',
      'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"t1","name":"read_file"}}\n\n',
      'event: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"pa"}}\n\n',
      'event: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":"th\\":\\"a.ts\\"}"}}\n\n',
      'event: content_block_start\ndata: {"index":1,"content_block":{"type":"tool_use","id":"t2","name":"write_file"}}\n\n',
      'event: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"b.ts\\"}"}}\n\n',
      'event: message_delta\ndata: {"delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}\n\n',
    ]);
    const deltas: string[] = [];
    const out = await parseAnthropicSse(stream, { onDelta: (t) => deltas.push(t) });

    expect(deltas).toEqual(['Hi', ' there']);
    expect(out.content).toBe('Hi there');
    expect(out.thinking).toBe('hmm');
    expect(out.finishReason).toBe('tool_use');
    expect(out.toolCalls).toHaveLength(2);
    expect(out.toolCalls[0]).toMatchObject({ id: 't1', name: 'read_file' });
    expect(out.toolCalls[1]).toMatchObject({ id: 't2', name: 'write_file' });
    // Fragments only form valid JSON once concatenated, so this fails if
    // `input_json_delta` accumulation is dropped.
    expect(out.toolCalls[0]!.arguments).toBe('{"path":"a.ts"}');
    expect(out.toolCalls[1]!.arguments).toBe('{"path":"b.ts"}');
    expect(out.usage).toEqual({ promptTokens: 11, completionTokens: 5, totalTokens: 16 });
  });
});

function okResponse(body: string): Response {
  return new Response(streamFromChunks([body]), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function spec(id: string): ModelSpec {
  return { id, tier: 'standard', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 128000 };
}

/** Manager over a three-model ladder, so a walk has somewhere to go. */
function ladder(client: ProviderClient): HandoffManager {
  return new HandoffManager({ client, models: ['a', 'b', 'c'].map(spec) });
}

function resultFor(model: string): CompletionResult {
  return {
    provider: 'test',
    model,
    content: 'answer',
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    finishReason: 'stop',
  };
}

describe('streamCompletion dispatcher', () => {
  it('falls back to complete() and emits one delta for a provider with no stream()', async () => {
    const complete = jest.fn(async (): Promise<CompletionResult> => ({
      provider: 'openai',
      model: 'm',
      content: 'whole answer',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      finishReason: 'stop',
    }));
    const deltas: string[] = [];
    const out = await streamCompletion(ladder({ mock: false, complete }), MSGS, {}, {
      onDelta: (t) => deltas.push(t),
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(['whole answer']);
    expect(out.content).toBe('whole answer');
  });

  it('prefers stream() when the provider implements it', async () => {
    const complete = jest.fn();
    const deltas: string[] = [];
    const out = await streamCompletion(
      ladder({
        mock: false,
        complete: complete as never,
        stream: async (_m, _o, h) => {
          h?.onDelta?.('a');
          h?.onDelta?.('b');
          return resultFor('a');
        },
      }),
      MSGS,
      {},
      { onDelta: (t) => deltas.push(t) },
    );
    expect(complete).not.toHaveBeenCalled();
    expect(deltas).toEqual(['a', 'b']);
    expect(out.content).toBe('answer');
    expect(out.attempts).toEqual(['a']);
  });

  it('honours stream:false even when the provider can stream', async () => {
    const complete = jest.fn(async (): Promise<CompletionResult> => ({
      provider: 'openai',
      model: 'm',
      content: 'whole',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }));
    const stream = jest.fn();
    const deltas: string[] = [];
    await streamCompletion(
      ladder({ mock: false, complete, stream: stream as never }),
      MSGS,
      { stream: false },
      { onDelta: (t) => deltas.push(t) },
    );
    expect(stream).not.toHaveBeenCalled();
    expect(deltas).toEqual(['whole']);
  });

  it('walks the ladder when a provider rejects the stream (I1/I3)', async () => {
    const stream = jest.fn(async (_m: ChatMessage[], o: ProviderCompleteOptions) => {
      if (o.model === 'a') throw new ProviderError('rate limited', 429, true);
      return resultFor(o.model);
    });
    const out = await streamCompletion(ladder({ mock: false, complete: jest.fn() as never, stream }), MSGS);

    expect(out.model).toBe('b');
    expect(out.attempts).toEqual(['a', 'b']);
    expect(stream.mock.calls.map((c) => c[1].model)).toEqual(['a', 'b']);
  });

  it('keeps preferredModel authoritative and never escalates past it', async () => {
    const stream = jest.fn(async () => {
      throw new ProviderError('model gone', 404, false);
    });
    await expect(
      streamCompletion(ladder({ mock: false, complete: jest.fn() as never, stream }), MSGS, {
        preferredModel: 'pinned',
      }),
    ).rejects.toThrow('model gone');
    expect(stream.mock.calls.map((c) => c[1].model)).toEqual(['pinned']);
  });

  it('stops on a non-retryable 400 instead of walking the ladder', async () => {
    const stream = jest.fn(async () => {
      throw new ProviderError('bad request', 400, false);
    });
    await expect(
      streamCompletion(ladder({ mock: false, complete: jest.fn() as never, stream }), MSGS),
    ).rejects.toThrow('bad request');
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('stops on a user cancel instead of walking the ladder', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    const stream = jest.fn(async () => {
      throw abort;
    });
    await expect(
      streamCompletion(ladder({ mock: false, complete: jest.fn() as never, stream }), MSGS),
    ).rejects.toThrow('The operation was aborted');
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('replays the buffered answer as one delta when the provider has no stream()', async () => {
    const thinking: string[] = [];
    const out = await streamCompletion(
      ladder({
        mock: false,
        complete: async (): Promise<CompletionResult> => ({
          provider: 'openai',
          model: 'm',
          content: 'buffered',
          thinking: 'pondering',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        }),
      }),
      MSGS,
      {},
      { onThinking: (t) => thinking.push(t) },
    );
    expect(out.content).toBe('buffered');
    expect(thinking).toEqual(['pondering']);
  });
});

describe('OpenAiClient.stream', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('requests stream:true and returns the aggregated completion', async () => {
    let seenBody: Record<string, unknown> = {};
    global.fetch = (async (_url: string, init: RequestInit) => {
      seenBody = JSON.parse(init.body as string);
      return okResponse(
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n' +
          'data: [DONE]\n\n',
      );
    }) as unknown as typeof fetch;

    const deltas: string[] = [];
    const client = new OpenAiClient({ apiKey: 'sk-test', baseUrl: 'https://example.test/v1' });
    const out = await client.stream!(MSGS, { model: 'gpt-x' }, { onDelta: (t) => deltas.push(t) });

    expect(seenBody.stream).toBe(true);
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(out.content).toBe('Hello');
    expect(out.usage).toEqual({ promptTokens: 3, completionTokens: 2, totalTokens: 5 });
    expect(out.finishReason).toBe('stop');
  });

  it('asks for streamed usage and leaves the non-streaming body untouched', async () => {
    let streamBody: Record<string, unknown> = {};
    let completeBody: Record<string, unknown> = {};
    const payload =
      'data: {"choices":[{"delta":{"content":"a"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const client = new OpenAiClient({ apiKey: 'sk-test', baseUrl: 'https://example.test/v1' });

    global.fetch = (async (_url: string, init: RequestInit) => {
      streamBody = JSON.parse(init.body as string);
      return okResponse(payload);
    }) as unknown as typeof fetch;
    await client.stream!(MSGS, { model: 'gpt-x' });

    global.fetch = (async (_url: string, init: RequestInit) => {
      completeBody = JSON.parse(init.body as string);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await client.complete(MSGS, { model: 'gpt-x' });

    expect(streamBody.stream_options).toEqual({ include_usage: true });
    expect(completeBody.stream).toBeUndefined();
    expect(completeBody.stream_options).toBeUndefined();
  });

  it('promotes a reasoning-only turn so it never renders blank (R1)', async () => {
    global.fetch = (async () =>
      okResponse(
        'data: {"choices":[{"delta":{"reasoning_content":"pondering"}}]}\n\n' +
          'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n' +
          'data: [DONE]\n\n',
      )) as unknown as typeof fetch;
    const client = new OpenAiClient({ apiKey: 'sk-test', baseUrl: 'https://example.test/v1' });
    const out = await client.stream!(MSGS, { model: 'o3-mini' });
    expect(out.content).toBe('pondering');
    expect(out.thinking).toBe('pondering');
  });

  it('splits a <think> block out of streamed content (R1)', async () => {
    global.fetch = (async () =>
      okResponse(
        'data: {"choices":[{"delta":{"content":"<think>reason</think>answer"}}]}\n\n' +
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
          'data: [DONE]\n\n',
      )) as unknown as typeof fetch;
    const client = new OpenAiClient({ apiKey: 'sk-test', baseUrl: 'https://example.test/v1' });
    const out = await client.stream!(MSGS, { model: 'deepseek-r1' });
    expect(out.content).toBe('answer');
    expect(out.thinking).toBe('reason');
  });
});

describe('AnthropicClient.stream', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('sends stream:true without stream_options and aggregates usage', async () => {
    let seenBody: Record<string, unknown> = {};
    global.fetch = (async (_url: string, init: RequestInit) => {
      seenBody = JSON.parse(init.body as string);
      return okResponse(
        'event: message_start\ndata: {"message":{"usage":{"input_tokens":7}}}\n\n' +
          'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hi"}}\n\n' +
          'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
      );
    }) as unknown as typeof fetch;

    const deltas: string[] = [];
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' });
    const out = await client.stream!(MSGS, { model: 'claude-x' }, { onDelta: (t) => deltas.push(t) });

    expect(seenBody.stream).toBe(true);
    expect(seenBody.stream_options).toBeUndefined();
    expect(deltas).toEqual(['Hi']);
    expect(out.content).toBe('Hi');
    expect(out.usage).toEqual({ promptTokens: 7, completionTokens: 2, totalTokens: 9 });
    expect(out.finishReason).toBe('end_turn');
  });

  it('promotes a thinking-only turn when max_tokens runs out mid-reasoning (R1)', async () => {
    global.fetch = (async () =>
      okResponse(
        'event: content_block_delta\ndata: {"delta":{"type":"thinking_delta","thinking":"half a thought"}}\n\n' +
          'event: message_delta\ndata: {"delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":9}}\n\n',
      )) as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' });
    const out = await client.stream!(MSGS, { model: 'claude-x' });
    expect(out.content).toBe('half a thought');
    expect(out.thinking).toBe('half a thought');
  });
});

describe('OpenAI-format gateway clients stream', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const CASES: Array<{ name: string; provider: string; client: ProviderClient }> = [
    { name: 'openRouter', provider: 'openrouter', client: new OpenRouterClient({ apiKey: 'k' }) },
    { name: 'vercel', provider: 'vercel', client: new VercelClient({ apiKey: 'k' }) },
    { name: 'together', provider: 'together', client: new TogetherClient({ apiKey: 'k' }) },
    {
      name: 'cloudflare',
      provider: 'cloudflare',
      client: new CloudflareClient({ apiKey: 'k', accountId: 'acct' }),
    },
  ];

  const SSE =
    'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n' +
    'data: [DONE]\n\n';

  /** Routes on `stream` so one mocked fetch can serve both paths. */
  function captureBodies(): { stream: Record<string, unknown>; complete: Record<string, unknown> } {
    const seen = { stream: {} as Record<string, unknown>, complete: {} as Record<string, unknown> };
    global.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      if (body.stream) {
        seen.stream = body;
        return okResponse(SSE);
      }
      seen.complete = body;
      return new Response(
        JSON.stringify({ model: 'srv', choices: [{ message: { content: 'buffered' } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    return seen;
  }

  it.each(CASES)('$name sends stream:true + stream_options and tags its provider', async ({ client, provider }) => {
    const seen = captureBodies();

    const out = await client.stream!(MSGS, { model: 'm' });
    expect(seen.stream.stream).toBe(true);
    expect(seen.stream.stream_options).toEqual({ include_usage: true });
    expect(out.provider).toBe(provider);
    expect(out.content).toBe('ok');
    expect(out.usage).toEqual({ promptTokens: 1, completionTokens: 1, totalTokens: 2 });
  });

  it.each(CASES)('$name keeps stream/stream_options out of the buffered body', async ({ client }) => {
    const seen = captureBodies();

    await client.complete(MSGS, { model: 'm' });
    expect(seen.complete.stream).toBeUndefined();
    expect(seen.complete.stream_options).toBeUndefined();
  });

  it.each(CASES)('$name splits <think> on the buffered path like the streaming path', async ({ client }) => {
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '<think>reason</think>answer' } }],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const out = await client.complete(MSGS, { model: 'deepseek-r1' });
    expect(out.content).toBe('answer');
    expect(out.thinking).toBe('reason');
  });
});
