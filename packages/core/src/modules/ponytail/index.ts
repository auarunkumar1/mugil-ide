/**
 * PONYTAIL MODULE
 * ===============
 * Output minimization: makes the model behave like the laziest senior dev in
 * the room — write only what the task needs, never less than what is safe.
 *
 * Credits
 * -------
 * Inspired by **DietrichGebert/ponytail** (https://github.com/DietrichGebert/ponytail),
 * "Makes your AI agent think like the laziest senior dev in the room. The best code is
 * the code you never wrote." Measured on real agentic sessions it cuts ~54% of code
 * (up to 94% on over-build traps), ~20% of cost and ~27% of time while staying 100%
 * "safe" (validation, error handling, security and accessibility never cut).
 *
 * The decision ladder below is adapted from that skill; the wording lives in
 * `src/rules/ponytail.json` and is updatable via `mugil-ide update`.
 *
 * See ATTRIBUTIONS.md at the repository root for the full credit list.
 */

import defaultRules from '../../rules/ponytail.json';
import { currentRevision, loadRulesSync } from '../overrides.js';

export interface PonytailOptions {
  /** Hard cap on completion tokens; enforced by the pipeline via max_tokens. */
  outputBudget?: number;
}

interface PonytailRules {
  version: string;
  preamble: string;
  ladder: string[];
  safety: string;
}

let rules: PonytailRules | undefined;
let rulesAt = -1;

function getRules(): PonytailRules {
  const revision = currentRevision();
  if (!rules || rulesAt !== revision) {
    rules = loadRulesSync<PonytailRules>('ponytail', defaultRules as unknown as PonytailRules);
    rulesAt = revision;
  }
  return rules;
}

/** System-level instruction that biases the model toward minimal output. */
export function ponytailInstruction(): string {
  const { preamble, ladder, safety } = getRules();
  return [preamble, ...ladder, safety].join('\n');
}

/** Resolves the output-token cap from ponytail options, if any. */
export function ponytailOutputBudget(options?: PonytailOptions): number | undefined {
  return options?.outputBudget;
}
