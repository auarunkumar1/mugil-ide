/**
 * Post-edit Diagnostics (LSP-lite)
 * ================================
 * After the agent writes or edits a file, run fast static diagnostics and
 * feed any errors back to the model so it self-corrects before expensive
 * test runs — the coding-agent diagnostics loop popularized by OpenCode's
 * LSP integration, minus the LSP server: we shell out to the project's own
 * `tsc --noEmit` and compress the errors.
 *
 * Opt-in via `MUGIL_IDE_TOOL_DIAGNOSTICS=1` (or by injecting a fake runner in
 * tests). Enabled only when the workspace has a `tsconfig.json` and a local
 * TypeScript binary, so a non-TS project never pays for it.
 *
 * Credit: diagnostics-feedback loop inspired by OpenCode — https://github.com/sst/opencode
 * See ATTRIBUTIONS.md at the repository root for the full credit list.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { compressCommandOutput } from '../rtk/index.js';

export interface DiagnosticsOptions {
  /** Max ms for the typecheck. Default 30000. */
  timeoutMs?: number;
  /** Max error lines returned. Default 40. */
  maxLines?: number;
}

export interface DiagnosticsResult {
  /** Compressed error output; empty when clean or when not run. */
  output: string;
  /** True when a typecheck actually ran. */
  ran: boolean;
}

/** Enables diagnostics from the environment (`MUGIL_IDE_TOOL_DIAGNOSTICS=1`). */
export function diagnosticsEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.MUGIL_IDE_TOOL_DIAGNOSTICS;
  return v === '1' || v === 'true' || v === 'on';
}

/**
 * Runs `tsc --noEmit` on the nearest `tsconfig.json` under `root` when
 * TypeScript is locally available. Clean output or an uncheckable project
 * yields `output: ''`.
 */
export function runDiagnostics(root: string, options: DiagnosticsOptions = {}): DiagnosticsResult {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxLines = options.maxLines ?? 40;
  const tsconfig = findNearestTsconfig(root);
  if (!tsconfig) return { output: '', ran: false };
  const dir = path.dirname(tsconfig);
  const tscBin = resolveTscBin(dir);
  if (!tscBin) return { output: '', ran: false };
  try {
    execSync(`"${tscBin}" --noEmit --pretty false -p "${tsconfig}"`, {
      cwd: dir,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { output: '', ran: true }; // clean
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    const combined = [error.stdout, error.stderr].filter(Boolean).join('\n') || `typecheck failed: ${error.message}`;
    const lines = combined
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0)
      .slice(0, maxLines);
    return { output: compressCommandOutput(lines.join('\n'), { maxLineLength: 300 }).text, ran: true };
  }
}

/** Nearest tsconfig.json walking up from `root` (stops at the home dir). */
export function findNearestTsconfig(root: string): string | null {
  let dir = path.resolve(root);
  const home = os.homedir();
  while (dir.length > 0) {
    const candidate = path.join(dir, 'tsconfig.json');
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // keep walking up
    }
    if (dir === home || dir === path.parse(dir).root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveTscBin(dir: string): string | null {
  const candidates = [
    path.join(dir, 'node_modules', '.bin', 'tsc'),
    path.join(dir, 'node_modules', '.bin', 'tsc.cmd'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // try next
    }
  }
  return null;
}
