import { ANSI } from '../ansi.js';

export type SupportedLanguage =
  | 'javascript'
  | 'typescript'
  | 'js'
  | 'ts'
  | 'python'
  | 'py'
  | 'json'
  | 'bash'
  | 'sh'
  | 'shell'
  | 'diff'
  | string;

/**
 * Lightweight token-based syntax highlighter for terminal rendering.
 * Does not pull heavy external dependencies, maintaining fast CLI startup time.
 */
export function highlightCode(code: string, lang: string = ''): string {
  const normalizedLang = lang.trim().toLowerCase();
  const eol = code.includes('\r\n') ? '\r\n' : '\n';
  const lines = code.split(/\r?\n/);

  return lines.map((line) => highlightLine(line, normalizedLang)).join(eol);
}

function highlightLine(line: string, lang: string): string {
  if (!line) return '';

  switch (lang) {
    case 'diff':
      return highlightDiffLine(line);
    case 'javascript':
    case 'typescript':
    case 'js':
    case 'ts':
      return highlightJsTsLine(line);
    case 'python':
    case 'py':
      return highlightPythonLine(line);
    case 'json':
      return highlightJsonLine(line);
    case 'bash':
    case 'sh':
    case 'shell':
      return highlightShellLine(line);
    default:
      return `${ANSI.green}${line}${ANSI.reset}`;
  }
}

function highlightDiffLine(line: string): string {
  if (line.startsWith('+')) return `${ANSI.green}${line}${ANSI.reset}`;
  if (line.startsWith('-')) return `${ANSI.red}${line}${ANSI.reset}`;
  if (line.startsWith('@@')) return `${ANSI.cyan}${line}${ANSI.reset}`;
  if (line.startsWith('diff ') || line.startsWith('index ')) return `${ANSI.bold}${line}${ANSI.reset}`;
  return `${ANSI.dim}${line}${ANSI.reset}`;
}

function highlightJsTsLine(line: string): string {
  // Comments
  if (/^\s*\/\//.test(line)) {
    return `${ANSI.gray}${line}${ANSI.reset}`;
  }

  const keywordRegex =
    /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|extends|new|async|await|try|catch|throw|typeof|interface|type|default|switch|case|break|continue|yield|of|in|as)\b/g;
  const typeRegex = /\b(string|number|boolean|any|void|null|undefined|never|unknown|Promise|Record|Array|Map|Set)\b/g;
  const numberRegex = /\b(\d+(\.\d+)?)\b/g;
  const stringRegex = /(["'`])(?:\\.|(?!\1)[^\\])*\1/g;

  let out = line;
  // Strings first to protect keywords inside strings
  const stringTokens: string[] = [];
  out = out.replace(stringRegex, (match) => {
    stringTokens.push(`${ANSI.green}${match}${ANSI.reset}`);
    return `__STR_${stringTokens.length - 1}__`;
  });

  out = out.replace(keywordRegex, `${ANSI.brightCyan}$1${ANSI.reset}`);
  out = out.replace(typeRegex, `${ANSI.yellow}$1${ANSI.reset}`);
  out = out.replace(numberRegex, `${ANSI.magenta}$1${ANSI.reset}`);

  // Restore strings
  out = out.replace(/__STR_(\d+)__/g, (_m, idx) => stringTokens[Number(idx)] || '');

  return out;
}

function highlightPythonLine(line: string): string {
  // Comments
  if (/^\s*#/.test(line)) {
    return `${ANSI.gray}${line}${ANSI.reset}`;
  }

  const keywordRegex =
    /\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|raise|with|lambda|yield|async|await|pass|break|continue|in|is|not|and|or)\b/g;
  const literalRegex = /\b(True|False|None)\b/g;
  const numberRegex = /\b(\d+(\.\d+)?)\b/g;
  const stringRegex = /(["'])(?:\\.|(?!\1)[^\\])*\1/g;

  let out = line;
  const stringTokens: string[] = [];
  out = out.replace(stringRegex, (match) => {
    stringTokens.push(`${ANSI.green}${match}${ANSI.reset}`);
    return `__STR_${stringTokens.length - 1}__`;
  });

  out = out.replace(keywordRegex, `${ANSI.brightCyan}$1${ANSI.reset}`);
  out = out.replace(literalRegex, `${ANSI.yellow}$1${ANSI.reset}`);
  out = out.replace(numberRegex, `${ANSI.magenta}$1${ANSI.reset}`);

  out = out.replace(/__STR_(\d+)__/g, (_m, idx) => stringTokens[Number(idx)] || '');

  return out;
}

function highlightJsonLine(line: string): string {
  // Keys
  let out = line.replace(/"([^"]+)"(\s*:)/g, `${ANSI.brightCyan}"$1"${ANSI.reset}$2`);
  // Values: Strings
  out = out.replace(/:\s*("([^"]+)")/g, `: ${ANSI.green}"$2"${ANSI.reset}`);
  // Values: Numbers
  out = out.replace(/:\s*(-?\d+(\.\d+)?)/g, `: ${ANSI.magenta}$1${ANSI.reset}`);
  // Values: Booleans & null
  out = out.replace(/:\s*(true|false|null)\b/g, `: ${ANSI.yellow}$1${ANSI.reset}`);

  return out;
}

function highlightShellLine(line: string): string {
  if (/^\s*#/.test(line)) {
    return `${ANSI.gray}${line}${ANSI.reset}`;
  }

  const cmdRegex =
    /\b(echo|cd|ls|mkdir|rm|cp|mv|git|npm|node|cat|grep|curl|chmod|chown|export|source|kill|docker|kubectl)\b/g;
  const flagRegex = /(--?[a-zA-Z0-9-]+)/g;
  const stringRegex = /(["'])(?:\\.|(?!\1)[^\\])*\1/g;

  let out = line;
  const stringTokens: string[] = [];
  out = out.replace(stringRegex, (match) => {
    stringTokens.push(`${ANSI.green}${match}${ANSI.reset}`);
    return `__STR_${stringTokens.length - 1}__`;
  });

  out = out.replace(cmdRegex, `${ANSI.brightCyan}$1${ANSI.reset}`);
  out = out.replace(flagRegex, `${ANSI.yellow}$1${ANSI.reset}`);

  out = out.replace(/__STR_(\d+)__/g, (_m, idx) => stringTokens[Number(idx)] || '');

  return out;
}
