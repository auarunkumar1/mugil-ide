import { scanSecrets } from '../src/modules/security/secretScanner.js';
import { SecretVault } from '../src/modules/security/secretVault.js';
import {
  classifyEndpoint,
  sanitizeOutbound,
} from '../src/modules/security/outboundGuard.js';
import { fireWebhooks, type WebhookConfig } from '../src/modules/webhooks.js';
import { OpenAiClient } from '../src/modules/handoff/openAi.js';
import { HandoffManager } from '../src/modules/handoff/index.js';
import { SecretLeakError } from '../src/modules/security/outboundGuard.js';
import type { ModelSpec } from '../src/types.js';

describe('Secret Boundary & Non-Blocking User Alerts (Phase 2)', () => {
  describe('Secret Scanner Pattern Expansions', () => {
    it('detects OpenCode oc_sk_ keys', () => {
      const key = ['oc_sk_', '1234567890abcdef12345678'].join('');
      const matches = scanSecrets(`OPENCODE_API_KEY=${key}`);
      expect(matches.length).toBe(1);
      expect(matches[0]?.type).toBe('OPENCODE_API_KEY');
      expect(matches[0]?.value).toBe(key);
    });

    it('detects GitLab PATs (glpat-...) and GitHub fine-grained PATs (github_pat_...)', () => {
      const gl = ['glpat-', 'abcdef1234567890abcdef12'].join('');
      const gh = ['github_pat_', '11AAAAAAA0123456789abcdefABCDEF_0123456789'].join('');
      const text = `GitLab: ${gl} and GitHub: ${gh}`;
      const matches = scanSecrets(text);
      expect(matches.length).toBe(2);
      expect(matches.some((m) => m.type === 'GITLAB_TOKEN')).toBe(true);
      expect(matches.some((m) => m.type === 'GITHUB_PAT')).toBe(true);
    });

    it('detects JWT tokens', () => {
      const jwt = [
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0',
        'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      ].join('.');
      const matches = scanSecrets(`Bearer token: ${jwt}`);
      expect(matches.some((m) => m.type === 'JWT_TOKEN' || m.type === 'BEARER_TOKEN')).toBe(true);
    });

    it('detects secret-bearing URL query parameters', () => {
      const url = 'https://api.example.com/webhook?token=secret1234567890&action=sync';
      const matches = scanSecrets(url);
      expect(matches.some((m) => m.type === 'SECRET_URL_PARAM')).toBe(true);
    });
  });

  describe('Exact Known-Secret Registry', () => {
    it('registers exact known secrets and vaults them before regex matching', () => {
      const vault = new SecretVault();
      const customSecret = 'my-super-secret-custom-key-12345';
      vault.registerKnownSecret('CUSTOM_KEY', customSecret);

      const result = vault.tokenize(`Connecting with ${customSecret} to server`);
      expect(result.count).toBe(1);
      expect(result.text).not.toContain(customSecret);
      expect(result.text).toContain('[MUGIL_SECRET_CUSTOM_KEY_');
      expect(vault.resolve(result.text)).toContain(customSecret);
    });
  });

  describe('Non-Blocking User Alerting Event', () => {
    it('fires onSecretDiscovered callback without interrupting execution', () => {
      const vault = new SecretVault();
      const events: any[] = [];
      const unsubscribe = vault.onSecretDiscovered((ev) => events.push(ev));

      const secret = ['sk-ant-', 'api03-abcdef12345678901234567890'].join('');
      const result = vault.tokenize(`My key is ${secret}`);
      expect(result.count).toBe(1);
      expect(events.length).toBe(1);
      expect(events[0].count).toBe(1);
      expect(events[0].types).toContain('ANTHROPIC_API_KEY');

      unsubscribe();
    });
  });

  describe('Outbound Guard & Fail-Closed Policy', () => {
    it('classifies endpoints as loopback, private-lan, or remote', () => {
      expect(classifyEndpoint('http://localhost:11434/v1')).toBe('loopback');
      expect(classifyEndpoint('http://127.0.0.1:8080/v1')).toBe('loopback');
      expect(classifyEndpoint('http://192.168.1.50:11434', true)).toBe('private-lan');
      expect(classifyEndpoint('http://192.168.1.50:11434', false)).toBe('remote');
      expect(classifyEndpoint('https://api.openai.com/v1')).toBe('remote');
      expect(classifyEndpoint('https://opencode.ai/inference')).toBe('remote');
    });

    it('allows tokens to remote endpoints when secrets are vaulted', () => {
      const vault = new SecretVault();
      const secret = ['sk-proj-', '12345678901234567890'].join('');
      const tokenized = vault.tokenize(`Check ${secret}`).text;

      const sanitized = sanitizeOutbound(
        { prompt: tokenized },
        { destinationUrl: 'https://api.openai.com/v1', vault },
      );
      expect((sanitized as any).prompt).toContain('[MUGIL_SECRET_');
      expect((sanitized as any).prompt).not.toContain(secret);
    });

    it('permits provider own key in Authorization header', () => {
      const providerKey = ['sk-proj-', 'my-legitimate-api-key-1234567890'].join('');
      const payload = {
        headers: {
          Authorization: `Bearer ${providerKey}`,
        },
        body: 'Safe prompt without credentials',
      };

      const result = sanitizeOutbound(payload, {
        destinationUrl: 'https://api.openai.com/v1',
        expectedProviderKey: providerKey,
      });

      expect((result as any).headers.Authorization).toBe(`Bearer ${providerKey}`);
    });
  });

  describe('Provider request-body sanitization', () => {
    it('sanitizes a direct provider body before fetch', async () => {
      const secret = ['sk-ant-', 'api03-abcdef12345678901234567890'].join('');
      let captured = '';
      const originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn().mockImplementation(async (_url, init) => {
        captured = String(init?.body ?? '');
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        } as Response;
      }) as unknown as typeof fetch;
      try {
        const client = new OpenAiClient({
          apiKey: 'provider-key',
          baseUrl: 'https://example.test/v1',
        });
        await client.complete(
          [{ role: 'user', content: `my key is ${secret}` }],
          { model: 'test-model' },
        );
        expect(captured).not.toContain(secret);
        expect(captured).toContain('[MUGIL_SECRET_ANTHROPIC_API_KEY_');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Local-only policy routing', () => {
    const models: ModelSpec[] = [
      {
        id: 'remote-model',
        tier: 'cheap',
        costPerMTokIn: 1,
        costPerMTokOut: 1,
        contextWindow: 100000,
        provider: 'opencode',
      },
      {
        id: 'local-model',
        tier: 'cheap',
        costPerMTokIn: 0,
        costPerMTokOut: 0,
        contextWindow: 8000,
        provider: 'ollama',
        isLocal: true,
      },
    ];

    it('fails closed instead of calling a remote client for a secret-bearing turn', async () => {
      const complete = jest.fn().mockResolvedValue({
        provider: 'opencode',
        model: 'remote-model',
        content: 'should not run',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
      const client = {
        name: 'opencode',
        mock: false,
        complete,
        stream: complete,
      } as any;
      const handoff = new HandoffManager({
        client,
        models,
        secretPolicy: 'local-only',
      });

      await expect(
        handoff.complete(
          [{ role: 'user', content: 'use [MUGIL_SECRET_OPENCODE_API_KEY_1]' }],
          { preferredModel: 'local-model' },
        ),
      ).rejects.toBeInstanceOf(SecretLeakError);
      expect(complete).not.toHaveBeenCalled();
    });

    it('allows a secret-bearing turn through a local client', async () => {
      const complete = jest.fn().mockResolvedValue({
        provider: 'ollama',
        model: 'local-model',
        content: 'local ok',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
      const client = {
        name: 'ollama',
        mock: false,
        complete,
        stream: complete,
      } as any;
      const handoff = new HandoffManager({
        client,
        models,
        secretPolicy: 'local-only',
      });

      const result = await handoff.complete(
        [{ role: 'user', content: 'use [MUGIL_SECRET_OPENCODE_API_KEY_1]' }],
        { preferredModel: 'local-model' },
      );
      expect(result.content).toBe('local ok');
      expect(complete).toHaveBeenCalledTimes(1);
    });
  });

  describe('Webhook Sanitization', () => {
    it('sanitizes secret-bearing payloads before webhook delivery', async () => {
      const secret = ['sk-ant-', 'api03-abcdef12345678901234567890'].join('');
      const capturedBodies: any[] = [];

      const mockFetch = jest.fn().mockImplementation((url, init) => {
        capturedBodies.push(JSON.parse(init.body));
        return Promise.resolve({ ok: true, status: 200 } as Response);
      });

      const configs: WebhookConfig[] = [{ url: 'https://webhook.site/test' }];
      await fireWebhooks(configs, 'turn.started', { prompt: `Here is ${secret}` }, mockFetch as any);

      expect(capturedBodies.length).toBe(1);
      expect(capturedBodies[0].payload.prompt).not.toContain(secret);
      expect(capturedBodies[0].payload.prompt).toContain('[MUGIL_SECRET_');
    });
  });
});
