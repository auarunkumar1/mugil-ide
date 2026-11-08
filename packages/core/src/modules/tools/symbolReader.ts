/**
 * Symbol Reader & Surgical Code Locator
 * =====================================
 * Locates functions, classes, interfaces, types, methods and extracts exact
 * code spans without reading or sending entire files into the context window.
 */

export interface LocatedSymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

/**
 * Removes comments and string/template/regex literal contents from a source
 * line, carrying `state` across lines. Brace counting over raw text is wrong
 * the moment a `{` appears inside a string, a comment or a regex — that is how
 * `read_symbol` used to return 10x too many lines.
 */
interface ScanState {
  blockComment: boolean;
  /** True while inside a multi-line template literal. */
  template: boolean;
}

const REGEX_PRECEDERS = new Set([
  '',
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '~',
  '^',
]);

function stripNonCode(line: string, state: ScanState): string {
  let out = '';
  let prev = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    const next = line[i + 1];
    if (state.blockComment) {
      if (ch === '*' && next === '/') {
        state.blockComment = false;
        i++;
      }
      continue;
    }
    if (state.template) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '`') {
        state.template = false;
        continue;
      }
      if (ch === '$' && next === '{') {
        const close = line.indexOf('}', i + 2);
        out += ' ' + (close < 0 ? line.slice(i + 2) : line.slice(i + 2, close)) + ' ';
        i = close < 0 ? line.length : close;
        if (close < 0) state.template = false;
        continue;
      }
      continue;
    }
    if (ch === '/' && next === '/') break;
    if (ch === '/' && next === '*') {
      state.blockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) {
        if (line[j] === '\\') j++;
        j++;
      }
      i = j;
      prev = ch;
      out += ' ';
      continue;
    }
    if (ch === '`') {
      let j = i + 1;
      let interpolations = 0;
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === '$' && line[j + 1] === '{') interpolations++;
        else if (line[j] === '}' && interpolations > 0) interpolations--;
        else if (line[j] === '`' && interpolations === 0) break;
        j++;
      }
      if (j >= line.length) state.template = true;
      i = j;
      prev = '`';
      out += ' ';
      continue;
    }
    if (ch === '/') {
      // Regex literal vs division: only when the preceding token cannot end an
      // expression. A braces-in-regex would otherwise unbalance the count.
      if (REGEX_PRECEDERS.has(prev.trim())) {
        let j = i + 1;
        let inClass = false;
        while (j < line.length) {
          const r = line[j]!;
          if (r === '\\') {
            j += 2;
            continue;
          }
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          else if (r === '/' && !inClass) break;
          j++;
        }
        i = j;
        prev = '/';
        out += ' ';
        continue;
      }
    }
    out += ch;
    if (ch.trim().length > 0) prev = ch;
  }
  return out;
}

/**
 * Parses and locates a symbol in code content by name.
 * Returns the exact line span and source lines.
 */
export function findSymbolInContent(
  content: string,
  symbolName: string,
  filePath = 'file.ts',
): LocatedSymbol | null {
  const lines = content.split(/\r?\n/);
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const isPython = ext === '.py';

  // Regex patterns to identify definition start
  const escaped = symbolName.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

  let defRegex: RegExp;
  if (isPython) {
    defRegex = new RegExp(`^(\\s*)(?:async\\s+)?(?:def|class)\\s+(${escaped})\\b`);
  } else {
    // JS/TS/Rust/Go/Java/C/C++
    defRegex = new RegExp(
      `(?:(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?|class|interface|type|enum)\\s+(${escaped})\\b)` +
        `|(?:(?:const|let|var)\\s+(${escaped})\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[a-zA-Z0-9_$]+)\\s*=>)` +
        `|(?:(?:public|private|protected|static|async|get|set|override|readonly)*\\s*(${escaped})\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?\\s*\\{)` +
        `|(?:(${escaped})\\s*:\\s*(?:async\\s*)?(?:function|\\([^)]*\\)\\s*=>))`,
    );
  }

  let startLine = -1;
  let indentLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isPython) {
      const match = line.match(defRegex);
      if (match) {
        startLine = i + 1;
        indentLevel = match[1]?.length ?? 0;
        break;
      }
    } else {
      if (defRegex.test(line)) {
        startLine = i + 1;
        break;
      }
    }
  }

  if (startLine === -1) {
    return null;
  }

  // Find endLine
  let endLine = startLine;

  if (isPython) {
    let lastContentLine = startLine;
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.trim().length === 0 || line.trim().startsWith('#')) {
        continue;
      }
      const lineIndent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      if (lineIndent <= indentLevel) {
        endLine = lastContentLine;
        break;
      }
      lastContentLine = i + 1;
      endLine = i + 1;
    }
  } else {
    // Brace counting for JS/TS/etc.
    // Braces are only counted once the parameter list has closed and never
    // inside comments, strings, templates or regexes — otherwise a signature
    // like `f(opts: { a: string } = {})` ended the span at the parameter type,
    // and any `{` in a string ran it to EOF.
    const state: ScanState = { blockComment: false, template: false };
    let braceCount = 0;
    let foundFirstOpen = false;
    let parenDepth = 0;
    let sawArrow = false;
    for (let i = startLine - 1; i < lines.length; i++) {
      const code = stripNonCode(lines[i]!, state);
      const opens = (code.match(/\{/g) || []).length;
      const closes = (code.match(/\}/g) || []).length;
      parenDepth += (code.match(/\(/g) || []).length - (code.match(/\)/g) || []).length;
      if (code.includes('=>')) sawArrow = true;
      if (parenDepth <= 0 && opens > 0) foundFirstOpen = true;
      if (foundFirstOpen) braceCount += opens - closes;
      endLine = i + 1;
      if (foundFirstOpen && braceCount <= 0) break;
      // Expression-bodied arrow (`const f = (x) => x + 1;`) — no braces at all.
      if (!foundFirstOpen && sawArrow && parenDepth <= 0 && code.trimEnd().endsWith(';')) break;
      // A declaration with no body at all (`declare function f(): void;`).
      if (!foundFirstOpen && parenDepth <= 0 && code.trimEnd().endsWith(';')) break;
    }
  }
  const slice = lines.slice(startLine - 1, endLine);
  const numbered = slice.map((line, idx) => `${startLine + idx}: ${line}`).join('\n');

  return {
    name: symbolName,
    kind: isPython ? 'definition' : 'declaration',
    startLine,
    endLine,
    snippet: numbered,
  };
}
