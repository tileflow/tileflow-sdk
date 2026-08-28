import {token} from '@tileflow/core';
import {defineOfficialTheme} from './theme-helpers';

type SiegfriedPalette = {
  blue: string;
  brown: string;
  ink: string;
  paper: string;
};

const lightPalette = {
  blue: '#5D90D0',
  brown: '#A96C4D',
  ink: '#171713',
  paper: '#F0EBE0',
} as const satisfies SiegfriedPalette;

/**
 * A nocturnal engraver's proof rather than a historical fourth printing.
 * The same three-ink grammar is preserved against a charcoal paper stock:
 * warm relief copper, alpine blue, and a soft ivory key ink.
 */
const darkPalette = {
  blue: '#79A9D6',
  brown: '#C48A68',
  ink: '#E8E0D0',
  paper: '#151612',
} as const satisfies SiegfriedPalette;

const regularFont = 'Cormorant Garamond Regular';
const semiboldFont = 'Cormorant Garamond SemiBold';
const italicFont = 'Cormorant Garamond Italic';

const patternNames = [
  'forest',
  'glacier',
  'gravel',
  'orchard',
  'paper-grain',
  'rock',
  'scree',
  'water-lines',
  'wetland',
] as const;

function patternTokens(variant: 'light' | 'dark') {
  return Object.fromEntries(
    patternNames.map((name) => [
      `patterns.${name}`,
      variant === 'light' ? `siegfried-${name}` : `siegfried-dark-${name}`,
    ]),
  );
}

function createSiegfriedTheme(
  id: string,
  colorScheme: 'light' | 'dark',
  palette: SiegfriedPalette,
) {
  return defineOfficialTheme({
    id,
    version: 1,
    colorScheme,
    colors: {
      background: palette.paper,
      boundary: palette.ink,
      building: palette.ink,
      land: palette.paper,
      park: palette.paper,
      road: palette.paper,
      roadCasing: palette.ink,
      roadMajor: palette.paper,
      text: palette.ink,
      textHalo: palette.paper,
      textMuted: palette.ink,
      water: palette.blue,
    },
    modules: {
      boundaries: {
        admin: palette.ink,
        disputed: palette.ink,
        major: palette.ink,
        maritime: palette.blue,
      },
      buildings: {
        active: palette.ink,
        businessCorridor: palette.paper,
        businessCorridorOutline: palette.ink,
        civic: palette.ink,
        commercial: palette.ink,
        destination: palette.ink,
        extrusion: palette.ink,
        fill: palette.ink,
        generic: palette.ink,
        highRise: palette.ink,
        highRiseOutline: palette.ink,
        industrial: palette.ink,
        lowRise: palette.ink,
        lowRiseOutline: palette.ink,
        outline: palette.ink,
        residential: palette.ink,
      },
      hydro: {
        ferry: palette.blue,
        label: palette.ink,
        water: palette.blue,
        waterway: palette.blue,
      },
      labels: {
        country: palette.ink,
        halo: palette.paper,
        muted: palette.ink,
        neighborhood: palette.ink,
        poi: palette.ink,
        primary: palette.ink,
        road: palette.ink,
        settlement: palette.ink,
        water: palette.ink,
      },
      landcover: {
        farmland: palette.paper,
        flowerbed: palette.paper,
        grass: palette.paper,
        ice: palette.paper,
        meadow: palette.paper,
        protected: palette.paper,
        recreationGround: palette.paper,
        rock: palette.paper,
        sand: palette.paper,
        scrub: palette.paper,
        urbanPark: palette.paper,
        villageGreen: palette.paper,
        wetland: palette.paper,
        wood: palette.paper,
      },
      landuse: {
        cemetery: palette.paper,
        civic: palette.paper,
        commercial: palette.paper,
        education: palette.paper,
        government: palette.paper,
        industrial: palette.paper,
        medical: palette.paper,
        military: palette.paper,
        parking: palette.paper,
        recreation: palette.paper,
        residential: palette.paper,
      },
      poi: {
        'arts-entertainment': palette.ink,
        education: palette.ink,
        'food-drink': palette.ink,
        halo: palette.paper,
        icon: palette.ink,
        label: palette.ink,
        landmark: palette.ink,
        lodging: palette.ink,
        medical: palette.ink,
        'park-nature': palette.ink,
        'public-services': palette.ink,
        religion: palette.ink,
        retail: palette.ink,
        'sport-leisure': palette.ink,
        transport: palette.ink,
        'visitor-amenity': palette.ink,
      },
      roads: {
        bridge: palette.paper,
        casing: palette.ink,
        ferry: palette.blue,
        minor: palette.paper,
        motorway: palette.paper,
        path: palette.ink,
        primary: palette.paper,
        rail: palette.ink,
        secondary: palette.paper,
        trunk: palette.paper,
        tunnel: palette.paper,
      },
    },
    extraColors: {
      'ink.contour': palette.brown,
      'ink.hydro': palette.blue,
      'ink.primary': palette.ink,
      'substrate.paper': palette.paper,
    },
    images: patternTokens(colorScheme),
    numbers: {
      'render.rockMask.opacity': colorScheme === 'light' ? 0.58 : 0.42,
    },
    fonts: {
      'type.italic': italicFont,
      'type.roman': regularFont,
      'type.semibold': semiboldFont,
    },
    typography: {
      font: regularFont,
      letterSpacing: 0.02,
      places: {font: semiboldFont, letterSpacing: 0.08},
      poi: {font: regularFont, letterSpacing: 0.03},
      roads: {font: regularFont, letterSpacing: 0.04},
      water: {font: italicFont, letterSpacing: 0.1},
    },
    lighting: {
      anchor: 'viewport',
      color: palette.paper,
      intensity: colorScheme === 'light' ? 0.08 : 0.04,
      position: [1.15, 210, 35],
    },
  });
}

/** Light facsimile and dark engraver-proof variants share one semantic vocabulary. */
export const siegfriedThemes = Object.freeze({
  light: createSiegfriedTheme('siegfried-light', 'light', lightPalette),
  dark: createSiegfriedTheme('siegfried-dark', 'dark', darkPalette),
});

/** Explicit visual references consumed by the autonomous Siegfried design. */
export const siegfriedVisual = Object.freeze({
  color: {
    contour: token.color('ink.contour'),
    hydro: token.color('ink.hydro'),
    ink: token.color('ink.primary'),
    paper: token.color('substrate.paper'),
  },
  font: {
    italic: token.font('type.italic'),
    regular: token.font('type.roman'),
    semibold: token.font('type.semibold'),
  },
  pattern: Object.fromEntries(
    patternNames.map((name) => [name, token.image(`patterns.${name}`)]),
  ) as Record<(typeof patternNames)[number], ReturnType<typeof token.image>>,
  number: {
    rockMaskOpacity: token.number('render.rockMask.opacity'),
  },
});
