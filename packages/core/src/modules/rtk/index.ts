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
  let out = text.replace(boilerplate, (m) => {
    removed.push(m);
    return '';
  });
  out = out.replace(intro, (m) => {
    removed.push(m);
    return '';
  });

  // Preserve markdown code blocks from being flattened
  const codeBlocks: string[] = [];
  let masked = out.replace(/```[\s\S]*?```/g, (m) => {
    codeBlocks.push(m);
    return `__RTK_CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // De-duplicate repeated sentences in prose (case-insensitive, whitespace-normalized).
  const seen = new Set<string>();
  masked = masked
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((chunk) => {
      const norm = chunk.trim().toLowerCase();
      if (norm.length === 0) return false;
      if (norm.startsWith('__rtk_code_block_')) return true;
      if (seen.has(norm)) {
        removed.push(chunk);
        return false;
      }
      seen.add(norm);
      return true;
    })
    .join(' ');

  masked = masked.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  out = masked.replace(/__RTK_CODE_BLOCK_(\d+)__/g, (_, idx) => codeBlocks[Number(idx)] ?? '');
  const changed = out !== text;
  return { text: out.trim(), changed, removed };
}

export interface CompressOutputOptions {
  /** Long lines are truncated at this length (default 200). */
  maxLineLength?: number;
  /** Collapse runs of identical lines into "N× line" (default true). */
  collapseRepeats?: boolean;
}

/**
 * RTK-style compression for shell/command output: collapses repeated lines,
 * trims blank-line noise and truncates very long lines. Keeps error/failure
 * lines intact (they usually matter).
 */
export function compressCommandOutput(text: string, options: CompressOutputOptions = {}): StrategyResult {
  const maxLineLength = options.maxLineLength ?? 200;
  const collapseRepeats = options.collapseRepeats ?? true;

  const lines = text.split('\n');
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
