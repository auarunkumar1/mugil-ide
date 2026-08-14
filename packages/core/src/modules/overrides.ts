/**
 * Rules override store (browser-safe core).
 *
 * Modules ship bundled, versioned rules (see `src/rules/*.json`). The Update
 * Manager can write newer rules to a local override store, and modules load
 * those at runtime — so modules are updatable without code changes.
 *
 * Resolution order per module id: local override (if present and valid) ->
 * bundled defaults.
 *
 * This module must stay free of Node builtins so the pure engine modules can
 * run in the browser (a future GUI client). The filesystem-backed store lives in
 * `overridesNode.ts` and is installed here via `setOverrideReader()` from the
 * core barrel; without it, bundled defaults are used.
 */

const cache = new Map<string, unknown>();
let revision = 0;

type OverrideReader = (id: string) => unknown | undefined;
let reader: OverrideReader | undefined;

/** Installs the fs-backed override reader (Node only; no-op in browsers). */
export function setOverrideReader(fn: OverrideReader | undefined): void {
  reader = fn;
}

/**
 * Node-only self-install: modules imported without the core barrel (e.g. in
 * tests or third-party consumers) still get filesystem override support.
 * The require is guarded and never executed in browsers, so this file stays
 * safe for browser bundles.
 */
function ensureReader(): void {
  if (reader) return;
  // In browser bundles `process` is undefined (Vite only shims
  // process.env.NODE_ENV), so the store is never touched there.
  if (typeof process === 'undefined') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeStore = require('./overridesNode.js') as {
      installOverrideReader: () => void;
    };
    nodeStore.installOverrideReader();
  } catch {
    // Not a Node runtime (e.g. browser bundle): bundled defaults only.
  }
}

/** Monotonic counter bumped whenever the override store changes; modules use
 * it to recompile their rule regexes (hot reload after `mugil-ide update`). */
export function currentRevision(): number {
  return revision;
}

function isRulesDoc(value: unknown): value is { version: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { version?: unknown }).version === 'string'
  );
}

/** Loads rules for a module: local override first, then bundled defaults. */
export function loadRulesSync<T>(id: string, defaults: T): T {
  ensureReader();
  if (cache.has(id)) return cache.get(id) as T;
  if (reader) {
    const override = reader(id);
    if (override && isRulesDoc(override)) {
      cache.set(id, override);
      return override as T;
    }
  }
  cache.set(id, defaults);
  return defaults;
}

/** Clears the in-process rules cache (used by tests and hot reloads). */
export function clearRulesCache(): void {
  cache.clear();
  revision += 1;
}
