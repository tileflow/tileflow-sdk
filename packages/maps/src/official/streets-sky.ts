import type {StreetsColorTheme, StreetsLightPreset} from './streets-theme-colors';

// The sky over a street-level view: a clear blue by day with a pale horizon, a peach dawn, a
// violet dusk over a pink horizon, and a navy night dark enough for stars. The glow is the light
// round a low sun: pale gold by day, apricot at dawn, amber at dusk; a night sun sits too low to
// glow. Faded and monochrome skies follow their families: softened towards grey, and grey.
const skies = {
  day: {color: '#5C9CE6', horizon: '#DCEBF7', blend: 0.6, glow: '#FFE7B8'},
  dawn: {color: '#7F9FD6', horizon: '#F6D4BC', blend: 0.75, glow: '#FFC77A'},
  dusk: {color: '#4A4784', horizon: '#E7A3A4', blend: 0.8, glow: '#FFA552'},
  night: {color: '#0B1630', horizon: '#26365A', blend: 0.6, glow: '#B4645A'},
} as const satisfies Record<
  StreetsLightPreset,
  {color: string; horizon: string; blend: number; glow: string}
>;

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
}

function hex(rgb: readonly number[]): string {
  return `#${rgb
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, '0')
        .toUpperCase(),
    )
    .join('')}`;
}

function inFamily(color: string, family: StreetsColorTheme): string {
  const rgb = channels(color);
  const gray = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  if (family === 'monochrome') return hex([gray, gray, gray]);
  if (family === 'faded') return hex(rgb.map((channel) => channel + (gray - channel) * 0.35));
  return color;
}

/** Theme tokens for Streets' sky. */
export function streetsSkyTokens(preset: StreetsLightPreset, family: StreetsColorTheme) {
  const sky = skies[preset];
  return {
    colors: {
      'sky.color': inFamily(sky.color, family),
      'sky.horizon': inFamily(sky.horizon, family),
      'sky.glow': inFamily(sky.glow, family),
    },
    numbers: {'sky.horizonBlend': sky.blend},
  };
}
