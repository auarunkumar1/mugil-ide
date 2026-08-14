/**
 * SIGNATURE REMOVER MODULE
 * ========================
 * Removes boilerplate "signatures" from prompts and from AI-generated code —
 * identity preambles ("You are Claude…", "As an AI language model…"),
 * Anthropic's `Human:`/`Assistant:` turn markers and `<system>` wrappers,
 * gratitude closers, AI-generated header comments, and invisible watermark
 * characters.
 *
 * Credits
 * -------
 * The prompt-side rules target signature formats introduced by:
 *   - **Anthropic** — the `Human:` / `Assistant:` / `<system>` message format
 *     (https://docs.anthropic.com) and Claude's identity preamble.
 *   - **OpenAI** — the ChatGPT "As an AI language model…" preamble family.
 *
 * The code-side rules are inspired by the community "de-AI" tooling that
 * removes AI artifacts from generated content, e.g.:
 *   - **conorbronsdon/avoid-ai-writing** (https://github.com/conorbronsdon/avoid-ai-writing)
 *     — detects and copyedits AI-generated boilerplate.
 *   - **wiltodelta/remove-ai-watermarks** (https://github.com/wiltodelta/remove-ai-watermarks)
 *     and the clean-paste / watermark-stripper ecosystem — removal of invisible
 *     watermark characters (zero-width spaces, etc.).
 *
 * All patterns live in `src/rules/signature-remover.json` and are updatable at
 * runtime via `mugil-ide update` (see src/modules/overrides.ts).
 *
 * See ATTRIBUTIONS.md at the repository root for the full credit list.
 */

import type { StrategyResult } from '../../types.js';
import defaultRules from '../../rules/signature-remover.json';
import { currentRevision, loadRulesSync } from '../overrides.js';

export type ProviderName = 'anthropic' | 'openai' | 'generic';

interface RuleSpec {
  provider: ProviderName;
  label: string;
  pattern: string;
  flags?: string;
}

interface SignatureRules {
  version: string;
  rules: RuleSpec[];
  code: {
    generatedHeader: { pattern: string; flags?: string };
    generatedCommentLine: { pattern: string; flags?: string };
    invisibleWatermark: { pattern: string; flags?: string };
  };
}

interface CompiledRules {
  rules: Array<{ provider: ProviderName; label: string; regex: RegExp }>;
  generatedHeader: RegExp;
  generatedCommentLine: RegExp;
  invisibleWatermark: RegExp;
}

let compiled: CompiledRules | undefined;
let compiledAt = -1;

function getRules(): CompiledRules {
  const revision = currentRevision();
  if (!compiled || compiledAt !== revision) {
    const doc = loadRulesSync<SignatureRules>(
      'signature-remover',
      defaultRules as unknown as SignatureRules,
    );
    compiled = {
      rules: doc.rules.map((r) => ({
        provider: r.provider,
        label: r.label,
        regex: new RegExp(r.pattern, r.flags ?? 'gi'),
      })),
      generatedHeader: new RegExp(doc.code.generatedHeader.pattern, doc.code.generatedHeader.flags ?? 'i'),
      generatedCommentLine: new RegExp(
        doc.code.generatedCommentLine.pattern,
        doc.code.generatedCommentLine.flags ?? 'gim',
      ),
      invisibleWatermark: new RegExp(doc.code.invisibleWatermark.pattern, doc.code.invisibleWatermark.flags ?? 'g'),
    };
    compiledAt = revision;
  }
  return compiled;
}

export interface StripOptions {
  providers?: ProviderName[];
}

/**
 * Strips known signatures from a prompt. Returns the cleaned text plus the
 * list of matched signatures (useful for debug output).
 */
export function stripSignatures(text: string, options: StripOptions = {}): StrategyResult {
  const { rules } = getRules();
  const providers = new Set(options.providers ?? (['anthropic', 'openai', 'generic'] as ProviderName[]));
  const removed: string[] = [];
  let out = text;

  for (const rule of rules) {
    if (!providers.has(rule.provider)) continue;
    out = out.replace(rule.regex, (match) => {
      removed.push(`[${rule.label}] ${match.trim()}`);
      return ' ';
    });
  }

  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, changed: out !== text.trim(), removed };
}

/**
 * Removes AI signatures from generated code: attribution headers, AI-attribution
 * comment lines and invisible watermark characters.
 */
export function stripCodeSignatures(code: string): StrategyResult {
  const { generatedHeader, generatedCommentLine, invisibleWatermark } = getRules();
  const removed: string[] = [];
  let out = code;

  out = out.replace(generatedHeader, (match) => {
    removed.push(`[code:generated-header] ${match.trim().slice(0, 120)}`);
    return '';
  });
  out = out.replace(generatedCommentLine, (match) => {
    removed.push(`[code:generated-comment] ${match.trim()}`);
    return '';
  });
  const watermarkCount = (out.match(invisibleWatermark) ?? []).length;
  if (watermarkCount > 0) {
    removed.push(`[code:watermark] ${watermarkCount} invisible watermark character(s)`);
    out = out.replace(invisibleWatermark, '');
  }

  out = out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, changed: out !== code.trim(), removed };
}
