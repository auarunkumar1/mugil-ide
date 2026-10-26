#!/usr/bin/env node
/**
 * Extracts one version's section from CHANGELOG.md for use as GitHub release
 * notes.
 *
 *   node scripts/release-notes.mjs 0.1.23   → prints the section to stdout
 *
 * Exits non-zero (printing nothing) when the section is missing, so the
 * workflow can fall back to GitHub's generated notes instead of publishing an
 * empty release body.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <version>');
  process.exit(2);
}
let md;
try {
  md = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
} catch {
  process.exit(1);
}
const lines = md.split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start === -1) process.exit(1);
let end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
if (end === -1) end = lines.length;
const body = lines.slice(start + 1, end).join('\n').trim();
if (!body) process.exit(1);
process.stdout.write(body + '\n');
