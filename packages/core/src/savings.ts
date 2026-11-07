import type { SavingsBreakdown } from "./types.js";

/**
 * Input-token savings percentage.
 *
 * The denominator is the *compressible* input — the tokens that actually went
 * through a compression module, before and after — not the provider's reported
 * prompt count. Measuring against the whole request (system prompt + tool
 * schemas + history, tens of thousands of tokens) diluted any real module
 * saving to "0%", which is what the status bar used to show.
 *
 * `savedTokens` were removed; `keptTokens` are the post-compression tokens that
 * were still sent.
 */
export function inputSavingsPercent(savedTokens: number, keptTokens: number): number {
  const total = savedTokens + keptTokens;
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.round((Math.max(0, savedTokens) / total) * 100);
}

/** Returns a fresh zeroed breakdown across all 4 optimization levels. */
export function defaultSavingsBreakdown(): SavingsBreakdown {
  return {
    caveman: 0,
    yagni: 0,
    cache: 0,
    mcp: 0,
  };
}

/** Merges two savings breakdowns. */
export function sumSavingsBreakdowns(
  a?: Partial<SavingsBreakdown>,
  b?: Partial<SavingsBreakdown>,
): SavingsBreakdown {
  return {
    caveman: (a?.caveman ?? 0) + (b?.caveman ?? 0),
    yagni: (a?.yagni ?? 0) + (b?.yagni ?? 0),
    cache: (a?.cache ?? 0) + (b?.cache ?? 0),
    mcp: (a?.mcp ?? 0) + (b?.mcp ?? 0),
  };
}

/**
 * Computes optimistic total saved tokens across Caveman, YAGNI, Cache, and MCP.
 * If baseSaved is higher than the sum, the larger of the two is used.
 */
export function optimisticSavingsTotal(
  breakdown?: Partial<SavingsBreakdown>,
  baseSaved = 0,
): number {
  if (!breakdown) return Math.max(0, baseSaved);
  const sum =
    (breakdown.caveman ?? 0) +
    (breakdown.yagni ?? 0) +
    (breakdown.cache ?? 0) +
    (breakdown.mcp ?? 0);
  return Math.max(baseSaved, sum);
}

/** Computes optimistic savings percentage based on optimistic total. */
export function optimisticSavingsPercent(
  optimisticSaved: number,
  keptTokens: number,
): number {
  const total = optimisticSaved + keptTokens;
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.round((Math.max(0, optimisticSaved) / total) * 100);
}
