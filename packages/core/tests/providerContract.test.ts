import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from '../src/config.js';

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'providers');

function readFixture(filename: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf-8');
}

describe('Provider Contract Fixtures & Safety Rails (Phase 0)', () => {
  it('loads default config with provider v2 and local-only secrets enabled', () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    expect(config.providerV2).toBe(true);
    expect(config.secretPolicy).toBe('local-only');
    expect(config.sensitivePolicy).toBe('secrets');
    expect(config.localEndpointsPolicy).toBe('loopback');
  });

  it('allows disabling providerV2 via MUGIL_IDE_PROVIDER_V2=0', () => {
    const config = loadConfig({ NODE_ENV: 'test', MUGIL_IDE_PROVIDER_V2: '0' });
    expect(config.providerV2).toBe(false);
  });

  it('respects MUGIL_IDE_SECRET_POLICY=redact', () => {
    const config = loadConfig({ NODE_ENV: 'test', MUGIL_IDE_SECRET_POLICY: 'redact' });
    expect(config.secretPolicy).toBe('redact');
  });

  it('validates OpenCode Go catalog fixture structure', () => {
    const raw = readFixture('opencode-go-models.json');
    const parsed = JSON.parse(raw) as { data: Array<{ id: string; api?: any; cost?: any; capabilities?: any }> };
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed.data.length).toBeGreaterThanOrEqual(4);

    const haiku = parsed.data.find((m) => m.id === 'claude-haiku-5-5');
    expect(haiku).toBeDefined();
    expect(typeof haiku?.api === 'object' ? haiku?.api?.messages : haiku?.api).toBeTruthy();
    expect(haiku?.cost?.text?.input?.cache?.write).toBe(0.125);
    expect(haiku?.capabilities?.reasoning?.supported).toBe(true);

    const gpt = parsed.data.find((m) => m.id === 'gpt-5-preview');
    expect(gpt).toBeDefined();
    expect(typeof gpt?.api === 'object' ? gpt?.api?.responses : gpt?.api).toBeTruthy();
  });

  it('validates the live OpenCode Usage fixture structure', () => {
    const raw = readFixture('opencode-usage.json');
    const parsed = JSON.parse(raw);
    expect(parsed.usage.rolling.status).toBe('ok');
    expect(parsed.usage.weekly.status).toBe('ok');
    expect(parsed.usage.monthly.status).toBe('ok');
    expect(parsed.usage.rolling.resetsAt).toMatch(/^\d{4}-/);
  });

  it('validates OpenRouter 200-body error fixture structure', () => {
    const raw = readFixture('openrouter-error-200.json');
    const parsed = JSON.parse(raw);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe(402);
    expect(parsed.error.message).toContain('Insufficient credits');
  });

  it('validates OpenRouter choice error fixture structure', () => {
    const raw = readFixture('openrouter-choice-error.json');
    const parsed = JSON.parse(raw);
    expect(parsed.choices[0].error).toBeDefined();
    expect(parsed.choices[0].error.code).toBe(500);
    expect(parsed.choices[0].finish_reason).toBe('error');
  });

  it('validates OpenRouter SSE mid-stream error fixture', () => {
    const raw = readFixture('openrouter-sse-error.txt');
    expect(raw).toContain('event: error');
    expect(raw).toContain('"code":429');
    expect(raw).toContain('Rate limit exceeded');
  });
});

describe('OpenCode Correctness Foundation (Phase 1)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('detects OpenCode Go plan via GET /inference/go/v1/usage', async () => {
    const usageFixture = JSON.parse(readFixture('opencode-usage.json'));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => usageFixture,
    } as Response);

    const { resolveOpenCodePlan, clearOpenCodePlanCache } = await import('../src/modules/handoff/openCode.js');
    clearOpenCodePlanCache();
    const result = await resolveOpenCodePlan('oc_sk_test_key_123');
    expect(result.plan).toBe('go');
    expect(result.usage?.usage?.rolling?.status).toBe('ok');
  });

  it('detects pay-as-you-go (zen) plan when usage endpoint returns 402/403', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Not a Go subscriber',
    } as Response);

    const { resolveOpenCodePlan, clearOpenCodePlanCache } = await import('../src/modules/handoff/openCode.js');
    clearOpenCodePlanCache();
    const result = await resolveOpenCodePlan('oc_sk_zen_key_456');
    expect(result.plan).toBe('zen');
  });

  it('treats quota 429 as a non-retryable ProviderError', async () => {
    const { OpenCodeClient } = await import('../src/modules/handoff/openCode.js');
    const quotaFixture = JSON.parse(readFixture('opencode-quota-429.json'));

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => JSON.stringify(quotaFixture),
    } as Response);

    const client = new OpenCodeClient({ apiKey: 'oc-key', baseUrl: 'https://opencode.ai/inference/go' });
    await expect(
      client.complete([{ role: 'user', content: 'test' }], { model: 'beam-free' }),
    ).rejects.toMatchObject({
      status: 429,
      retryable: false,
    });
  });

  it('does not rewrite explicit OPENCODE_BASE_URL=https://opencode.ai/zen/v1', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      AI_PROVIDER: 'opencode',
      OPENCODE_API_KEY: 'oc-key',
      OPENCODE_BASE_URL: 'https://opencode.ai/zen/v1',
    });
    expect(config.opencodeBaseUrl).toBe('https://opencode.ai/zen/v1');
  });
});
