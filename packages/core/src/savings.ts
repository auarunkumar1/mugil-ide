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
