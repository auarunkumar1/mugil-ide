import {
  hasSecrets,
  scanSecrets,
  shannonEntropy,
} from '../src/modules/security/secretScanner.js';
import { SecretVault, secretToken } from '../src/modules/security/secretVault.js';

/** Fixtures are built at runtime so this file never contains a real-looking key. */
const OPENAI = ['sk-', 'A'.repeat(8), 'b1C2d3E4f5G6h7I8j9K0l1M2n3O4p5'].join('');
const OPENROUTER = ['sk-or-v1-', 'abcdef0123456789abcdef0123456789'].join('');
const ANTHROPIC = ['sk-ant-', 'api03-abcdefghijklmnopqrstuvwx'].join('');
const AWS = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const GITHUB = ['ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('');
const SLACK = ['xoxb-', '123456789012-abcdefghijklmnop'].join('');
const GOOGLE = ['AIza', 'SyA1234567890abcdefghijklmnopqrstu'].join('');
const STRIPE = ['sk_live_', 'abcdefghijklmnopqrstuvwx'].join('');
const HF = ['hf_', 'abcdefghijklmnopqrstuvwx'].join('');

describe('scanSecrets', () => {
  it.each([
    ['openai', OPENAI, 'OPENAI_API_KEY'],
    ['openrouter', OPENROUTER, 'OPENROUTER_API_KEY'],
    ['anthropic', ANTHROPIC, 'ANTHROPIC_API_KEY'],
    ['aws', AWS, 'AWS_ACCESS_KEY_ID'],
    ['github', GITHUB, 'GITHUB_TOKEN'],
    ['slack', SLACK, 'SLACK_TOKEN'],
    ['google', GOOGLE, 'GOOGLE_API_KEY'],
    ['stripe', STRIPE, 'STRIPE_KEY'],
    ['huggingface', HF, 'HUGGINGFACE_TOKEN'],
  ])('detects a %s key', (_label, secret, type) => {
    const matches = scanSecrets(`export const key = "${secret}";`);
    expect(matches.map((m) => m.type)).toContain(type);
    expect(matches[0]!.value).toBe(secret);
  });

  it('detects bearer and basic auth headers', () => {
    const bearer = scanSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123');
    expect(bearer[0]).toMatchObject({ type: 'BEARER_TOKEN', value: 'abcdefghijklmnopqrstuvwxyz0123' });
    const basic = scanSecrets('Authorization: Basic dXNlcjpwYXNzd29yZDEyMzQ1Ng==');
    expect(basic[0]!.type).toBe('BASIC_AUTH');
  });

  it('extracts only the password from a connection string', () => {
    const matches = scanSecrets('DATABASE_URL=postgres://admin:s3cr3tP4ssw0rd@db.internal:5432/app');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ type: 'CONNECTION_PASSWORD', value: 's3cr3tP4ssw0rd' });
  });

  it('detects private key blocks', () => {
    // Header assembled at runtime so this fixture never looks like a real key.
    const begin = ['-----', 'BEGIN RSA PRIVATE KEY', '-----'].join('');
    const end = ['-----', 'END RSA PRIVATE KEY', '-----'].join('');
    const pem = `${begin}\nMIIEow\n${end}`;
    expect(scanSecrets(pem)[0]!.type).toBe('PRIVATE_KEY');
  });

  it('detects CLI password flags and assignments', () => {
    expect(scanSecrets('mysql --password=hunter2hunter2 -u root')[0]!.type).toBe('CLI_PASSWORD');
    const assigned = scanSecrets('password: "c0rrectH0rseBattery"');
    expect(assigned[0]!.type).toBe('PASSWORD_ASSIGNMENT');
  });

  it('ignores placeholders and documentation values', () => {
    expect(hasSecrets('OPENROUTER_API_KEY=sk-or-v1-...')).toBe(false);
    expect(hasSecrets('api_key: <your-key-here>')).toBe(false);
    expect(hasSecrets('password: ' + 'x'.repeat(20))).toBe(false);
    expect(hasSecrets('example key sk-or-v1-test1234')).toBe(false);
  });

  it('reports non-overlapping spans in order', () => {
    const text = `a ${OPENAI} b ${GITHUB}`;
    const matches = scanSecrets(text);
    expect(matches).toHaveLength(2);
    expect(matches[0]!.start).toBeLessThan(matches[1]!.start);
    expect(matches[0]!.end).toBeLessThanOrEqual(matches[1]!.start);
  });

  it('computes Shannon entropy', () => {
    expect(shannonEntropy('aaaaaaaa')).toBe(0);
    expect(shannonEntropy('abcdefgh')).toBeCloseTo(3, 5);
  });
});

describe('SecretVault', () => {
  it('replaces secrets with stable tokens and reuses them', () => {
    const vault = new SecretVault();
    const first = vault.tokenize(`token=${OPENROUTER}`);
    expect(first.count).toBe(1);
    expect(first.text).toBe(`token=${secretToken('OPENROUTER_API_KEY', 1)}`);
    expect(first.text).not.toContain('sk-or-v1');

    const second = vault.tokenize(`again ${OPENROUTER}`);
    expect(second.tokens[0]).toBe(first.tokens[0]);
    expect(vault.size).toBe(1);
  });

  it('resolves tokens back to the real value locally', () => {
    const vault = new SecretVault();
    const { text } = vault.tokenize(OPENAI);
    expect(vault.resolve(`curl -H "Authorization: Bearer ${text}"`)).toContain(OPENAI);
  });

  it('leaves clean text untouched', () => {
    const vault = new SecretVault();
    const { text, count } = vault.tokenize('just a normal prompt');
    expect(text).toBe('just a normal prompt');
    expect(count).toBe(0);
    expect(vault.size).toBe(0);
  });

  it('reports hasToken only for known tokens', () => {
    const vault = new SecretVault();
    const { text } = vault.tokenize(AWS);
    expect(vault.hasToken(text)).toBe(true);
    expect(vault.hasToken('[MUGIL_SECRET_FAKE_99]')).toBe(false);
    expect(vault.hasToken('nothing here')).toBe(false);
  });

  it('clears everything', () => {
    const vault = new SecretVault();
    const { text } = vault.tokenize(GITHUB);
    vault.clear();
    expect(vault.size).toBe(0);
    expect(vault.resolve(text)).toBe(text);
  });
});
