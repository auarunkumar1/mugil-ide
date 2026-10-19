/**
 * RTK MODULE — Reduced Token Kernel
 * =================================
 * Removes redundant tokens from prompt context and tool output.
 *
 * Credits
 * -------
 * Inspired by **rtk-ai/rtk** — "Rust Token Killer"
 * (https://github.com/rtk-ai/rtk), a CLI proxy that compresses command output
 * before it reaches the LLM context window, cutting token consumption 60–90%
 * on common dev commands (git status/diff/log compaction, test failure-only
 * output, grouped grep matches, etc.).
 *
 * `rtkStrategy` strips intro/closing boilerplate and de-duplicates repeated
 * sentences from a prompt; `compressCommandOutput` mirrors RTK's shell-output
 * compression (collapse repeated lines, truncate long lines, drop blank noise)
 * for tool output that is about to be fed to a model.
 *
 * The boilerplate/intro patterns live in `src/rules/rtk.json` and are updatable
 * at runtime via `mugil-ide update` (see src/modules/overrides.ts).
 *
 * See ATTRIBUTIONS.md at the repository root for the full credit list.
 */

import type { StrategyResult } from '../../types.js';
import defaultRules from '../../rules/rtk.json';
import { currentRevision, loadRulesSync } from '../overrides.js';
import { isCodePlaceholder, maskCodeBlocks, restoreCodeBlocks } from '../codeMask.js';
import { compressJson } from './jsonCrusher.js';

export { compressJson };

interface RtkRules {
  version: string;
  boilerplate: { pattern: string; flags?: string };
  intro: { pattern: string; flags?: string };
}

interface CompiledRules {
  boilerplate: RegExp;
  intro: RegExp;
}

let compiled: CompiledRules | undefined;
let compiledAt = -1;

function getRules(): CompiledRules {
  const revision = currentRevision();
  if (!compiled || compiledAt !== revision) {
    const doc = loadRulesSync<RtkRules>('rtk', defaultRules as unknown as RtkRules);
    compiled = {
      boilerplate: new RegExp(doc.boilerplate.pattern, doc.boilerplate.flags ?? 'gi'),
      intro: new RegExp(doc.intro.pattern, doc.intro.flags ?? 'gi'),
    };
    compiledAt = revision;
  }
  return compiled;
}

/** Strips boilerplate and de-duplicates repeated content, keeping the kernel. */
export function rtkStrategy(text: string): StrategyResult {
  const { boilerplate, intro } = getRules();
  const removed: string[] = [];

  // Preserve code verbatim: the prose passes below must not rewrite it, and the
  // line-splitting de-dupe must not reflow it.
  const { masked, blocks } = maskCodeBlocks(text);

  const stripped = masked.replace(boilerplate, (m) => {
    removed.push(m);
    return '';
  });
  const out0 = stripped.replace(intro, (m) => {
    removed.push(m);
    return '';
  });

  // De-duplicate repeated prose within each line. Working line-by-line keeps
  // every newline, so markdown lists, YAML, diffs and multi-line structure
  // survive — the previous version split on \n and rejoined with a space,
  // flattening the whole prompt into a single paragraph.
  const seen = new Set<string>();
  const lines = out0.split('\n').map((line) => {
    const parts = line
      .split(/(?<=[.!?])\s+/)
      .map((chunk) => chunk.trim())
      .filter((chunk) => {
        if (chunk.length === 0) return false;
        if (isCodePlaceholder(chunk)) return true;
        const norm = chunk.toLowerCase();
        if (seen.has(norm)) {
          removed.push(chunk);
          return false;
        }
        seen.add(norm);
        return true;
      });
    return parts.join(' ');
  });

  let out = lines.join('\n');
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = restoreCodeBlocks(out, blocks);
  const changed = out !== text;
  return { text: out.trim(), changed, removed };
}

/**
 * Dedicated 1-line context git diff compression (Unified Diff Minifier).
 * Strips verbose commit indexes, collapses unchanged context lines down to 1 line,
 * while preserving changed hunks (+ / -), hunk headers, and file demarcations.
 */
export function compressGitDiff(diffText: string, contextLines = 1): string {
  if (!diffText.includes('diff --git') && !diffText.startsWith('@@')) {
    return diffText;
  }
  const lines = diffText.split('\n');
  const result: string[] = [];
  let inHunk = false;
  let leadingContext: string[] = [];
  let trailingContextCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Drop noisy git index / mode metadata
    if (line.startsWith('index ') && /^[0-9a-f]{7,}\.\.[0-9a-f]{7,}/i.test(line.slice(6))) {
      continue;
    }

    if (line.startsWith('@@ ')) {
      inHunk = true;
      leadingContext = [];
      trailingContextCount = 0;
      result.push(line);
      continue;
    }

    if (!inHunk) {
      result.push(line);
      continue;
    }

    // Inside a hunk
    if (line.startsWith('+') || line.startsWith('-')) {
      // Flush leading context up to desired contextLines
      if (leadingContext.length > 0) {
        const kept = leadingContext.slice(-contextLines);
        result.push(...kept);
        leadingContext = [];
      }
      result.push(line);
      trailingContextCount = 0;
    } else if (line.startsWith(' ')) {
      // Context line
      trailingContextCount++;
      if (trailingContextCount <= contextLines) {
        result.push(line);
      } else {
        leadingContext.push(line);
      }
    } else {
      // New file or end of diff
      inHunk = false;
      leadingContext = [];
      trailingContextCount = 0;
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * Filters repetitive passing test suites and verbose build asset lists,
 * preserving failures, stack traces, and compiler diagnostics.
 */
export function filterTestBuildNoise(output: string): string {
  // Check if output has test or build indicators
  const hasTest = /(?:PASS|FAIL|✓|✕|tests?|suites?|spec)/i.test(output);
  const hasFailure = /(?:FAIL|✕|failed|error|AssertionError|ERR!|error TS\d+)/i.test(output);

  if (!hasTest && !hasFailure) return output;

  const lines = output.split('\n');
  const filtered: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Drop purely passing test suite rows when failures exist
    if (hasFailure && (trimmed.startsWith('PASS ') || trimmed.startsWith('✓ ') || /^\s*√\s+/.test(line))) {
      continue;
    }
    // Drop webpack/vite asset emission noise
    if (/^\s*(?:dist\/|build\/|assets\/).+\s+\d+(?:\.\d+)?\s*(?:kB|MB|bytes|B)\b/i.test(trimmed)) {
      continue;
    }
    filtered.push(line);
  }

  return filtered.join('\n');
}

export interface CompressOutputOptions {
  /** Long lines are truncated at this length (default 200). */
  maxLineLength?: number;
  /** Collapse runs of identical lines into "N× line" (default true). */
  collapseRepeats?: boolean;
  /** Command name if known (e.g. 'git diff') for domain-specific minification. */
  command?: string;
}

/**
 * RTK-style compression for shell/command output: collapses repeated lines,
 * trims blank-line noise, compresses git diffs to 1-line context, and filters test/build noise.
 */
export function compressCommandOutput(text: string, options: CompressOutputOptions = {}): StrategyResult {
  const maxLineLength = options.maxLineLength ?? 200;
  const collapseRepeats = options.collapseRepeats ?? true;

  let processed = text;
  if (options.command?.startsWith('git diff') || processed.includes('diff --git')) {
    processed = compressGitDiff(processed, 1);
  } else if (processed.trim().startsWith('{') || processed.trim().startsWith('[')) {
    processed = compressJson(processed);
  }
  processed = filterTestBuildNoise(processed);

  const lines = processed.split('\n');
  const out: string[] = [];
  let prev: string | undefined;
  let count = 0;

  const push = (): void => {
    if (prev === undefined) return;
    out.push(count > 1 ? `${prev}  [${count}×]` : prev);
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.trim().length === 0) {
      push();
      prev = undefined;
      count = 0;
      continue;
    }
    const truncated =
      line.length > maxLineLength ? `${line.slice(0, maxLineLength)}… (+${line.length - maxLineLength} chars)` : line;

    if (collapseRepeats && truncated === prev) {
      count += 1;
      continue;
    }
    push();
    prev = truncated;
    count = 1;
  }
  push();

  const result = out.join('\n');
  return { text: result, changed: result !== text };
}
