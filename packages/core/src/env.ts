/**
 * User-level env file (API keys) layer.
 *
 * `mugil-ide login` stores provider API keys in a user-level env file
 * (default `~/.config/mugil-ide/.env`, override with `MUGIL_IDE_ENV_FILE`) so
 * they survive across CLI/MCP invocations without being committed or echoed.
 *
 * Safety rules:
 *   - The file is written with owner-only permissions (0600 on POSIX).
 *   - Writes go through a temp file + atomic rename (no partial files).
 *   - Keys are never printed by the CLI (masked in `keys` output).
 *   - `process.env` always wins over the file at load time.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** The user-level env file location. Honors MUGIL_IDE_ENV_FILE. */
export function userEnvPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.MUGIL_IDE_ENV_FILE || path.join(os.homedir(), '.config', 'mugil-ide', '.env');
}

/** Minimal dotenv parser: KEY=VALUE lines, # comments, quoted values. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      // Strip inline comments only for unquoted values.
      value = value.split(/\s+#/)[0]!.trim();
    }
    out[key] = value;
  }
  return out;
}

/** Reads and parses the user env file; returns {} when absent/unreadable. */
export function readUserEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const file = userEnvPath(env);
  try {
    return parseEnvFile(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** Serializes entries, preserving existing lines (keys are updated in place). */
export function serializeEnvFile(entries: Record<string, string>, existing = ''): string {
  const current = parseEnvFile(existing);
  const merged = { ...current, ...entries };
  const seen = new Set<string>();
  const lines = existing.split(/\r?\n/).map((line) => {
    const eq = line.indexOf('=');
    if (eq <= 0 || line.trim().startsWith('#')) return line;
    const key = line.slice(0, eq).trim();
    if (!(key in merged)) return line;
    seen.add(key);
    return `${key}=${merged[key]}`;
  });
  for (const [key, value] of Object.entries(merged)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  // Collapse trailing blank lines.
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines.join('\n') + '\n';
}

/**
 * Safely writes entries to the user env file (0600, atomic). Returns the
 * file path. Throws on failure so callers can surface a clear error.
 */
export function writeUserEnv(
  entries: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const file = userEnvPath(env);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const existing = (() => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  })();
  const tmp = path.join(dir, `.env.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, serializeEnvFile(entries, existing), { mode: 0o600 });
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
  // POSIX: ensure owner-only permissions even if umask or rename changed them.
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows: chmod is a no-op; the ACL is out of scope.
  }
  return file;
}

/** Deletes the given keys from the user env file (no-op when absent). */
export function deleteUserEnvKeys(
  keys: string[],
  env: NodeJS.ProcessEnv = process.env,
): { file: string; removed: string[] } {
  const file = userEnvPath(env);
  const existing = (() => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  })();
  const toDelete = new Set(keys);
  const removed: string[] = [];
  const lines = existing.split(/\r?\n/).filter((line) => {
    const eq = line.indexOf('=');
    if (eq <= 0 || line.trim().startsWith('#')) return true;
    const key = line.slice(0, eq).trim();
    if (toDelete.has(key)) {
      removed.push(key);
      return false;
    }
    return true;
  });
  const out = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  fs.writeFileSync(file, out, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // non-POSIX
  }
  return { file, removed };
}
