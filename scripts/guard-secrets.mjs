#!/usr/bin/env node
/**
 * Pre-commit secret guard.
 *
 * Scans staged files for real-looking API keys / private material and blocks
 * the commit when anything suspicious is found. The scanner is deliberately
 * strict on LENGTH: real provider keys are long (30+ chars), while the repo's
 * test fixtures (`sk-or-v1-test1234`, `sk-ant-test`, …) and `.env.example`
 * placeholders (`sk-or-v1-...`) are short and never match.
 *
 * Usage:
 *   node scripts/guard-secrets.mjs            # scan staged files (pre-commit)
 *   node scripts/guard-secrets.mjs <path...>  # scan explicit files (testing)
 *
 * Wire as a pre-commit hook (one-time):
 *   git config core.hooksPath .githooks
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** name → regex. Order matters only for reporting. */
const PATTERNS = [
  ['OpenRouter API key', /\bsk-or-v1-[A-Za-z0-9_-]{15,}/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{15,}/],
  ['OpenAI project key', /\bsk-proj-[A-Za-z0-9_-]{15,}/],
  ['OpenAI (legacy) key', /\bsk-[A-Za-z0-9]{30,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}/],
  ['GitHub PAT', /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}/],
  ['Stripe key', /\bsk_live_[A-Za-z0-9]{20,}/],
  ['Private key block', /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
];

/** Paths where placeholder values are expected (never flagged). */
function isAllowedEnvExample(rel) {
  return rel.endsWith('.env.example');
}

/** A committed `.env` file (not `.env.example`) is always a mistake. */
function isBareEnvFile(rel) {
  if (isAllowedEnvExample(rel)) return false;
  const base = path.basename(rel);
  return base === '.env' || (base.endsWith('.env') && !base.includes('.env.'));
}

function mask(value) {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function scanFile(rel) {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return [];
  let content;
  try {
    content = readFileSync(abs, 'utf8');
  } catch {
    return []; // binary/unreadable — skip
  }
  const hits = [];
  if (isBareEnvFile(rel)) hits.push('committed .env file (not .env.example)');
  for (const [name, re] of PATTERNS) {
    const match = content.match(re);
    if (match) hits.push(`${name}: ${mask(match[0])}`);
  }
  return hits;
}

function main() {
  let files;
  if (process.argv.length > 2) {
    files = process.argv.slice(2);
  } else {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], {
      cwd: root,
      encoding: 'utf8',
    });
    files = out.split('\0').filter(Boolean);
  }

  const findings = [];
  for (const rel of files) {
    for (const hit of scanFile(rel)) {
      findings.push(`  ${rel} → ${hit}`);
    }
  }

  if (findings.length > 0) {
    console.error('🔒 Commit blocked — possible secret detected:\n');
    for (const f of findings) console.error(f);
    console.error(
      '\nIf this is a real key: remove it from the staged file and store it only in\n' +
        '~/.config/mugil-ide/.env (never committed). If it is a test fixture, it is too\n' +
        'short to match — check the flagged value. To override: git commit --no-verify.\n',
    );
    process.exit(1);
  }
  console.log(`🔒 secret guard: ${files.length} file(s) clean`);
}

main();
