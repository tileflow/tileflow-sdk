import {Color, type SkySpecification} from '@maplibre/maplibre-gl-style-spec';
import type {TileflowAtmosphere, TileflowResolvedAtmosphere} from './atmosphere';
import type {TileflowThemeColorValue} from './cartography/values';

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
  const normalize = (input: TileflowThemeColorValue): `#${string}` => {
    const color = typeof input === 'string' ? Color.parse(input) : undefined;
    if (!color || color.a !== 1)
      throw new Error('Atmosphere colors must resolve to opaque colors.');
    return `#${[color.r, color.g, color.b]
      .map((channel) =>
        Math.round(channel * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  };
  return {
    ...options,
    skyColor: normalize(options.skyColor),
    horizonColor: normalize(options.horizonColor),
    fogColor: normalize(options.fogColor),
    spaceColor: normalize(options.spaceColor),
  };
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
