# Streaming Model Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver model output token-by-token to the terminal and browser so long answers appear progressively instead of appearing all at once after the request completes.

**Architecture:** Add pure SSE parsers in a new `stream.ts`, then an optional `stream()` method on `ProviderClient` that falls back to `complete()` for providers that cannot stream. Deltas flow `provider → ToolLoop.onDelta → PipelineEvent{type:'delta'} → AgentRepl.io.write`. The browser needs **no** transport change: `ReplIO.write` already becomes an `agent_data` WebSocket frame that xterm writes incrementally.

**Tech Stack:** TypeScript, Node 20 global `fetch` + `ReadableStream`, SSE (`text/event-stream`), Jest (`ts-jest`), WebSocket (`ws`), xterm.js.

## Global Constraints

- Node.js >= 20 (global `fetch`, `ReadableStream`, `TextDecoder` streaming). No new npm dependencies.
- Streaming is **opt-out per request**: `AskOptions.stream?: boolean` defaults to `true`. `MUGIL_IDE_NO_STREAM=1` forces it off globally.
- Every streaming request must honour the existing `signal` / `timeoutMs` from `ProviderCompleteOptions` (added in v0.1.13 unreleased work) — see `requestSignal()` in `packages/core/src/modules/handoff/provider.ts`.
- A provider that cannot stream MUST behave exactly as today: same request, same `CompletionResult`, same token accounting. The only difference is one `delta` event carrying the whole text.
- Streaming changes **rendering only**. `AskResult.response`, `usage`, `finishReason`, `truncated` and the smart-cache store path must be byte-identical to the non-streaming path.
- All new source files use `.ts` + `.js` ESM import specifiers (repo convention).
- ESLint must pass with zero errors; `npm run typecheck` and `npm test` must be green before each commit.

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/modules/handoff/stream.ts` | **Create.** Pure SSE frame parser + `streamCompletion()` dispatcher. No I/O beyond reading the response body. |
| `packages/core/src/modules/handoff/provider.ts` | **Modify.** Add optional `stream()` to `ProviderClient`; add `stream?: boolean` to `ProviderCompleteOptions`. |
| `packages/core/src/modules/handoff/openAi.ts` | **Modify.** Implement `stream()` (OpenAI wire format). |
| `packages/core/src/modules/handoff/anthropic.ts` | **Modify.** Implement `stream()` (Anthropic wire format). |
| `packages/core/src/modules/handoff/openRouter.ts`, `vercel.ts`, `together.ts`, `cloudflare.ts` | **Modify.** Implement `stream()` (all OpenAI-compatible; delegate to a shared helper). |
| `packages/core/src/types.ts` | **Modify.** Add `PipelineEvent` variant `{ type: 'delta'; text: string }`. |
| `packages/core/src/modules/tool-loop/index.ts` | **Modify.** Accept `onDelta`, forward to handoff, flush provisional deltas. |
| `packages/core/src/pipeline.ts` | **Modify.** Accept `stream`, pass through, emit `delta` events. |
| `packages/cli/src/terminal/agentRepl.ts` | **Modify.** Render deltas live; discard provisional text when a tool call follows. |
| `packages/core/tests/stream.test.ts` | **Create.** SSE parser + dispatcher tests (fake `fetch`, no network). |
| `packages/core/tests/toolLoop.test.ts` | **Modify.** Delta forwarding tests. |
| `packages/core/tests/pipeline.test.ts` | **Modify.** `stream: false` and default-stream tests. |

---

### Task 1: SSE Parsers

Pure functions over a `ReadableStream<Uint8Array>`. No network, no providers.

**Files:**
- Create: `packages/core/src/modules/handoff/stream.ts`
- Test: `packages/core/tests/stream.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  ```ts
  export interface StreamHandlers {
    onDelta?: (text: string) => void;
    onThinking?: (text: string) => void;
  }
  export interface StreamedCompletion {
    content: string;
    thinking: string;
    toolCalls: ToolCall[];
    finishReason?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  }
  export function parseOpenAiSse(
    body: ReadableStream<Uint8Array>,
    handlers?: StreamHandlers,
  ): Promise<StreamedCompletion>;
  export function parseAnthropicSse(
    body: ReadableStream<Uint8Array>,
    handlers?: StreamHandlers,
  ): Promise<StreamedCompletion>;
  /** Turns a byte stream into SSE events, handling CRLF and chunk splits mid-frame. */
  export function* iterateSseEvents(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<{ event?: string; data: string }>;
  /** Builds a ReadableStream from raw string chunks — test helper, exported for tests. */
  export function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array>;
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/stream.test.ts`:

```ts
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
      'event: content_block_start\ndata: {"content_block":{"type":"tool_use","id":"t1","name":"list_files"}}\n\n',
      'event: content_block_delta\ndata: {"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
      'event: message_delta\ndata: {"delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}\n\n',
    ]);
    const deltas: string[] = [];
    const out = await parseAnthropicSse(stream, { onDelta: (t) => deltas.push(t) });

    expect(deltas).toEqual(['Hi', ' there']);
    expect(out.content).toBe('Hi there');
    expect(out.thinking).toBe('hmm');
    expect(out.finishReason).toBe('tool_use');
    expect(out.toolCalls[0]).toMatchObject({ id: 't1', name: 'list_files' });
    expect(out.usage).toEqual({ promptTokens: 11, completionTokens: 5 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx jest tests/stream.test.ts`
Expected: FAIL — `Cannot find module '../src/modules/handoff/stream.js'`.

- [ ] **Step 3: Implement `stream.ts`**

Create `packages/core/src/modules/handoff/stream.ts`:

```ts
/**
 * Server-Sent Events parsing for streaming completions.
 *
 * Two wire formats cover every provider in this repo:
 *   - OpenAI-compatible (`openAi`, `openRouter`, `vercel`, `together`,
 *     `cloudflare`): `data: {"choices":[{"delta":{...}}]}` terminated by
 *     `data: [DONE]`.
 *   - Anthropic (`anthropic`): named events (`message_start`,
 *     `content_block_delta`, ...) with no terminator.
 *
 * These functions are pure: they take a byte stream and return the aggregated
 * result. No provider knowledge, no I/O.
 */
import type { ToolCall } from '../../types.js';

export interface StreamHandlers {
  /** Called for each visible text fragment, in order. */
  onDelta?: (text: string) => void;
  /** Called for each reasoning fragment (thinking / reasoning_content). */
  onThinking?: (text: string) => void;
}

export interface StreamedCompletion {
  content: string;
  thinking: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/** Test helper (and the shape real `Response.body` has). */
export function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/**
 * Yields one SSE event per complete frame. A frame boundary is a blank line;
 * frames split across byte chunks are buffered until complete, which is the
 * normal case with real providers.
 */
export async function* iterateSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Normalise CRLF so a single blank-line test covers both conventions.
      buffer = buffer.replace(/\r\n/g, '\n');
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
      }
    }
    const tail = parseFrame(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): { event?: string; data: string } | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.length === 0 || line.startsWith(':')) continue; // blank / keep-alive
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (data.length === 0) return undefined;
  return { event, data: data.join('\n') };
}

function safeJson(data: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return undefined; // keep-alive payloads and partial frames
  }
}

export async function parseOpenAiSse(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers = {},
): Promise<StreamedCompletion> {
  let content = '';
  let thinking = '';
  let finishReason: string | undefined;
  let usage: StreamedCompletion['usage'];
  // Tool call fragments arrive keyed by `index`; arguments accumulate across
  // frames and only form valid JSON once complete.
  const partial = new Map<number, { id: string; name: string; args: string }>();

  for await (const ev of iterateSseEvents(body)) {
    if (ev.data === '[DONE]') break;
    const json = safeJson(ev.data);
    if (!json) continue;
    if (json.usage) {
      const u = json.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      usage = {
        promptTokens: u.prompt_tokens,
        completionTokens: u.completion_tokens,
        totalTokens: u.total_tokens,
      };
    }
    const choice = (json.choices as Array<Record<string, any>> | undefined)?.[0];
    if (!choice) continue;
    if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      content += delta.content;
      handlers.onDelta?.(delta.content);
    }
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      thinking += reasoning;
      handlers.onThinking?.(reasoning);
    }
    for (const tc of (delta.tool_calls as Array<Record<string, any>>) ?? []) {
      const idx = typeof tc.index === 'number' ? tc.index : 0;
      const slot = partial.get(idx) ?? { id: '', name: '', args: '' };
      if (typeof tc.id === 'string' && tc.id) slot.id = tc.id;
      if (typeof tc.function?.name === 'string' && tc.function.name) slot.name = tc.function.name;
      if (typeof tc.function?.arguments === 'string') slot.args += tc.function.arguments;
      partial.set(idx, slot);
    }
  }

  const toolCalls: ToolCall[] = [...partial.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, v]) => v.name.length > 0)
    .map(([, v]) => ({ id: v.id, name: v.name, arguments: v.args || '{}' }));

  return { content, thinking, toolCalls, finishReason, usage };
}

export async function parseAnthropicSse(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers = {},
): Promise<StreamedCompletion> {
  let content = '';
  let thinking = '';
  let finishReason: string | undefined;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  // Anthropic streams tool inputs as `input_json_delta` fragments belonging to
  // the block most recently announced by `content_block_start`.
  const blocks = new Map<number, { id: string; name: string; args: string }>();
  let currentToolIndex: number | null = null;

  for await (const ev of iterateSseEvents(body)) {
    const json = safeJson(ev.data);
    if (!json) continue;
    const type = (ev.event ?? json.type) as string;

    if (type === 'message_start') {
      const input = (json.message as { usage?: { input_tokens?: number } } | undefined)?.usage;
      promptTokens = input?.input_tokens;
      continue;
    }
    if (type === 'message_delta') {
      const stop = (json.delta as { stop_reason?: string } | undefined)?.stop_reason;
      if (typeof stop === 'string') finishReason = stop;
      const out = (json.usage as { output_tokens?: number } | undefined)?.output_tokens;
      if (typeof out === 'number') completionTokens = out;
      continue;
    }
    if (type === 'content_block_start') {
      const block = json.content_block as { type?: string; id?: string; name?: string } | undefined;
      if (block?.type === 'tool_use') {
        const idx = typeof json.index === 'number' ? json.index : blocks.size;
        currentToolIndex = idx;
        blocks.set(idx, { id: block.id ?? '', name: block.name ?? '', args: '' });
      }
      continue;
    }
    if (type !== 'content_block_delta') continue;

    const delta = json.delta as
      | { type?: string; text?: string; thinking?: string; partial_json?: string }
      | undefined;
    if (!delta) continue;
    if (delta.type === 'text_delta' && typeof delta.text === 'string') {
      content += delta.text;
      handlers.onDelta?.(delta.text);
    } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      thinking += delta.thinking;
      handlers.onThinking?.(delta.thinking);
    } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      const slot = currentToolIndex !== null ? blocks.get(currentToolIndex) : undefined;
      if (slot) slot.args += delta.partial_json;
    }
  }

  return {
    content,
    thinking,
    toolCalls: [...blocks.values()].map((b) => ({ id: b.id, name: b.name, arguments: b.args || '{}' })),
    finishReason,
    usage:
      promptTokens !== undefined || completionTokens !== undefined
        ? {
            promptTokens,
            completionTokens,
            totalTokens:
              (promptTokens ?? 0) + (completionTokens ?? 0) || undefined,
          }
        : undefined,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && npx jest tests/stream.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/handoff/stream.ts packages/core/tests/stream.test.ts
git commit -m "feat(handoff): add SSE parsers for OpenAI and Anthropic stream formats"
```

---

### Task 2: `ProviderClient.stream()` with Non-Streaming Fallback

**Files:**
- Modify: `packages/core/src/modules/handoff/provider.ts`
- Modify: `packages/core/src/modules/handoff/openAi.ts`
- Modify: `packages/core/src/modules/handoff/anthropic.ts`
- Modify: `packages/core/src/modules/handoff/openRouter.ts`, `vercel.ts`, `together.ts`, `cloudflare.ts`
- Test: `packages/core/tests/stream.test.ts`

**Interfaces:**
- Consumes: `parseOpenAiSse`, `parseAnthropicSse`, `StreamHandlers`, `StreamedCompletion` from Task 1; `requestSignal()` from `provider.ts`.
- Produces:
  ```ts
  // provider.ts
  export interface ProviderClient {
    readonly mock: boolean;
    complete(messages: ChatMessage[], options: ProviderCompleteOptions): Promise<CompletionResult>;
    /** Optional: absent = cannot stream, dispatcher falls back to complete(). */
    stream?(
      messages: ChatMessage[],
      options: ProviderCompleteOptions,
      handlers?: StreamHandlers,
    ): Promise<CompletionResult>;
  }
  // options gains:
  stream?: boolean;
  ```

- [ ] **Step 1: Write the failing test**

Append to `packages/core/tests/stream.test.ts`:

```ts
import { OpenAiClient } from '../src/modules/handoff/openAi.js';
import { streamCompletion } from '../src/modules/handoff/stream.js';
import type { ChatMessage, CompletionResult } from '../src/types.js';

const MSGS: ChatMessage[] = [{ role: 'user', content: 'hi' }];

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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx jest tests/stream.test.ts`
Expected: FAIL — `streamCompletion` is not exported, `client.stream` is undefined.

- [ ] **Step 3: Add the interface and dispatcher**

In `packages/core/src/modules/handoff/provider.ts`, extend `ProviderCompleteOptions` with `stream?: boolean;` and extend `ProviderClient`:

```ts
export interface ProviderClient {
  readonly mock: boolean;
  complete(messages: ChatMessage[], options: ProviderCompleteOptions): Promise<CompletionResult>;
  /**
   * Optional streaming completion. When absent the dispatcher falls back to
   * `complete()` and emits a single delta, so every provider keeps working.
   */
  stream?(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    handlers?: StreamHandlers,
  ): Promise<CompletionResult>;
}
```

Add `import type { StreamHandlers } from './stream.js';` to `provider.ts`.

Append to `packages/core/src/modules/handoff/stream.ts`:

```ts
import type { ChatMessage, CompletionResult } from '../../types.js';
import type { ProviderClient, ProviderCompleteOptions } from './provider.js';
import { countTokens } from '../../token/tokenizer.js';

/**
 * Streams a completion when the provider supports it, otherwise falls back to
 * `complete()` and replays the whole answer as one delta. Callers cannot tell
 * the difference except by how many deltas they received.
 */
export async function streamCompletion(
  client: ProviderClient,
  messages: ChatMessage[],
  options: ProviderCompleteOptions,
  handlers: StreamHandlers = {},
): Promise<CompletionResult> {
  if (options.stream === false || !client.stream) {
    const result = await client.complete(messages, options);
    if (result.content.length > 0) handlers.onDelta?.(result.content);
    if (result.thinking && result.thinking.length > 0) handlers.onThinking?.(result.thinking);
    return result;
  }
  return client.stream(messages, options, handlers);
}
```

- [ ] **Step 4: Implement `stream()` on `openAi.ts`**

In `packages/core/src/modules/handoff/openAi.ts`, add after `complete()`:

```ts
  /**
   * Streaming variant of `complete()`. Same request body plus `stream: true`;
   * `choices[0].delta` fragments are aggregated by `parseOpenAiSse` so the
   * returned CompletionResult is identical to the non-streaming one.
   */
  async stream(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    handlers: StreamHandlers = {},
  ): Promise<CompletionResult> {
    if (this.mock) {
      const result = mockCompletion(messages, options, 'OPENAI_API_KEY');
      if (result.content.length > 0) handlers.onDelta?.(result.content);
      return result;
    }
    const res = await this.post(messages, options, { stream: true });
    if (!res.body) throw new ProviderError('OpenAI returned no body to stream', res.status, true);
    const streamed = await parseOpenAiSse(res.body, handlers);
    return this.finalize(messages, options, streamed);
  }
```

To make that compile without duplicating the body-building logic, extract the
existing request construction from `complete()` into two private helpers and
have both call them. Replace the inline body/fetch in `complete()` with:

```ts
  /** Builds the request body. `stream: true` adds the SSE flag. */
  private buildBody(messages: ChatMessage[], options: ProviderCompleteOptions, stream: boolean): Record<string, unknown> {
    const isLocal = this.isLocalEndpoint();
    const isOpenAiReasoning =
      !isLocal &&
      (options.model.startsWith('o1') ||
        options.model.startsWith('o3') ||
        (options.thinkingLevel && options.thinkingLevel !== 'off'));
    const body: Record<string, unknown> = {
      model: options.model,
      messages: toOpenAiMessages(messages),
    };
    if (options.tools && options.tools.length > 0) body.tools = toOpenAiTools(options.tools);
    if (isOpenAiReasoning) {
      if (options.maxTokens) body.max_completion_tokens = options.maxTokens;
      if (options.thinkingLevel && options.thinkingLevel !== 'off') {
        body.reasoning_effort = options.thinkingLevel;
      }
    } else {
      if (options.maxTokens) body.max_tokens = options.maxTokens;
      if (!options.model.startsWith('o1') && !options.model.startsWith('o3')) {
        body.temperature = options.temperature ?? 0.7;
      }
    }
    if (stream) body.stream = true;
    return body;
  }

  private async post(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    extra: Record<string, unknown> = {},
  ): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey || 'local'}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify({ ...this.buildBody(messages, options, extra.stream === true), ...extra }),
      signal: requestSignal(options),
    });
    if (!res.ok) {
      throw new ProviderError(
        `OpenAI ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`,
        res.status,
        res.status === 429 || res.status >= 500,
      );
    }
    return res;
  }

  private isLocalEndpoint(): boolean {
    return (
      this.baseUrl.includes('localhost') ||
      this.baseUrl.includes('127.0.0.1') ||
      this.baseUrl.includes('0.0.0.0') ||
      this.baseUrl.includes('::1')
    );
  }

  /** Turns aggregated stream output into the standard CompletionResult shape. */
  private finalize(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    streamed: StreamedCompletion,
  ): CompletionResult {
    const promptText = messages.map((m) => m.content).join('\n');
    const promptTokens = streamed.usage?.promptTokens ?? countTokens(promptText);
    const completionTokens = streamed.usage?.completionTokens ?? countTokens(streamed.content);
    return {
      provider: 'openai',
      model: options.model,
      content: streamed.content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: streamed.usage?.totalTokens ?? promptTokens + completionTokens,
      },
      finishReason: streamed.finishReason,
      toolCalls: streamed.toolCalls.length > 0 ? streamed.toolCalls : undefined,
      thinking: streamed.thinking.length > 0 ? streamed.thinking : undefined,
    };
  }
```

Add to the imports in `openAi.ts`: `parseOpenAiSse`, `type StreamHandlers`, `type StreamedCompletion`, `requestSignal`.

- [ ] **Step 5: Implement `stream()` on `anthropic.ts`**

Same shape, using `parseAnthropicSse`. Append after `complete()`:

```ts
  async stream(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    handlers: StreamHandlers = {},
  ): Promise<CompletionResult> {
    if (this.mock) {
      const result = mockCompletion(messages, options, 'ANTHROPIC_API_KEY');
      if (result.content.length > 0) handlers.onDelta?.(result.content);
      return result;
    }
    const body = this.buildBody(messages, options);
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey!,
        'anthropic-version': '2023-06-01',
        ...this.extraHeaders,
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal: requestSignal(options),
    });
    if (!res.ok) {
      throw new ProviderError(
        `Anthropic ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`,
        res.status,
        res.status === 429 || res.status >= 500,
      );
    }
    if (!res.body) throw new ProviderError('Anthropic returned no body to stream', res.status, true);
    const streamed = await parseAnthropicSse(res.body, handlers);
    const promptTokens = streamed.usage?.promptTokens ?? countTokens(messages.map((m) => m.content).join('\n'));
    const completionTokens = streamed.usage?.completionTokens ?? countTokens(streamed.content);
    return {
      provider: 'anthropic',
      model: options.model,
      content: streamed.content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: streamed.usage?.totalTokens ?? promptTokens + completionTokens,
      },
      finishReason: streamed.finishReason,
      toolCalls: streamed.toolCalls.length > 0 ? streamed.toolCalls : undefined,
      thinking: streamed.thinking.length > 0 ? streamed.thinking : undefined,
    };
  }
```

Extract the existing body construction in `complete()` into
`private buildBody(messages, options): Record<string, unknown>` (system block,
`max_tokens`, thinking config, tools with cache breakpoints) and have
`complete()` call it. The `system` value is currently computed inside
`complete()` from the messages — move that read into `buildBody` unchanged.

Add imports: `parseAnthropicSse`, `type StreamHandlers`, `type StreamedCompletion`, `requestSignal`.

- [ ] **Step 6: Implement `stream()` on the four OpenAI-compatible clients**

`openRouter.ts`, `vercel.ts`, `together.ts` and `cloudflare.ts` are all
OpenAI wire format. In each, add a `stream()` that mirrors the OpenAI one using
that file's own URL, headers and provider tag. For example in `openRouter.ts`:

```ts
  async stream(
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    handlers: StreamHandlers = {},
  ): Promise<CompletionResult> {
    if (this.mock) {
      const result = mockCompletion(messages, options, 'OPENROUTER_API_KEY');
      if (result.content.length > 0) handlers.onDelta?.(result.content);
      return result;
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': this.appUrl,
        'X-Title': this.appTitle,
      },
      body: JSON.stringify({ ...this.buildBody(messages, options), stream: true }),
      signal: requestSignal(options),
    });
    if (!res.ok) {
      throw new ProviderError(
        `OpenRouter ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`,
        res.status,
        res.status === 429 || res.status >= 500,
      );
    }
    if (!res.body) throw new ProviderError('OpenRouter returned no body to stream', res.status, true);
    const streamed = await parseOpenAiSse(res.body, handlers);
    const promptTokens = streamed.usage?.promptTokens ?? countTokens(messages.map((m) => m.content).join('\n'));
    const completionTokens = streamed.usage?.completionTokens ?? countTokens(streamed.content);
    return {
      provider: 'openrouter',
      model: options.model,
      content: streamed.content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: streamed.usage?.totalTokens ?? promptTokens + completionTokens,
      },
      finishReason: streamed.finishReason,
      toolCalls: streamed.toolCalls.length > 0 ? streamed.toolCalls : undefined,
      thinking: streamed.thinking.length > 0 ? streamed.thinking : undefined,
    };
  }
```

Substitute the correct provider string (`'vercel'`, `'together'`,
`'cloudflare'`, matching each file's existing `complete()` return), the correct
missing-env-var name in `mockCompletion`, and that file's existing headers. Each
file's existing body construction moves into `private buildBody(messages, options)`
exactly as for `openAi.ts`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/core && npx jest tests/stream.test.ts tests/providerClients.test.ts tests/handoff.test.ts`
Expected: PASS — the new streaming tests plus every pre-existing provider test
(the refactor must not change any existing request body).

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/modules/handoff
git commit -m "feat(handoff): stream completions via SSE with non-streaming fallback"
```

---

### Task 3: Pipeline and Tool Loop Delta Events

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/pipeline.ts`
- Modify: `packages/core/src/modules/tool-loop/index.ts`
- Test: `packages/core/tests/pipeline.test.ts`, `packages/core/tests/toolLoop.test.ts`

**Interfaces:**
- Consumes: `streamCompletion` from Task 2.
- Produces:
  ```ts
  // types.ts — PipelineEvent gains one variant
  | { type: 'delta'; text: string }
  // pipeline.ts — AskOptions gains
  stream?: boolean;
  // tool-loop/index.ts — ToolLoopOptions gains
  onDelta?: (text: string) => void;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/tests/toolLoop.test.ts`:

```ts
  it('forwards streamed deltas through onDelta', async () => {
    const client = scriptedClient([result({ content: 'par', finishReason: 'stop' })]);
    const deltas: string[] = [];
    const loop = new ToolLoop({
      handoff: new HandoffManager({ client, models: [] }),
      onDelta: (t) => deltas.push(t),
    });
    await loop.run([...system, { role: 'user', content: 'go' }], { tools: [ADD], registry });
    // The scripted client has no stream(), so the dispatcher replays the whole
    // answer as a single delta — proving the wiring, not the transport.
    expect(deltas).toEqual(['par']);
  });
```

Append to `packages/core/tests/pipeline.test.ts`, inside `describe('Pipeline', ...)`:

```ts
  it('emits delta events while streaming and stops when stream is false', async () => {
    const streaming = {
      mock: false,
      complete: jest.fn().mockResolvedValue({
        provider: 'openai', model: 'm', content: 'streamed',
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }, finishReason: 'stop',
      }),
      stream: jest.fn(async (_m: unknown, _o: unknown, h: any) => {
        h?.onDelta?.('str');
        h?.onDelta?.('eamed');
        return {
          provider: 'openai', model: 'm', content: 'streamed',
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }, finishReason: 'stop',
        };
      }),
    };
    const mk = () => new Pipeline({
      cache: new SmartCache({ backend: new MemoryBackend(), ttlSeconds: 3600, embedding: new LexicalEmbedding() }),
      handoff: new HandoffManager({ client: streaming as unknown as ProviderClient, models: MODELS }),
    });

    const seen: string[] = [];
    const result = await mk().ask('hello', { noCache: true, onEvent: (e) => {
      if (e.type === 'delta') seen.push(e.text);
    } });
    expect(seen).toEqual(['str', 'eamed']);
    expect(result.response).toBe('streamed');
    expect(streaming.complete).not.toHaveBeenCalled();

    const seenOff: string[] = [];
    await mk().ask('hello', { noCache: true, stream: false, onEvent: (e) => {
      if (e.type === 'delta') seenOff.push(e.text);
    } });
    expect(streaming.complete).toHaveBeenCalledTimes(1);
    // Fallback path still emits deltas, just not incrementally.
    expect(seenOff).toEqual(['streamed']);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && npx jest tests/toolLoop.test.ts tests/pipeline.test.ts`
Expected: FAIL — `onDelta` is not a `ToolLoopOptions` property; no `delta` event
type exists.

- [ ] **Step 3: Add the event type and `AskOptions.stream`**

In `packages/core/src/types.ts`, add to the `PipelineEvent` union:

```ts
  | { type: 'delta'; text: string }
```

In `packages/core/src/pipeline.ts`, add to `AskOptions`:

```ts
  /**
   * Stream tokens as they arrive. Default true. Set false (or
   * MUGIL_IDE_NO_STREAM=1) to force a single buffered completion.
   */
  stream?: boolean;
```

- [ ] **Step 4: Wire `onDelta` through the tool loop**

In `packages/core/src/modules/tool-loop/index.ts`:

1. Add `private readonly onDelta?: (text: string) => void;` to the class.
2. Assign `this.onDelta = options.onDelta;` in the constructor.
3. Add `onDelta?: (text: string) => void;` to `ToolLoopOptions`.
4. In `run()`, replace each `this.handoff.complete(<messages>, this.sized(<messages>, options)...)`
   call's options argument so it also carries the streaming flag, and pass
   handlers:

```ts
      const handlers: StreamHandlers = {
        onDelta: this.onDelta
          ? (text) => {
              // Provisional: if this completion turns out to carry tool calls,
              // the consumer discards what it rendered. See agentRepl.ts.
              this.onDelta(text);
            }
          : undefined,
      };
      const completion = await streamCompletion(
        this.handoff.currentClient,
        msgs,
        this.streamOptions(this.sized(msgs, options)),
        handlers,
      );
```

5. Add a private helper so the three call sites stay consistent:

```ts
  /** Non-null client accessor — the handoff always has one. */
  private streamOptions(options: ToolLoopRunOptions): ProviderCompleteOptions {
    return { ...options, stream: options.stream !== false };
  }
```

Use `streamCompletion(this.handoff.currentClient, ...)` at all three call sites
(the main loop, the forced final answer, and the `finish()` empty-response
retry). `HandoffManager.currentClient` is a public getter that already exists.

Add `import { streamCompletion, type StreamHandlers } from '../handoff/stream.js';`
and `type ProviderCompleteOptions` to the imports.

- [ ] **Step 5: Wire the pipeline**

In `packages/core/src/pipeline.ts`, inside `runAsk()`:

- The plain-ask branch becomes:

```ts
      : await streamCompletion(
          this.handoff.currentClient,
          messages,
          { ...options, maxTokens, stream: this.streamingEnabled(options) },
          { onDelta: (text) => emit({ type: 'delta', text }) },
        );
```

- The `ToolLoop` construction gains `onDelta: (text) => emit({ type: 'delta', text })`.
- Add:

```ts
  /** Streaming is on unless the caller or the environment turns it off. */
  private streamingEnabled(options: AskOptions): boolean {
    if (options.stream !== undefined) return options.stream;
    return process.env.MUGIL_IDE_NO_STREAM !== '1';
  }
```

- The `ToolLoop` run options already spread `...options`, so `stream` flows to
  the loop; confirm the spread is `...options, tools, registry, maxTokens`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/core && npx jest tests/toolLoop.test.ts tests/pipeline.test.ts`
Expected: PASS, including the 15 pre-existing pipeline tests.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/pipeline.ts packages/core/src/modules/tool-loop/index.ts packages/core/tests
git commit -m "feat(pipeline): emit delta events from streamed completions"
```

---

### Task 4: Live Terminal and Browser Rendering

**Files:**
- Modify: `packages/cli/src/terminal/agentRepl.ts`
- Test: `packages/cli/tests/server.test.ts`

**Interfaces:**
- Consumes: `PipelineEvent` `{ type: 'delta'; text: string }` from Task 3.
- Produces: no new exported API. `ReplIO.write` already forwards to the
  browser as an `agent_data` WebSocket frame, so no server or `html.ts` change
  is required.

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/tests/server.test.ts`:

```ts
  it('streams assistant text to the browser before the turn completes', async () => {
    const streaming = {
      mock: false,
      complete: jest.fn().mockResolvedValue({
        provider: 'openai', model: 'm', content: 'Hello world',
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }, finishReason: 'stop',
      }),
      stream: jest.fn(async (_m: unknown, _o: unknown, h: any) => {
        h?.onDelta?.('Hello ');
        h?.onDelta?.('world');
        return {
          provider: 'openai', model: 'm', content: 'Hello world',
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }, finishReason: 'stop',
        };
      }),
    } as unknown as ProviderClient;
    const server = await startIdeServer({ engine: scriptedEngine(streaming), port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const frames: string[] = [];
    await new Promise<void>((r) => ws.on('open', () => r()));
    ws.on('message', (raw) => frames.push(String(raw)));

    ws.send(JSON.stringify({ type: 'agent_input', data: 'hello there\r' }));
    await waitForMessage<{ turn: { response: string } }>(
      ws,
      (m) => m.type === 'turn_complete',
    );

    // The deltas reached the socket as incremental agent_data frames — no new
    // WebSocket message type was needed.
    const joined = frames.join('');
    expect(joined).toContain('Hello ');
    expect(joined).toContain('world');
    await server.close();
  });
```

This mirrors the existing tests at `server.test.ts:138` (`ws://localhost:${server.port}/ws`)
and `:181` (`await server.close()`). `scriptedEngine` is the existing helper at
`server.test.ts:55`, and `waitForMessage` is at `server.test.ts:81`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/cli && npx jest tests/server.test.ts -t "streams assistant text"`
Expected: FAIL — no delta frames are sent yet.

- [ ] **Step 3: Render deltas live in the REPL**

In `packages/cli/src/terminal/agentRepl.ts`, inside `executePrompt()`:

1. Add a per-turn accumulator before the `pipeline.ask(...)` call:

```ts
      let streamed = '';
      let streamingActive = false;
```

2. Add a `delta` branch to the existing `onEvent` switch, before the `done`
   handling:

```ts
          } else if (event.type === 'delta') {
            if (!streamingActive) {
              // First fragment: take over the blank line under the header.
              streamingActive = true;
              this.io.write(`\r\n${bold(cyan('Assistant:'))}\r\n`);
            }
            streamed += event.text;
            this.io.write(event.text);
          }
```

3. Right after `const result = await this.engine.pipeline.ask(...)` resolves,
   before the existing `Assistant:` block, reconcile what was streamed with
   what actually came back:

```ts
      if (streamingActive) {
        // Tool calls invalidate the streamed text: the model was narrating
        // intent, not answering. Clear the streamed region before the final
        // answer is printed so the transcript does not show both.
        this.io.write(`\r\n${yellow('⚠ Partial reasoning discarded — the model requested tools.')}\r\n`);
      }
```

4. Replace the unconditional header write so it is not printed twice:

```ts
      // Assistant Response (only when nothing was streamed above)
      if (!streamingActive) {
        this.io.write(`\r\n${bold(cyan('Assistant:'))}\r\n`);
      }
      const polishedResponse = formatMarkdown(result.response);
      this.io.write(`${polishedResponse}\r\n`);
```

Because streamed text is raw and the final print is markdown-formatted, the
final `formatMarkdown` pass still runs. When streaming succeeded the formatted
output duplicates the streamed text, so guard it:

```ts
      if (!streamingActive) {
        this.io.write(`${formatMarkdown(result.response)}\r\n`);
      }
```

5. Ensure a newline is written before the turn footer when streaming was
   active, so the footer does not land on the last streamed line:

```ts
      if (streamingActive) this.io.write('\r\n');
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/cli && npx jest tests/server.test.ts`
Expected: PASS, all existing tests plus the new one.

- [ ] **Step 5: Verify manually in a real terminal**

Run: `npm run dev` then type a long question at the `mugil-ide>` prompt.
Expected: text appears progressively. Press Ctrl-C mid-stream — Expected:
`■ Cancelling turn.` and a usable prompt returns. Run `/plan`, ask for a plan —
Expected: the plan streams and no writes are attempted.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/terminal/agentRepl.ts packages/cli/tests/server.test.ts
git commit -m "feat(cli): render streamed model output live in the REPL"
```

---

### Task 5: Cancellation Propagation and Documentation

**Files:**
- Modify: `packages/core/src/modules/tools/workspaceTools.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `ToolLoopRunOptions.signal` (already threaded through
  `HandoffOptions`) from the Phase 3 work.
- Produces: `CreateWorkspaceToolsOptions.signal?: AbortSignal`, forwarded into
  the subagent `ToolLoop.run()` options so Ctrl-C stops subagents too.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/tests/taskTool.test.ts`:

```ts
  it('propagates an abort signal into the subagent loop', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = scriptedClient([result({ content: 'never used', finishReason: 'stop' })]);
    const handoff = new HandoffManager({ client, models: [] });
    const { toolRegistry } = createWorkspaceTools(ROOT, {
      handoff,
      signal: controller.signal,
    });
    const out = await toolRegistry.task(
      taskCall('c1', { mode: 'explore', description: 'look around' }),
    );
    expect(out).toMatch(/abort|cancel/i);
  });
```

Reuses the file's existing helpers: `scriptedClient` (:10), `result` (:22),
the `createWorkspaceTools` import (:4), `ROOT`, and `taskCall(name, args)` (:44).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx jest tests/taskTool.test.ts -t "propagates an abort"`
Expected: FAIL — `CreateWorkspaceToolsOptions` has no `signal`, and the subagent
loop still runs.

- [ ] **Step 3: Thread the signal into the subagent loop**

In `packages/core/src/modules/tools/workspaceTools.ts`:

1. Add to `CreateWorkspaceToolsOptions`:

```ts
  /** Cancels subagent loops (the user pressed Ctrl-C mid-turn). */
  signal?: AbortSignal;
```

2. In the `task` executor, add `signal: options.signal,` to the object passed
   to `loop.run(...)` (alongside `tools`, `registry`, `permission`,
   `preferredModel`, `maxTokens`).

3. In `AgentRepl.executePrompt()`, pass the turn signal into
   `createWorkspaceTools(...)`:

```ts
        signal: this.turnAbort.signal,
```

- [ ] **Step 4: Update the CHANGELOG**

Add to `## [Unreleased]` → `### Added`:

```markdown
- **Streaming Model Output**: Completions stream token-by-token to the terminal and web UI instead of appearing all at once. Adds SSE parsers for the OpenAI and Anthropic wire formats, an optional `ProviderClient.stream()` with automatic fallback to buffered `complete()` for providers that cannot stream, a `delta` pipeline event, and live REPL rendering. Set `MUGIL_IDE_NO_STREAM=1` or pass `stream: false` to force buffered mode.
```

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all clean, all suites pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/tools/workspaceTools.ts packages/core/tests/taskTool.test.ts CHANGELOG.md packages/cli/src/terminal/agentRepl.ts
git commit -m "fix(core): propagate turn cancellation into subagent loops"
```

---

## Self-Review

**Spec coverage:** SSE parsing (Task 1), provider wiring + fallback (Task 2),
event plumbing (Task 3), terminal/browser rendering (Task 4), cancellation +
docs (Task 5). Every constraint in the header is enforced in at least one step.

**Type consistency:** `StreamHandlers` / `StreamedCompletion` are defined in
Task 1 and consumed unchanged in Task 2. `streamCompletion` is defined in Task 2
and consumed in Task 3. `onDelta` is defined on `ToolLoopOptions` in Task 3 and
used in Task 4. `signal` on `CreateWorkspaceToolsOptions` is defined and used in
Task 5. `currentClient` and `requestSignal` already exist in the codebase.

**Known risk called out:** tool-call completions stream text that is
subsequently discarded. Task 4 Step 3 makes that visible in the transcript
rather than hiding it, and the alternative (buffering until the completion is
known to be final) would forfeit incremental output entirely.