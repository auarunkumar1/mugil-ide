import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  clearNamedSession,
  clearSession,
  listSessions,
  loadSession,
  loadSessionFile,
  namedSessionPath,
  removeLegacySessionFile,
  saveSession,
  sessionFilePath,
  type SessionEntry,
  type SessionStats,
} from '../src/modules/sessions.js';

const entry = (id: number, prompt = `prompt-${id}`): SessionEntry => ({
  id,
  prompt,
  response: `response-${id}`,
  model: 'test-model',
  provider: 'mock',
});

describe('sessions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-sessions-'));
  const file = path.join(dir, 'last-session.json');

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips saved entries', () => {
    const entries = [entry(1), entry(2)];
    saveSession(entries, file);
    const loaded = loadSession(file);
    expect(loaded).toHaveLength(2);
    expect(loaded[1]).toMatchObject({ id: 2, prompt: 'prompt-2', response: 'response-2', model: 'test-model' });
  });

  it('caps the number of saved entries', () => {
    const entries = Array.from({ length: 120 }, (_, i) => entry(i));
    saveSession(entries, file);
    expect(loadSession(file)).toHaveLength(50);
    // The newest entries are kept.
    expect(loadSession(file)[49]!.id).toBe(119);
  });

  it('returns [] for a missing or corrupt file', () => {
    expect(loadSession(path.join(dir, 'nope.json'))).toEqual([]);
    fs.writeFileSync(file, '{not json!!', 'utf-8');
    expect(loadSession(file)).toEqual([]);
    fs.writeFileSync(file, '{"version":2,"entries":[]}', 'utf-8');
    expect(loadSession(file)).toEqual([]);
  });

  it('named sessions: sanitized paths, round-trip, list (newest first), clear', () => {
    const env = { MUGIL_IDE_CACHE_DIR: dir } as NodeJS.ProcessEnv;
    const p1 = namedSessionPath('my session/1', env);
    expect(path.basename(p1)).toBe('session-my_session_1.json');

    saveSession([entry(1), entry(2)], p1);
    const loaded = loadSession(namedSessionPath('my session/1', env));
    expect(loaded).toHaveLength(2);
    expect(loaded[1]!.prompt).toBe('prompt-2');
    // Remove the round-trip file so ordering below is deterministic.
    fs.rmSync(p1, { force: true });

    // Deterministic ordering: write files directly with explicit savedAt.
    const writeNamed = (name: string, savedAt: number, turns: number): void => {
      fs.writeFileSync(
        namedSessionPath(name, env),
        JSON.stringify({
          version: 1,
          savedAt,
          entries: Array.from({ length: turns }, (_, i) => entry(i)),
        }),
        'utf-8',
      );
    };
    writeNamed('old', 1000, 2);
    writeNamed('new', 2000, 1);
    const infos = listSessions(env);
    expect(infos.map((i) => i.name)).toEqual(['new', 'old']); // newest first
    expect(infos[0]!.turns).toBe(1);

    expect(clearNamedSession('new', env)).toBe(true);
    expect(listSessions(env).map((i) => i.name)).toEqual(['old']);
    expect(clearNamedSession('missing', env)).toBe(false);
  });

  it('listSessions returns [] when the cache dir is absent', () => {
    expect(listSessions({ MUGIL_IDE_CACHE_DIR: path.join(dir, 'nope') } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('drops malformed entries but keeps valid ones', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        entries: [{ id: 1, prompt: 'ok', response: 'fine' }, { id: 'x', prompt: 42, response: 'bad' }, null],
      }),
      'utf-8',
    );
    const loaded = loadSession(file);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.prompt).toBe('ok');
  });

  it('clears the session file', () => {
    saveSession([entry(1)], file);
    expect(clearSession(file)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(loadSession(file)).toEqual([]);
  });

  it('scopes the auto-saved session file per workspace', () => {
    const env = { MUGIL_IDE_CACHE_DIR: dir } as NodeJS.ProcessEnv;
    const alpha = sessionFilePath(env, '/projects/alpha');
    const beta = sessionFilePath(env, '/projects/beta');
    // Two projects never share the auto-save file.
    expect(alpha).not.toBe(beta);
    // Stable per workspace across calls.
    expect(sessionFilePath(env, '/projects/alpha')).toBe(alpha);
    expect(sessionFilePath(env, '/projects/beta')).toBe(beta);
    // The old global `last-session.json` name is gone — auto-resume can no
    // longer leak one project's conversation into another.
    expect(path.basename(alpha)).toMatch(/^last-session-[0-9a-f]{10}\.json$/);
    expect(path.basename(alpha)).not.toBe('last-session.json');
  });

  it('auto-save/load/clear round-trip through the workspace-scoped default path', () => {
    const prev = process.env.MUGIL_IDE_CACHE_DIR;
    process.env.MUGIL_IDE_CACHE_DIR = dir;
    try {
      const file = sessionFilePath();
      saveSession([entry(1)]);
      expect(fs.existsSync(file)).toBe(true);
      expect(loadSession()).toHaveLength(1);
      expect(clearSession()).toBe(true);
      expect(fs.existsSync(file)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MUGIL_IDE_CACHE_DIR;
      else process.env.MUGIL_IDE_CACHE_DIR = prev;
    }
  });

  it('auto-resume sweeps up the legacy global last-session.json', () => {
    // Simulate a pre-workspace-scoping install: a global last-session.json.
    const legacy = path.join(dir, 'last-session.json');
    fs.writeFileSync(legacy, JSON.stringify({ version: 1, savedAt: 1, entries: [entry(1)] }), 'utf-8');
    const prev = process.env.MUGIL_IDE_CACHE_DIR;
    process.env.MUGIL_IDE_CACHE_DIR = dir;
    try {
      // Loading the workspace-scoped default (auto-resume) path removes it.
      // The legacy contents are not served — they can't be attributed to any
      // workspace, and serving them would re-introduce the cross-project leak.
      expect(loadSession()).toEqual([]);
      expect(fs.existsSync(legacy)).toBe(false);
      // Idempotent: a second startup finds nothing to remove.
      expect(removeLegacySessionFile()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MUGIL_IDE_CACHE_DIR;
      else process.env.MUGIL_IDE_CACHE_DIR = prev;
    }
  });

  it('persists session stats (version 2) and restores them', () => {
    // NOTE: a dedicated file — the describe-level `file` is the legacy
    // `last-session.json` name, which the cleanup test expects to be absent.
    const statsFile = path.join(dir, 'stats-test.json');
    const stats: SessionStats = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheHits: 2,
      requests: 3,
      tokensSaved: 40,
      filesModified: ['src/a.ts', 'README.md'],
    };
    saveSession([entry(1)], statsFile, stats);
    const saved = JSON.parse(fs.readFileSync(statsFile, 'utf-8')) as { version: number; stats: SessionStats };
    expect(saved.version).toBe(2);
    expect(saved.stats).toEqual(stats);

    const loaded = loadSessionFile(statsFile);
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.stats).toEqual(stats);
    // loadSession keeps returning just the entries (backward compat).
    expect(loadSession(statsFile)).toHaveLength(1);
  });

  it('loads version-1 files (entries, no stats) and sanitizes garbage stats', () => {
    const statsFile = path.join(dir, 'stats-test.json');
    // Pre-stats (version 1) files still load — stats are null.
    fs.writeFileSync(statsFile, JSON.stringify({ version: 1, savedAt: 1, entries: [entry(1)] }), 'utf-8');
    const v1 = loadSessionFile(statsFile);
    expect(v1.entries).toHaveLength(1);
    expect(v1.stats).toBeNull();

    // Version-2 files with malformed stats are coerced to zeros / valid strings.
    fs.writeFileSync(
      statsFile,
      JSON.stringify({
        version: 2,
        savedAt: 1,
        entries: [entry(1)],
        stats: { promptTokens: 'bad', requests: 4, filesModified: [1, 'ok.txt', null] },
      }),
      'utf-8',
    );
    const v2 = loadSessionFile(statsFile);
    expect(v2.stats).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHits: 0,
      requests: 4,
      tokensSaved: 0,
      filesModified: ['ok.txt'],
    });
  });

  it('removeLegacySessionFile leaves named and per-workspace sessions alone', () => {
    const env = { MUGIL_IDE_CACHE_DIR: dir } as NodeJS.ProcessEnv;
    expect(removeLegacySessionFile(env)).toBe(false); // no-op when absent

    const named = namedSessionPath('keep me', env);
    saveSession([entry(1)], named);
    const scoped = sessionFilePath(env, '/projects/alpha');
    saveSession([entry(1)], scoped);
    const legacy = path.join(dir, 'last-session.json');
    fs.writeFileSync(legacy, '{}', 'utf-8');

    expect(removeLegacySessionFile(env)).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
    // Named + per-workspace session files are untouched.
    expect(fs.existsSync(named)).toBe(true);
    expect(fs.existsSync(scoped)).toBe(true);
  });
});
