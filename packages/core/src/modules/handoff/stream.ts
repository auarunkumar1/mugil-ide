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
 * The parsers below are pure: they take a byte stream and return the aggregated
 * result. No provider knowledge, no I/O. The exception is `streamCompletion` at
 * the bottom of this file — it does I/O, through the `HandoffManager`, and is
 * the streaming entry point for callers.
 */
import type { ChatMessage, HandoffOptions, ToolCall } from '../../types.js';
import type { HandoffManager, HandoffResult } from './index.js';

export interface StreamHandlers {
  /**
   * Called for each visible text fragment, in order.
   *
   * `streamed` is the provenance flag: `true` only for a fragment that arrived
   * incrementally over SSE, `false` for a whole-answer replay the buffered
   * fallback emits. It defaults to `false` when omitted, so a call site that
   * passes only the text (every provider client's mock branch) is always
   * classified as buffered — the safe direction, since a renderer that cannot
   * prove text was incremental must not present it as if it were.
   */
  onDelta?: (text: string, streamed?: boolean) => void;
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
    // An early `break` (e.g. OpenAI's `[DONE]`) leaves the producer unread, so
    // cancel explicitly or a real `Response.body` keeps its socket open.
    try {
      await reader.cancel();
    } catch {
      // Already errored or already closed. Never let this mask the caller's
      // own error, nor turn a clean early break into a throw.
    }
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
      handlers.onDelta?.(delta.content, true);
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
      handlers.onDelta?.(delta.text, true);
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

/**
 * Per-request options for `streamCompletion`. An alias, not a copy: the
 * `stream: false` opt-out is declared once on `HandoffOptions`.
 */
export type StreamCompletionOptions = HandoffOptions;

/**
 * Runs a completion through the handoff ladder, streaming where possible.
 *
 * Takes the `HandoffManager` rather than a bare `ProviderClient` so the request
 * always walks the same ladder, `fallbackChain` and break policy as
 * `complete()`. Streaming is best-effort: a client with no `stream()`, a
 * caller passing `stream: false`, or the process-wide `MUGIL_IDE_NO_STREAM=1`
 * kill switch replays the buffered answer as ONE delta carrying
 * `streamed: false`, so a renderer can tell that replay from a real stream and
 * present it exactly as it did before streaming existed; and a provider that
 * rejects SSE degrades to the next model rather than crashing the turn.
 *
 * This function is the single place that decides stream-vs-buffered, so the
 * kill switch covers every caller — including tool loops that build their own
 * run options and never see the pipeline.
 */
export async function streamCompletion(
  manager: HandoffManager,
  messages: ChatMessage[],
  options: StreamCompletionOptions = {},
  handlers: StreamHandlers = {},
): Promise<HandoffResult> {
  if (options.stream === false || process.env.MUGIL_IDE_NO_STREAM === '1') {
    const result = await manager.complete(messages, options);
    if (result.content.length > 0) handlers.onDelta?.(result.content, false);
    if (result.thinking && result.thinking.length > 0) handlers.onThinking?.(result.thinking);
    return result;
  }
  return manager.stream(messages, options, handlers);
}
