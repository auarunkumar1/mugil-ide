import {
  UnifiedWireClient,
  createUnifiedWireClient,
} from '../src/modules/handoff/unifiedWireClient.js';

describe('UnifiedWireClient', () => {
  it('configures OpenAI provider defaults', () => {
    const client = createUnifiedWireClient({ provider: 'openai', apiKey: 'test-key' });
    expect(client.name).toBe('openai');
  });

  it('configures OpenRouter provider headers and stream options', () => {
    const client = new UnifiedWireClient({ provider: 'openrouter', apiKey: 'router-key' });
    expect(client.name).toBe('openrouter');
    const body = client.buildBody([{ role: 'user', content: 'hello' }], {});
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('configures Together reasoning effort when thinkingLevel is set', () => {
    const client = new UnifiedWireClient({ provider: 'together', apiKey: 'together-key' });
    const body = client.buildBody([{ role: 'user', content: 'solve' }], { thinkingLevel: 'high' });
    expect(body.reasoning).toEqual({ effort: 'high' });
  });

  it('identifies local endpoints without requiring API key', () => {
    const client = createUnifiedWireClient({ provider: 'ollama' });
    expect(client.name).toBe('ollama');
  });
});
