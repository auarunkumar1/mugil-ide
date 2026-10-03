import {
  iterateSseEvents,
  parseAnthropicSse,
  parseOpenAiSse,
  streamCompletion,
  streamFromChunks,
} from '../src/modules/handoff/stream.js';
import { OpenAiClient } from '../src/modules/handoff/openAi.js';
import { AnthropicClient } from '../src/modules/handoff/anthropic.js';
import type { ChatMessage, CompletionResult } from '../src/types.js';

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
    const out = await streamCompletion({ mock: false, complete }, MSGS, { model: 'm' }, {
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
      {
        mock: false,
        complete: complete as never,
        stream: async (_m, _o, h) => {
          h?.onDelta?.('a');
          h?.onDelta?.('b');
          return {
            provider: 'openai',
            model: 'm',
            content: 'ab',
            usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
            finishReason: 'stop',
          };
        },
      },
      MSGS,
      { model: 'm' },
      { onDelta: (t) => deltas.push(t) },
    );
    expect(complete).not.toHaveBeenCalled();
    expect(deltas).toEqual(['a', 'b']);
    expect(out.content).toBe('ab');
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
      { mock: false, complete, stream: stream as never },
      MSGS,
      { model: 'm', stream: false },
      { onDelta: (t) => deltas.push(t) },
    );
    expect(stream).not.toHaveBeenCalled();
    expect(deltas).toEqual(['whole']);
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
