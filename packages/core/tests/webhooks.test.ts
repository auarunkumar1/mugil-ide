import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fireWebhooks, parseWebhookConfigs } from '../src/modules/webhooks.js';

describe('parseWebhookConfigs', () => {
  it('parses webhooks from the env JSON string', () => {
    const env = {
      MUGIL_IDE_WEBHOOKS: JSON.stringify([
        { url: 'https://example.com/hooks', events: ['turn.completed'] },
        { url: 'https://other.com/x' },
      ]),
    };
    const configs = parseWebhookConfigs(env as NodeJS.ProcessEnv);
    expect(configs).toHaveLength(2);
    expect(configs[0]?.events).toEqual(['turn.completed']);
    expect(configs[1]?.events).toBeUndefined();
  });

  it('loads from the config file, env wins on URL conflicts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-webhooks-'));
    const file = path.join(dir, 'hooks.json');
    fs.writeFileSync(
      file,
      JSON.stringify([
        { url: 'https://example.com/a', events: ['turn.completed'] },
        { url: 'https://example.com/b' },
      ]),
    );
    const env = {
      MUGIL_IDE_WEBHOOKS_CONFIG: file,
      MUGIL_IDE_WEBHOOKS: JSON.stringify([{ url: 'https://example.com/a', events: ['turn.error'] }]),
    };
    const configs = parseWebhookConfigs(env as NodeJS.ProcessEnv);
    expect(configs).toHaveLength(2);
    const byUrl = new Map(configs.map((c) => [c.url, c]));
    expect(byUrl.get('https://example.com/a')?.events).toEqual(['turn.error']);
    expect(byUrl.get('https://example.com/b')?.events).toBeUndefined();
  });

  it('ignores malformed config and non-http(s) URLs without throwing', () => {
    const env = {
      MUGIL_IDE_WEBHOOKS: JSON.stringify([
        { url: 'ftp://x' },
        { url: 'not-a-url' },
        { url: 'https://ok.example.com' },
      ]),
      MUGIL_IDE_WEBHOOKS_CONFIG: '/nonexistent/hooks.json',
    };
    const configs = parseWebhookConfigs(env as NodeJS.ProcessEnv);
    expect(configs).toEqual([{ url: 'https://ok.example.com' }]);
  });
});

describe('fireWebhooks', () => {
  const recordFetch = (
    calls: { url: string; init: RequestInit }[],
    response: { ok: boolean; status: number },
  ): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), init: init ?? {} });
      return new Response(null, { status: response.status });
    }) as typeof fetch;

  it('POSTs a JSON envelope to subscribed webhooks', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const results = await fireWebhooks(
      [{ url: 'https://example.com/hooks' }, { url: 'https://example.com/only-completed', events: ['turn.completed'] }],
      'turn.completed',
      { model: 'm1', usage: { totalTokens: 10 } },
      recordFetch(calls, { ok: true, status: 200 }),
    );
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.init.method).toBe('POST');
      expect((call.init.headers as Record<string, string>)['content-type']).toBe('application/json');
      const body = JSON.parse(call.init.body as string);
      expect(body.event).toBe('turn.completed');
      expect(body.source).toBe('mugil-ide');
      expect(body.payload.model).toBe('m1');
      expect(typeof body.ts).toBe('string');
    }
  });

  it('only delivers to webhooks subscribed to the fired event', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await fireWebhooks(
      [
        { url: 'https://example.com/completed', events: ['turn.completed'] },
        { url: 'https://example.com/errors', events: ['turn.error'] },
      ],
      'turn.completed',
      {},
      recordFetch(calls, { ok: true, status: 200 }),
    );
    expect(calls.map((c) => c.url)).toEqual(['https://example.com/completed']);
  });

  it('forwards custom headers and never throws on failures', async () => {
    const failing: typeof fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const results = await fireWebhooks(
      [{ url: 'https://example.com/hooks', headers: { Authorization: 'Bearer tok' } }],
      'tool.executed',
      { name: 'read_file' },
      failing,
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toContain('ECONNREFUSED');
  });

  it('returns [] for no configs or no matching event', async () => {
    expect(await fireWebhooks([], 'turn.completed', {})).toEqual([]);
    const calls: { url: string; init: RequestInit }[] = [];
    await fireWebhooks(
      [{ url: 'https://example.com/x', events: ['turn.error'] }],
      'turn.completed',
      {},
      recordFetch(calls, { ok: true, status: 200 }),
    );
    expect(calls).toEqual([]);
  });
});
