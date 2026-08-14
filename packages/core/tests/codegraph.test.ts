import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildCodeGraph,
  languageFor,
  parseCodeFile,
  queryCodeGraph,
} from '../src/modules/codegraph/index.js';

function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-graph-'));
  fs.mkdirSync(path.join(dir, 'src', 'node_modules'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'a.ts'),
    ['export function helper() { return 1; }', 'export function main() { return helper(); }'].join(
      '\n',
    ),
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'b.ts'),
    "import { main } from './a';\nexport const entry = () => main;\n",
  );
  fs.writeFileSync(path.join(dir, 'src', 'node_modules', 'skip.ts'), 'export const skip = 1;\n');
  return dir;
}

describe('languageFor', () => {
  it('maps extensions to languages', () => {
    expect(languageFor('a.ts')).toBe('typescript');
    expect(languageFor('a.py')).toBe('python');
    expect(languageFor('a.go')).toBe('go');
    expect(languageFor('a.rs')).toBe('rust');
    expect(languageFor('a.txt')).toBeUndefined();
  });
});

describe('parseCodeFile', () => {
  it('extracts exported symbols and imports from TypeScript', () => {
    const content = [
      "import { z } from 'zod';",
      "import { Client } from '@modelcontextprotocol/sdk';",
      '',
      '/** Docs. */',
      'export function buildGraph(root: string) {',
      '  return root;',
      '}',
      '',
      'export class GraphBuilder {',
      '  build() {}',
      '}',
      '',
      'export const helper = () => 1;',
      'export interface Options { top?: number }',
      'export type Result = { ok: boolean }',
      'export enum Tier { cheap, smart }',
    ].join('\n');
    const parsed = parseCodeFile('src/graph.ts', content);
    expect(parsed.language).toBe('typescript');
    const names = parsed.symbols.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['buildGraph', 'GraphBuilder', 'helper', 'Options', 'Result', 'Tier']),
    );
    expect(parsed.imports.map((i) => i.to)).toEqual(['zod', '@modelcontextprotocol/sdk']);
    const fn = parsed.symbols.find((s) => s.name === 'buildGraph')!;
    expect(fn.line).toBe(5);
    expect(fn.snippet).toContain('return root');
  });

  it('parses python, go and rust', () => {
    const py = parseCodeFile(
      'mod.py',
      'import os\nfrom collections import Counter\n\ndef main(args):\n    return os.getcwd()\n\nclass Parser:\n    pass\n',
    );
    expect(py.symbols.map((s) => s.name)).toEqual(['main', 'Parser']);
    expect(py.imports.map((i) => i.to)).toEqual(['collections', 'os']);

    const go = parseCodeFile(
      'main.go',
      'package main\n\nimport (\n\t"fmt"\n\t"os"\n)\n\nfunc Main() string {\n\treturn fmt.Sprint("hi")\n}\n\ntype Config struct{}\n',
    );
    expect(go.symbols.map((s) => s.name)).toEqual(['Main', 'Config']);
    expect(go.imports.map((i) => i.to)).toEqual(['fmt', 'os']);

    const rs = parseCodeFile(
      'lib.rs',
      'use std::collections::HashMap;\n\npub fn run() {}\npub struct Node {}\npub enum Kind {}\npub trait Visitor {}\n',
    );
    expect(rs.symbols.map((s) => s.name)).toEqual(['run', 'Node', 'Kind', 'Visitor']);
    expect(rs.imports.map((i) => i.to)).toEqual(['std::collections::HashMap']);
  });
});

describe('buildCodeGraph', () => {
  it('builds stats, import edges and same-file call edges, skipping ignored dirs', () => {
    const dir = fixture();
    const graph = buildCodeGraph(dir);
    expect(graph.stats.files).toBe(2);
    expect(graph.stats.symbols).toBe(3); // helper, main, entry
    expect(graph.edges.imports.some((e) => e.from === 'src/b.ts' && e.to === './a')).toBe(true);
    expect(graph.edges.calls.some((e) => e.from === 'main' && e.to === 'helper')).toBe(true);
    const main = graph.symbols.find((s) => s.name === 'main')!;
    expect(main.file).toBe('src/a.ts');
    expect(main.snippet).toContain('return helper()');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('honors the languages filter and extra ignoreDirs', () => {
    const dir = fixture();
    fs.writeFileSync(path.join(dir, 'src', 'x.py'), 'def pyfn(): pass\n');
    const graph = buildCodeGraph(dir, { languages: ['typescript'], ignoreDirs: ['src'] });
    expect(graph.stats.files).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('queryCodeGraph', () => {
  it('ranks exact name matches above incidental matches', () => {
    const dir = fixture();
    const graph = buildCodeGraph(dir);
    const results = queryCodeGraph(graph, 'helper', { top: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.symbol.name).toBe('helper');
    expect(results[0]!.score).toBeGreaterThan(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('finds symbols by task description with file/line + snippet', () => {
    const dir = fixture();
    const graph = buildCodeGraph(dir);
    const results = queryCodeGraph(graph, 'entry point that imports main', { top: 5 });
    const entry = results.find((r) => r.symbol.name === 'entry');
    expect(entry).toBeDefined();
    expect(entry!.symbol.file).toBe('src/b.ts');
    expect(entry!.symbol.snippet).toContain('export const entry');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
