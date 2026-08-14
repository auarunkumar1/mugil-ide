/**
 * CAVEMAN MODULE
 * ==============
 * Terse, filler-free prompt compression — "why use many token when few token do trick".
 *
 * Credits
 * -------
 * Inspired by **JuliusBrussee/caveman** (https://github.com/JuliusBrussee/caveman), the
 * Claude Code skill (MIT) that cuts ~65% of output tokens by answering in tight
 * caveman-speak, popularized by the "taught Claude to talk like a caveman" community
 * experiments (r/ClaudeAI, Medium's "What is Caveman Prompt?", Apr 2026).
 *
 * This module applies the same terse-phrasing philosophy on the *input* side: it strips
 * polite filler, long-winded constructions ("in order to" -> "to") and hedge words from
 * a prompt before it is sent to a model, so the request itself costs fewer tokens.
 *
 * The phrase/filler/polite rules live in `src/rules/caveman.json` and are updatable at
 * runtime via `mugil-ide update` (see src/modules/overrides.ts).
 *
 * See ATTRIBUTIONS.md at the repository root for the full credit list.
 */

import type { StrategyResult } from '../../types.js';
import defaultRules from '../../rules/caveman.json';
import { currentRevision, loadRulesSync } from '../overrides.js';

interface CavemanRules {
  version: string;
  phrases: Array<{ pattern: string; flags?: string; replacement: string }>;
  filler: string;
  fillerFlags?: string;
  polite: string;
  politeFlags?: string;
}

interface CompiledRules {
  phrases: Array<[RegExp, string]>;
  filler: RegExp;
  polite: RegExp;
}

let compiled: CompiledRules | undefined;
let compiledAt = -1;

function getRules(): CompiledRules {
  const revision = currentRevision();
  if (!compiled || compiledAt !== revision) {
    const doc = loadRulesSync<CavemanRules>('caveman', defaultRules as unknown as CavemanRules);
    compiled = {
      phrases: doc.phrases.map((p) => [new RegExp(p.pattern, p.flags ?? 'gi'), p.replacement]),
      filler: new RegExp(doc.filler, doc.fillerFlags ?? 'gi'),
      polite: new RegExp(doc.polite, doc.politeFlags ?? 'gi'),
    };
    compiledAt = revision;
  }
  return compiled;
}

/** Compresses a prompt into terse caveman phrasing. */
export function cavemanStrategy(text: string): StrategyResult {
  const { phrases, filler, polite } = getRules();
  let out = text;
  for (const [re, replacement] of phrases) {
    out = out.replace(re, replacement);
  }
  out = out.replace(filler, ' ');
  out = out.replace(polite, ' ');
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');
  const changed = out !== text;
  return { text: out.trim(), changed };
}
