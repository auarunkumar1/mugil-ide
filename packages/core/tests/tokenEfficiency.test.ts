import { cavemanStrategy } from '../src/modules/caveman/index.js';
import { compressCommandOutput, rtkStrategy, compressJson } from '../src/modules/rtk/index.js';
import { ponytailInstruction, ponytailOutputBudget } from '../src/modules/ponytail/index.js';
import { refinePrompt, truncateToBudget } from '../src/refine.js';
import { countTokens } from '../src/token/tokenizer.js';
import { BlobStore } from '../src/modules/tools/blobStore.js';

describe('cavemanStrategy', () => {
  it('compresses winded phrasing', () => {
    const input = 'In order to fix the bug, please could you kindly review the code?';
    const { text } = cavemanStrategy(input);
    expect(text).not.toContain('In order to');
    expect(text).not.toContain('please');
    expect(text).not.toContain('kindly');
  });

  it('reports change', () => {
    const result = cavemanStrategy('Please review the code.');
    expect(result.changed).toBe(true);
  });

  it('leaves already-terse text untouched', () => {
    const result = cavemanStrategy('Fix the bug now.');
    expect(result.changed).toBe(false);
  });

  it('never rewrites code inside a fenced block', () => {
    const code = ['```ts', '// in order to fix this, please review', 'const kind = "really";', '```'].join('\n');
    const prompt = `Please review this.\n\n${code}\n`;
    const { text } = cavemanStrategy(prompt);
    // The prose around the block is compressed...
    expect(text).not.toContain('Please review this.');
    // ...but the code comes back byte-identical.
    expect(text).toContain('// in order to fix this, please review');
    expect(text).toContain('const kind = "really";');
  });

  it('never rewrites inline code spans', () => {
    const { text } = cavemanStrategy('Set `in order to please` in the config.');
    expect(text).toContain('`in order to please`');
  });
});

describe('rtkStrategy structure preservation', () => {
  it('keeps newlines, lists and diffs intact', () => {
    const prompt = [
      'Fix the failing test.',
      '',
      '- first item',
      '- second item',
      '',
      '```diff',
      '- old line',
      '+ new line',
      '```',
    ].join('\n');
    const { text } = rtkStrategy(prompt);
    expect(text).toContain('- first item\n- second item');
    expect(text).toContain('```diff\n- old line\n+ new line\n```');
  });

  it('still de-duplicates repeated prose lines', () => {
    const { text } = rtkStrategy('Run the tests.\nRun the tests.\nShip it.');
    expect(text.match(/run the tests/gi)?.length).toBe(1);
    expect(text).toContain('Ship it.');
  });

  it('still strips boilerplate closers', () => {
    const { text } = rtkStrategy('Write a binary search. Let me know if you have any questions!');
    expect(text).toContain('binary search');
    expect(text).not.toMatch(/let me know/i);
  });
});

describe('rtkStrategy', () => {
  it('strips boilerplate closers', () => {
    const { text, removed } = rtkStrategy(
      'Write a binary search. Let me know if you have any questions!',
    );
    expect(text).toContain('binary search');
    expect(text).not.toMatch(/let me know/i);
    expect(removed?.length).toBeGreaterThan(0);
  });

  it('de-duplicates repeated sentences', () => {
    const { text } = rtkStrategy('Refactor the parser. Refactor the parser. Refactor the parser.');
    expect(text.match(/refactor the parser/gi)?.length).toBe(1);
  });
});

describe('compressCommandOutput', () => {
  it('collapses repeated lines into a counted line', () => {
    const output = ['ok', 'ok', 'ok', 'done'].join('\n');
    const { text } = compressCommandOutput(output);
    expect(text).toContain('3×');
    expect(text.match(/^ok\s+\[/m)).not.toBeNull();
    expect(text).toContain('done');
  });

  it('truncates long lines with a marker', () => {
    const long = 'x'.repeat(500);
    const { text } = compressCommandOutput(long, { maxLineLength: 50 });
    expect(text).toContain('+450 chars');
    expect(text.length).toBeLessThan(100);
  });

  it('collapses blank-line noise', () => {
    const { text } = compressCommandOutput('a\n\n\n\n\nb');
    expect(text).not.toContain('\n\n');
  });

  it('leaves short clean output untouched', () => {
    const output = 'all tests passed\nbuild ok';
    const { text, changed } = compressCommandOutput(output);
    expect(changed).toBe(false);
    expect(text).toBe(output);
  });

  it('compresses git diff context to 1 line and strips index hashes', () => {
    const diff = [
      'diff --git a/foo.ts b/foo.ts',
      'index 1234567..89abcdef 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -10,7 +10,7 @@',
      ' context line 1',
      ' context line 2',
      ' context line 3',
      '-const oldVal = 1;',
      '+const newVal = 2;',
      ' context line 4',
      ' context line 5',
      ' context line 6',
    ].join('\n');
    const { text } = compressCommandOutput(diff, { command: 'git diff' });
    expect(text).not.toContain('index 1234567..89abcdef');
    expect(text).toContain('+const newVal = 2;');
    expect(text).toContain(' context line 3');
    expect(text).toContain(' context line 4');
    // Multiline context collapsed
    expect(text.split('\n').length).toBeLessThan(diff.split('\n').length);
  });

  it('filters passing test noise when test failures exist', () => {
    const testLog = [
      'PASS tests/a.test.ts',
      'PASS tests/b.test.ts',
      'FAIL tests/c.test.ts',
      '  ✕ should validate correctly',
      '    AssertionError: expected true to be false',
    ].join('\n');
    const { text } = compressCommandOutput(testLog);
    expect(text).not.toContain('PASS tests/a.test.ts');
    expect(text).not.toContain('PASS tests/b.test.ts');
    expect(text).toContain('FAIL tests/c.test.ts');
    expect(text).toContain('AssertionError: expected true to be false');
  });
});

describe('truncateToBudget', () => {
  it('truncates when over budget and marks it', () => {
    const input = 'Sentence one. '.repeat(80);
    const budget = countTokens(input) / 2;
    const { text, changed } = truncateToBudget(input, budget);
    expect(changed).toBe(true);
    expect(countTokens(text)).toBeLessThanOrEqual(budget + 20);
    expect(text).toContain('truncated');
  });

  it('does nothing when within budget', () => {
    const input = 'Short prompt.';
    const { changed } = truncateToBudget(input, 1000);
    expect(changed).toBe(false);
  });
});

describe('refinePrompt', () => {
  it('reduces tokens and reports savings', () => {
    const verbose =
      'Hi there! In order to get this working, please could you kindly write a function ' +
      'that sorts a list of numbers using quicksort. Thank you in advance for your help!';
    const result = refinePrompt(verbose);
    expect(result.refinedTokens).toBeLessThanOrEqual(result.originalTokens);
    expect(result.savingsPct).toBeGreaterThanOrEqual(0);
    expect(result.appliedStrategies.length).toBeGreaterThan(0);
    expect(result.original).toBe(verbose);
  });

  it('applies truncate last to enforce budget', () => {
    // Distinct sentences so earlier strategies cannot collapse them.
    const long = Array.from(
      { length: 500 },
      (_, i) => `Sentence number ${i} about the topic at hand.`,
    ).join(' ');
    const result = refinePrompt(long, { budgetTokens: 50 });
    expect(result.refinedTokens).toBeLessThanOrEqual(60);
    expect(result.appliedStrategies).toContain('truncate');
    // The caller must be able to tell the user their input was cut.
    expect(result.truncated).toBe(true);
    expect(result.truncatedTokens).toBeGreaterThan(0);
  });

  it('reports no truncation when the prompt fits the budget', () => {
    const result = refinePrompt('Please fix the bug.', { budgetTokens: 10_000 });
    expect(result.truncated).toBe(false);
    expect(result.truncatedTokens).toBe(0);
  });

  it('can run a single strategy', () => {
    const result = refinePrompt('Please fix the bug. In order to test, run npm test.', {
      strategies: ['caveman'],
    });
    expect(result.appliedStrategies).toEqual(['caveman']);
  });
});

describe('ponytail module', () => {
  it('produces an instruction with the lazy-senior-dev ladder', () => {
    const instruction = ponytailInstruction();
    expect(instruction).toContain('smallest amount of code');
    expect(instruction).toContain('YAGNI');
    expect(instruction).toContain('standard library');
    expect(instruction).toContain('Never cut validation');
  });

  it('resolves an output budget when configured', () => {
    expect(ponytailOutputBudget({ outputBudget: 512 })).toBe(512);
    expect(ponytailOutputBudget()).toBeUndefined();
  });
});

describe('JSON SmartCrusher (compressJson)', () => {
  it('converts uniform object arrays to tabular format', () => {
    const raw = JSON.stringify([
      { id: 1, name: 'Alice', active: true },
      { id: 2, name: 'Bob', active: false },
    ], null, 2);
    const out = compressJson(raw);
    expect(out).toContain('[Table: 2 rows | cols: id, name, active]');
    expect(out).toContain('Alice');
    expect(out).toContain('Bob');
  });

  it('strips null and empty properties', () => {
    const raw = JSON.stringify({ a: 1, b: null, c: undefined, d: '' });
    const out = compressJson(raw);
    expect(out).toBe('{"a":1}');
  });
});

describe('CCR BlobStore', () => {
  it('stores and retrieves slices from blobs', () => {
    const store = new BlobStore(5);
    const longText = 'Hello World '.repeat(500);
    const id = store.put(longText);

    expect(id).toMatch(/^blob_/);
    const chunk = store.readChunk(id, 0, 50);
    expect(chunk?.text).toBe(longText.slice(0, 50));
    expect(chunk?.hasMore).toBe(true);
    expect(store.get(id)?.size).toBe(longText.length);
  });
});

