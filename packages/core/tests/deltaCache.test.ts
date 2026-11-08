import { DeltaCache } from '../src/modules/rtk/deltaCache.js';

describe('DeltaCache', () => {
  let cache: DeltaCache;

  beforeEach(() => {
    cache = new DeltaCache();
  });

  it('normalizes command strings ignoring trailing args and multiple spaces', () => {
    expect(cache.normalizeCommand('npm test -- --runInBand')).toBe('npm test');
    expect(cache.normalizeCommand('npm   test  ')).toBe('npm test');
  });

  it('extracts Jest failures with summary and details', () => {
    const output = `
FAIL packages/core/tests/foo.test.ts
  ● FooSuite › should calculate correctly

    expect(received).toBe(expected)

    Expected: 42
    Received: 0

      at Object.<anonymous> (foo.test.ts:15:10)

  ● FooSuite › should throw on invalid input

    Error: expected error was not thrown
      at Object.<anonymous> (foo.test.ts:25:10)

Test Suites: 1 failed, 1 total
Tests: 2 failed, 2 total
`;

    const failures = cache.extractFailures(output);
    expect(failures).toHaveLength(2);
    expect(failures[0]?.id).toBe('FooSuite › should calculate correctly');
    expect(failures[0]?.details).toContain('Expected: 42');
    expect(failures[1]?.id).toBe('FooSuite › should throw on invalid input');
  });

  it('diffs failures between consecutive runs', () => {
    const run1 = `
FAIL packages/core/tests/foo.test.ts
  ● FooSuite › test 1
    Error: fail 1
  ● FooSuite › test 2
    Error: fail 2
`;

    const run2 = `
FAIL packages/core/tests/foo.test.ts
  ● FooSuite › test 2
    Error: fail 2
  ● FooSuite › test 3
    Error: fail 3
`;

    const res1 = cache.apply('npm test', run1);
    expect(res1.changed).toBe(false); // First run doesn't collapse

    const res2 = cache.apply('npm test', run2, { maxUnchangedShown: 0 });
    expect(res2.changed).toBe(true);
    expect(res2.deltaStats?.resolvedCount).toBe(1);
    expect(res2.deltaStats?.newCount).toBe(1);
    expect(res2.deltaStats?.unchangedCount).toBe(1);
    expect(res2.text).toContain('Resolved (1): FooSuite › test 1');
    expect(res2.text).toContain('New failures (1): FooSuite › test 3');
    expect(res2.text).toContain('[unchanged failure stack trace collapsed by Delta Mode]');
  });

  it('notifies when all previous failures are resolved', () => {
    const run1 = `
FAIL packages/core/tests/foo.test.ts
  ● FooSuite › test 1
    Error: fail 1
`;
    const run2 = `
PASS packages/core/tests/foo.test.ts
Test Suites: 1 passed, 1 total
`;

    cache.apply('npm test', run1);
    const res2 = cache.apply('npm test', run2);

    expect(res2.changed).toBe(true);
    expect(res2.deltaStats?.resolvedCount).toBe(1);
    expect(res2.text).toContain('All 1 previous failure(s) successfully resolved!');
  });

  it('does not report resolved failures when the new run is red but unparsed', () => {
    const run1 = `
FAIL packages/core/tests/foo.test.ts
  ● FooSuite › test 1
    Error: fail 1
`;
    cache.apply('npm run build', run1);
    // Toolchain blow-up: nothing for extractFailures to match, but the build
    // is clearly not green.
    const run2 = `error TS5083: Cannot read file 'tsconfig.json'.`;
    const res = cache.apply('npm run build', run2);
    expect(res.changed).toBe(false);
    expect(res.text).not.toContain('successfully resolved');
    // The signature is retained, so a genuinely green run still reports it.
    const res3 = cache.apply('npm run build', 'Build succeeded. 0 errors.');
    expect(res3.changed).toBe(true);
    expect(res3.text).toContain('All 1 previous failure(s) successfully resolved!');
  });
  it('scopes caches per workspace so a folder switch cannot fake a fix', () => {
    const a = new DeltaCache('/project-a');
    const b = new DeltaCache('/project-b');
    a.apply('npm test', 'FAIL x.test.ts\n  ● suite › a\n    Error: boom');
    const crossed = b.apply('npm test', 'Suite passed');
    expect(crossed.changed).toBe(false);
    expect(crossed.text).not.toContain('successfully resolved');
    // add keywords
  });
});
