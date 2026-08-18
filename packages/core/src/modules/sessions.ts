/**
 * Session Persistence
 * ===================
 * Saves and restores the TUI conversation so a restart resumes where you
 * left off — the session-resume pattern from OpenCode. Entries are stored
 * as a versioned JSON file in the cache dir (`MUGIL_IDE_CACHE_DIR`,
 * default `~/.cache/mugil-ide/`).
 *
 * The **auto-saved** session (`last-session-<workspace>.json`) is scoped to
 * the workspace directory: reopening the app in a different project folder
 * starts fresh instead of resuming another project's conversation (which
 * previously leaked file references between similarly-named projects).
 * The legacy global `last-session.json` from pre-scoping versions is swept
 * up on startup by `removeLegacySessionFile()` (invoked on the auto-resume
 * path) so it doesn't linger on disk.
 * **Named** sessions (`session-<name>.json`) stay global — the user names
 * and resumes them explicitly with `/session` / `/resume`.
 *
 * Only completed, non-transient turns are kept (system slash-command
 * confirmations are skipped by the caller). Corrupt or missing files load
 * as an empty conversation.
 *
 * Since format version 2 the file also carries the session's token/savings
 * metrics (`SessionStats`), so `/stats` survives a reconnect — the file is
 * rewritten automatically after every completed turn and whenever the
 * session state changes (`/undo`, `/reset`).
 *
 * Credit: session-resume pattern inspired by OpenCode — https://github.com/sst/opencode
 * See ATTRIBUTIONS.md at the repository root for the full credit list.
 */
import * as crypto from 'node:crypto';
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

/**
 * Session metrics persisted with the auto-saved conversation so `/stats`
 * survives a reconnect (scoped per workspace like the session itself).
 * `filesModified` is stored as workspace-relative paths in a JSON-friendly
 * array; callers that keep a `Set` convert on save/load.
 */
export interface SessionStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHits: number;
  requests: number;
  tokensSaved: number;
  filesModified: string[];
}

export interface SessionFile {
  version: 1 | 2;
  savedAt: number;
  entries: SessionEntry[];
  /** Present in version-2 files. */
  stats?: SessionStats;
}

const MAX_ENTRIES = 50;
const MAX_CONTENT_CHARS = 200_000;

/**
 * Short stable tag for a workspace root, used to scope the auto-saved
 * session file per project directory.
 */
function workspaceTag(workspace: string): string {
  return crypto.createHash('sha1').update(path.resolve(workspace)).digest('hex').slice(0, 10);
}

/**
 * The auto-saved session file path: cache dir +
 * `last-session-<workspace>.json`. Scoping by workspace means closing the
 * app and reopening it in another project never resumes that project's
 * conversation (and never leaks its file references into the new one).
 */
export function sessionFilePath(env: NodeJS.ProcessEnv = process.env, workspace = process.cwd()): string {
  const dir = env.MUGIL_IDE_CACHE_DIR || path.join(os.homedir(), '.cache', 'mugil-ide');
  return path.join(dir, `last-session-${workspaceTag(workspace)}.json`);
}

/** Path of the legacy global auto-save file (pre-workspace-scoping versions). */
function legacySessionFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.MUGIL_IDE_CACHE_DIR || path.join(os.homedir(), '.cache', 'mugil-ide');
  return path.join(dir, 'last-session.json');
}

/**
 * Removes the legacy global `last-session.json` auto-save file written by
 * versions before sessions were scoped per workspace. That file is no longer
 * read anywhere, so it only lingers on disk. Idempotent and safe — named
 * sessions (`session-*.json`) and per-workspace files are untouched.
 * Returns true when the file was removed, false when absent or on failure.
 */
export function removeLegacySessionFile(env: NodeJS.ProcessEnv = process.env): boolean {
  const legacy = legacySessionFilePath(env);
  try {
    // Only remove a regular file — never follow or remove anything else.
    if (fs.existsSync(legacy) && fs.statSync(legacy).isFile()) {
      fs.rmSync(legacy, { force: true });
      return true;
    }
  } catch {
    // best-effort — ignore removal errors
  }
  return false;
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

/** Writes the conversation (newest last) + session metrics to the file. */
export function saveSession(entries: SessionEntry[], file = sessionFilePath(), stats?: SessionStats): string {
  const session: SessionFile = {
    version: 2,
    savedAt: Date.now(),
    entries: entries.slice(-MAX_ENTRIES),
    ...(stats ? { stats } : {}),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf-8');
  return file;
}

/** Coerces a persisted stats blob into a valid `SessionStats` (zeros/[] on garbage). */
function sanitizeStats(stats: unknown): SessionStats | null {
  if (!stats || typeof stats !== 'object') return null;
  const s = stats as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    promptTokens: num(s.promptTokens),
    completionTokens: num(s.completionTokens),
    totalTokens: num(s.totalTokens),
    cacheHits: num(s.cacheHits),
    requests: num(s.requests),
    tokensSaved: num(s.tokensSaved),
    filesModified: Array.isArray(s.filesModified) ? s.filesModified.filter((f): f is string => typeof f === 'string') : [],
  };
}

/**
 * Loads a saved conversation + session metrics; empty / null when absent,
 * corrupt, or of an unknown version. Accepts version-1 files (entries only).
 */
export function loadSessionFile(file = sessionFilePath()): { entries: SessionEntry[]; stats: SessionStats | null } {
  // On the auto-resume (startup) path, sweep up the legacy global
  // `last-session.json` from pre-workspace-scoping versions so it doesn't
  // linger on disk. Named-session loads pass an explicit file and skip this.
  if (file === sessionFilePath()) removeLegacySessionFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as SessionFile;
    if (!parsed || (parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.entries)) {
      return { entries: [], stats: null };
    }
    const entries = parsed.entries
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
    return { entries, stats: sanitizeStats(parsed.stats) };
  } catch {
    return { entries: [], stats: null };
  }
}

/** Loads a saved conversation (entries only); [] when absent, corrupt, or mismatched. */
export function loadSession(file = sessionFilePath()): SessionEntry[] {
  return loadSessionFile(file).entries;
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
