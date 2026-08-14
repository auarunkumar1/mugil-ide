import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateDocs, globToRegex, matchesAny, parseFile, watchDocs } from '../src/index.js';

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiide-docs-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'sample-project', description: 'A sample for docs testing' }),
  );
  fs.writeFileSync(
    path.join(root, 'src', 'math.ts'),
    `/**
 * Adds two numbers together.
 * @param a first number
 * @param b second number
 */
export function add(a: number, b: number): number {
  return a + b;
}

/** A point in 2D space. */
export interface Point {
  x: number;
  y: number;
}

export const VERSION = '1.0.0';
`,
  );
  fs.writeFileSync(
    path.join(root, 'src', 'greeter.ts'),
    `export class Greeter {
  greeting: string;
  constructor(greeting: string) {
    this.greeting = greeting;
  }
}

/** Says hello. */
export function greet(name: string): string {
  return 'Hello ' + name;
}
`,
  );
  fs.writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), 'module.exports = 42;\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# readme\n');
  return root;
}

describe('glob matcher', () => {
  it('matches **/*.ts across directories', () => {
    const re = globToRegex('**/*.ts');
    expect(re.test('a.ts')).toBe(true);
    expect(re.test('src/a/b.ts')).toBe(true);
    expect(re.test('a.js')).toBe(false);
  });

  it('supports {a,b} alternatives and ? wildcards', () => {
    expect(globToRegex('src/*.{ts,js}').test('src/x.ts')).toBe(true);
    expect(globToRegex('src/*.{ts,js}').test('src/x.js')).toBe(true);
    expect(globToRegex('src/*.{ts,js}').test('src/x.py')).toBe(false);
    expect(globToRegex('file?.txt').test('file1.txt')).toBe(true);
  });

  it('matchesAny returns true when any glob matches', () => {
    expect(matchesAny('a/b.ts', [globToRegex('**/*.ts')])).toBe(true);
    expect(matchesAny('a/b.js', [globToRegex('**/*.ts')])).toBe(false);
  });
});

describe('parseFile', () => {
  it('extracts exported symbols with doc comments', () => {
    const source = `/** Adds numbers. */
export function add(a: number, b: number): number { return a + b; }

export class Foo {}

export type Bar = string;
`;
    const parsed = parseFile('x.ts', source);
    const names = parsed.symbols.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['add', 'Foo', 'Bar']));
    const add = parsed.symbols.find((s) => s.name === 'add');
    expect(add?.docs).toContain('Adds numbers');
    expect(add?.signature).toContain('function add(a: number, b: number)');
  });

  it('detects python defs and classes', () => {
    const source = `def helper(x):
    return x


def public_api(a, b=1):
    return a + b


class Thing:
    pass
`;
    const parsed = parseFile('mod.py', source);
    expect(parsed.language).toBe('python');
    expect(parsed.symbols.map((s) => s.name)).toContain('public_api');
    expect(parsed.symbols.map((s) => s.name)).toContain('Thing');
  });
});

describe('generateDocs', () => {
  let root: string;

  beforeEach(() => {
    root = makeProject();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes a markdown doc with the project name, tree and symbols', async () => {
    const result = await generateDocs({ root });
    expect(fs.existsSync(result.output)).toBe(true);
    const doc = fs.readFileSync(result.output, 'utf8');
    expect(doc).toContain('# sample-project — Documentation');
    expect(doc).toContain('Adds two numbers together');
    expect(doc).toContain('function add(a: number, b: number)');
    expect(doc).toContain('class Greeter');
    expect(doc).toContain('src/math.ts');
    expect(result.filesScanned).toBeGreaterThan(0);
    expect(result.symbols).toBeGreaterThanOrEqual(4);
    expect(result.tokens).toBeGreaterThan(0);
  });

  it('skips ignored directories like node_modules', async () => {
    const result = await generateDocs({ root });
    const doc = fs.readFileSync(result.output, 'utf8');
    expect(doc).not.toContain('node_modules');
  });

  it('respects include globs', async () => {
    const result = await generateDocs({ root, globs: ['src/**/*.ts'] });
    const doc = fs.readFileSync(result.output, 'utf8');
    expect(doc).toContain('src/math.ts');
    expect(doc).not.toContain('README.md');
  });

  it('writes to a custom output path', async () => {
    const output = path.join(root, 'docs', 'API.md');
    const result = await generateDocs({ root, output });
    expect(result.output).toBe(output);
    expect(fs.existsSync(output)).toBe(true);
  });
});

describe('watchDocs', () => {
  it('regenerates periodically', async () => {
    const root = makeProject();
    const calls: Array<{ files: number }> = [];
    const watched = watchDocs({
      root,
      intervalSeconds: 0.05,
      onGenerated: (result) => calls.push({ files: result.filesScanned }),
    });
    const deadline = Date.now() + 1500;
    while (calls.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    watched.stop();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
