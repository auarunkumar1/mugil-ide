import {
  inputSavingsPercent,
  defaultSavingsBreakdown,
  sumSavingsBreakdowns,
  optimisticSavingsTotal,
  optimisticSavingsPercent,
  calculateSessionEfficiency,
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
  it('initializes default zeroed savings breakdown across 6 levels', () => {
    const bd = defaultSavingsBreakdown();
    expect(bd).toEqual({
      caveman: 0,
      yagni: 0,
      cache: 0,
      mcp: 0,
      toolPruning: 0,
      hybridRecon: 0,
    });
  });

  it('sums two savings breakdowns correctly', () => {
    const a = { caveman: 10, yagni: 50, cache: 100, mcp: 20, toolPruning: 300, hybridRecon: 500 };
    const b = { caveman: 5, yagni: 25, cache: 0, mcp: 10, toolPruning: 150, hybridRecon: 250 };
    const sum = sumSavingsBreakdowns(a, b);
    expect(sum).toEqual({
      caveman: 15,
      yagni: 75,
      cache: 100,
      mcp: 30,
      toolPruning: 450,
      hybridRecon: 750,
    });
  });

  it('computes optimistic total savings including toolPruning and hybridRecon', () => {
    const bd = {
      caveman: 50,
      yagni: 1000,
      cache: 500,
      mcp: 200,
      toolPruning: 3500,
      hybridRecon: 15000,
    };
    expect(optimisticSavingsTotal(bd, 200)).toBe(20250);
    // If baseSaved is somehow higher, it respects baseSaved
    expect(optimisticSavingsTotal({ caveman: 10 }, 500)).toBe(500);
  });

  it('computes optimistic savings percentage against compressible tokens', () => {
    // 1750 saved, 250 kept -> 1750 / (1750 + 250) = 87.5% -> 88%
    expect(optimisticSavingsPercent(1750, 250)).toBe(88);
    expect(optimisticSavingsPercent(0, 500)).toBe(0);
    expect(optimisticSavingsPercent(500, 0)).toBe(100);
  });

  it('calculates normalized session efficiency accurately and bounds to 0-100%', () => {
    // 500 direct + 1500 avoided vs 200 billed: 2000 / (2000 + 200) = 90.9% -> 91%
    expect(calculateSessionEfficiency(500, 1500, 200)).toBe(91);
    // Pure 0-bill run: 100%
    expect(calculateSessionEfficiency(1000, 0, 0)).toBe(100);
    // Zero activity: 0%
    expect(calculateSessionEfficiency(0, 0, 0)).toBe(0);
    // Negative numbers handled cleanly
    expect(calculateSessionEfficiency(-10, -5, 100)).toBe(0);
  });
});
