import { AnthropicClient } from '../src/modules/handoff/anthropic.js';
import { OpenAiClient } from '../src/modules/handoff/openAi.js';
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
      system?: string;
      messages: unknown[];
    };
    expect(body.system).toBe('you are a helpful assistant');
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
      tools?: Array<{ name: string; description: string; input_schema: unknown }>;
    };
    expect(body.tools).toEqual([
      { name: 'add', description: 'add two numbers', input_schema: { type: 'object' } },
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
});
