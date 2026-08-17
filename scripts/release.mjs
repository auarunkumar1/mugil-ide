#!/usr/bin/env node
/**
 * Mugil IDE release tooling.
 *
 *   node scripts/release.mjs [patch|minor|major]      → dry-run plan (default)
 *   node scripts/release.mjs minor --bump             → bump + pack + git commit/tag
 *   node scripts/release.mjs major --publish          → bump + pack + commit/tag + npm publish
 *
 * Bumps the version in every package.json, the core VERSION constant and the
 * module registry, sets all `@mugil-ide/*` deps to the new version, then
 * packs. `--publish` publishes in dependency order: core → docs → mcp → cli.
 *
 * The working tree must be clean unless `--force` is passed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bumpArg = (process.argv.find((a) => ['patch', 'minor', 'major'].includes(a)) ?? 'patch');
const mode = process.argv.includes('--publish')
  ? 'publish'
  : process.argv.includes('--bump')
    ? 'bump'
    : 'dry-run';
const force = process.argv.includes('--force');

const PACKAGES = ['packages/core', 'packages/docs', 'packages/mcp', 'packages/cli'];
const PUBLISH_ORDER = ['packages/core', 'packages/docs', 'packages/mcp', 'packages/cli'];

function readJson(p) {
  return JSON.parse(readFileSync(path.join(root, p), 'utf8'));
}
function writeJson(p, data) {
  writeFileSync(path.join(root, p), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function bumpVersion(v, kind) {
  const [major, minor, patch] = v.split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const rootPkg = readJson('package.json');
const newVersion = bumpVersion(rootPkg.version, bumpArg);

// --- git state check (skipped in dry-run)
const isGit = existsSync(path.join(root, '.git'));
function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
if (isGit && mode !== 'dry-run' && !force) {
  const dirty = git(['status', '--porcelain']);
  if (dirty) {
    console.error('✗ working tree is not clean — commit or stash first (or pass --force)');
    process.exit(1);
  }
}

// --- print the plan
console.log(`\n📦 Mugil IDE release plan [${mode}]\n`);
console.log(`  · version: ${rootPkg.version} -> ${newVersion} (${bumpArg})`);
console.log('  · bump: package.json, packages/*/package.json, branding.ts VERSION, registry.json');
console.log('  · pack: npm run pack (regenerates dist-packages/)');
if (mode === 'bump' || mode === 'publish') {
  console.log(`  · git: commit "Release v${newVersion}" + tag v${newVersion}`);
}
if (mode === 'publish') {
  console.log(`  · publish: ${PUBLISH_ORDER.join(' → ')}`);
}
console.log('');

if (mode === 'dry-run') process.exit(0);

// --- apply version bumps
function setVersion(pkgPath) {
  const p = readJson(pkgPath);
  p.version = newVersion;
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = p[section];
    if (!deps) continue;
    for (const key of Object.keys(deps)) {
      if (key.startsWith('@mugil-ide/')) deps[key] = newVersion;
    }
  }
  writeJson(pkgPath, p);
}
setVersion('package.json');
for (const pkg of PACKAGES) setVersion(`${pkg}/package.json`);

const brandingPath = path.join(root, 'packages/core/src/branding.ts');
const branding = readFileSync(brandingPath, 'utf8');
writeFileSync(
  brandingPath,
  branding.replace(/export const VERSION = '[^']+';/, `export const VERSION = '${newVersion}';`),
  'utf8',
);

const registry = readJson('packages/core/src/rules/registry.json');
registry.package.version = newVersion;
writeJson('packages/core/src/rules/registry.json', registry);

console.log(`  ✓ bumped to ${newVersion}`);
execFileSync('npm', ['run', 'pack'], { cwd: root, stdio: 'inherit', shell: true });

if (mode === 'bump' || mode === 'publish') {
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'inherit' });
  execFileSync('git', ['commit', '-m', `Release v${newVersion}`], { cwd: root, stdio: 'inherit' });
  execFileSync('git', ['tag', `v${newVersion}`], { cwd: root, stdio: 'inherit' });
  console.log(`  ✓ tagged v${newVersion}`);
}

if (mode === 'publish') {
  for (const pkg of PUBLISH_ORDER) {
    console.log(`\n📦 publishing ${pkg} …`);
    // `./` prefix: npm 11 misparses a bare path ("packages/core") as the
    // GitHub shorthand github:packages/core and tries `git ls-remote`.
    execFileSync('npm', ['publish', `./${pkg}`, '--access', 'public'], {
      cwd: root,
      stdio: 'inherit',
      shell: true,
    });
  }
  console.log('\n✅ published — `npm i -g mugil-ide` installs the new release.');
}
