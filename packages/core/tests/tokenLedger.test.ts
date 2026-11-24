import { OpenRouterClient } from '../src/modules/handoff/openRouter.js';
import { OpenCodeClient } from '../src/modules/handoff/openCode.js';
import { AnthropicClient } from '../src/modules/handoff/anthropic.js';
import { UnifiedWireClient } from '../src/modules/handoff/unifiedWireClient.js';
import { parseOpenAiSse, parseAnthropicSse, streamFromChunks } from '../src/modules/handoff/stream.js';

describe('Phase 5: Token Ledger & Local-AI Parity', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('Rich Usage Metadata & Billing Sources', () => {
    it('stamps billingSource: "opencode" on OpenCode completions', async () => {
      const client = new OpenCodeClient({ apiKey: 'test-key' });
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          model: 'claude-3-5-sonnet-20241022',
          content: [
            {
              type: 'text',
              text: 'Hello from OpenCode',
            },
          ],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 15,
            output_tokens: 10,
          },
        }),
      } as any);

      const result = await client.complete(
        [{ role: 'user', content: 'hello' }],
        { model: 'claude-3-5-sonnet' },
      );

      expect(result.provider).toBe('opencode');
      expect(result.usage.billingSource).toBe('go');
      expect(result.usage.totalTokens).toBe(25);
    });

    it('stamps billingSource: "openrouter" and extracts cost and reasoningTokens', async () => {
      const client = new OpenRouterClient({ apiKey: 'test-key' });
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          model: 'deepseek/deepseek-r1',
          choices: [
            {
              message: {
                content: 'Final Answer',
                reasoning: 'Detailed thinking process',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 50,
            total_tokens: 70,
            prompt_tokens_details: { cached_tokens: 10 },
            completion_tokens_details: { reasoning_tokens: 40 },
            total_cost: 0.0015,
          },
        }),
      } as any);

      const result = await client.complete(
        [{ role: 'user', content: 'solve this' }],
        { model: 'deepseek/deepseek-r1' },
      );

      expect(result.usage.billingSource).toBe('openrouter');
      expect(result.usage.cachedTokens).toBe(10);
      expect(result.usage.reasoningTokens).toBe(40);
      expect(result.usage.cost).toBe(0.0015);
      expect(result.thinking).toBe('Detailed thinking process');
    });

    it('extracts cacheRead and cacheWrite tokens in Anthropic completion', async () => {
      const client = new AnthropicClient({ apiKey: 'test-key' });
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          model: 'claude-3-7-sonnet-20250219',
          content: [{ type: 'text', text: 'Anthropic reply' }],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 50,
            output_tokens: 25,
            cache_read_input_tokens: 1000,
            cache_creation_input_tokens: 250,
          },
        }),
      } as any);

      const result = await client.complete(
        [{ role: 'user', content: 'test anthropic' }],
        { model: 'claude-3-7-sonnet' },
      );

      expect(result.provider).toBe('anthropic');
      expect(result.usage.promptTokens).toBe(50);
      expect(result.usage.completionTokens).toBe(25);
      expect(result.usage.cachedTokens).toBe(1000);
      expect(result.usage.cacheWriteTokens).toBe(250);
    });

    it('extracts cacheRead and cacheWrite tokens in Anthropic SSE stream', async () => {
      const chunks = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"claude-3-7-sonnet","usage":{"input_tokens":100,"cache_read_input_tokens":500,"cache_creation_input_tokens":150}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Streamed Anthropic"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}\n\n',
      ];

      const stream = streamFromChunks(chunks);
      const streamed = await parseAnthropicSse(stream);

      expect(streamed.usage?.promptTokens).toBe(100);
      expect(streamed.usage?.completionTokens).toBe(20);
      expect(streamed.usage?.cachedTokens).toBe(500);
      expect(streamed.usage?.cacheWriteTokens).toBe(150);
      expect(streamed.content).toBe('Streamed Anthropic');
    });

    it('extracts reasoningTokens and cost in OpenAI SSE stream', async () => {
      const chunks = [
        'data: {"id":"1","choices":[{"index":0,"delta":{"content":"Answer"}}],"usage":{"prompt_tokens":10,"completion_tokens":30,"total_tokens":40,"prompt_tokens_details":{"cached_tokens":5},"completion_tokens_details":{"reasoning_tokens":25},"total_cost":0.0008}}\n\n',
        'data: [DONE]\n\n',
      ];

      const stream = streamFromChunks(chunks);
      const streamed = await parseOpenAiSse(stream);

      expect(streamed.usage?.promptTokens).toBe(10);
      expect(streamed.usage?.completionTokens).toBe(30);
      expect(streamed.usage?.cachedTokens).toBe(5);
      expect(streamed.usage?.reasoningTokens).toBe(25);
      expect(streamed.usage?.cost).toBe(0.0008);
      expect(streamed.content).toBe('Answer');
    });

    it('stamps billingSource: "local" on UnifiedWireClient for local endpoints', async () => {
      const client = new UnifiedWireClient({
        provider: 'ollama',
      });

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          model: 'llama3:latest',
          choices: [{ message: { content: 'Local response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
      } as any);

      const result = await client.complete(
        [{ role: 'user', content: 'test local' }],
        { model: 'llama3' },
      );

      expect(result.usage.billingSource).toBe('local');
    });

    it('ensures local endpoints do not send cloud headers', async () => {
      const client = new UnifiedWireClient({
        provider: 'llamacpp',
        baseUrl: 'http://127.0.0.1:8080/v1',
      });

      let capturedHeaders: Record<string, string> = {};
      globalThis.fetch = jest.fn().mockImplementation(async (_url, init) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            model: 'qwen2.5-coder',
            choices: [{ message: { content: 'local code' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
        };
      });

      await client.complete(
        [{ role: 'user', content: 'hello local' }],
        { model: 'qwen2.5-coder' },
      );

      expect(capturedHeaders['x-opencode-session']).toBeUndefined();
      expect(capturedHeaders['anthropic-version']).toBeUndefined();
      expect(capturedHeaders['HTTP-Referer']).toBeUndefined();
      expect(capturedHeaders['X-Title']).toBeUndefined();
      expect(capturedHeaders['Content-Type']).toBe('application/json');
    });
  });
});
