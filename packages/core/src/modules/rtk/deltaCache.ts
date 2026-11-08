/**
 * Delta Mode Error Diagnostics (RTK DeltaCache)
 * ==============================================
 * Diffs test and build outputs across consecutive runs of the same or similar command.
 * Identifies resolved, new, and unchanged failures, collapsing unchanged stack traces
 * to save up to 85% of tokens during iterative debug loops.
 */

export interface FailureItem {
  id: string;
  summary: string;
  details: string;
}

export interface DeltaStats {
  resolvedCount: number;
  newCount: number;
  unchangedCount: number;
  tokensSavedEstimate: number;
}

export interface DeltaDiffResult {
  resolved: string[];
  newFailures: FailureItem[];
  unchanged: FailureItem[];
}

export class DeltaCache {
  private cache = new Map<string, { timestamp: number; failures: Map<string, FailureItem> }>();

  /** Normalize command to group minor flag variations (e.g. `npm test` vs `npm test -- --runInBand`). */
  normalizeCommand(command: string): string {
    return command.trim().replace(/\s+--\s+.*$/, '').replace(/\s+/g, ' ');
  }

  /** Clears all cached failure signatures. */
  clear(): void {
    this.cache.clear();
  }

  /** Extracts discrete failure items from raw command output. */
  extractFailures(output: string): FailureItem[] {
    const failures: FailureItem[] = [];
    const lines = output.split('\n');

    // 1. Jest / Vitest / Mocha patterns: "● Suite › test name" or "FAIL path/to/test"
    let currentItem: { id: string; summary: string; lines: string[] } | null = null;

    const rawLines = lines;
    const hasJestBullet = rawLines.some((l) => /^\s*●\s+/.test(l));

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      const jestMatch = line.match(/^(\s*●\s+)(.+)$/);
      const failMatch = !hasJestBullet ? line.match(/^FAIL\s+([^\s]+)/) : null;
      const pytestMatch = line.match(/^FAILED\s+([^\s]+)(?:\s+-\s+(.+))?/);
      const cargoMatch = line.match(/^test\s+([^\s]+)\s+\.\.\.\s+FAILED/);
      const tscMatch = line.match(/^([^\s]+(?:\.tsx?|\.jsx?|\.vue|\.rs|\.py|\.go|\.c|\.cpp))(?::|\()(\d+)(?:,\d+|\))?:\s+error\s+(.*)$/i);

      let newId: string | null = null;
      let newSummary: string | null = null;

      if (jestMatch) {
        newId = jestMatch[2]!.trim();
        newSummary = jestMatch[2]!.trim();
      } else if (failMatch) {
        newId = failMatch[1]!.trim();
        newSummary = `FAIL ${newId}`;
      } else if (pytestMatch) {
        newId = pytestMatch[1]!.trim();
        newSummary = pytestMatch[2] ? `${newId}: ${pytestMatch[2].trim()}` : newId;
      } else if (cargoMatch) {
        newId = cargoMatch[1]!.trim();
        newSummary = `test ${newId} FAILED`;
      } else if (tscMatch) {
        newId = `${tscMatch[1]}:${tscMatch[2]}`;
        newSummary = `${tscMatch[1]}:${tscMatch[2]}: ${tscMatch[3]}`;
      }

      if (newId) {
        if (currentItem) {
          failures.push({
            id: currentItem.id,
            summary: currentItem.summary,
            details: currentItem.lines.join('\n').trim(),
          });
        }
        currentItem = {
          id: newId,
          summary: newSummary ?? newId,
          lines: [line],
        };
      } else if (currentItem) {
        // Collect following lines until end or new section
        if (line.startsWith('Test Suites:') || line.startsWith('=== FAILURES ===') || line.startsWith('Tests: ')) {
          failures.push({
            id: currentItem.id,
            summary: currentItem.summary,
            details: currentItem.lines.join('\n').trim(),
          });
          currentItem = null;
        } else {
          currentItem.lines.push(line);
        }
      }
    }

    if (currentItem) {
      failures.push({
        id: currentItem.id,
        summary: currentItem.summary,
        details: currentItem.lines.join('\n').trim(),
      });
    }

    return failures;
  }

  /** Diffs current failures against previous run. */
  diff(command: string, currentFailures: FailureItem[]): DeltaDiffResult {
    const key = this.normalizeCommand(command);
    const prev = this.cache.get(key);

    const currentMap = new Map<string, FailureItem>();
    for (const f of currentFailures) {
      currentMap.set(f.id, f);
    }

    if (!prev) {
      // First run: save and return all as new
      this.cache.set(key, { timestamp: Date.now(), failures: currentMap });
      return {
        resolved: [],
        newFailures: currentFailures,
        unchanged: [],
      };
    }

    const prevMap = prev.failures;
    const resolved: string[] = [];
    const newFailures: FailureItem[] = [];
    const unchanged: FailureItem[] = [];

    // Find resolved (in prev, not in current)
    for (const [id, item] of prevMap.entries()) {
      if (!currentMap.has(id)) {
        resolved.push(item.summary);
      }
    }

    // Find new & unchanged
    for (const [id, item] of currentMap.entries()) {
      if (!prevMap.has(id)) {
        newFailures.push(item);
      } else {
        unchanged.push(item);
      }
    }

    // Update cache
    this.cache.set(key, { timestamp: Date.now(), failures: currentMap });

    return { resolved, newFailures, unchanged };
  }

  /**
   * Applies Delta Mode compression to output.
   * If there are unchanged failures, collapses them and surfaces resolved/new failures prominently.
   */
  apply(command: string, output: string, options: { maxUnchangedShown?: number } = {}): {
    text: string;
    changed: boolean;
    deltaStats?: DeltaStats;
  } {
    const maxUnchanged = options.maxUnchangedShown ?? 1;
    const failures = this.extractFailures(output);

    // If no failures extracted or too short, return unchanged
    if (failures.length === 0) {
      const key = this.normalizeCommand(command);
      const prev = this.cache.get(key);
      if (prev && prev.failures.size > 0) {
        // All failures resolved!
        const resolvedList = Array.from(prev.failures.values()).map((f) => f.summary);
        this.cache.set(key, { timestamp: Date.now(), failures: new Map() });
        const banner = `\n✔ [Delta Mode: All ${resolvedList.length} previous failure(s) successfully resolved!]\n`;
        return {
          text: banner + output,
          changed: true,
          deltaStats: {
            resolvedCount: resolvedList.length,
            newCount: 0,
            unchangedCount: 0,
            tokensSavedEstimate: 0,
          },
        };
      }
      return { text: output, changed: false };
    }

    const diffResult = this.diff(command, failures);
    const { resolved, newFailures, unchanged } = diffResult;

    // If this is the first run (no resolved, no unchanged), return raw
    if (resolved.length === 0 && unchanged.length === 0) {
      return { text: output, changed: false };
    }

    // If there are unchanged failures to collapse:
    let modified = output;
    let savedChars = 0;

    // For unchanged failures beyond maxUnchanged, replace their full stack traces with a 1-line note
    if (unchanged.length > maxUnchanged) {
      const toCollapse = unchanged.slice(maxUnchanged);
      for (const item of toCollapse) {
        if (item.details && modified.includes(item.details)) {
          const replacement = `${item.summary} [unchanged failure stack trace collapsed by Delta Mode]`;
          savedChars += item.details.length - replacement.length;
          modified = modified.replace(item.details, replacement);
        }
      }
    }

    // Build concise delta summary header
    const summaryLines: string[] = ['--- [Delta Mode Diagnostics] ---'];
    if (resolved.length > 0) {
      summaryLines.push(`✔ Resolved (${resolved.length}): ${resolved.slice(0, 3).join(', ')}${resolved.length > 3 ? ` (+${resolved.length - 3} more)` : ''}`);
    }
    if (newFailures.length > 0) {
      summaryLines.push(`✕ New failures (${newFailures.length}): ${newFailures.map((f) => f.id).slice(0, 3).join(', ')}`);
    }
    if (unchanged.length > 0) {
      summaryLines.push(`⚠ Unchanged failures (${unchanged.length}): ${unchanged.length > maxUnchanged ? `${maxUnchanged} shown, ${unchanged.length - maxUnchanged} collapsed` : `${unchanged.length} shown`}`);
    }
    summaryLines.push('--------------------------------');

    const banner = summaryLines.join('\n') + '\n\n';
    const finalOutput = banner + modified;

    const tokensSavedEstimate = Math.max(0, Math.round(savedChars / 4));

    return {
      text: finalOutput,
      changed: true,
      deltaStats: {
        resolvedCount: resolved.length,
        newCount: newFailures.length,
        unchangedCount: unchanged.length,
        tokensSavedEstimate,
      },
    };
  }
}

/** Global singleton delta cache instance. */
export const globalDeltaCache = new DeltaCache();

/** Convenience helper for delta mode. */
export function applyDeltaMode(command: string, output: string, cache: DeltaCache = globalDeltaCache): {
  text: string;
  changed: boolean;
  deltaStats?: DeltaStats;
} {
  return cache.apply(command, output);
}
