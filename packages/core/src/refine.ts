import type { RefineResult, StrategyResult } from './types.js';
import { countTokens } from './token/tokenizer.js';
import { cavemanStrategy } from './modules/caveman/index.js';
import { rtkStrategy } from './modules/rtk/index.js';

/**
 * Refine pipeline — composition layer over the credited modules.
 *
 * Order of operations (cheap-and-safe first, budget last):
 *   1. `caveman` — terse phrasing (inspired by JuliusBrussee/caveman).
 *   2. `rtk`     — reduced token kernel: boilerplate + dedupe
 *                  (inspired by rtk-ai/rtk).
 *   3. `truncate`— pull the prompt back under the token budget at sentence
 *                  boundaries, marking what was cut. Standard technique.
 *
 * See ATTRIBUTIONS.md at the repository root for credits.
 */

export interface RefineOptions {
  budgetTokens?: number;
  /** Strategies to run, in order. Defaults to all. */
  strategies?: Array<'caveman' | 'rtk' | 'truncate'>;
}

/**
 * Truncates at sentence boundaries to fit a token budget, marking what was
 * cut. The marker's own tokens are reserved so the result still fits.
 */
export function truncateToBudget(text: string, budgetTokens: number): StrategyResult {
  const current = countTokens(text);
  if (current <= budgetTokens) {
    return { text, changed: false };
  }

  const marker = (trimmed: number) => `\n\n[truncated: ${trimmed} tokens trimmed to fit budget]`;
  const markerTokens = countTokens(marker(99999));
  const effectiveBudget = Math.max(0, budgetTokens - markerTokens);

  const sentences = text.match(/[^.!?\n]+[.!?]*\n?/g) ?? [text];
  let out = '';
  let trimmed = 0;
  for (const sentence of sentences) {
    const candidate = out + sentence;
    if (countTokens(candidate) <= effectiveBudget) {
      out = candidate;
    } else if (out === '') {
      // First sentence exceeds effective budget: split by words so we don't drop entire prompt
      const words = sentence.split(/(\s+)/);
      for (const word of words) {
        if (countTokens(out + word) <= effectiveBudget) {
          out += word;
        } else {
          trimmed += countTokens(word);
        }
      }
    } else {
      trimmed += countTokens(sentence);
    }
  }
  out = out.trim();
  if (trimmed > 0) {
    out += marker(trimmed);
  }
  const changed = out !== text;
  return { text: out, changed };
}

/**
 * Runs the compression cascade. `truncate` is always last so the budget
 * constraint wins.
 */
export function refinePrompt(prompt: string, options: RefineOptions = {}): RefineResult {
  const budget = options.budgetTokens ?? Number.POSITIVE_INFINITY;
  const wanted = options.strategies ?? ['caveman', 'rtk', 'truncate'];
  const appliedStrategies: string[] = [];

  let text = prompt;
  for (const name of wanted) {
    const result: StrategyResult =
      name === 'caveman'
        ? cavemanStrategy(text)
        : name === 'rtk'
          ? rtkStrategy(text)
          : truncateToBudget(text, budget);
    if (result.changed) appliedStrategies.push(name);
    text = result.text;
  }

  const originalTokens = countTokens(prompt);
  const refinedTokens = countTokens(text);
  const savingsPct =
    originalTokens === 0 ? 0 : Math.round(((originalTokens - refinedTokens) / originalTokens) * 100);

  return {
    original: prompt,
    refined: text,
    originalTokens,
    refinedTokens,
    savingsPct,
    appliedStrategies,
  };
}
