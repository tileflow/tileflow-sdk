import type {TileflowThemeColorValue, TileflowThemeNumberValue} from './cartography/values';

/**
 * The sky above the horizon when the camera tilts up towards it, in either projection. Colours and
 * numbers take theme tokens, so each theme paints its own sky: blue by day, warm at dusk, dark with
 * stars at night. Colours must resolve to opaque colours.
 */
export type TileflowSkyOptions = {
  /** The sky overhead. Default: `#5c9ce6`. */
  color?: TileflowThemeColorValue;
  /** The pale band along the horizon, which also colours 3D terrain's distance fog. Default: `#dcebf7`. */
  horizonColor?: TileflowThemeColorValue;
  /** How far up the horizon band reaches, as a share of half the view's height, from 0 to 1. Default: 0.6. */
  horizonBlend?: TileflowThemeNumberValue;
  /** The brightest the stars shine, from 0 (none) to 1, reached where the sky is dark. Default: 0.6. */
  starIntensity?: TileflowThemeNumberValue;
};

export type TileflowSky = boolean | TileflowSkyOptions;

export type TileflowResolvedSky = {
  color: `#${string}`;
  horizonColor: `#${string}`;
  horizonBlend: number;
  starIntensity: number;
};

export const tileflowSkyMetadataKey = 'tileflow:sky';

/** The versioned runtime payload: what the browser needs to draw the stars. */
export type TileflowSkyMetadata = {version: 1; starIntensity: number};

/** Validate the runtime payload without loading authoring schemas. */
export function readTileflowSky(value: unknown): TileflowSkyMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || Object.keys(record).length !== 2) return undefined;
  const intensity = record.starIntensity;
  if (
    typeof intensity !== 'number' ||
    !Number.isFinite(intensity) ||
    intensity < 0 ||
    intensity > 1
  )
    return undefined;
  return {version: 1, starIntensity: intensity};
}

/**
 * How much of the stars' brightness a sky of this colour lets through, from 0 to 1. Stars come out
 * as the sky darkens, so a theme blend from dusk into night brings them in with the dark. The
 * channels are 0–1 sRGB.
 */
export function tileflowSkyStarVisibility(channels: readonly [number, number, number]): number {
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const luminance = 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  // A night navy (#0b1630, about 0.009) shows every star; a dusk violet (#6f6a9e, about 0.15) none.
  const progress = Math.min(1, Math.max(0, (0.06 - luminance) / (0.06 - 0.015)));
  return progress * progress * (3 - 2 * progress);
}
