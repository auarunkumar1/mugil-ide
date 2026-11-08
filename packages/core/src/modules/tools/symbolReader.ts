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
        `|(?:(${escaped})\\s*:\\s*(?:async\\s*)?(?:function|\\([^)]*\\)\\s*=>))`
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
    // Brace counting for JS/TS/etc
    let braceCount = 0;
    let foundFirstOpen = false;

    for (let i = startLine - 1; i < lines.length; i++) {
      const line = lines[i]!;
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;

      if (opens > 0) foundFirstOpen = true;
      braceCount += opens - closes;

      if (foundFirstOpen && braceCount <= 0) {
        endLine = i + 1;
        break;
      }
      // If single-line arrow function without braces
      if (!foundFirstOpen && line.includes('=>') && (line.endsWith(';') || i > startLine + 1)) {
        endLine = i + 1;
        break;
      }
      endLine = i + 1;
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
