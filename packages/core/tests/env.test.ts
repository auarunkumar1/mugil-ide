import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  deleteUserEnvKeys,
  parseEnvFile,
  readUserEnv,
  serializeEnvFile,
  writeUserEnv,
} from '../src/env.js';
import { loadConfig } from '../src/config.js';

function tmpEnv(): { dir: string; file: string; env: NodeJS.ProcessEnv } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-env-'));
  // Nested dir exercises the mkdir -p path.
  const file = path.join(dir, 'sub', '.env');
  return { dir, file, env: { MUGIL_IDE_ENV_FILE: file } };
}

describe('parseEnvFile', () => {
  it('parses KEY=VALUE with comments, quotes and inline comments', () => {
    const out = parseEnvFile(
      [
        '# a comment',
        'EMPTY=',
        'A=hello',
        'B="quoted value"',
        "C='single'",
        'D=value # inline',
        'E=  spaced  ',
        'not-valid=skip',
        '',
      ].join('\n'),
    );
    expect(out).toEqual({
      EMPTY: '',
      A: 'hello',
      B: 'quoted value',
      C: 'single',
      D: 'value',
      E: 'spaced',
    });
  });
});

describe('serializeEnvFile', () => {
  it('updates keys in place, appends new ones, preserves comments and other keys', () => {
    const existing = '# header\nA=old\nB=keep\n';
    const out = serializeEnvFile({ A: 'new', C: 'added' }, existing);
    expect(out).toContain('# header');
    expect(out).toContain('A=new');
    expect(out).toContain('B=keep');
    expect(out).toContain('C=added');
  });
});

describe('writeUserEnv / readUserEnv / deleteUserEnvKeys', () => {
  it('round-trips through a temp file, merging and deleting', () => {
    const { dir, file, env } = tmpEnv();
    const written = writeUserEnv({ OPENROUTER_API_KEY: 'sk-or-v1-secret' }, env);
    expect(written).toBe(file);
    expect(fs.existsSync(file)).toBe(true);
    expect(readUserEnv(env)).toEqual({ OPENROUTER_API_KEY: 'sk-or-v1-secret' });

    writeUserEnv({ OPENAI_API_KEY: 'sk-openai' }, env);
    expect(readUserEnv(env)).toEqual({
      OPENROUTER_API_KEY: 'sk-or-v1-secret',
      OPENAI_API_KEY: 'sk-openai',
    });

    const { removed } = deleteUserEnvKeys(['OPENROUTER_API_KEY'], env);
    expect(removed).toEqual(['OPENROUTER_API_KEY']);
    expect(readUserEnv(env)).toEqual({ OPENAI_API_KEY: 'sk-openai' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes owner-only permissions on POSIX', () => {
    if (process.platform === 'win32') return; // chmod is a no-op on Windows
    const { dir, file, env } = tmpEnv();
    writeUserEnv({ OPENAI_API_KEY: 'sk-x' }, env);
    const mode = fs.statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('never exposes the key in the returned file path', () => {
    const { dir, file, env } = tmpEnv();
    const written = writeUserEnv({ OPENAI_API_KEY: 'sk-super-secret-1234' }, env);
    expect(written).not.toContain('secret');
    expect(file).not.toContain('secret');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('loadConfig merge precedence', () => {
  it('lets process.env override the user env file', () => {
    const { dir, env } = tmpEnv();
    writeUserEnv({ OPENROUTER_API_KEY: 'file-key', TOKEN_BUDGET: '5000' }, env);
    const config = loadConfig({ ...env, OPENROUTER_API_KEY: 'env-key' });
    expect(config.openRouterApiKey).toBe('env-key');
    expect(config.tokenBudget).toBe(5000);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads keys from the user env file when process.env lacks them', () => {
    const { dir, env } = tmpEnv();
    writeUserEnv({ ANTHROPIC_API_KEY: 'sk-ant-file' }, env);
    const config = loadConfig(env);
    expect(config.anthropicApiKey).toBe('sk-ant-file');
    expect(config.provider).toBe('anthropic');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('opencode provider', () => {
  it('is selected via AI_PROVIDER with default base url and model ladder', () => {
    const cfg = loadConfig({
      NODE_ENV: 'test',
      AI_PROVIDER: 'opencode',
      OPENCODE_API_KEY: 'oc-test',
    });
    expect(cfg.provider).toBe('opencode');
    expect(cfg.opencodeApiKey).toBe('oc-test');
    expect(cfg.opencodeBaseUrl).toBe('https://opencode.ai/zen/v1');
    expect(cfg.models.map((m) => m.id)).toEqual([
      'claude-haiku-4-5',
      'claude-sonnet-4-5',
      'claude-opus-4-5',
    ]);
  });

  it('is auto-detected when only OPENCODE_API_KEY is set', () => {
    const cfg = loadConfig({ NODE_ENV: 'test', OPENCODE_API_KEY: 'oc-test' });
    expect(cfg.provider).toBe('opencode');
  });

  it('honors OPENCODE_BASE_URL and OPENCODE_MODELS overrides', () => {
    const cfg = loadConfig({
      NODE_ENV: 'test',
      AI_PROVIDER: 'opencode',
      OPENCODE_API_KEY: 'oc-test',
      OPENCODE_BASE_URL: 'http://localhost:9/v1',
      OPENCODE_MODELS: 'qwen3-coder',
    });
    expect(cfg.opencodeBaseUrl).toBe('http://localhost:9/v1');
    expect(cfg.models.map((m) => m.id)).toEqual(['qwen3-coder']);
  });
});
