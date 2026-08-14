/**
 * Packs every @mugil-ide/* workspace package into dist-packages/ so the set can
 * be published (or installed from tarballs) together.
 *
 * Publish order matters: core -> {docs, mcp} -> cli, since each depends on the
 * previous ones. npm resolves the `@mugil-ide/*` deps from the registry once
 * published; from tarballs, install them in that order.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-packages');

const packages = [
  'packages/core',
  'packages/docs',
  'packages/mcp',
  'packages/cli',
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const pkg of packages) {
  const dir = path.join(root, pkg);
  console.log(`\n📦 packing ${pkg} …`);
  execFileSync('npm', ['pack', dir, '--pack-destination', outDir], {
    cwd: root,
    stdio: 'inherit',
    // npm is npm.cmd on Windows; a shell resolves the shim.
    shell: true,
  });
}

console.log('\n✅ packed tarballs in dist-packages/:');
for (const file of readdirSync(outDir).filter((f) => f.endsWith('.tgz')).sort()) {
  console.log(`  ${file}`);
}
