/* eslint-disable no-control-regex */
import { ANSI } from '../ansi.js';

/** Strips all ANSI SGR escape codes and OSC 8 hyperlinks to calculate visible length */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\]8;;.*?\x1b\\/g, '')
    .replace(/\x1b\]8;;\x1b\\/g, '');
}

/** Calculates visual column width of a single unicode code point */
export function codePointWidth(codePoint: number): number {
  if (codePoint === 0) return 0;
  // Control characters
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  // Combining marks and zero-width characters
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  ) {
    return 0;
  }
  // Fullwidth and Wide characters: CJK and Emojis
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f680 && codePoint <= 0x1f6ff) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x1fa00 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** Calculates visual width of a string in terminal columns */
export function visibleWidth(text: string): number {
  const stripped = stripAnsi(text);
  let w = 0;
  for (const ch of stripped) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) {
      w += codePointWidth(cp);
    }
  }
  return w;
}

/** Truncates a string to a maximum visual width, appending ellipsis if truncated */
export function truncateWidth(text: string, maxWidth: number, ellipsis = '…'): string {
  if (maxWidth <= 0) return '';
  const currentWidth = visibleWidth(text);
  if (currentWidth <= maxWidth) return text;
  const ellWidth = visibleWidth(ellipsis);
  if (maxWidth <= ellWidth) {
    return ellipsis.slice(0, maxWidth);
  }

  let res = '';
  let w = 0;
  const targetWidth = maxWidth - ellWidth;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const cw = cp !== undefined ? codePointWidth(cp) : 1;
    if (w + cw > targetWidth) break;
    res += ch;
    w += cw;
  }
  return res + ellipsis;
}

export interface InlineRenderOptions {
  hyperlinks?: boolean;
}

/**
 * Formats inline Markdown styling:
 * - Bold + Italic: ***text*** or ___text___
 * - Bold: **text** or __text__
 * - Italic: *text* or _text_
 * - Strikethrough: ~~text~~
 * - Inline Code: `code`
 * - Links: [label](url) -> OSC 8 terminal hyperlink or colored text
 */
export function formatInline(text: string, options: InlineRenderOptions = {}): string {
  if (!text) return '';

  let out = text;

  // 1. Protect inline code spans first so formatting characters inside code are not touched
  const codeTokens: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeTokens.push(`${ANSI.yellow}${code}${ANSI.reset}`);
    return `@@INLINECODE${codeTokens.length - 1}@@`;
  });

  // 2. Protect links before any ANSI brackets \x1b[ are added
  const linkTokens: string[] = [];
  const hyperlinks = options.hyperlinks ?? true;
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
    if (hyperlinks) {
      // OSC 8 Hyperlink: \x1b]8;;url\x1b\label\x1b]8;;\x1b\
      linkTokens.push(`\x1b]8;;${url}\x1b\\${ANSI.cyan}${ANSI.underline}${label}${ANSI.reset}\x1b]8;;\x1b\\`);
    } else {
      linkTokens.push(`${ANSI.cyan}${ANSI.underline}${label}${ANSI.reset} (${ANSI.dim}${url}${ANSI.reset})`);
    }
    return `@@INLINELINK${linkTokens.length - 1}@@`;
  });

  // 3. Strikethrough: ~~text~~
  out = out.replace(/~~(.*?)~~/g, `\x1b[9m$1${ANSI.reset}`);

  // 4. Bold + Italic: ***text*** or ___text___
  out = out.replace(/(\*\*\*|___)(.*?)\1/g, `${ANSI.bold}${ANSI.italic}$2${ANSI.reset}`);

  // 5. Bold: **text** or __text__
  out = out.replace(/(\*\*|__)(.*?)\1/g, `${ANSI.bold}$2${ANSI.reset}`);

  // 6. Italic: *text* or _text_ (ensuring no internal unescaped tokens)
  out = out.replace(/(^|[^*_])(\*|_)([^*_\n]+?)\2(?![*_])/g, `$1${ANSI.italic}$3${ANSI.reset}`);

  // 7. Restore links
  out = out.replace(/@@INLINELINK(\d+)@@/g, (_m, idx) => linkTokens[Number(idx)] || '');

  // 8. Restore inline code
  out = out.replace(/@@INLINECODE(\d+)@@/g, (_m, idx) => codeTokens[Number(idx)] || '');

  return out;
}
