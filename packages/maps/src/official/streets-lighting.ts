import type {TileflowThemeLighting} from '@tileflow/core';
import type {StreetsColorTheme, StreetsLightPreset} from './streets-theme-colors';

// Public Mapbox Standard light properties, retrieved 2026-10-18 from
// https://api.mapbox.com/styles/v1/mapbox/standard (modified 2026-10-08T14:57:51.547Z).
// Direction is [azimuth clockwise from north, polar angle from the zenith]:
// https://docs.mapbox.com/style-spec/reference/light/#direction
// These are the fixed zoom >= 14 values. Standard interpolates directional intensity
// at zooms 12/13/14; Tileflow's theme sun currently accepts constant presets.
// Effective colors include Standard's color-theme LUT, evaluated with GL JS 3.28.1's
// trilinear interpolation; fractional RGB preserves its output. The fixture records
// the source hashes and raw inputs independently of this runtime table. Our scene
// normalizes illumination against authored roof color instead of tinting that
// observed color a second time; this is not Standard's material/emission pipeline.
const defaultLighting = {
  dawn: {
    sun: {
      azimuth: 120,
      altitude: 40,
      color: '#FECA8B',
      intensity: 0.5,
      shadowIntensity: 1,
    },
    ambient: {color: '#FFECDC', intensity: 0.75},
  },
  day: {
    sun: {
      azimuth: 180,
      altitude: 70,
      color: '#FFFFFF',
      intensity: 0.2,
      shadowIntensity: 1,
    },
    ambient: {color: '#FFFFFF', intensity: 0.8},
  },
  dusk: {
    sun: {
      azimuth: 240,
      altitude: 10,
      color: '#FEC286',
      intensity: 0.2,
      shadowIntensity: 0.85,
    },
    ambient: {color: '#363E5E', intensity: 0.8},
  },
  night: {
    // The high night direction represents moonlight, not a below-horizon sun.
    sun: {
      azimuth: 270,
      altitude: 70,
      color: '#3F4455',
      intensity: 0.5,
      shadowIntensity: 0.5,
    },
    ambient: {color: '#001638', intensity: 0.5},
  },
} as const;

const fadedLighting = {
  dawn: {
    sun: {...defaultLighting.dawn.sun, color: 'rgb(252.513725, 222.937729, 169.273879)'},
    ambient: {color: 'rgb(254, 244.681815, 235.980392)', intensity: 0.75},
  },
  day: defaultLighting.day,
  dusk: {
    sun: {...defaultLighting.dusk.sun, color: 'rgb(252.513725, 217.250027, 164.945083)'},
    ambient: {color: 'rgb(87.776471, 97.427724, 126.419608)', intensity: 0.8},
  },
  night: {
    sun: {...defaultLighting.night.sun, color: 'rgb(97.815686, 102.955556, 118.333333)'},
    ambient: {color: 'rgb(2, 38.117647, 86.886275)', intensity: 0.5},
  },
} as const;

const monochromeLighting = {
  dawn: {
    sun: {
      ...defaultLighting.dawn.sun,
      altitude: 50,
      color: 'rgb(226.147143, 226.147143, 226.147143)',
      intensity: 0.35,
    },
    ambient: {color: 'rgb(245.703576, 245.703576, 245.703576)', intensity: 0.75},
  },
  day: {
    sun: defaultLighting.day.sun,
    ambient: {...defaultLighting.day.ambient, intensity: 0.85},
  },
  dusk: {
    sun: {
      ...defaultLighting.dusk.sun,
      altitude: 60,
      color: 'rgb(163.817309, 163.817309, 163.817309)',
      intensity: 0.15,
    },
    ambient: {color: 'rgb(126.294118, 126.294118, 126.294118)', intensity: 0.1},
  },
  night: {
    // Standard's monochrome LUT maps a black light input to #353535. Feeding the
    // raw black into the scene would incorrectly remove all night illumination.
    sun: {...defaultLighting.night.sun, color: '#353535', intensity: 0.25},
    ambient: {color: '#353535', intensity: 0},
  },
} as const;

export const streetsLighting = {
  default: defaultLighting,
  faded: fadedLighting,
  monochrome: monochromeLighting,
} as const satisfies Record<StreetsColorTheme, Record<StreetsLightPreset, TileflowThemeLighting>>;
