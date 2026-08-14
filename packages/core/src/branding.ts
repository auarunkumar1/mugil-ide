/** Mugil IDE branding: brand names, the logo grid, and the ASCII-art banner. */

export const BRAND = 'Mugil IDE';
export const BRAND_SLUG = 'mugil-ide';
export const VERSION = '1.0.0';

/**
 * 5-row block glyphs (figlet-style) used to build the "MUGIL IDE" logo.
 * Each glyph keeps its natural width; rows are joined with a single space.
 */
const GLYPHS: Record<string, string[]> = {
  M: [' __  __', '|  \\/  |', '| |\\/| |', '| |  | |', '|_|  |_|'],
  U: [' _   _ ', '| | | |', '| |_| |', '|  _  |', '|_| |_|'],
  G: [' ____ ', '/ ___|', '| |  _ ', '| |_| |', '\\____|'],
  I: [' _ ', '| |', '| |', '| |', '|_|'],
  L: [' _ ', '| |', '| |', '| |', '|_|'],
  D: [' ____ ', '|  __|', '| |  |', '| |__|', '|____|'],
  E: [' _____', '| ____|', '| |___', '| |___', '|_____|'],
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

/** Full banner block with brand + version tagline. */
export function getBanner(): string {
  return ['', ...BANNER_ART, '', `${BRAND} v${VERSION} — token-efficient AI IDE`, ''].join('\n');
}
