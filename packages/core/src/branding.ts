/** Mugil IDE branding: brand names, the logo grid, and the ASCII-art banner. */

export const BRAND = 'Mugil IDE';
export const BRAND_SLUG = 'mugil-ide';
export const VERSION = '0.1.11';

/**
 * 5-row modern ANSI Shadow 3D block glyphs used to build the "MUGIL IDE" logo.
 * Solid block geometry (OpenCode style) with built-in 3D bevels and drop shadows.
 */
const GLYPHS: Record<string, string[]> = {
  M: ['███╗   ███╗ ', '████╗ ████║ ', '██╔████╔██║ ', '██║╚██╔╝██║ ', '██║ ╚═╝ ██║ '],
  U: ['██╗   ██╗  ', '██║   ██║  ', '██║   ██║  ', '██║   ██║  ', '╚██████╔╝  '],
  G: [' ██████╗   ', '██╔════╝   ', '██║  ███╗  ', '██║   ██║  ', '╚██████╔╝  '],
  I: ['██╗  ', '██║  ', '██║  ', '██║  ', '██║  '],
  L: ['██╗       ', '██║       ', '██║       ', '██║       ', '███████╗  '],
  D: ['██████╗   ', '██╔══██╗  ', '██║  ██║   ', '██║  ██║   ', '██████╔╝  '],
  E: ['███████╗ ', '██╔════╝ ', '█████╗   ', '██╔══╝   ', '███████╗ '],
};

/** The word rendered by the logo. */
const LOGO_TEXT = 'MUGIL IDE';

/**
 * The "MUGIL IDE" logo grid (unpadded rows, one character per cell). The TUI
 * colorizes this grid cell-by-cell for the pseudo-3D RGB logo.
 */
export const LOGO_GRID = (() => {
  const height = 5;
  const grid: string[] = Array.from({ length: height }, () => '');
  for (const ch of LOGO_TEXT) {
    const glyph = ch === ' ' ? Array<string>(height).fill(' ') : GLYPHS[ch]!;
    for (let r = 0; r < height; r++) {
      const row = grid[r]!;
      grid[r] = (row.length > 0 ? row + ' ' : '') + glyph[r]!;
    }
  }
  return grid;
})();

/** The MUGIL IDE banner, with every row padded to the same width. */
export const BANNER_ART = (() => {
  const width = Math.max(...LOGO_GRID.map((row) => row.length));
  return LOGO_GRID.map((row) => row.padEnd(width));
})();

/** Return the banner with each glyph coloured by a smooth 24-bit RGB gradient
 *  that cycles per column, giving a shimmering rainbow effect without
 *  altering the ASCII text structure. */
export function getColoredBanner(hueOffset = 0): string {
  const rows = BANNER_ART;
  const width = rows[0]?.length ?? 0;
  return rows
    .map((row) =>
      Array.from({ length: width }, (_, c) => {
        const ch = row[c];
        if (ch === ' ') return ' ';
        const [r, g, b] = hueToRgb((hueOffset + c * 8) % 360);
        return `\x1b[38;2;${r};${g};${b}m${ch}\x1b[0m`;
      }).join(''),
    )
    .join('\n');
}

/** Convert a hue (0‑360) to an RGB 255 tuple. */
function hueToRgb(hue: number): [number, number, number] {
  const s = 1;
  const v = 1;
  const i = Math.floor(hue / 60) % 6;
  const f = hue / 60 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const mod = i;
  let rgb: [number, number, number] = [0, 0, 0];
  switch (mod) {
    case 0: rgb = [v, t, p]; break;
    case 1: rgb = [q, v, p]; break;
    case 2: rgb = [p, v, t]; break;
    case 3: rgb = [p, q, v]; break;
    case 4: rgb = [t, p, v]; break;
    case 5: rgb = [v, p, q]; break;
  }
  return [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)];
}

/** Full banner block with brand + version tagline. */
export function getBanner(): string {
  return ['', ...BANNER_ART, '', `${BRAND} v${VERSION} — token-efficient AI IDE`, ''].join('\n');
}
