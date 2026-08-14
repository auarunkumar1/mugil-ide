/**
 * Heuristic source parsers. Extracts the API surface (exported functions,
 * classes, interfaces, types, enums) plus their preceding doc comments, so
 * documentation can be generated offline without a full compiler.
 */
import * as path from 'node:path';

export interface DocSymbol {
  name: string;
  kind: string;
  signature: string;
  docs?: string;
  line: number;
}

export interface ParsedFile {
  path: string;
  language: string;
  symbols: DocSymbol[];
}

type Rule = RegExp;

const TS_RULES: Array<{ kind: string; re: Rule }> = [
  { kind: 'function', re: /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g },
  {
    kind: 'const',
    re: /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  },
  { kind: 'class', re: /export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g },
  { kind: 'interface', re: /export\s+interface\s+([A-Za-z_$][\w$]*)/g },
  { kind: 'type', re: /export\s+type\s+([A-Za-z_$][\w$]*)\s*=/g },
  { kind: 'enum', re: /export\s+enum\s+([A-Za-z_$][\w$]*)/g },
];

const PY_RULES: Array<{ kind: string; re: Rule }> = [
  { kind: 'function', re: /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^:)]*)\)/gm },
  { kind: 'class', re: /^class\s+([A-Za-z_]\w*)/gm },
];

const GO_RULES: Array<{ kind: string; re: Rule }> = [
  { kind: 'function', re: /^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)\s*\(([^)]*)\)/gm },
  { kind: 'type', re: /^type\s+(\w+)\s+(struct|interface)/gm },
];

const RS_RULES: Array<{ kind: string; re: Rule }> = [
  { kind: 'function', re: /^(?:pub\s+)?fn\s+(\w+)\s*\(([^)]*)\)/gm },
  { kind: 'struct', re: /^(?:pub\s+)?struct\s+(\w+)/gm },
  { kind: 'enum', re: /^(?:pub\s+)?enum\s+(\w+)/gm },
  { kind: 'trait', re: /^(?:pub\s+)?trait\s+(\w+)/gm },
];

function languageFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'].includes(ext)) return 'typescript';
  if (['.py', '.pyw'].includes(ext)) return 'python';
  if (['.go'].includes(ext)) return 'go';
  if (['.rs'].includes(ext)) return 'rust';
  if (['.md', '.markdown'].includes(ext)) return 'markdown';
  if (['.json', '.jsonc'].includes(ext)) return 'json';
  return 'text';
}

/** Extracts the JSDoc/docstring block immediately preceding a match. */
function extractDocBlock(content: string, matchIndex: number): string | undefined {
  const before = content.slice(0, matchIndex);
  const trimmed = before.replace(/\s+$/, '');
  if (!trimmed.endsWith('*/') && !trimmed.endsWith('"""') && !trimmed.endsWith("'''")) {
    return undefined;
  }
  const isBlock = trimmed.endsWith('*/');
  const open = isBlock
    ? trimmed.lastIndexOf('/**')
    : Math.max(trimmed.lastIndexOf('"""'), trimmed.lastIndexOf("'''"));
  if (open === -1) return undefined;
  const block = trimmed.slice(open);

  const lines = block
    .split('\n')
    .map((line) => {
      let l = line.trim();
      if (l.startsWith('/**')) l = l.slice(3);
      if (l.startsWith('*/')) l = l.slice(2);
      if (l.startsWith('*')) l = l.slice(1);
      if (l.endsWith('*/')) l = l.slice(0, -2);
      if (l.startsWith('"')) l = l.slice(1);
      if (l.endsWith('"')) l = l.slice(0, -1);
      return l.trim();
    })
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines.join(' ') : undefined;
}

function collect(content: string, rules: Array<{ kind: string; re: Rule }>): DocSymbol[] {
  const symbols: DocSymbol[] = [];
  for (const { kind, re } of rules) {
    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(content)) !== null) {
      const name = match[1]!;
      const params = match[2] ?? '';
      const line = content.slice(0, match.index).split('\n').length;
      const signature =
        kind === 'function'
          ? `function ${name}(${params.trim()})`
          : kind === 'const'
            ? `const ${name} = (...) => ...`
            : `${kind} ${name}`;
      symbols.push({
        name,
        kind,
        signature,
        docs: extractDocBlock(content, match.index),
        line,
      });
    }
  }
  // Deduplicate (same symbol can match multiple rules) and sort by line.
  const seen = new Set<string>();
  return symbols
    .filter((s) => {
      const key = `${s.line}:${s.name}:${s.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.line - b.line);
}

/** Parses a single source file into its documented symbols. */
export function parseFile(file: string, content: string): ParsedFile {
  const language = languageFor(file);
  let symbols: DocSymbol[] = [];
  if (language === 'typescript') symbols = collect(content, TS_RULES);
  else if (language === 'python') symbols = collect(content, PY_RULES);
  else if (language === 'go') symbols = collect(content, GO_RULES);
  else if (language === 'rust') symbols = collect(content, RS_RULES);
  return { path: file, language, symbols };
}
