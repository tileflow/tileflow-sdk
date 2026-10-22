import {Color, type SkySpecification} from '@maplibre/maplibre-gl-style-spec';
import {
  defaultAtmosphereStars,
  type TileflowAtmosphere,
  type TileflowResolvedAtmosphere,
} from './atmosphere';
import type {TileflowThemeColorValue} from './cartography/values';
import type {TileflowResolvedSky, TileflowSky} from './sky';

const defaults: TileflowResolvedAtmosphere = {
  ...defaultAtmosphereStars,
  skyColor: '#263b50',
  horizonColor: '#b6cfe2',
  fogColor: '#d4e1ec',
  spaceColor: '#142233',
  starIntensity: 0.6,
  starParallax: 0.4,
};

export function resolveTileflowAtmosphere(
  value: TileflowAtmosphere | undefined,
): TileflowResolvedAtmosphere | undefined {
  if (!value) return undefined;
  const options = value === true ? {} : value;
  const normalize = (input: TileflowThemeColorValue) => opaqueHex(input, 'Atmosphere colors');
  return {
    skyColor: normalize(options.skyColor ?? defaults.skyColor),
    horizonColor: normalize(options.horizonColor ?? defaults.horizonColor),
    fogColor: normalize(options.fogColor ?? defaults.fogColor),
    spaceColor: normalize(options.spaceColor ?? defaults.spaceColor),
    starColor: normalize(options.starColor ?? defaults.starColor),
    starCount: options.starCount ?? defaults.starCount,
    starSize: options.starSize ?? defaults.starSize,
    starIntensity: options.starIntensity ?? defaults.starIntensity,
    starParallax: options.starParallax ?? defaults.starParallax,
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
    // The browser draws a contour halo. Native sun scattering washes out the globe's surface.
    'atmosphere-blend': 0,
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
export function compileTileflowStreetSky(
  options: TileflowResolvedSky,
  globeAtmosphere = false,
): SkySpecification {
  return {
    'sky-color': options.color,
    'horizon-color': options.horizonColor,
    // MapLibre fogs only 3D terrain; the haze matches the horizon so terrain meets the sky.
    'fog-color': options.horizonColor,
    'sky-horizon-blend': options.horizonBlend,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.75,
    'atmosphere-blend': globeAtmosphere
      ? 0
      : ['interpolate', ['linear'], ['zoom'], 0, 0.55, 3, 0.45, 5, 0.2, 7, 0],
  };
}
