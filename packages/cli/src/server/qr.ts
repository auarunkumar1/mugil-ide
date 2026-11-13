/**
 * Pure TypeScript QR Code Generator (Model 2, Byte Mode, Error Correction Level M/L)
 * Zero external dependencies. Generates both SVG strings for browser rendering
 * and Unicode half-block ANSI strings for terminal rendering.
 */

// QR Code Version Specs: [version, totalCodewords, ecCodewordsPerBlock, numBlocksGroup1, numCodewordsGroup1, numBlocksGroup2, numCodewordsGroup2]
// For Error Correction Level M
interface VersionSpec {
  version: number;
  size: number;
  totalDataBytes: number;
  ecBytesPerBlock: number;
  group1Blocks: number;
  group1DataBytes: number;
  group2Blocks: number;
  group2DataBytes: number;
  alignmentPatterns: number[];
}

const VERSION_SPECS_M: VersionSpec[] = [
  { version: 1, size: 21, totalDataBytes: 16, ecBytesPerBlock: 10, group1Blocks: 1, group1DataBytes: 16, group2Blocks: 0, group2DataBytes: 0, alignmentPatterns: [] },
  { version: 2, size: 25, totalDataBytes: 28, ecBytesPerBlock: 16, group1Blocks: 1, group1DataBytes: 28, group2Blocks: 0, group2DataBytes: 0, alignmentPatterns: [6, 18] },
  { version: 3, size: 29, totalDataBytes: 44, ecBytesPerBlock: 26, group1Blocks: 1, group1DataBytes: 44, group2Blocks: 0, group2DataBytes: 0, alignmentPatterns: [6, 22] },
  { version: 4, size: 33, totalDataBytes: 64, ecBytesPerBlock: 18, group1Blocks: 2, group1DataBytes: 32, group2Blocks: 0, group2DataBytes: 0, alignmentPatterns: [6, 26] },
  { version: 5, size: 37, totalDataBytes: 86, ecBytesPerBlock: 24, group1Blocks: 2, group1DataBytes: 43, group2Blocks: 0, group2DataBytes: 0, alignmentPatterns: [6, 30] },
  { version: 6, size: 41, totalDataBytes: 108, ecBytesPerBlock: 16, group1Blocks: 4, group1DataBytes: 27, group2Blocks: 0, group2DataBytes: 0, alignmentPatterns: [6, 34] },
  { version: 7, size: 45, totalDataBytes: 124, ecBytesPerBlock: 18, group1Blocks: 4, group1DataBytes: 31, group2Blocks: 0, group2DataBytes: 0, alignmentPatterns: [6, 22, 38] },
  { version: 8, size: 49, totalDataBytes: 154, ecBytesPerBlock: 22, group1Blocks: 2, group1DataBytes: 38, group2Blocks: 2, group2DataBytes: 39, alignmentPatterns: [6, 24, 42] },
  { version: 9, size: 53, totalDataBytes: 182, ecBytesPerBlock: 22, group1Blocks: 3, group1DataBytes: 36, group2Blocks: 2, group2DataBytes: 37, alignmentPatterns: [6, 26, 46] },
  { version: 10, size: 57, totalDataBytes: 216, ecBytesPerBlock: 26, group1Blocks: 4, group1DataBytes: 40, group2Blocks: 1, group2DataBytes: 41, alignmentPatterns: [6, 28, 50] },
];

// Galois Field GF(256) tables with primitive polynomial 0x11d (285)
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    EXP_TABLE[i + 255] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
})();

function gfMultiply(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
}

function calculateReedSolomon(data: Uint8Array, ecLength: number): Uint8Array {
  // Generator polynomial
  let genPoly = new Uint8Array([1]);
  for (let i = 0; i < ecLength; i++) {
    const nextPoly = new Uint8Array(genPoly.length + 1);
    const factor = EXP_TABLE[i];
    for (let j = 0; j < genPoly.length; j++) {
      nextPoly[j] ^= gfMultiply(genPoly[j], factor);
      nextPoly[j + 1] ^= genPoly[j];
    }
    genPoly = nextPoly;
  }

  const remainder = new Uint8Array(ecLength);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    for (let j = 0; j < ecLength - 1; j++) {
      remainder[j] = remainder[j + 1] ^ gfMultiply(genPoly[ecLength - 1 - j], factor);
    }
    remainder[ecLength - 1] = gfMultiply(genPoly[0], factor);
  }
  return remainder;
}

export interface QrOptions {
  size?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
}

/**
 * Encodes text into a boolean 2D matrix (true = dark, false = light).
 */
export function generateQrMatrix(text: string): boolean[][] {
  const textBytes = Buffer.from(text, 'utf-8');

  // Choose the smallest version that can accommodate textBytes.length + 3 overhead bytes
  const spec = VERSION_SPECS_M.find((s) => s.totalDataBytes >= textBytes.length + 3);
  if (!spec) {
    throw new Error(`Data too long for compact QR generator (${textBytes.length} bytes; max 213)`);
  }

  // 1. Data Bitstream Encoding: Mode Indicator (Byte mode = 0100) + Character Count Indicator + Data Bytes
  const bitStream: number[] = [];
  function pushBits(val: number, len: number) {
    for (let i = len - 1; i >= 0; i--) {
      bitStream.push((val >>> i) & 1);
    }
  }

  // Byte mode indicator: 0100
  pushBits(0b0100, 4);
  // Character count indicator (8 bits for versions 1-9 in byte mode, 16 bits for v10)
  pushBits(textBytes.length, spec.version <= 9 ? 8 : 16);
  // Data bytes
  for (let i = 0; i < textBytes.length; i++) {
    pushBits(textBytes[i], 8);
  }
  // Terminator: up to 4 zero bits
  const capacityBits = spec.totalDataBytes * 8;
  const terminatorLength = Math.min(4, capacityBits - bitStream.length);
  pushBits(0, terminatorLength);
  // Pad to byte boundary
  while (bitStream.length % 8 !== 0) {
    bitStream.push(0);
  }
  // Pad bytes: 0xEC, 0x11 alternating
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bitStream.length < capacityBits) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  // Convert bitstream to data codewords
  const dataCodewords = new Uint8Array(spec.totalDataBytes);
  for (let i = 0; i < spec.totalDataBytes; i++) {
    let byteVal = 0;
    for (let b = 0; b < 8; b++) {
      byteVal = (byteVal << 1) | bitStream[i * 8 + b];
    }
    dataCodewords[i] = byteVal;
  }

  // 2. Block division and Reed-Solomon generation
  const blocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;

  for (let g = 0; g < spec.group1Blocks; g++) {
    const slice = dataCodewords.slice(offset, offset + spec.group1DataBytes);
    blocks.push(slice);
    ecBlocks.push(calculateReedSolomon(slice, spec.ecBytesPerBlock));
    offset += spec.group1DataBytes;
  }
  for (let g = 0; g < spec.group2Blocks; g++) {
    const slice = dataCodewords.slice(offset, offset + spec.group2DataBytes);
    blocks.push(slice);
    ecBlocks.push(calculateReedSolomon(slice, spec.ecBytesPerBlock));
    offset += spec.group2DataBytes;
  }

  // Interleave data codewords
  const finalCodewords: number[] = [];
  const maxDataLen = Math.max(spec.group1DataBytes, spec.group2DataBytes || 0);
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < blocks.length; b++) {
      if (i < blocks[b].length) {
        finalCodewords.push(blocks[b][i]);
      }
    }
  }
  // Interleave EC codewords
  for (let i = 0; i < spec.ecBytesPerBlock; i++) {
    for (let b = 0; b < ecBlocks.length; b++) {
      finalCodewords.push(ecBlocks[b][i]);
    }
  }

  // 3. Construct Matrix
  const N = spec.size;
  const matrix: (boolean | null)[][] = Array.from({ length: N }, () => Array(N).fill(null));
  const isFunction: boolean[][] = Array.from({ length: N }, () => Array(N).fill(false));

  function setModule(r: number, c: number, val: boolean) {
    matrix[r][c] = val;
    isFunction[r][c] = true;
  }

  // Finder Patterns (7x7) + Separators
  function addFinderPattern(startR: number, startC: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = startR + r;
        const nc = startC + c;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          const isDark = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          setModule(nr, nc, isDark);
        } else {
          setModule(nr, nc, false);
        }
      }
    }
  }
  addFinderPattern(0, 0);
  addFinderPattern(0, N - 7);
  addFinderPattern(N - 7, 0);

  // Alignment Patterns (for v >= 2)
  const coords = spec.alignmentPatterns;
  for (const r of coords) {
    for (const c of coords) {
      if (matrix[r][c] !== null) continue; // Skip finders
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const isDark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setModule(r + dr, c + dc, isDark);
        }
      }
    }
  }

  // Timing Patterns
  for (let i = 8; i < N - 8; i++) {
    if (matrix[6][i] === null) setModule(6, i, i % 2 === 0);
    if (matrix[i][6] === null) setModule(i, 6, i % 2 === 0);
  }

  // Dark module
  setModule(4 * spec.version + 9, 8, true);

  // Reserve Format Info Area
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === null) isFunction[8][i] = true;
    if (matrix[i][8] === null) isFunction[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    if (matrix[8][N - 1 - i] === null) isFunction[8][N - 1 - i] = true;
    if (matrix[N - 1 - i][8] === null) isFunction[N - 1 - i][8] = true;
  }

  // 4. Place Data Bits
  const dataBits: number[] = [];
  for (const byte of finalCodewords) {
    for (let b = 7; b >= 0; b--) {
      dataBits.push((byte >>> b) & 1);
    }
  }

  let bitIdx = 0;
  let dirUp = true;
  for (let right = N - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing column
    const rows = dirUp
      ? Array.from({ length: N }, (_, i) => N - 1 - i)
      : Array.from({ length: N }, (_, i) => i);

    for (const r of rows) {
      for (const c of [right, right - 1]) {
        if (!isFunction[r][c]) {
          const bit = bitIdx < dataBits.length ? dataBits[bitIdx++] : 0;
          matrix[r][c] = bit === 1;
        }
      }
    }
    dirUp = !dirUp;
  }

  // 5. Mask Pattern 0: (row + col) % 2 === 0
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!isFunction[r][c]) {
        if ((r + c) % 2 === 0) {
          matrix[r][c] = !matrix[r][c];
        }
      }
    }
  }

  // Format String: Level M (00) + Mask 0 (000) = 00000 -> 0x0000 -> BCH code: 0x4a17 ^ mask 0x5412 = 0x1e05
  // Format info bits for Level M, Mask 0: 0x1e05 (binary 001111000000101)
  const formatBits = [0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1];
  for (let i = 0; i < 6; i++) matrix[8][i] = formatBits[i] === 1;
  matrix[8][7] = formatBits[6] === 1;
  matrix[8][8] = formatBits[7] === 1;
  matrix[7][8] = formatBits[8] === 1;
  for (let i = 9; i < 15; i++) matrix[14 - i][8] = formatBits[i] === 1;

  for (let i = 0; i < 7; i++) matrix[N - 1 - i][8] = formatBits[i] === 1;
  for (let i = 7; i < 15; i++) matrix[8][N - 15 + i] = formatBits[i] === 1;

  return matrix.map((row) => row.map((cell) => cell === true));
}

/**
 * Generates an SVG string representation of a QR code.
 */
export function generateQrSvg(text: string, options: QrOptions = {}): string {
  const matrix = generateQrMatrix(text);
  const N = matrix.length;
  const margin = options.margin ?? 4;
  const size = options.size ?? 256;
  const darkColor = options.darkColor ?? '#000000';
  const lightColor = options.lightColor ?? '#ffffff';

  const totalModules = N + margin * 2;
  const rects: string[] = [];

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (matrix[r][c]) {
        rects.push(`<rect x="${c + margin}" y="${r + margin}" width="1" height="1" fill="${darkColor}"/>`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalModules} ${totalModules}" width="${size}" height="${size}" shape-rendering="crispEdges">
  <rect width="100%" height="100%" fill="${lightColor}"/>
  ${rects.join('\n  ')}
</svg>`;
}

/**
 * Generates an ANSI terminal string representation of a QR code using Unicode half-blocks.
 */
export function generateQrAnsi(text: string): string {
  const matrix = generateQrMatrix(text);
  const N = matrix.length;
  const margin = 2;

  // Add quiet zone
  const total = N + margin * 2;
  const full: boolean[][] = Array.from({ length: total }, () => Array(total).fill(false));
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      full[r + margin][c + margin] = matrix[r][c];
    }
  }

  const lines: string[] = [];
  // Render two vertical modules per character using upper/lower half block
  for (let r = 0; r < total; r += 2) {
    let line = '  ';
    for (let c = 0; c < total; c++) {
      const top = full[r][c];
      const bot = r + 1 < total ? full[r + 1][c] : false;
      if (top && bot) {
        line += ' '; // Inverted for dark terminal background
      } else if (top && !bot) {
        line += '▄';
      } else if (!top && bot) {
        line += '▀';
      } else {
        line += '█';
      }
    }
    lines.push(line);
  }

  return lines.join('\n');
}
