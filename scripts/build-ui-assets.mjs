#!/usr/bin/env node
/**
 * UI Asset Bundler & CSP Hardener
 * ===============================
 * Modularizes client assets by extracting inline <style> and <script> contents
 * from the Web UI into static standalone bundles (bundle.css and bundle.js).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const htmlSourcePath = path.join(root, 'packages', 'cli', 'src', 'server', 'html.ts');
const outDir = path.join(root, 'packages', 'cli', 'dist', 'client');

if (!fs.existsSync(htmlSourcePath)) {
  console.error(`Error: html.ts not found at ${htmlSourcePath}`);
  process.exit(1);
}

const content = fs.readFileSync(htmlSourcePath, 'utf-8');

// Extract CSS inside <style>...</style>
const styleMatch = content.match(/<style>([\s\S]*?)<\/style>/);
const scriptMatch = content.match(/<script>([\s\S]*?)<\/script>/);

fs.mkdirSync(outDir, { recursive: true });

if (styleMatch && styleMatch[1]) {
  const cssOut = path.join(outDir, 'bundle.css');
  fs.writeFileSync(cssOut, styleMatch[1].trim(), 'utf-8');
  console.log(`✓ Extracted CSS bundle: ${cssOut} (${styleMatch[1].length} chars)`);
}

if (scriptMatch && scriptMatch[1]) {
  const jsOut = path.join(outDir, 'bundle.js');
  fs.writeFileSync(jsOut, scriptMatch[1].trim(), 'utf-8');
  console.log(`✓ Extracted JS bundle: ${jsOut} (${scriptMatch[1].length} chars)`);
}

console.log('✓ UI assets extracted and modularized successfully.');
