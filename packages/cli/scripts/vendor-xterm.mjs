#!/usr/bin/env node
/**
 * Vendors the xterm.js browser assets into dist/vendor/xterm so the packaged
 * `mugil-ide` app works fully offline — no CDN dependency at page-load time.
 *
 * Also stages dist/server/diffWorker.js — the plain-JS worker-thread entry for
 * the /api/diffs endpoint. Worker threads don't go through tsc (and the file
 * deliberately isn't part of the TS build), so it's copied verbatim into
 * dist/, which the npm tarball (files: ["dist"]) carries.
 *
 * Runs after `tsc` in the cli package's build script.
 */
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(pkgRoot, 'dist', 'vendor', 'xterm');

/**
 * [npm package (for resolution), file inside it, output filename].
 * The LICENSE files ship alongside the vendored assets — MIT requires the
 * copyright + permission notice to accompany copies of the software, and
 * these copies are distributed in the npm tarball (files: ["dist"]).
 */
const ASSETS = [
  ['@xterm/xterm/package.json', 'css/xterm.css', 'xterm.css'],
  ['@xterm/xterm/package.json', 'lib/xterm.js', 'xterm.js'],
  ['@xterm/xterm/package.json', 'LICENSE', 'xterm.LICENSE'],
  ['@xterm/addon-fit/package.json', 'lib/addon-fit.js', 'addon-fit.js'],
  ['@xterm/addon-fit/package.json', 'LICENSE', 'addon-fit.LICENSE'],
  ['@xterm/addon-web-links/package.json', 'lib/addon-web-links.js', 'addon-web-links.js'],
  ['@xterm/addon-web-links/package.json', 'LICENSE', 'addon-web-links.LICENSE'],
];

mkdirSync(outDir, { recursive: true });
for (const [pkgJson, rel, out] of ASSETS) {
  const src = join(dirname(require.resolve(pkgJson)), rel);
  copyFileSync(src, join(outDir, out));
  console.log(`  vendored ${out} <- ${src}`);
}

// Stage the diff-worker entry (plain JS — see diffRunner.ts for the client).
const workerSrc = join(pkgRoot, 'src', 'server', 'diffWorker.js');
const workerOut = join(pkgRoot, 'dist', 'server');
mkdirSync(workerOut, { recursive: true });
copyFileSync(workerSrc, join(workerOut, 'diffWorker.js'));
console.log(`  staged dist/server/diffWorker.js <- ${workerSrc}`);
