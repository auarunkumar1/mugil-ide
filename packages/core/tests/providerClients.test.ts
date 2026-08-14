import { AnthropicClient } from '../src/modules/handoff/anthropic.js';
import { OpenAiClient } from '../src/modules/handoff/openAi.js';
import { createEngine, loadConfig } from '../src/index.js';

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

  it('falls back to mock mode without a key', async () => {
    const client = new OpenAiClient();
    expect(client.mock).toBe(true);
    const result = await client.complete([{ role: 'user', content: 'hi' }], { model: 'gpt-4o-mini' });
    expect(result.mock).toBe(true);
    expect(result.content).toContain('OPENAI_API_KEY');
  });
});

describe('AnthropicClient', () => {
  it('posts to the Messages API with x-api-key and extracts system', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'claude-3-5-sonnet',
        content: [{ type: 'text', text: 'answer' }],
        usage: { input_tokens: 8, output_tokens: 3 },
        stop_reason: 'end_turn',
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' });
    const result = await client.complete(
      [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'q' },
      ],
      { model: 'claude-3-5-sonnet', maxTokens: 128 },
    );

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
      system: string;
      messages: Array<{ role: string; content: string }>;
      max_tokens: number;
    };
    expect(body.system).toBe('be terse');
    expect(body.messages).toEqual([{ role: 'user', content: 'q' }]);
    expect(body.max_tokens).toBe(128);
    expect(result.provider).toBe('anthropic');
    expect(result.content).toBe('answer');
    expect(result.usage.totalTokens).toBe(11);
  });

  it('defaults max_tokens and falls back to mock without a key', async () => {
    const client = new AnthropicClient();
    expect(client.mock).toBe(true);
    const result = await client.complete([{ role: 'user', content: 'hi' }], { model: 'x' });
    expect(result.mock).toBe(true);
    expect(result.content).toContain('ANTHROPIC_API_KEY');
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
});
