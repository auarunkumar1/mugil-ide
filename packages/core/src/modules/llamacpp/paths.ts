import * as path from 'node:path';
import * as fs from 'node:fs';
import { userEnvPath } from '../../env.js';

/** The root application data directory where Mugil stores user config, vendor binaries, and models. */
export function appDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.dirname(userEnvPath(env));
}

/** Directory for downloaded/custom .gguf model weights. Overridden by MUGIL_IDE_MODELS_DIR. */
export function modelsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.MUGIL_IDE_MODELS_DIR || path.join(appDataDir(env), 'models');
}

/** Root directory for vendored binaries (e.g. llama.cpp). */
export function vendorRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(appDataDir(env), 'vendor', 'llama.cpp');
}

/** Variant-specific vendor directory for a pinned build (e.g. b12451-cpu or b12451-cuda). */
export function vendorDir(build: number, variant = 'cpu', env: NodeJS.ProcessEnv = process.env): string {
  return path.join(vendorRoot(env), `b${build}-${variant}`);
}

/** Path to the llama-server pid file for process supervision. */
export function pidFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(appDataDir(env), 'llama-server.pid');
}

/** Ensures a target directory exists with 0700 permissions (lazy creation). */
export function ensureDir(dirPath: string): string {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
  return dirPath;
}
