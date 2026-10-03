/**
 * Code-block masking shared by the prompt-compression strategies.
 *
 * Both `caveman` and `rtk` rewrite prose with regexes. Applied to a prompt that
 * contains code, those regexes corrupt identifiers, paths, shell commands and
 * string literals — "in order to" inside a comment becomes "to", and a
 * `please` in a user-facing message vanishes. Masking code out before the prose
 * pass and restoring it afterwards keeps the saving on prose while leaving code
 * byte-identical.
 */

/** Fenced blocks (``` or ~~~) and inline spans (`code`). */
const CODE_PATTERN = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`/g;

const PLACEHOLDER_PREFIX = '__MUGIL_CODE_';

/** Placeholders are alphanumeric+underscore so prose regexes can't match them. */
function placeholder(index: number): string {
  return `${PLACEHOLDER_PREFIX}${index}__`;
}

/**
 * Replaces every code block with an opaque placeholder.
 * Returns the masked text plus the blocks, for `restoreCodeBlocks`.
 */
export function maskCodeBlocks(text: string): { masked: string; blocks: string[] } {
  const blocks: string[] = [];
  const masked = text.replace(CODE_PATTERN, (m) => {
    blocks.push(m);
    return placeholder(blocks.length - 1);
  });
  return { masked, blocks };
}

/** True when a chunk is one of our placeholders (never treat it as prose). */
export function isCodePlaceholder(chunk: string): boolean {
  return chunk.trim().startsWith(PLACEHOLDER_PREFIX);
}

/** Puts the masked code blocks back verbatim. */
export function restoreCodeBlocks(masked: string, blocks: string[]): string {
  return masked.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)__`, 'g'),
    (_, idx: string) => blocks[Number(idx)] ?? '',
  );
}