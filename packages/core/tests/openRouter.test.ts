import { OpenRouterClient, OpenRouterError } from '../src/modules/handoff/openRouter.js';
import { UnifiedWireClient } from '../src/modules/handoff/unifiedWireClient.js';
import { parseOpenAiSse, streamFromChunks } from '../src/modules/handoff/stream.js';
import { ProviderError } from '../src/modules/handoff/provider.js';
import fs from 'fs';
import path from 'path';

describe('Phase 4: OpenRouter Hardening & Provider Wire Resilience', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('OpenRouterClient Contract & Error Handling', () => {
    it('sets default attribution headers to github repo and Mugil IDE', () => {
      const client = new OpenRouterClient({ apiKey: 'test-key' });
      // Access protected getHeaders via build check or reflection
      const headers = (client as any).getHeaders();
      expect(headers['HTTP-Referer']).toBe('https://github.com/auarunkumar1/mugil-ide');
      expect(headers['X-Title']).toBe('Mugil IDE');
      expect(headers['Authorization']).toBe('Bearer test-key');
    });

    it('honors custom appUrl and appTitle when provided', () => {
      const client = new OpenRouterClient({
        apiKey: 'test-key',
        appUrl: 'https://my-custom-domain.org',
        appTitle: 'Custom IDE',
      });
      const headers = (client as any).getHeaders();
      expect(headers['HTTP-Referer']).toBe('https://my-custom-domain.org');
      expect(headers['X-Title']).toBe('Custom IDE');
    });

    it('parses Retry-After header on 429 response', async () => {
      const client = new OpenRouterClient({ apiKey: 'test-key' });
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limit exceeded',
        headers: new Headers({
          'retry-after': '12',
        }),
      } as any);

      await expect(
        client.complete([{ role: 'user', content: 'hello' }], { model: 'test' }),
      ).rejects.toThrow(OpenRouterError);

      try {
        await client.complete([{ role: 'user', content: 'hello' }], { model: 'test' });
      } catch (err) {
        expect(err).toBeInstanceOf(OpenRouterError);
        const orErr = err as OpenRouterError;
        expect(orErr.status).toBe(429);
        expect(orErr.retryable).toBe(true);
        expect(orErr.retryAfter).toBe(12);
      }
    });

    it('detects HTTP 200 with top-level error object (fixture: openrouter-error-200.json)', async () => {
      const fixturePath = path.join(__dirname, 'fixtures/providers/openrouter-error-200.json');
      const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

      const client = new OpenRouterClient({ apiKey: 'test-key' });
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => fixture,
      } as any);

      let thrown = false;
      try {
        await client.complete([{ role: 'user', content: 'hello' }], { model: 'test' });
      } catch (err) {
        thrown = true;
        expect(err).toBeInstanceOf(OpenRouterError);
        const orErr = err as OpenRouterError;
        expect(orErr.status).toBe(402);
        expect(orErr.retryable).toBe(false);
        expect(orErr.message).toContain('Insufficient credits in account');
      }
      expect(thrown).toBe(true);
    });

    it('detects HTTP 200 with choice error (fixture: openrouter-choice-error.json)', async () => {
      const fixturePath = path.join(__dirname, 'fixtures/providers/openrouter-choice-error.json');
      const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

      const client = new OpenRouterClient({ apiKey: 'test-key' });
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => fixture,
      } as any);

      let thrown = false;
      try {
        await client.complete([{ role: 'user', content: 'hello' }], { model: 'test' });
      } catch (err) {
        thrown = true;
        expect(err).toBeInstanceOf(OpenRouterError);
        const orErr = err as OpenRouterError;
        expect(orErr.status).toBe(500);
        expect(orErr.retryable).toBe(true);
        expect(orErr.message).toContain('Provider upstream timeout');
      }
      expect(thrown).toBe(true);
    });
  });

  describe('OpenAI / OpenRouter SSE Stream Error Handling', () => {
    it('detects mid-stream event: error (fixture: openrouter-sse-error.txt)', async () => {
      const fixturePath = path.join(__dirname, 'fixtures/providers/openrouter-sse-error.txt');
      const fixtureContent = fs.readFileSync(fixturePath, 'utf-8');

      const stream = streamFromChunks([fixtureContent]);

      await expect(parseOpenAiSse(stream)).rejects.toThrow(ProviderError);

      const stream2 = streamFromChunks([fixtureContent]);
      try {
        await parseOpenAiSse(stream2);
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        const pe = err as ProviderError;
        expect(pe.status).toBe(429);
        expect(pe.retryable).toBe(true);
        expect(pe.retryAfter).toBe(5);
        expect(pe.message).toContain('Rate limit exceeded for provider');
      }
    });

    it('detects mid-stream finish_reason: "error"', async () => {
      const rawSse = [
        'data: {"id":"1","choices":[{"index":0,"delta":{"content":"Hi"}}]}\n\n',
        'data: {"id":"1","choices":[{"index":0,"error":{"code":503,"message":"Model overloaded"},"finish_reason":"error"}]}\n\n',
      ];
      const stream = streamFromChunks(rawSse);

      await expect(parseOpenAiSse(stream)).rejects.toThrow(ProviderError);
    });
  });

  describe('UnifiedWireClient Stream Options & Local Parity', () => {
    it('omits stream_options when stream is not enabled', () => {
      const client = new UnifiedWireClient({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      const body = client.buildBody([{ role: 'user', content: 'hello' }], {
        model: 'anthropic/claude-3.5-sonnet',
        stream: false,
      });

      expect(body.stream_options).toBeUndefined();
    });

    it('includes stream_options when stream is enabled', () => {
      const client = new UnifiedWireClient({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      const body = client.buildBody([{ role: 'user', content: 'hello' }], {
        model: 'anthropic/claude-3.5-sonnet',
        stream: true,
      });

      expect(body.stream_options).toEqual({ include_usage: true });
    });

    it('treats local providers (ollama, lmstudio, llamacpp) as local endpoints', () => {
      const llamacppClient = new UnifiedWireClient({
        provider: 'llamacpp',
        baseUrl: 'http://127.0.0.1:8080/v1',
      });
      expect(llamacppClient.mock).toBe(false);

      const ollamaClient = new UnifiedWireClient({
        provider: 'ollama',
      });
      expect(ollamaClient.mock).toBe(false);

      const lmstudioClient = new UnifiedWireClient({
        provider: 'lmstudio',
      });
      expect(lmstudioClient.mock).toBe(false);
    });
  });
});
