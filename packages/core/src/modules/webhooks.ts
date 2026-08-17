/**
 * Webhook Integrations
 * ====================
 * Notifies external HTTP endpoints about engine lifecycle events, so a
 * long-running task can ping Slack/a server when it finishes, a tool
 * executes, or an ask errors. Config is a JSON array (env var
 * `MUGIL_IDE_WEBHOOKS` and/or file `MUGIL_IDE_WEBHOOKS_CONFIG`, env wins on
 * URL conflicts):
 *
 *   [ { "url": "https://example.com/hooks", "events": ["turn.completed"], "headers": { "Authorization": "Bearer x" } } ]
 *
 * Events: `turn.started`, `tool.executed`, `turn.completed`, `turn.error`.
 * A webhook without `events` receives every event. Delivery is
 * **fire-and-forget** and best-effort: failures are captured in the returned
 * results and never throw, and a per-webhook timeout keeps the agent loop
 * from ever being slowed by an unreachable endpoint.
 */
import * as fs from 'node:fs';

export const WEBHOOK_EVENTS = [
  'turn.started',
  'tool.executed',
  'turn.completed',
  'turn.error',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookConfig {
  /** HTTPS/HTTP endpoint to POST to. */
  url: string;
  /** Events to receive; absent = all events. */
  events?: string[];
  /** Extra headers (e.g. Authorization). `content-type` is always set. */
  headers?: Record<string, string>;
}

export interface WebhookResult {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}

const WEBHOOK_TIMEOUT_MS = 5_000;

/** Reads webhook configs: file first, env JSON wins on URL conflicts. */
export function parseWebhookConfigs(env: NodeJS.ProcessEnv = process.env): WebhookConfig[] {
  const byUrl = new Map<string, WebhookConfig>();
  const ingest = (raw: string): void => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        if (isValidConfig(entry)) byUrl.set(entry.url, entry);
      }
    } catch {
      // malformed config is ignored (never crash the engine)
    }
  };
  if (env.MUGIL_IDE_WEBHOOKS_CONFIG) {
    try {
      ingest(fs.readFileSync(env.MUGIL_IDE_WEBHOOKS_CONFIG, 'utf-8'));
    } catch {
      // unreadable config file is ignored
    }
  }
  if (env.MUGIL_IDE_WEBHOOKS) ingest(env.MUGIL_IDE_WEBHOOKS);
  return [...byUrl.values()];
}

/**
 * POSTs `{ event, payload, source, ts }` to every configured webhook that
 * subscribes to `event`. Never throws — each endpoint's failure is returned
 * as a `WebhookResult` with `ok: false` and the error message.
 */
export async function fireWebhooks(
  configs: WebhookConfig[],
  event: WebhookEvent,
  payload: Record<string, unknown>,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<WebhookResult[]> {
  if (configs.length === 0) return [];
  const body = JSON.stringify({
    event,
    payload,
    source: 'mugil-ide',
    ts: new Date().toISOString(),
  });
  const matching = configs.filter((c) => !c.events || c.events.includes(event));
  return Promise.all(
    matching.map(async (config): Promise<WebhookResult> => {
      try {
        const response = await fetchFn(config.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(config.headers ?? {}) },
          body,
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });
        return { url: config.url, ok: response.ok, status: response.status };
      } catch (err) {
        return {
          url: config.url,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}

function isValidConfig(s: unknown): s is WebhookConfig {
  if (!s || typeof s !== 'object') return false;
  const c = s as WebhookConfig;
  if (typeof c.url !== 'string') return false;
  try {
    const protocol = new URL(c.url).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
