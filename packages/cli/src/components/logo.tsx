import React from 'react';
import { Box, Text } from 'ink';
import { BRAND, LOGO_GRID, VERSION } from '@mugil-ide/core';

/** Converts HSL (h: 0-360, s/l: 0-100) to a #rrggbb hex string. */
function hslToHex(hue: number, sat: number, light: number): string {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = Math.min(100, Math.max(0, sat)) / 100;
  const l = Math.min(100, Math.max(0, light)) / 100;
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const toHex = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/**
  * Surface lighting modifier for pseudo-3D text depth.
  * Upper edges and left-facing diagonals catch ambient key light;
  * bottom row and right-facing edges receive drop-shadow depth.
  */
function getChar3DLightModifier(ch: string, row: number): number {
  if (ch === '_' && row === 0) return 22; // Top surface highlight
  if (ch === '_' && row === 4) return -12; // Base shadow
  if (ch === '/' || ch === '|') return 8; // Left/vertical bevel
  if (ch === '\\') return -10; // Right bevel shadow
  return 0;
}

/**
 * Pseudo-3D "MUGIL IDE" logo with multi-pass directional lighting,
 * bevel highlights, and static chromatic sweep.
 */
export function MugilLogo(): React.ReactElement {
  const rows = LOGO_GRID;
  const width = Math.max(...rows.map((row) => row.length));

  return (
    <Box flexDirection="column">
      {rows.map((row, r) => (
        <Box key={r}>
          {Array.from(row).map((ch, c) => {
            if (ch === ' ') {
              return <Text key={c}> </Text>;
            }

            // Base chromatic hue across column
            const baseHue = (190 + (c / width) * 120) % 360;

            // Pseudo-3D vertical extrusion: top row is bright, base is deeper
            const verticalLighting = 82 - r * 8;

            // Character-specific bevel lighting (top highlight vs right-side shadow)
            const bevel = getChar3DLightModifier(ch, r);

            // Final calculated lightness with pseudo-3D depth
            const light = Math.min(94, Math.max(30, verticalLighting + bevel));
            const sat = 90;

            return (
              <Text key={c} bold color={hslToHex(baseHue, sat, light)}>
                {ch}
              </Text>
            );
          })}
        </Box>
      ))}
      <Box marginTop={0}>
        <Text color="cyan" bold>✦ </Text>
        <Text bold color="white">
          {BRAND}{' '}
        </Text>
        <Text dimColor>v{VERSION} — token-efficient AI IDE</Text>
      </Box>
    </Box>
  );
}

