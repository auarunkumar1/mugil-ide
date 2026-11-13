import { generateQrMatrix, generateQrSvg, generateQrAnsi } from '../src/server/qr.js';

describe('QR Code Generator (Pure TypeScript)', () => {
  it('encodes alphanumeric strings into valid square boolean matrices', () => {
    const matrix = generateQrMatrix('http://localhost:3000/?token=abc123xyz');
    expect(Array.isArray(matrix)).toBe(true);
    expect(matrix.length).toBeGreaterThan(20);
    // Matrix must be perfectly square
    expect(matrix[0].length).toBe(matrix.length);
    // Finder patterns: top-left corner must be dark
    expect(matrix[0][0]).toBe(true);
    expect(matrix[6][0]).toBe(true);
    expect(matrix[0][6]).toBe(true);
  });

  it('generates well-formed SVG with width, height, and viewBox', () => {
    const svg = generateQrSvg('http://192.168.1.100:54321/?token=secret123', { size: 240 });
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="240"');
    expect(svg).toContain('height="240"');
    expect(svg).toContain('viewBox=');
    expect(svg).toContain('<rect');
    expect(svg).toContain('</svg>');
  });

  it('generates non-empty ANSI string with half-block characters for terminal rendering', () => {
    const ansi = generateQrAnsi('http://192.168.1.100:54321/?token=secret123');
    expect(typeof ansi).toBe('string');
    expect(ansi.length).toBeGreaterThan(50);
    expect(ansi).toMatch(/[▀▄█ ]/);
  });
});
