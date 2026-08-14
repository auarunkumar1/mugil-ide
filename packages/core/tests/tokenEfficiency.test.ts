import { cavemanStrategy } from '../src/modules/caveman/index.js';
import { compressCommandOutput, rtkStrategy } from '../src/modules/rtk/index.js';
import { ponytailInstruction, ponytailOutputBudget } from '../src/modules/ponytail/index.js';
import { refinePrompt, truncateToBudget } from '../src/refine.js';
import { countTokens } from '../src/token/tokenizer.js';

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
