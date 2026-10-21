import {Color, type SkySpecification} from '@maplibre/maplibre-gl-style-spec';
import type {TileflowAtmosphere, TileflowResolvedAtmosphere} from './atmosphere';
import type {TileflowThemeColorValue} from './cartography/values';
import type {TileflowResolvedSky, TileflowSky} from './sky';

const defaults: TileflowResolvedAtmosphere = {
  skyColor: '#07152b',
  horizonColor: '#83b9f4',
  fogColor: '#bad2eb',
  spaceColor: '#030916',
  starIntensity: 0.6,
  starParallax: 0.4,
};

export function resolveTileflowAtmosphere(
  value: TileflowAtmosphere | undefined,
): TileflowResolvedAtmosphere | undefined {
  if (!value) return undefined;
  const options = {...defaults, ...(value === true ? {} : value)};
  const normalize = (input: TileflowThemeColorValue) => opaqueHex(input, 'Atmosphere colors');
  return {
    ...options,
    skyColor: normalize(options.skyColor),
    horizonColor: normalize(options.horizonColor),
    fogColor: normalize(options.fogColor),
    spaceColor: normalize(options.spaceColor),
  };
}

function opaqueHex(input: unknown, subject: string): `#${string}` {
  const color = typeof input === 'string' ? Color.parse(input) : undefined;
  if (!color || color.a !== 1) throw new Error(`${subject} must resolve to opaque colors.`);
  return `#${[color.r, color.g, color.b]
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function compileTileflowSky(options: TileflowResolvedAtmosphere): SkySpecification {
  return {
    'sky-color': options.skyColor,
    'horizon-color': options.horizonColor,
    'fog-color': options.fogColor,
    'sky-horizon-blend': 0.12,
    'horizon-fog-blend': 0.5,
    'fog-ground-blend': 0.1,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 3, 0.45, 5, 0.2, 7, 0],
  };
}

const skyDefaults = {
  color: '#5c9ce6',
  horizonColor: '#dcebf7',
  horizonBlend: 0.6,
  glowColor: '#ffc68a',
  starIntensity: 0.6,
} as const;

/** Colours and numbers here are already theme-resolved; tokens resolve before compilation. */
export function resolveTileflowSky(
  value: TileflowSky | undefined,
): TileflowResolvedSky | undefined {
  if (!value) return undefined;
  const options = {...skyDefaults, ...(value === true ? {} : value)};
  const unit = (input: unknown, name: string): number => {
    if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > 1)
      throw new Error(`Sky ${name} must resolve to a number from 0 to 1.`);
    return input;
  };
  return {
    color: opaqueHex(options.color, 'Sky colors'),
    horizonColor: opaqueHex(options.horizonColor, 'Sky colors'),
    horizonBlend: unit(options.horizonBlend, 'horizonBlend'),
    glowColor: opaqueHex(options.glowColor, 'Sky colors'),
    starIntensity: unit(options.starIntensity, 'starIntensity'),
  };
}

/**
 * The street-level sky. MapLibre paints it in every projection when the camera tilts towards the
 * horizon; on a globe it also blends into the atmosphere at world zooms, as the globe atmosphere does.
 */
export function compileTileflowStreetSky(options: TileflowResolvedSky): SkySpecification {
  return {
    'sky-color': options.color,
    'horizon-color': options.horizonColor,
    // MapLibre fogs only 3D terrain; the haze matches the horizon so terrain meets the sky.
    'fog-color': options.horizonColor,
    'sky-horizon-blend': options.horizonBlend,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.75,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 3, 0.45, 5, 0.2, 7, 0],
  };
}
