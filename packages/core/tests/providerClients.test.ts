import { AnthropicClient } from '../src/modules/handoff/anthropic.js';
import { OpenAiClient } from '../src/modules/handoff/openAi.js';
import { OpenCodeClient } from '../src/modules/handoff/openCode.js';
import { CloudflareClient } from '../src/modules/handoff/cloudflare.js';
import { fetchProviderModels } from '../src/modules/handoff/models.js';
import { createEngine, loadConfig } from '../src/index.js';
import type { ToolDefinition } from '../src/types.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function okResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

/** A 200 whose body is an SSE byte stream, which is what stream() consumes. */
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
    text: async () => frames.join(''),
  } as unknown as Response;
}

describe('OpenAiClient', () => {
  it('posts to the chat completions endpoint with a Bearer key', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'gpt-4o-mini',
        choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenAiClient({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' });
    const result = await client.complete([{ role: 'user', content: 'hi' }], {
      model: 'gpt-4o-mini',
      maxTokens: 64,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      model: string;
      max_tokens: number;
    };
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.max_tokens).toBe(64);
    expect(result.provider).toBe('openai');
    expect(result.content).toBe('hello');
    expect(result.usage.totalTokens).toBe(7);
  });

  it('captures reasoning output from reasoning-capable models', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'o3-mini',
        choices: [
          {
            message: { content: '42', reasoning: 'step by step explanation' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenAiClient({ apiKey: 'sk-test' });
    const result = await client.complete([{ role: 'user', content: 'what is 6 * 7' }], {
      model: 'o3-mini',
      thinkingLevel: 'medium',
    });

    expect(result.thinking).toBe('step by step explanation');
    expect(result.content).toBe('42');
  });

  it('runs offline mock when no key is set', async () => {
    const client = new OpenAiClient();
    const result = await client.complete([{ role: 'user', content: 'ping' }], {
      model: 'gpt-4o-mini',
    });
    expect(result.mock).toBe(true);
    expect(result.content).toContain('[mock]');
  });

  it('falls back to reasoning content when a reply is reasoning-only', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'deepseek/deepseek-r1',
        choices: [
          {
            message: { content: null, reasoning_content: 'the final answer is 42' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenAiClient({ apiKey: 'sk-test' });
    const result = await client.complete([{ role: 'user', content: 'what is the answer' }], {
      model: 'deepseek/deepseek-r1',
    });
    // Tokens were consumed but content was null — the reasoning must surface.
    expect(result.content).toBe('the final answer is 42');
  });

  it('handles unclosed <think> tag and [THINKING] block delimiters', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'deepseek-r1',
        choices: [
          {
            message: {
              content: '<think>partial reasoning that got cut off',
            },
            finish_reason: 'length',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenAiClient({ apiKey: 'sk-test' });
    const result = await client.complete([{ role: 'user', content: 'solve' }], {
      model: 'deepseek-r1',
    });
    // Unclosed thinking tag lifted into thinking, and promoted to content since content was blank
    expect(result.thinking).toBe('partial reasoning that got cut off');
    expect(result.content).toBe('partial reasoning that got cut off');
  });

  it('captures cached_tokens from prompt_tokens_details and sorts tool parameters canonically', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'deepseek/deepseek-chat',
        choices: [{ message: { content: 'cached response' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_tokens_details: { cached_tokens: 80 },
        },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenAiClient({ apiKey: 'sk-test' });
    const result = await client.complete([{ role: 'user', content: 'test caching' }], {
      model: 'deepseek/deepseek-chat',
      tools: [
        {
          name: 'zebra_tool',
          description: 'tool z',
          parameters: { z_param: '1', a_param: '2' },
        },
        {
          name: 'alpha_tool',
          description: 'tool a',
          parameters: { y_param: '3', b_param: '4' },
        },
      ],
    });

    expect(result.usage.cachedTokens).toBe(80);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      tools: Array<{ function: { name: string; parameters: Record<string, unknown> } }>;
    };
    // Tools are sorted alphabetically by name
    expect(body.tools[0]!.function.name).toBe('alpha_tool');
    expect(body.tools[1]!.function.name).toBe('zebra_tool');
    // Parameter keys are canonicalized in sorted order
    expect(Object.keys(body.tools[0]!.function.parameters)).toEqual(['b_param', 'y_param']);
  });
});

describe('AnthropicClient', () => {
  it('posts to the messages endpoint with x-api-key', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'claude-3-5-sonnet',
        content: [{ type: 'text', text: 'anthropic reply' }],
        usage: { input_tokens: 8, output_tokens: 4 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new AnthropicClient({
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com',
    });
    const result = await client.complete([{ role: 'user', content: 'hello' }], {
      model: 'claude-3-5-sonnet',
      maxTokens: 128,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-test',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      model: string;
      max_tokens: number;
    };
    expect(body.model).toBe('claude-3-5-sonnet');
    expect(body.max_tokens).toBe(128);
    expect(result.provider).toBe('anthropic');
    expect(result.content).toBe('anthropic reply');
    expect(result.usage.totalTokens).toBe(12);
  });

  it('extracts system messages into top-level parameter', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'claude-3-5-sonnet',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' });
    await client.complete(
      [
        { role: 'system', content: 'you are a helpful assistant' },
        { role: 'user', content: 'test' },
      ],
      { model: 'claude-3-5-sonnet' },
    );

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      system?: Array<{ type: string; text: string; cache_control?: { type: string } }>;
      messages: unknown[];
    };
    expect(body.system).toEqual([
      { type: 'text', text: 'you are a helpful assistant', cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.messages).toHaveLength(1);
  });

  it('runs offline mock when no key is set', async () => {
    const client = new AnthropicClient();
    const result = await client.complete([{ role: 'user', content: 'ping' }], {
      model: 'claude-3-5-sonnet',
    });
    expect(result.mock).toBe(true);
    expect(result.content).toContain('[mock]');
  });

  it('captures thinking output block from reasoning-capable models', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'claude-3-7-sonnet',
        content: [
          { type: 'thinking', thinking: 'let me ponder this problem deeply' },
          { type: 'text', text: 'final answer' },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' });
    const result = await client.complete([{ role: 'user', content: 'solve this' }], {
      model: 'claude-3-7-sonnet',
      thinkingLevel: 'high',
    });

    expect(result.thinking).toBe('let me ponder this problem deeply');
    expect(result.content).toBe('final answer');
  });

  it('falls back to thinking text when a response has only thinking blocks', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'claude-3-7-sonnet',
        content: [{ type: 'thinking', thinking: 'reasoning only, no text block' }],
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: 'max_tokens',
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' });
    const result = await client.complete([{ role: 'user', content: 'deep question' }], {
      model: 'claude-3-7-sonnet',
      thinkingLevel: 'high',
    });
    // max_tokens exhausted mid-reasoning -> no text block; surface the thinking.
    expect(result.content).toBe('reasoning only, no text block');
  });

  it('configures thinking budget when thinkingLevel is specified', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'claude-3-7-sonnet',
        content: [{ type: 'text', text: 'detailed answer' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' });
    await client.complete([{ role: 'user', content: 'test' }], {
      model: 'claude-3-7-sonnet',
      thinkingLevel: 'medium',
    });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      thinking?: { type: string; budget_tokens: number };
      max_tokens: number;
    };
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
    expect(body.max_tokens).toBeGreaterThanOrEqual(4096 + 1024);
  });
});

describe('OpenCodeClient', () => {
  it('runs in mock mode without an API key', async () => {
    const client = new OpenCodeClient();
    const result = await client.complete([{ role: 'user', content: 'hi' }], { model: 'qwen3-coder' });
    expect(result.mock).toBe(true);
    expect(result.content).toContain('[mock] no OPENCODE_API_KEY');
  });

  it('routes claude models to the Anthropic-format /v1/messages endpoint', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'claude-haiku-4-5',
        content: [{ type: 'text', text: 'hello from zen' }],
        usage: { input_tokens: 5, output_tokens: 2 },
        stop_reason: 'end_turn',
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenCodeClient({ apiKey: 'oc-test' });
    const result = await client.complete([{ role: 'user', content: 'hi' }], {
      model: 'claude-haiku-4-5',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://opencode.ai/zen/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'oc-test',
          'User-Agent': 'opencode/1.18.27',
        }),
      }),
    );
    expect(result.provider).toBe('opencode');
    expect(result.model).toBe('claude-haiku-4-5');
  });

  it('routes all other models through chat completions with a Bearer key', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'qwen3-coder',
        choices: [{ message: { content: 'hello again' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenCodeClient({ apiKey: 'oc-test' });
    const result = await client.complete([{ role: 'user', content: 'hi' }], {
      model: 'qwen3-coder',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://opencode.ai/zen/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer oc-test',
          'User-Agent': 'opencode/1.18.27',
        }),
      }),
    );
    expect(result.provider).toBe('opencode');
    expect(result.content).toBe('hello again');
    expect(result.usage.totalTokens).toBe(7);
  });

  it('rejects gpt/codex models with a non-retryable error (Responses API unsupported)', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const client = new OpenCodeClient({ apiKey: 'oc-test' });
    await expect(
      client.complete([{ role: 'user', content: 'hi' }], { model: 'gpt-5.6-sol' }),
    ).rejects.toMatchObject({ status: 400, retryable: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('streams claude models over SSE from /v1/messages and re-brands the provider', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      sseResponse([
        'event: message_start\ndata: {"message":{"usage":{"input_tokens":5}}}\n\n',
        'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hel"}}\n\n',
        'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"lo"}}\n\n',
        'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
      ]),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenCodeClient({ apiKey: 'oc-test' });
    const deltas: Array<{ text: string; streamed?: boolean }> = [];
    const result = await client.stream!([{ role: 'user', content: 'hi' }], { model: 'claude-haiku-4-5' }, {
      onDelta: (text, streamed) => deltas.push({ text, streamed }),
    });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { stream: boolean };
    expect(body.stream).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://opencode.ai/zen/v1/messages');
    expect(deltas.map((d) => d.text)).toEqual(['Hel', 'lo']);
    // Provenance survives delegation: the fragments really were incremental.
    expect(deltas.every((d) => d.streamed === true)).toBe(true);
    expect(result.provider).toBe('opencode');
    expect(result.content).toBe('Hello');
    expect(result.usage.totalTokens).toBe(7);
  });

  it('streams non-claude models from /v1/chat/completions and re-brands the provider', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" there"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":3,"total_tokens":7}}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenCodeClient({ apiKey: 'oc-test' });
    const deltas: string[] = [];
    const result = await client.stream!([{ role: 'user', content: 'hi' }], { model: 'qwen3-coder' }, {
      onDelta: (text) => deltas.push(text),
    });

    expect(fetchMock.mock.calls[0]![0]).toBe('https://opencode.ai/zen/v1/chat/completions');
    expect(deltas).toEqual(['hi', ' there']);
    expect(result.provider).toBe('opencode');
    expect(result.content).toBe('hi there');
  });

  it('rejects gpt/codex models on the streaming path too', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const client = new OpenCodeClient({ apiKey: 'oc-test' });
    await expect(
      client.stream!([{ role: 'user', content: 'hi' }], { model: 'gpt-5.6-sol' }),
    ).rejects.toMatchObject({ status: 400, retryable: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('uses the documented /inference paths when that base is configured', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenCodeClient({
      apiKey: 'oc-test',
      baseUrl: 'https://opencode.ai/inference',
    });
    await client.complete([{ role: 'user', content: 'hi' }], { model: 'claude-sonnet-4-5' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://opencode.ai/inference/anthropic/v1/messages');
    fetchMock.mockResolvedValue(
      okResponse({
        model: 'qwen3-coder',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
    await client.complete([{ role: 'user', content: 'hi' }], { model: 'qwen3-coder' });
    expect(fetchMock.mock.calls[1]![0]).toBe(
      'https://opencode.ai/inference/openai/v1/chat/completions',
    );
  });
});

describe('provider selection in createEngine', () => {
  it('picks OpenAI when only OPENAI_API_KEY is set', () => {
    const engine = createEngine(loadConfig({ NODE_ENV: 'test', OPENAI_API_KEY: 'sk-x' }));
    expect(engine.client.constructor.name).toBe('OpenAiClient');
    expect(engine.config.provider).toBe('openai');
  });

  it('picks Anthropic when only ANTHROPIC_API_KEY is set', () => {
    const engine = createEngine(loadConfig({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'sk-ant' }));
    expect(engine.client.constructor.name).toBe('AnthropicClient');
    expect(engine.config.provider).toBe('anthropic');
  });

  it('keeps OpenRouter primary when its key is present', () => {
    const engine = createEngine(
      loadConfig({ NODE_ENV: 'test', OPENROUTER_API_KEY: 'sk-or', ANTHROPIC_API_KEY: 'sk-ant' }),
    );
    expect(engine.client.constructor.name).toBe('OpenRouterClient');
    expect(engine.config.provider).toBe('openrouter');
  });

  it('honors an explicit AI_PROVIDER override', () => {
    const engine = createEngine(
      loadConfig({ NODE_ENV: 'test', AI_PROVIDER: 'anthropic', OPENROUTER_API_KEY: 'sk-or' }),
    );
    expect(engine.config.provider).toBe('anthropic');
  });

  it('supports Ollama without API key', () => {
    const engine = createEngine(
      loadConfig({ NODE_ENV: 'test', AI_PROVIDER: 'ollama' }),
    );
    expect(engine.client.constructor.name).toBe('OpenAiClient');
    expect(engine.client.mock).toBe(false);
    expect(engine.config.provider).toBe('ollama');
  });

  it('supports LM Studio without API key', () => {
    const engine = createEngine(
      loadConfig({ NODE_ENV: 'test', AI_PROVIDER: 'lmstudio' }),
    );
    expect(engine.client.constructor.name).toBe('OpenAiClient');
    expect(engine.client.mock).toBe(false);
    expect(engine.config.provider).toBe('lmstudio');
  });
});

describe('tool calling (Anthropic)', () => {
  it('includes tools in the Anthropic wire format', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'claude-3-5-sonnet',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' });
    await client.complete([{ role: 'user', content: 'hi' }], {
      model: 'claude-3-5-sonnet',
      tools: [{ name: 'add', description: 'add two numbers', parameters: { type: 'object' } }],
    });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      tools?: Array<{ name: string; description: string; input_schema: unknown; cache_control?: unknown }>;
    };
    expect(body.tools).toEqual([
      {
        name: 'add',
        description: 'add two numbers',
        input_schema: { type: 'object' },
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('parses tool_use blocks into ToolCalls', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'claude-3-5-sonnet',
        content: [
          { type: 'text', text: 'let me compute' },
          { type: 'tool_use', id: 'toolu_1', name: 'add', input: { a: 2, b: 3 } },
        ],
        usage: { input_tokens: 5, output_tokens: 8 },
        stop_reason: 'tool_use',
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' });
    const result = await client.complete([{ role: 'user', content: 'compute' }], {
      model: 'claude-3-5-sonnet',
      tools: [{ name: 'add', description: 'add', parameters: {} }],
    });
    expect(result.content).toBe('let me compute');
    expect(result.toolCalls).toEqual([{ id: 'toolu_1', name: 'add', arguments: '{"a":2,"b":3}' }]);
    expect(result.finishReason).toBe('tool_use');
  });

  it('translates assistant toolCalls and tool results into Anthropic messages', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'claude-3-5-sonnet',
        content: [{ type: 'text', text: '5' }],
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' });
    await client.complete(
      [
        { role: 'user', content: '2 + 3' },
        {
          role: 'assistant',
          content: 'computing',
          toolCalls: [{ id: 'toolu_1', name: 'add', arguments: '{"a":2,"b":3}' }],
        },
        { role: 'tool', toolCallId: 'toolu_1', content: '5' },
      ],
      { model: 'claude-3-5-sonnet', tools: [{ name: 'add', description: 'add', parameters: {} }] },
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { messages: unknown[] };
    expect(body.messages).toEqual([
      { role: 'user', content: '2 + 3' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'computing' },
          { type: 'tool_use', id: 'toolu_1', name: 'add', input: { a: 2, b: 3 } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '5' }] },
    ]);
  });
});

describe('tool calling (OpenAI family)', () => {
  it('includes a tools array in the request body (OpenAI format)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'gpt-4o-mini',
        choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenAiClient({ apiKey: 'sk-test' });
    const tool: ToolDefinition = {
      name: 'add',
      description: 'add two numbers',
      parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
    };
    await client.complete([{ role: 'user', content: '2 + 3' }], { model: 'gpt-4o-mini', tools: [tool] });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      tools?: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>;
    };
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'add', description: 'add two numbers', parameters: tool.parameters } },
    ]);
  });

  it('parses tool_calls from the response', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'gpt-4o-mini',
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'add', arguments: '{"a":2,"b":3}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenAiClient({ apiKey: 'sk-test' });
    const result = await client.complete([{ role: 'user', content: 'compute' }], {
      model: 'gpt-4o-mini',
      tools: [{ name: 'add', description: 'add two numbers', parameters: {} }],
    });
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'add', arguments: '{"a":2,"b":3}' }]);
    expect(result.finishReason).toBe('tool_calls');
  });

  it('parses tool_calls that omit the type field (local OpenAI-compatible endpoints)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'local-model',
        choices: [
          {
            message: {
              content: '',
              // No `type: 'function'` — some Ollama/LM Studio builds and
              // proxies omit it; the call must still be executed.
              tool_calls: [{ id: 'call_1', function: { name: 'write_file', arguments: '{"path":"index.html"}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenAiClient({ apiKey: 'sk-test' });
    const result = await client.complete([{ role: 'user', content: 'create a file' }], {
      model: 'local-model',
      tools: [{ name: 'write_file', description: 'write a file', parameters: {} }],
    });
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'write_file', arguments: '{"path":"index.html"}' },
    ]);
  });

  it('round-trips assistant toolCalls and tool results through the request body', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'gpt-4o-mini',
        choices: [{ message: { content: 'final', tool_calls: undefined }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenAiClient({ apiKey: 'sk-test' });
    await client.complete(
      [
        { role: 'user', content: '2 + 3' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'add', arguments: '{"a":2,"b":3}' }],
        },
        { role: 'tool', toolCallId: 'call_1', content: '5' },
      ],
      { model: 'gpt-4o-mini', tools: [{ name: 'add', description: 'add', parameters: {} }] },
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { messages: unknown[] };
    expect(body.messages).toEqual([
      { role: 'user', content: '2 + 3' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'add', arguments: '{"a":2,"b":3}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '5' },
    ]);
  });
});

describe('tool-calling capability detection', () => {
  it('marks OpenRouter models that advertise tools support', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        data: [
          { id: 'a/model-with-tools', supported_parameters: ['temperature', 'tools'] },
          { id: 'b/model-without-tools', supported_parameters: ['temperature'] },
          { id: 'c/no-parameter-info' },
        ],
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    // Distinct baseUrl so this does not collide with the fetchProviderModels
    // suite's cache key (`openrouter:default:auth`).
    const models = await fetchProviderModels({
      provider: 'openrouter',
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.detect/v1',
    });
    expect(models.find((m) => m.id === 'a/model-with-tools')!.supportsTools).toBe(true);
    expect(models.find((m) => m.id === 'b/model-without-tools')!.supportsTools).toBe(false);
    expect(models.find((m) => m.id === 'c/no-parameter-info')!.supportsTools).toBe(true); // default true
  });

  it('defaults Ollama models to tool support', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({ data: [{ id: 'llama3.2:latest' }] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    // Distinct baseUrl to avoid the fetchProviderModels suite's cache key.
    const models = await fetchProviderModels({ provider: 'ollama', baseUrl: 'http://ollama.detect:11434/v1' });
    expect(models[0]!.supportsTools).toBe(true);
  });
});

describe('fetchProviderModels', () => {
  it('fetches models from OpenRouter endpoint', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        data: [
          { id: 'meta-llama/llama-3.3-70b-instruct', context_length: 128000, pricing: { prompt: '0.00000012', completion: '0.0000003' } },
          { id: 'deepseek/deepseek-r1', context_length: 128000, pricing: { prompt: '0.00000055', completion: '0.00000219' } },
        ],
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const models = await fetchProviderModels({ provider: 'openrouter', apiKey: 'test-key' });
    expect(models.length).toBe(2);
    expect(models[0]!.id).toBe('meta-llama/llama-3.3-70b-instruct');
    expect(models[1]!.supportsThinking).toBe(true);
  });

  it('fetches models from Ollama endpoint', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        data: [{ id: 'llama3.2:latest' }, { id: 'deepseek-r1:8b' }],
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const models = await fetchProviderModels({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1' });
    expect(models.length).toBe(2);
    expect(models[0]!.id).toBe('llama3.2:latest');
    expect(models[1]!.supportsThinking).toBe(true);
  });

  it('lists OpenCode Zen models from GET /models', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        data: [
          { id: 'claude-haiku-4-5', context_length: 200000 },
          { id: 'qwen3-coder', context_length: 128000 },
        ],
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const models = await fetchProviderModels({
      provider: 'opencode',
      apiKey: 'oc-test',
      baseUrl: 'https://opencode.ai/zen/v1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://opencode.ai/zen/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer oc-test' }),
      }),
    );
    expect(models.map((m) => m.id)).toEqual(['claude-haiku-4-5', 'qwen3-coder']);
    expect(models[0]).toMatchObject({ tier: 'standard', contextWindow: 200000 });
  });
  it('lists models from the /inference base at /v1/models', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse({ data: [{ id: 'big-pickle' }] }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await fetchProviderModels({
      provider: 'opencode',
      apiKey: 'oc-test',
      baseUrl: 'https://opencode.ai/inference',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://opencode.ai/inference/v1/models',
      expect.anything(),
    );
  });
});

describe('Vercel AI Gateway', () => {
  it('probes the gateway host, not api.vercel.ai', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse({ data: [{ id: 'openai/gpt-4o-mini' }] }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await fetchProviderModels({ provider: 'vercel', apiKey: 'vck_test', baseUrl: 'https://ai-gateway.vercel.sh/v1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ai-gateway.vercel.sh/v1/models',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer vck_test' }) }),
    );
  });

  it('maps catalog pricing (per token) to per-MTok and keeps context windows', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        data: [
          {
            id: 'anthropic/claude-sonnet-4.5',
            context_window: 1000000,
            supported_parameters: ['tools', 'reasoning'],
            pricing: { input: '0.000003', output: '0.000015' },
          },
          {
            id: 'openai/gpt-4o-mini',
            context_window: 128000,
            supported_parameters: ['tools'],
            pricing: { input: '0.00000015', output: '0.0000006' },
          },
        ],
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const models = await fetchProviderModels({
      provider: 'vercel',
      apiKey: 'vck_test',
      baseUrl: 'https://gateway.pricing.test/v1',
    });
    const sonnet = models.find((m) => m.id === 'anthropic/claude-sonnet-4.5')!;
    expect(sonnet.costPerMTokIn).toBeCloseTo(3);
    expect(sonnet.costPerMTokOut).toBeCloseTo(15);
    expect(sonnet.contextWindow).toBe(1000000);
    expect(sonnet.supportsThinking).toBe(true);
    const mini = models.find((m) => m.id === 'openai/gpt-4o-mini')!;
    expect(mini.tier).toBe('cheap');
    expect(mini.costPerMTokIn).toBeCloseTo(0.15);
  });

  it('defaults the Vercel client to the AI Gateway base URL', () => {
    const engine = createEngine(
      loadConfig({ NODE_ENV: 'test', AI_PROVIDER: 'vercel', VERCEL_API_KEY: 'vck_test' }),
    );
    expect(engine.config.vercelBaseUrl).toBe('https://ai-gateway.vercel.sh/v1');
    expect(engine.handoff.isMock).toBe(false);
  });

  it('accepts AI_GATEWAY_API_KEY as an alias for VERCEL_API_KEY', () => {
    const engine = createEngine(
      loadConfig({ NODE_ENV: 'test', AI_PROVIDER: 'vercel', AI_GATEWAY_API_KEY: 'vck_alias' }),
    );
    expect(engine.config.vercelApiKey).toBe('vck_alias');
    expect(engine.handoff.isMock).toBe(false);
  });
});

describe('opencode engine wiring', () => {
  it('createEngine wires OpenCodeClient when provider is opencode', () => {
    const engine = createEngine(
      loadConfig({ NODE_ENV: 'test', AI_PROVIDER: 'opencode', OPENCODE_API_KEY: 'oc-test' }),
    );
    expect(engine.client).toBeInstanceOf(OpenCodeClient);
    expect(engine.handoff.isMock).toBe(false);
  });
});

describe('CloudflareClient API paths', () => {
  const ok = () =>
    okResponse({
      model: '@cf/meta/llama-3.1-8b-instruct',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  it('uses the Workers AI direct path under /client/v4/accounts/{id}/ai/v1', async () => {
    const fetchMock = jest.fn().mockResolvedValue(ok());
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new CloudflareClient({ apiKey: 'k', accountId: 'acct' });
    await client.complete([{ role: 'user', content: 'hi' }], {
      model: '@cf/meta/llama-3.1-8b-instruct',
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct/ai/v1/chat/completions',
    );
  });
  it('uses the gateway host (not api.cloudflare.com) when a gateway id is set', async () => {
    const fetchMock = jest.fn().mockResolvedValue(ok());
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new CloudflareClient({ apiKey: 'k', accountId: 'acct', gatewayId: 'gw' });
    await client.complete([{ role: 'user', content: 'hi' }], {
      model: '@cf/meta/llama-3.1-8b-instruct',
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://gateway.ai.cloudflare.com/v1/acct/gw/openai/chat/completions',
    );
  });
});

describe('Cloudflare model discovery', () => {
  it('uses the configured account id (not just one parsed from the URL)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({ result: [{ id: '@cf/meta/llama-3.1-8b-instruct' }] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const models = await fetchProviderModels({
      provider: 'cloudflare',
      apiKey: 'k',
      baseUrl: 'https://api.cloudflare.com/client/v4',
      accountId: 'acct-123',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/acct-123/ai/models/search',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer k' }),
      }),
    );
    expect(models.map((m) => m.id)).toEqual(['@cf/meta/llama-3.1-8b-instruct']);
  });
});
