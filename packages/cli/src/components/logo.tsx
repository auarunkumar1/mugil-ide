import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { BRAND, LOGO_GRID, VERSION } from '@mugil-ide/core';

/** Converts HSL (h: 0-360, s/l: 0-100) to a #rrggbb hex string. */
function hslToHex(hue: number, sat: number, light: number): string {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = sat / 100;
  const l = light / 100;
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

const TICK_MS = 80;
const HUE_STEP = 6;
const HUE_SPAN = 210; // RGB sweep spread across the logo width

/**
 * Pseudo-3D "Mugil IDE" logo with an animated RGB sweep.
 *
 * Every cell of the logo grid gets a hue taken from a sweep that travels
 * across the glyphs (red → green → blue) and advances over time, while the
 * lightness falls from the top of each glyph row to its base — faking a
 * light source shining down on raised text. Falls back to a static bold
 * logo when stdout is not a TTY (piped output, tests).
 */
export function MugilLogo(): React.ReactElement {
  const animated = process.stdout.isTTY === true;
  const [hue, setHue] = useState(0);

  useEffect(() => {
    if (!animated) return;
    const id = setInterval(() => setHue((h) => (h + HUE_STEP) % 360), TICK_MS);
    return () => clearInterval(id);
  }, [animated]);

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
            if (!animated) {
              return (
                <Text key={c} bold>
                  {ch}
                </Text>
              );
            }
            const colHue = (hue + (c / width) * HUE_SPAN) % 360;
            // 3D shading: brighter at the top, darker at the base, with a
            // subtle per-column bevel.
            const light = Math.max(32, 82 - r * 10 - (c % 3));
            return (
              <Text key={c} color={hslToHex(colHue, 95, light)}>
                {ch}
              </Text>
            );
          })}
        </Box>
      ))}
      <Text bold color="white">
        {BRAND} v{VERSION} — token-efficient AI IDE
      </Text>
    </Box>
  );
}
