import * as browser from '../src/browser.js';

describe('browser engine entry', () => {
  it('exposes the pure credited modules', () => {
    expect(typeof browser.cavemanStrategy).toBe('function');
    expect(typeof browser.rtkStrategy).toBe('function');
    expect(typeof browser.compressCommandOutput).toBe('function');
    expect(typeof browser.ponytailInstruction).toBe('function');
    expect(typeof browser.stripSignatures).toBe('function');
    expect(typeof browser.stripCodeSignatures).toBe('function');
  });

  it('refines prompts with the full cascade', () => {
    const result = browser.refinePrompt('In order to fix the bug, please kindly review the code.');
    expect(result.refined).not.toContain('In order to');
    expect(result.appliedStrategies.length).toBeGreaterThan(0);
    expect(result.originalTokens).toBeGreaterThanOrEqual(result.refinedTokens);
  });

  it('counts tokens deterministically', () => {
    const a = browser.countTokens('write a debounce function');
    const b = browser.countTokens('write a debounce function');
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
    // Node uses tiktoken; browsers fall back to the deterministic estimator.
    expect(['estimator', 'tiktoken:cl100k_base']).toContain(browser.getTokenizer().name);
  });

  it('strips signatures and compresses output', () => {
    const stripped = browser.stripSignatures('Human: hello');
    expect(stripped.changed).toBe(true);
    const compressed = browser.compressCommandOutput('ok\nok\nok');
    expect(compressed.text).toContain('[3');
  });

  it('exposes the ponytail instruction ladder', () => {
    expect(browser.ponytailInstruction().length).toBeGreaterThan(50);
  });
});
