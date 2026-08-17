/**
 * ANSI formatting helpers for terminal output.
 */

export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Bright Foreground colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  bgDarkGray: '\x1b[100m',

  // Cursor controls
  clearScreen: '\x1b[2J\x1b[H',
  clearLine: '\x1b[2K\r',
  cursorUp: (n = 1) => `\x1b[${n}A`,
  cursorDown: (n = 1) => `\x1b[${n}B`,
  cursorForward: (n = 1) => `\x1b[${n}C`,
  cursorBack: (n = 1) => `\x1b[${n}D`,
};

export function c(text: string | number, ...styles: string[]): string {
  return `${styles.join('')}${text}${ANSI.reset}`;
}

export function bold(text: string | number): string {
  return `${ANSI.bold}${text}${ANSI.reset}`;
}

export function dim(text: string | number): string {
  return `${ANSI.dim}${text}${ANSI.reset}`;
}

export function cyan(text: string | number): string {
  return `${ANSI.cyan}${text}${ANSI.reset}`;
}

export function green(text: string | number): string {
  return `${ANSI.green}${text}${ANSI.reset}`;
}

export function yellow(text: string | number): string {
  return `${ANSI.yellow}${text}${ANSI.reset}`;
}

export function red(text: string | number): string {
  return `${ANSI.red}${text}${ANSI.reset}`;
}

export function magenta(text: string | number): string {
  return `${ANSI.magenta}${text}${ANSI.reset}`;
}

export function blue(text: string | number): string {
  return `${ANSI.blue}${text}${ANSI.reset}`;
}

export function gray(text: string | number): string {
  return `${ANSI.gray}${text}${ANSI.reset}`;
}

export function badge(label: string, bg: string = ANSI.bgBlue, fg: string = ANSI.brightWhite): string {
  return ` ${bg}${fg}${ANSI.bold} ${label} ${ANSI.reset} `;
}

export function formatBox(title: string, lines: string[], width = 64): string {
  const top = `┌─ ${title} ${'─'.repeat(Math.max(0, width - title.length - 5))}┐`;
  const bottom = `└${'─'.repeat(width - 2)}┘`;
  const body = lines.map((l) => `│ ${l.padEnd(width - 4)} │`).join('\r\n');
  return `${top}\r\n${body}\r\n${bottom}`;
}

/** Formats raw Markdown from LLM into clean, color-styled terminal ANSI text. */
export function formatMarkdown(text: string): string {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';

  for (const rawLine of lines) {
    let line = rawLine;

    // Code block toggle
    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = line.trim().slice(3).trim();
        out.push(`${ANSI.dim}┌─── ${codeLang || 'code'} ${'─'.repeat(Math.max(0, 48 - (codeLang.length || 4)))}┐${ANSI.reset}`);
      } else {
        inCodeBlock = false;
        out.push(`${ANSI.dim}└───${'─'.repeat(50)}┘${ANSI.reset}`);
      }
      continue;
    }

    if (inCodeBlock) {
      out.push(`  ${ANSI.green}${line}${ANSI.reset}`);
      continue;
    }

    // Headers
    if (/^#{1,6}\s+/.test(line)) {
      const headerText = line.replace(/^#{1,6}\s+/, '');
      out.push(`\r\n${ANSI.bold}${ANSI.brightCyan}${headerText}${ANSI.reset}`);
      continue;
    }

    // Horizontal rule
    if (/^(?:[-*_]\s*){3,}$/.test(line.trim())) {
      out.push(`${ANSI.dim}${'─'.repeat(48)}${ANSI.reset}`);
      continue;
    }

    // Bullets: * or -
    if (/^\s*[*+-]\s+/.test(line)) {
      const indent = line.match(/^\s*/)?.[0] ?? '';
      const content = line.replace(/^\s*[*+-]\s+/, '');
      line = `${indent}  • ${content}`;
    }

    // Numbered lists
    if (/^\s*\d+\.\s+/.test(line)) {
      const match = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
      if (match) {
        line = `${match[1]}  ${ANSI.bold}${match[2]}${ANSI.reset} ${match[3]}`;
      }
    }

    // Bold + Italic: ***text*** or ___text___
    line = line.replace(/(\*\*\*|___)(.*?)\1/g, `${ANSI.bold}${ANSI.italic}$2${ANSI.reset}`);

    // Bold: **text** or __text__
    line = line.replace(/(\*\*|__)(.*?)\1/g, `${ANSI.bold}$2${ANSI.reset}`);

    // Italic: *text* or _text_
    line = line.replace(/(^|[^*_])(\*|_)([^*_]+?)\2(?![*_])/g, `$1${ANSI.italic}$3${ANSI.reset}`);

    // Inline code: `text`
    line = line.replace(/`([^`]+)`/g, `${ANSI.yellow}$1${ANSI.reset}`);

    out.push(line);
  }

  return out.join('\r\n');
}
