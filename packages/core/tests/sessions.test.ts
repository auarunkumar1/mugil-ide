import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  clearNamedSession,
  clearSession,
  listSessions,
  loadSession,
  namedSessionPath,
  saveSession,
  type SessionEntry,
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
});
