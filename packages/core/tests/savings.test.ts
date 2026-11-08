import {
  inputSavingsPercent,
  defaultSavingsBreakdown,
  sumSavingsBreakdowns,
  optimisticSavingsTotal,
  optimisticSavingsPercent,
} from '../src/savings.js';

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

describe('multi-level savings and optimistic estimation', () => {
  it('initializes default zeroed savings breakdown across 4 levels', () => {
    const bd = defaultSavingsBreakdown();
    expect(bd).toEqual({ caveman: 0, yagni: 0, cache: 0, mcp: 0 });
  });

  it('sums two savings breakdowns correctly', () => {
    const a = { caveman: 10, yagni: 50, cache: 100, mcp: 20 };
    const b = { caveman: 5, yagni: 25, cache: 0, mcp: 10 };
    const sum = sumSavingsBreakdowns(a, b);
    expect(sum).toEqual({ caveman: 15, yagni: 75, cache: 100, mcp: 30 });
  });

  it('computes optimistic total savings', () => {
    const bd = { caveman: 50, yagni: 1000, cache: 500, mcp: 200 };
    expect(optimisticSavingsTotal(bd, 200)).toBe(1750);
    // If baseSaved is somehow higher, it respects baseSaved
    expect(optimisticSavingsTotal({ caveman: 10 }, 500)).toBe(500);
  });

  it('computes optimistic savings percentage against compressible tokens', () => {
    // 1750 saved, 250 kept -> 1750 / (1750 + 250) = 87.5% -> 88%
    expect(optimisticSavingsPercent(1750, 250)).toBe(88);
    expect(optimisticSavingsPercent(0, 500)).toBe(0);
    expect(optimisticSavingsPercent(500, 0)).toBe(100);
  });
});
