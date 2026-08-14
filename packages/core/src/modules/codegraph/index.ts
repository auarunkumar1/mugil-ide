/**
 * CODEGRAPH MODULE
 * ===============
 * Builds a knowledge graph of a codebase — every symbol, import/dependency
 * edge and same-file call edge — so an agent gets exactly the code it needs
 * for a task in one call instead of dumping the whole repo into context.
 *
 * Credits
 * -------
 * Inspired by **colbymchenry/codegraph**
 * (https://github.com/colbymchenry/codegraph) — "a pre-built knowledge graph
 * of every symbol, call edge, and dependency in your codebase". This module
 * reimplements the idea in TypeScript for this codebase: regex-driven (no
 * Tree-sitter), covering TypeScript/JavaScript, Python, Go and Rust, with
 * per-language patterns in `src/rules/codegraph.json` (updatable at runtime
 * via `mugil-ide update`).
 *
 * Limitation: call edges are same-file name references (word-boundary
 * matches inside a symbol's body). Cross-file edges require import
 * resolution, which is out of scope here — the import edges give you the
 * dependency map, and `queryCodeGraph` gives you the relevant snippets.
 *
 * See ATTRIBUTIONS.md at the repository root for the full credit list.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import defaultRules from '../../rules/codegraph.json';
import { currentRevision, loadRulesSync } from '../overrides.js';

export type CodeLanguage = 'typescript' | 'python' | 'go' | 'rust';

export interface CodeSymbol {
  name: string;
  kind: string;
  signature: string;
  /** Path relative to the graph root, forward slashes. */
  file: string;
  line: number;
  /** Source block starting at this symbol's line, up to the next symbol. */
  snippet: string;
}

export interface ImportEdge {
  /** File (relative to root) that imports. */
  from: string;
  /** Imported module specifier. */
  to: string;
  kind: string;
}

export interface CallEdge {
  /** Symbol that references another symbol. */
  from: string;
  /** Referenced symbol (defined in the same file). */
  to: string;
  file: string;
}

export interface CodeFile {
  path: string;
  language: CodeLanguage;
  symbols: CodeSymbol[];
  imports: ImportEdge[];
}

export interface CodeGraph {
  root: string;
  files: CodeFile[];
  /** Flat symbol index across all files. */
  symbols: CodeSymbol[];
  edges: { imports: ImportEdge[]; calls: CallEdge[] };
  stats: {
    files: number;
    symbols: number;
    importEdges: number;
    callEdges: number;
    languages: Record<string, number>;
  };
}

export interface BuildCodeGraphOptions {
  /** Extra directory names to skip beyond the defaults in the rules. */
  ignoreDirs?: string[];
  /** Restrict to specific languages. */
  languages?: CodeLanguage[];
}

interface LanguageRules {
  extensions: string[];
  symbols: Array<{ kind: string; pattern: string; flags?: string }>;
  imports: Array<{ kind: string; pattern: string; flags?: string }>;
}

interface CodegraphRules {
  version: string;
  ignoreDirs: string[];
  languages: Record<CodeLanguage, LanguageRules>;
}

interface CompiledRules {
  ignoreDirs: Set<string>;
  languages: Record<CodeLanguage, { extensions: string[]; symbols: Array<{ kind: string; re: RegExp }>; imports: Array<{ kind: string; re: RegExp }> }>;
}

let compiled: CompiledRules | undefined;
let compiledAt = -1;

function getRules(): CompiledRules {
  const revision = currentRevision();
  if (!compiled || compiledAt !== revision) {
    const doc = loadRulesSync<CodegraphRules>('codegraph', defaultRules as unknown as CodegraphRules);
    const languages = {} as CompiledRules['languages'];
    for (const [name, lang] of Object.entries(doc.languages)) {
      languages[name as CodeLanguage] = {
        extensions: lang.extensions,
        symbols: lang.symbols.map((s) => ({ kind: s.kind, re: new RegExp(s.pattern, s.flags ?? 'g') })),
        imports: lang.imports.map((i) => ({ kind: i.kind, re: new RegExp(i.pattern, i.flags ?? 'g') })),
      };
    }
    compiled = { ignoreDirs: new Set(doc.ignoreDirs), languages };
    compiledAt = revision;
  }
  return compiled;
}

/** Maps a file extension to its language (undefined for non-source files). */
export function languageFor(file: string): CodeLanguage | undefined {
  const ext = path.extname(file).toLowerCase();
  const { languages } = getRules();
  for (const [name, lang] of Object.entries(languages)) {
    if (lang.extensions.includes(ext)) return name as CodeLanguage;
  }
  return undefined;
}

const MAX_SNIPPET_LINES = 60;

/** Extracts symbols (with line numbers) from source content. */
function collectSymbols(content: string, rules: Array<{ kind: string; re: RegExp }>): Array<{ name: string; kind: string; line: number }> {
  const found: Array<{ name: string; kind: string; line: number }> = [];
  for (const { kind, re } of rules) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const name = match[1]!;
      const line = content.slice(0, match.index).split('\n').length;
      found.push({ name, kind, line });
    }
  }
  const seen = new Set<string>();
  return found
    .filter((s) => {
      const key = `${s.line}:${s.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.line - b.line);
}

/** Extracts import specifiers from source content. */
function collectImports(content: string, rules: Array<{ kind: string; re: RegExp }>): Array<{ to: string; kind: string }> {
  const found: Array<{ to: string; kind: string }> = [];
  for (const { kind, re } of rules) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      found.push({ to: match[1]!, kind });
    }
  }
  const seen = new Set<string>();
  return found.filter((i) => {
    if (seen.has(i.to)) return false;
    seen.add(i.to);
    return true;
  });
}

/** Splices a snippet for each symbol: from its line up to the next symbol. */
function attachSnippets(
  content: string,
  symbols: Array<{ name: string; kind: string; line: number }>,
): Array<{ name: string; kind: string; line: number; snippet: string }> {
  const lines = content.split('\n');
  return symbols.map((s, i) => {
    const nextLine = symbols[i + 1] ? symbols[i + 1]!.line : lines.length + 1;
    const end = Math.min(nextLine - 1, s.line - 1 + MAX_SNIPPET_LINES, lines.length);
    const snippet = lines.slice(s.line - 1, end).join('\n');
    return { ...s, snippet };
  });
}

/** Builds same-file reference (call) edges between symbols. */
function collectCallEdges(
  content: string,
  symbols: Array<{ name: string; kind: string; line: number; snippet: string }>,
  file: string,
): CallEdge[] {
  const edges: CallEdge[] = [];
  for (const a of symbols) {
    for (const b of symbols) {
      if (a.name === b.name) continue;
      const re = new RegExp(`\\b${escapeRegExp(b.name)}\\b`, 'g');
      if (re.test(a.snippet)) {
        edges.push({ from: a.name, to: b.name, file });
      }
    }
  }
  return edges;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parses a single source file into symbols, imports and call edges. */
export function parseCodeFile(file: string, content: string): CodeFile {
  const language = languageFor(file);
  if (!language) return { path: file, language: 'typescript', symbols: [], imports: [] };
  const { languages } = getRules();
  const rules = languages[language]!;
  const rawSymbols = collectSymbols(content, rules.symbols);
  const symbols = attachSnippets(content, rawSymbols).map((s) => ({
    name: s.name,
    kind: s.kind,
    signature:
      s.kind === 'function'
        ? `function ${s.name}(...)`
        : s.kind === 'const'
          ? `const ${s.name} = ...`
          : `${s.kind} ${s.name}`,
    file,
    line: s.line,
    snippet: s.snippet,
  }));
  const imports = collectImports(content, rules.imports).map((i) => ({ from: file, to: i.to, kind: i.kind }));
  return { path: file, language, symbols, imports };
}

/** Recursively collects source files under a root, skipping ignored dirs. */
export function collectSourceFiles(root: string, options: BuildCodeGraphOptions = {}): string[] {
  const { ignoreDirs, languages } = getRules();
  const skip = new Set<string>([...ignoreDirs, ...(options.ignoreDirs ?? [])]);
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) stack.push(full);
      } else if (entry.isFile()) {
        const language = languageFor(entry.name);
        if (language && (!options.languages || options.languages.includes(language))) {
          files.push(full);
        }
      }
    }
  }
  return files;
}

/** Builds a knowledge graph for a project root. */
export function buildCodeGraph(root: string, options: BuildCodeGraphOptions = {}): CodeGraph {
  const files = collectSourceFiles(root, options);
  const parsed: CodeFile[] = [];
  const allSymbols: CodeSymbol[] = [];
  const importEdges: ImportEdge[] = [];
  const callEdges: CallEdge[] = [];
  const languageCounts: Record<string, number> = {};

  for (const full of files) {
    const content = fs.readFileSync(full, 'utf8');
    const file = parseCodeFile(full, content);
    // Rebase paths relative to root with forward slashes.
    const rel = path.relative(root, full).split(path.sep).join('/');
    const symbols = file.symbols.map((s) => ({ ...s, file: rel }));
    const imports = file.imports.map((i) => ({ ...i, from: rel }));
    const calls = collectCallEdges(content, attachSnippets(content, file.symbols.map((s) => ({ name: s.name, kind: s.kind, line: s.line }))), rel);

    parsed.push({ path: rel, language: file.language, symbols, imports });
    allSymbols.push(...symbols);
    importEdges.push(...imports);
    callEdges.push(...calls);
    languageCounts[file.language] = (languageCounts[file.language] ?? 0) + 1;
  }

  return {
    root,
    files: parsed,
    symbols: allSymbols,
    edges: { imports: importEdges, calls: callEdges },
    stats: {
      files: parsed.length,
      symbols: allSymbols.length,
      importEdges: importEdges.length,
      callEdges: callEdges.length,
      languages: languageCounts,
    },
  };
}

export interface QueryResult {
  symbol: CodeSymbol;
  /** Relevance score (higher = more relevant). */
  score: number;
}

/**
 * Ranks symbols by relevance to a task description — for context injection.
 * Name matches weigh most, then file path, then signature/snippet matches.
 */
export function queryCodeGraph(graph: CodeGraph, query: string, options: { top?: number } = {}): QueryResult[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1);
  const scored: QueryResult[] = [];

  for (const symbol of graph.symbols) {
    const name = symbol.name.toLowerCase();
    const file = symbol.file.toLowerCase();
    const haystack = `${symbol.signature} ${symbol.snippet}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (name.includes(token)) score += 4;
      if (name === token) score += 2;
      if (file.includes(token)) score += 2;
      const occurrences = haystack.split(token).length - 1;
      score += Math.min(occurrences, 5);
    }
    if (score > 0) scored.push({ symbol, score });
  }

  scored.sort((a, b) => b.score - a.score || a.symbol.file.localeCompare(b.symbol.file) || a.symbol.line - b.symbol.line);
  return scored.slice(0, options.top ?? 10);
}
