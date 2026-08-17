import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UpdateManager } from '../src/update/updateManager.js';
import { clearRulesCache } from '../src/modules/overrides.js';
import { readOverrideSync, writeOverrideSync } from '../src/modules/overridesNode.js';
import { cavemanStrategy } from '../src/modules/caveman/index.js';

const REGISTRY_URL = 'https://registry.example.test/registry.json';
const REGISTRY = {
  schema: 1,
  modules: {
    caveman: { version: '2.0.0', rulesUrl: 'https://example.test/rules/caveman.json' },
    rtk: { version: '1.0.0' },
  },
  package: { name: 'mugil-ide', version: '9.9.9' },
};
const NEW_CAVEMAN_RULES = {
  version: '2.0.0',
  phrases: [{ pattern: '\\bxyzzy\\b', flags: 'gi', replacement: '' }],
  filler: '\\bnever-match-filler\\b',
  fillerFlags: 'gi',
  polite: '\\bnever-match-polite\\b',
  politeFlags: 'gi',
};

function makeFetchFn(): (url: string) => Promise<Response> {
  return async (url: string) => {
    if (url === REGISTRY_URL) return new Response(JSON.stringify(REGISTRY), { status: 200 });
    if (url === 'https://example.test/rules/caveman.json') {
      return new Response(JSON.stringify(NEW_CAVEMAN_RULES), { status: 200 });
    }
    if (url === 'https://registry.npmjs.org/mugil-ide/latest') {
      return new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
}

let dir: string;
let originalDir: string | undefined;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiide-modules-'));
  originalDir = process.env.MUGIL_IDE_MODULES_DIR;
  process.env.MUGIL_IDE_MODULES_DIR = dir;
  clearRulesCache();
});

afterAll(() => {
  if (originalDir === undefined) delete process.env.MUGIL_IDE_MODULES_DIR;
  else process.env.MUGIL_IDE_MODULES_DIR = originalDir;
  fs.rmSync(dir, { recursive: true, force: true });
  clearRulesCache();
});

/** Removes any written overrides so tests start from bundled defaults. */
function resetStore(): void {
  for (const name of ['caveman.json', 'rtk.json', 'ponytail.json', 'signature-remover.json']) {
    try {
      fs.rmSync(path.join(dir, name), { force: true });
    } catch {
      // ignore
    }
  }
  clearRulesCache();
}

describe('rules override store', () => {
  it('falls back to bundled defaults with no override', () => {
    resetStore();
    const result = cavemanStrategy('In order to fix the bug, please review.');
    expect(result.text).toBe('to fix the bug, review.');
  });

  it('hot-reloads module rules after an override is written', () => {
    resetStore();
    writeOverrideSync('caveman', NEW_CAVEMAN_RULES);
    const result = cavemanStrategy('xyzzy please review the code');
    expect(result.text).not.toContain('xyzzy');
    // The old phrase rules are gone — "in order to" is no longer compressed.
    expect(cavemanStrategy('In order to fix it.').text).toBe('In order to fix it.');
  });

  it('ignores malformed overrides and keeps defaults', () => {
    resetStore();
    fs.writeFileSync(
      path.join(dir, 'caveman.json'),
      JSON.stringify({ bogus: true, noVersion: 'x' }),
      'utf8',
    );
    clearRulesCache();
    expect(readOverrideSync('caveman')).toBeUndefined();
    const result = cavemanStrategy('In order to fix the bug.');
    expect(result.text).toContain('to fix the bug');
  });
});

describe('UpdateManager', () => {
  beforeEach(() => {
    resetStore();
  });

  const fetchFn = makeFetchFn();

  it('reports available module and npm updates from a registry', async () => {
    const manager = new UpdateManager({ registryUrl: REGISTRY_URL, fetchFn });
    const result = await manager.check();
    expect(result.configured).toBe(true);
    expect(result.registryUrl).toBe(REGISTRY_URL);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toMatchObject({ id: 'caveman', current: '1.0.0', latest: '2.0.0' });
    expect(result.npm).toEqual({ current: '0.1.0', latest: '9.9.9' });
  });

  it('reports nothing when unconfigured', async () => {
    const manager = new UpdateManager({ registryUrl: undefined, checkNpm: false });
    const result = await manager.check();
    expect(result.configured).toBe(false);
    expect(result.updates).toHaveLength(0);
    expect(result.npm).toBeNull();
  });

  it('survives a failing registry fetch', async () => {
    const manager = new UpdateManager({
      registryUrl: 'https://example.test/missing.json',
      fetchFn: async () => {
        throw new Error('network down');
      },
      checkNpm: false,
    });
    const result = await manager.check();
    expect(result.updates).toHaveLength(0);
    expect(result.configured).toBe(true);
  });

  it('applies updates to the override store and localVersion reflects them', async () => {
    const manager = new UpdateManager({ registryUrl: REGISTRY_URL, fetchFn, checkNpm: false });
    const result = await manager.check();
    const applied = await manager.apply(result.updates);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.applied).toBe(true);
    expect(readOverrideSync<{ version: string }>('caveman')?.version).toBe('2.0.0');
    expect(manager.localVersion('caveman')).toBe('2.0.0');
  });

  it('runs the update cycle periodically via watch()', async () => {
    const manager = new UpdateManager({ registryUrl: REGISTRY_URL, fetchFn, checkNpm: false });
    const calls: Array<{ updates: number; applied: number }> = [];
    const watched = manager.watch({
      intervalSeconds: 0.05,
      onUpdate: (result, applied) => {
        calls.push({ updates: result.updates.length, applied: applied.length });
      },
    });
    const deadline = Date.now() + 1500;
    while (calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    watched.stop();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0]?.updates).toBeGreaterThan(0);
    expect(calls[0]?.applied).toBeGreaterThan(0);
  });

  it('does not report same-version modules as updates', async () => {
    const manager = new UpdateManager({
      registryUrl: REGISTRY_URL,
      fetchFn,
      checkNpm: false,
    });
    const result = await manager.check();
    expect(result.updates.map((u) => u.id)).not.toContain('rtk');
  });
});
