import { findSymbolInContent } from '../src/modules/tools/symbolReader.js';

describe('symbolReader', () => {
  it('extracts a TypeScript function definition with correct line bounds', () => {
    const code = `
import { foo } from './foo';

export function add(a: number, b: number): number {
  const sum = a + b;
  return sum;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
`;

    const found = findSymbolInContent(code, 'add', 'math.ts');
    expect(found).not.toBeNull();
    expect(found?.startLine).toBe(4);
    expect(found?.endLine).toBe(7);
    expect(found?.snippet).toContain('4: export function add');
    expect(found?.snippet).toContain('7: }');
  });

  it('extracts a TypeScript interface or class definition', () => {
    const code = `
export interface UserConfig {
  name: string;
  age: number;
}

export class Greeter {
  greet(name: string) {
    return 'Hello ' + name;
  }
}
`;

    const iface = findSymbolInContent(code, 'UserConfig', 'config.ts');
    expect(iface).not.toBeNull();
    expect(iface?.startLine).toBe(2);
    expect(iface?.endLine).toBe(5);

    const cls = findSymbolInContent(code, 'Greeter', 'config.ts');
    expect(cls).not.toBeNull();
    expect(cls?.startLine).toBe(7);
    expect(cls?.endLine).toBe(11);
  });

  it('extracts a Python function using indentation', () => {
    const pyCode = `
import os

def calculate_total(items):
    total = 0
    for item in items:
        total += item.price
    return total

def print_receipt():
    pass
`;

    const found = findSymbolInContent(pyCode, 'calculate_total', 'shop.py');
    expect(found).not.toBeNull();
    expect(found?.startLine).toBe(4);
    expect(found?.endLine).toBe(8);
    expect(found?.snippet).toContain('4: def calculate_total(items):');
    expect(found?.snippet).toContain('8:     return total');
  });

  it('returns null when the symbol is not present', () => {
    const code = `export const x = 1;`;
    expect(findSymbolInContent(code, 'nonExistent', 'x.ts')).toBeNull();
  });
});
