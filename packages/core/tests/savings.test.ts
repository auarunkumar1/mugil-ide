import { inputSavingsPercent } from '../src/savings.js';

describe('inputSavingsPercent', () => {
  it('measures saved tokens against compressible input, not the whole prompt', () => {
    // 5 tokens removed out of 25 compressible tokens is 20%, even though the
    // provider reported 24 500 prompt tokens.
    expect(inputSavingsPercent(5, 20)).toBe(20);
    expect(inputSavingsPercent(10, 0)).toBe(100);
    expect(inputSavingsPercent(0, 30)).toBe(0);
  });

  it('matches the Caveman-only case that used to read 0%', () => {
    // 14 input tokens -> 9 after caveman.
    expect(inputSavingsPercent(5, 9)).toBe(36);
  });

  it('never returns NaN or a negative percentage', () => {
    expect(inputSavingsPercent(0, 0)).toBe(0);
    expect(inputSavingsPercent(-5, 10)).toBe(0);
    expect(inputSavingsPercent(Number.NaN, 10)).toBe(0);
  });
});
