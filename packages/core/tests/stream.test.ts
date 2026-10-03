import {
  iterateSseEvents,
  parseAnthropicSse,
  parseOpenAiSse,
  streamFromChunks,
} from '../src/modules/handoff/stream.js';

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
