import type {TileflowThemeLighting} from '@tileflow/core';
import type {StreetsColorTheme, StreetsLightPreset} from './streets-theme-colors';

// Dawn, dusk and night retain public Mapbox Standard light properties, retrieved 2026-10-18 from
// https://api.mapbox.com/styles/v1/mapbox/standard (modified 2026-10-08T14:57:51.547Z).
// Direction is [azimuth clockwise from north, polar angle from the zenith]:
// https://docs.mapbox.com/style-spec/reference/light/#direction
// Daylight uses Streets' warm sun and cool skylight to separate its architectural planes.
// The reference presets use the fixed zoom >= 14 values. Standard interpolates directional intensity
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
      color: '#FFF5E8',
      intensity: 0.3,
      shadowIntensity: 0.8,
    },
    ambient: {color: '#E2EBF7', intensity: 0.7},
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

// A palette changes the color of the light, never its direction or strength.
// All palettes at the same moment therefore share the same shadow geometry.
function withLightColors(colors: Record<StreetsLightPreset, {sun: string; ambient: string}>) {
  return Object.fromEntries(
    (Object.keys(defaultLighting) as StreetsLightPreset[]).map((preset) => [
      preset,
      {
        sun: {...defaultLighting[preset].sun, color: colors[preset].sun},
        ambient: {...defaultLighting[preset].ambient, color: colors[preset].ambient},
      },
    ]),
  ) as Record<
    StreetsLightPreset,
    {
      sun: {
        azimuth: number;
        altitude: number;
        color: string;
        intensity: number;
        shadowIntensity: number;
      };
      ambient: {color: string; intensity: number};
    }
  >;
}

const fadedLighting = withLightColors({
  dawn: {
    sun: 'rgb(252.513725, 222.937729, 169.273879)',
    ambient: 'rgb(254, 244.681815, 235.980392)',
  },
  day: {sun: '#FFF8EF', ambient: '#EBF0F8'},
  dusk: {
    sun: 'rgb(252.513725, 217.250027, 164.945083)',
    ambient: 'rgb(87.776471, 97.427724, 126.419608)',
  },
  night: {sun: 'rgb(97.815686, 102.955556, 118.333333)', ambient: 'rgb(2, 38.117647, 86.886275)'},
});

const monochromeLighting = withLightColors({
  dawn: {
    sun: 'rgb(226.147143, 226.147143, 226.147143)',
    ambient: 'rgb(245.703576, 245.703576, 245.703576)',
  },
  day: {sun: '#FFFFFF', ambient: '#FFFFFF'},
  dusk: {
    sun: 'rgb(163.817309, 163.817309, 163.817309)',
    ambient: 'rgb(126.294118, 126.294118, 126.294118)',
  },
  // Retain legible artistic moonlight; black would remove all night illumination.
  night: {sun: '#353535', ambient: '#353535'},
});

export const streetsLighting = {
  default: defaultLighting,
  faded: fadedLighting,
  monochrome: monochromeLighting,
} as const satisfies Record<StreetsColorTheme, Record<StreetsLightPreset, TileflowThemeLighting>>;
