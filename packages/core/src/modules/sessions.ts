/**
 * Session Persistence
 * ===================
 * Saves and restores the TUI conversation so a restart resumes where you
 * left off — the session-resume pattern from OpenCode. Entries are stored
 * as a versioned JSON file in the cache dir (`MUGIL_IDE_CACHE_DIR`,
 * default `~/.cache/mugil-ide/last-session.json`).
 *
 * Only completed, non-transient turns are kept (system slash-command
 * confirmations are skipped by the caller). Corrupt or missing files load
 * as an empty conversation.
 *
 * Credit: session-resume pattern inspired by OpenCode — https://github.com/sst/opencode
 * See ATTRIBUTIONS.md at the repository root for the full credit list.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface SessionEntry {
  id: number;
  prompt: string;
  response: string;
  model?: string;
  provider?: string;
  mock?: boolean;
  toolCalls?: number;
}

export interface SessionFile {
  version: 1;
  savedAt: number;
  entries: SessionEntry[];
}

const MAX_ENTRIES = 50;
const MAX_CONTENT_CHARS = 200_000;

/** The session file path (cache dir + `last-session.json`). */
export function sessionFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.MUGIL_IDE_CACHE_DIR || path.join(os.homedir(), '.cache', 'mugil-ide');
  return path.join(dir, 'last-session.json');
}

/** Cache dir used for session files. */
export function sessionDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.MUGIL_IDE_CACHE_DIR || path.join(os.homedir(), '.cache', 'mugil-ide');
}

/** Path for a named session file: `session-<sanitized-name>.json`. */
export function namedSessionPath(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
  return path.join(sessionDir(env), `session-${safe}.json`);
}

/** Saved named-session metadata, newest first. */
export interface SessionInfo {
  name: string;
  savedAt: number;
  turns: number;
}

/** Lists named sessions (`session-*.json`, excluding the auto `last-session`). */
export function listSessions(env: NodeJS.ProcessEnv = process.env): SessionInfo[] {
  const dir = sessionDir(env);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /^session-.+\.json$/.test(f));
  } catch {
    return [];
  }
  const infos: SessionInfo[] = [];
  for (const file of files) {
    const name = file.replace(/^session-/, '').replace(/\.json$/, '');
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as SessionFile;
      infos.push({
        name,
        savedAt: Number(parsed.savedAt) || 0,
        turns: Array.isArray(parsed.entries) ? parsed.entries.length : 0,
      });
    } catch {
      // corrupt named sessions are skipped from the list
    }
  }
  return infos.sort((a, b) => b.savedAt - a.savedAt);
}

/** Removes a named session file. Returns false when it does not exist. */
export function clearNamedSession(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const file = namedSessionPath(name, env);
  if (!fs.existsSync(file)) return false;
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Writes the conversation (newest last) to the session file. */
export function saveSession(entries: SessionEntry[], file = sessionFilePath()): string {
  const session: SessionFile = {
    version: 1,
    savedAt: Date.now(),
    entries: entries.slice(-MAX_ENTRIES),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf-8');
  return file;
}

/** Loads a saved conversation; [] when absent, corrupt, or mismatched. */
export function loadSession(file = sessionFilePath()): SessionEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as SessionFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries
      .filter(
        (e) =>
          e &&
          typeof e.prompt === 'string' &&
          typeof e.response === 'string' &&
          e.prompt.length < MAX_CONTENT_CHARS &&
          e.response.length < MAX_CONTENT_CHARS,
      )
      .map((e) => ({ ...e, id: Number(e.id) || 0 }))
      .slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** Removes the session file (no-op when absent). */
export function clearSession(file = sessionFilePath()): boolean {
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}
