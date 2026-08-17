import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));

interface CliResult {
  stdout: string;
  stderr: string;
  code?: number;
  dir: string;
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'mugil-cli-'));
}

/** Runs the built CLI with a hermetic cache dir + user env file. */
async function runCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  const dir = tmpDir();
  const base = {
    ...process.env,
    MUGIL_IDE_CACHE_DIR: join(dir, 'cache'),
    MUGIL_IDE_ENV_FILE: join(dir, '.env'),
    ...env,
  };
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [CLI, ...args], { env: base });
    return { stdout, stderr, dir };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code, dir };
  }
}

function makeFixture(): string {
  const dir = tmpDir();
  writeFileSync(join(dir, 'a.ts'), 'export function helper() { return 1; }\nexport const entry = () => helper();\n');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'b.py'), 'def pyfn():\n    return 1\n');
  return dir;
}

describe('mugil-ide CLI (spawned)', () => {
  it('prints the version', async () => {
    const { stdout } = await runCli(['--version']);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('lists the commands in --help', async () => {
    const { stdout } = await runCli(['--help']);
    for (const cmd of ['ui', 'run', 'graph', 'logout', 'keys', 'update', 'docs']) {
      expect(stdout).toContain(cmd);
    }
  });

  it('runs a prompt in mock mode', async () => {
    const { stdout } = await runCli(['run', '--no-cache', 'Hello world']);
    expect(stdout).toContain('mock');
    expect(stdout).toContain('tokens');
    expect(stdout).toContain('response');
  });

  it('emits raw JSON with --json', async () => {
    const { stdout } = await runCli(['run', '--json', '--no-cache', 'hello']);
    const parsed = JSON.parse(stdout) as { response: string; elapsedMs: number; mock: boolean };
    expect(parsed.mock).toBe(true);
    expect(typeof parsed.response).toBe('string');
    expect(parsed.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects an empty prompt with a non-zero exit', async () => {
    const { code, stderr } = await runCli(['run']);
    expect(code).not.toBe(0);
    expect(stderr).toContain('prompt required');
  });

  it('keys shows not configured, then reflects saved keys and logout', async () => {
    const { stdout, dir } = await runCli(['keys']);
    expect(stdout).toContain('not configured');

    writeFileSync(join(dir, '.env'), 'OPENROUTER_API_KEY=sk-or-v1-test1234\n');
    const withKey = await runCli(['keys'], { MUGIL_IDE_ENV_FILE: join(dir, '.env') });
    expect(withKey.stdout).toContain('openrouter');
    expect(withKey.stdout).toContain('1234');

    const logout = await runCli(['logout', 'openrouter'], { MUGIL_IDE_ENV_FILE: join(dir, '.env') });
    expect(logout.stdout).toContain('removed OPENROUTER_API_KEY');
    expect(readFileSync(join(dir, '.env'), 'utf8')).not.toContain('OPENROUTER_API_KEY');
  });

  it('logout requires a provider unless --all', async () => {
    const { code, stderr } = await runCli(['logout']);
    expect(code).not.toBe(0);
    expect(stderr).toContain('provide a provider');
  });

  it('update --check --no-npm reports up to date', async () => {
    const { stdout } = await runCli(['update', '--check', '--no-npm']);
    expect(stdout).toContain('up to date');
  });

  it('graph builds stats and answers context queries', async () => {
    const fixture = makeFixture();
    const { stdout } = await runCli(['graph', fixture]);
    expect(stdout).toContain('codegraph');
    expect(stdout).toContain('symbols');
    expect(stdout).toContain('typescript');
    expect(stdout).toContain('python');

    const query = await runCli(['graph', fixture, '--query', 'helper']);
    expect(query.stdout).toContain('helper');
  });

  it('graph -o writes a serialized graph', async () => {
    const fixture = makeFixture();
    const out = join(fixture, 'graph.json');
    const { stdout } = await runCli(['graph', fixture, '-o', out]);
    expect(stdout).toContain('graph.json');
    expect(existsSync(out)).toBe(true);
    const parsed = JSON.parse(readFileSync(out, 'utf8')) as { stats: { symbols: number } };
    expect(parsed.stats.symbols).toBe(3); // helper, entry, pyfn
  });

  it('docs generates DOCUMENTATION.md for a project', async () => {
    const fixture = makeFixture();
    const { stdout } = await runCli(['docs', fixture]);
    expect(stdout).toContain('docs:');
    const doc = join(fixture, 'DOCUMENTATION.md');
    expect(existsSync(doc)).toBe(true);
    expect(readFileSync(doc, 'utf8')).toContain('helper');
  });
});
