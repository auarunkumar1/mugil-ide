import { BANNER_ART, BRAND, LOGO_GRID, getBanner, VERSION } from '../src/branding.js';

describe('branding', () => {
  it('uses the Mugil IDE brand', () => {
    expect(BRAND).toBe('Mugil IDE');
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it('renders MUGIL IDE in the logo grid', () => {
    expect(LOGO_GRID).toHaveLength(5);
    const flat = LOGO_GRID.join('\n');
    // Letter shapes: M chevron, U cup, G bar, I stem, L base, D/E bars.
    expect(flat).toContain('\\/');
    expect(flat).toContain('_   _');
    expect(flat).toContain(' ____ ');
    expect(flat).toContain('|____|');
    expect(flat).toContain('|_____|');
  });

  it('pads every banner row to the same width (monospace-safe)', () => {
    const widths = new Set(BANNER_ART.map((row) => row.length));
    expect(widths.size).toBe(1);
    expect(BANNER_ART).toHaveLength(5);
  });

  it('includes the brand + version tagline in the banner', () => {
    const banner = getBanner();
    expect(banner).toContain(BRAND);
    expect(banner).toContain(`v${VERSION}`);
  });
});
