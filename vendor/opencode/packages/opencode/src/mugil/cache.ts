/**
 * MUGIL SMART-CACHE — exact tier for the fork's LLM call path
 * ============================================================
 * Port of the `@mugil-ide/core` smart-cache exact tier (no embeddings, no
 * partial matching): a response is stored keyed by a sha256 of the full
 * request (system prompt + model messages + model id) and served verbatim
 * on an exact hit.
 *
 * Design notes:
 * - In-memory Map on top of a JSON file backend (`MUGIL_IDE_CACHE_DIR`,
 *   default `~/.cache/mugil-ide/fork-cache.json`). TTL from `CACHE_TTL`
 *   (default 86400s = 1 day).
 * - **Tool-call bypass is the caller's job**: the LLM stream wrapper skips
 *   lookup AND store when the request carries tools or prior tool-call
 *   messages (side-effectful / stale — same rule as the legacy pipeline).
 * - Kill switch: `MUGIL_IDE_ADDONS=0` disables the cache entirely.
 * - Fail-open: any fs/parse error degrades to a miss, never a crash.
 *
 * Credits: `modules/smart-cache` in the mugil repo (exact tier); see
 * ATTRIBUTIONS.md.
 */

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

const ENABLED = process.env.MUGIL_IDE_ADDONS !== "0"
const TTL_MS = (Number(process.env.CACHE_TTL) || 86400) * 1000

interface CacheEntry {
  value: string
  storedAt: number
}

function cacheFile(): string {
  const dir = process.env.MUGIL_IDE_CACHE_DIR ?? join(homedir(), ".cache", "mugil-ide")
  return join(dir, "fork-cache.json")
}

let memory = new Map<string, CacheEntry>()
let loaded = false

function load(): void {
  if (loaded) return
  loaded = true
  try {
    const file = cacheFile()
    if (!existsSync(file)) return
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, CacheEntry>
    memory = new Map(Object.entries(raw))
  } catch {
    memory = new Map()
  }
}

function persist(): void {
  try {
    const file = cacheFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(Object.fromEntries(memory.entries()), null, 2))
  } catch {
    // fail-open: cache is a nicety, never crash the loop
  }
}

/** sha256 of the full request — the exact-match cache key. */
export function mugilCacheKey(system: string[], messages: unknown[], model: string): string {
  return createHash("sha256")
    .update(system.join("\n"))
    .update("\u0000")
    .update(JSON.stringify(messages))
    .update("\u0000")
    .update(model)
    .digest("hex")
}

/** Returns the cached response for the key, or undefined on miss/expired. */
export function mugilCacheLookup(key: string): string | undefined {
  if (!ENABLED) return undefined
  load()
  const entry = memory.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.storedAt > TTL_MS) {
    memory.delete(key)
    return undefined
  }
  return entry.value
}

/** Stores a response under the key (no-op when disabled). */
export function mugilCacheStore(key: string, response: string): void {
  if (!ENABLED) return
  load()
  memory.set(key, { value: response, storedAt: Date.now() })
  persist()
}

/** Bypass helper: true when the request is tool-bearing (must never cache). */
export function mugilCacheBypass(tools: Record<string, unknown> | undefined, messages: unknown[]): boolean {
  if (tools && Object.keys(tools).length > 0) return true
  for (const msg of messages) {
    const content = (msg as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content as Array<{ type?: string }>) {
      if (part.type === "tool-call" || part.type === "tool-result") return true
    }
  }
  return false
}
