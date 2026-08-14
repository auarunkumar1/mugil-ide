import { countTokens, getTokenizer } from '../src/token/tokenizer.js';

describe('tokenizer', () => {
  it('counts tokens and is deterministic', () => {
    const text = 'Write a function that sorts an array of numbers.';
    const a = countTokens(text);
    const b = countTokens(text);
    expect(a).toBeGreaterThan(0);
    expect(a).toBe(b);
  });

  it('counts zero for empty input', () => {
    expect(countTokens('')).toBe(0);
  });

  it('returns a tokenizer with a name', () => {
    const tok = getTokenizer();
    expect(tok.name.length).toBeGreaterThan(0);
  });

  it('longer text never yields fewer tokens than short text', () => {
    const short = countTokens('hello');
    const long = countTokens('hello '.repeat(200));
    expect(long).toBeGreaterThan(short);
  });

  it('encode/decode round trips to a string', () => {
    const tok = getTokenizer();
    const tokens = tok.encode('test input text');
    expect(Array.isArray(tokens)).toBe(true);
    expect(typeof tok.decode(tokens)).toBe('string');
  });
});
