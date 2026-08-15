/**
 * MUGIL WEBHOOKS — fire-and-forget HTTP notifications on pipeline events
 * ======================================================================
 * Port of `modules/webhooks.ts` in the mugil repo. Reads endpoints from
 * `MUGIL_IDE_WEBHOOKS` (JSON array) / `MUGIL_IDE_WEBHOOKS_CONFIG` (JSON
 * file; env value wins on URL conflicts). Delivery is fire-and-forget with
 * a 5s per-webhook timeout — it never slows the agent loop.
 *
 * The fork's event bus (`session.next.*`) is mapped to the mugil event
 * names (`turn.started` / `tool.executed` / `turn.completed` /
 * `turn.error`) by the caller (see plugin/index.ts wiring).
 *
 * Kill switch: `MUGIL_IDE_ADDONS=0` disables delivery.
 *
 * Credits: `modules/webhooks.ts` in the mugil repo.
 */

export interface WebhookConfig {
  url: string
  /** Event names to notify; absent = all events. */
  events?: string[]
}

export function mugilWebhookConfigs(): WebhookConfig[] {
  const raw = process.env.MUGIL_IDE_WEBHOOKS
  const file = process.env.MUGIL_IDE_WEBHOOKS_CONFIG
  const parsed: WebhookConfig[] = []

  if (file) {
    try {
      const { readFileSync } = require("node:fs") as typeof import("node:fs")
      const items = JSON.parse(readFileSync(file, "utf8")) as WebhookConfig[]
      for (const item of items) {
        if (item && typeof item.url === "string") parsed.push({ url: item.url, events: item.events })
      }
    } catch {
      // malformed config file — ignore, fall through to env
    }
  }

  if (raw) {
    try {
      const items = JSON.parse(raw) as WebhookConfig[]
      const byUrl = new Map(parsed.map((item) => [item.url, item]))
      for (const item of items) {
        if (!item || typeof item.url !== "string") continue
        const existing = byUrl.get(item.url)
        if (existing) {
          // env value wins on URL conflicts
          existing.events = item.events
        } else {
          parsed.push({ url: item.url, events: item.events })
          byUrl.set(item.url, item)
        }
      }
    } catch {
      // malformed env JSON — ignore
    }
  }

  return parsed
}

/**
 * Fires the event to every configured endpoint that subscribes to it.
 * Fire-and-forget: failures are swallowed per-URL, never awaited by the
 * caller, and a 5s timeout bounds each delivery.
 */
export function mugilFireWebhooks(event: string, payload: Record<string, unknown>): void {
  if (process.env.MUGIL_IDE_ADDONS === "0") return
  const configs = mugilWebhookConfigs()
  if (configs.length === 0) return

  const body = JSON.stringify({ event, payload, source: "mugil-ide", ts: new Date().toISOString() })

  for (const cfg of configs) {
    if (cfg.events && cfg.events.length > 0 && !cfg.events.includes(event)) continue
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    fetch(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
    })
      .catch(() => {
        // fire-and-forget: never let a webhook failure surface
      })
      .finally(() => clearTimeout(timer))
  }
}
