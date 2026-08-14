import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { clearRulesCache, setOverrideReader } from './overrides.js';

/**
 * Node-only rules override store.
 *
 * This module touches the filesystem, so it must never be imported from a
 * browser bundle. The browser-safe side lives in `overrides.ts`; the reader
 * below is installed into it via `installOverrideReader()` (called from the
 * core barrel) so `loadRulesSync` can consult the store without this file
 * being part of the module graph.
 */

function isRulesDoc(value: unknown): value is { version: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { version?: unknown }).version === 'string'
  );
}

export function overrideDir(): string {
  return (
    process.env.MUGIL_IDE_MODULES_DIR ??
    path.join(os.homedir(), '.config', 'mugil-ide', 'modules')
  );
}

/** Reads the override for a module without touching the rules cache. */
export function readOverrideSync<T>(id: string): T | undefined {
  const file = path.join(overrideDir(), `${id}.json`);
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isRulesDoc(parsed) ? (parsed as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Writes new rules to the store (and refreshes the in-process cache). */
export function writeOverrideSync<T>(id: string, rules: T): void {
  if (!isRulesDoc(rules)) {
    throw new Error(`refusing to write invalid rules for module "${id}"`);
  }
  const dir = overrideDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(rules, null, 2), 'utf8');
  // Bump the revision so running modules hot-reload the new rules.
  clearRulesCache();
}

/**
 * Wires the fs-backed reader into the browser-safe rules loader.
 *
 * Mirrors the original store gating so test runs stay hermetic: the store is
 * only consulted when `MUGIL_IDE_MODULES_DIR` is explicitly set or we are not
 * running tests (otherwise a developer's home-dir overrides could leak into
 * test expectations).
 */
export function installOverrideReader(): void {
  const enabled = Boolean(process.env.MUGIL_IDE_MODULES_DIR) || process.env.NODE_ENV !== 'test';
  if (enabled) {
    setOverrideReader((id) => readOverrideSync(id));
  }
}
