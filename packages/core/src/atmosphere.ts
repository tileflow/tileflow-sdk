import type {TileflowThemeColorValue} from './cartography/values';

/** Optional globe atmosphere. Colors use theme tokens or explicit fixed values and must resolve to opaque colors. */
export type TileflowAtmosphereOptions = {
  skyColor?: TileflowThemeColorValue;
  horizonColor?: TileflowThemeColorValue;
  fogColor?: TileflowThemeColorValue;
  spaceColor?: TileflowThemeColorValue;
  /** Star color. Default: #e0ebff. */
  starColor?: TileflowThemeColorValue;
  /** Stars per repeating 1600 × 1000 CSS-pixel area, integer 0–4096. Default: 1100. */
  starCount?: number;
  /** Star radius multiplier from 0 (hidden) to 4. Default: 1. */
  starSize?: number;
  /** Star brightness from 0 (hidden) to 1. Default: 0.6. */
  starIntensity?: number;
  /** Camera-relative star movement from 0 (still) to 1. Default: 0.4. */
  starParallax?: number;
};

export type TileflowAtmosphere = boolean | TileflowAtmosphereOptions;
export type TileflowResolvedAtmosphere = {
  skyColor: `#${string}`;
  horizonColor: `#${string}`;
  fogColor: `#${string}`;
  spaceColor: `#${string}`;
  starColor: `#${string}`;
  starCount: number;
  starSize: number;
  starIntensity: number;
  starParallax: number;
};

export const tileflowAtmosphereMetadataKey = 'tileflow:atmosphere';
export const tileflowAtmosphereMetadataVersion = 2;
export const defaultAtmosphereStars = {
  starColor: '#e0ebff',
  starCount: 1100,
  starSize: 1,
} as const;
/** Validate the complete versioned runtime payload without loading authoring schemas. */
export function readTileflowAtmosphere(value: unknown): TileflowResolvedAtmosphere | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const legacy = record.version === 1;
  if (
    (!legacy && record.version !== tileflowAtmosphereMetadataVersion) ||
    Object.keys(record).length !== (legacy ? 7 : 10)
  )
    return undefined;
  for (const key of ['skyColor', 'horizonColor', 'fogColor', 'spaceColor']) {
    if (typeof record[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(record[key])) return undefined;
  }
  for (const key of ['starIntensity', 'starParallax']) {
    const number = record[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 1)
      return undefined;
  }
  const stars = legacy ? defaultAtmosphereStars : record;
  if (
    typeof stars.starColor !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(stars.starColor) ||
    typeof stars.starCount !== 'number' ||
    !Number.isInteger(stars.starCount) ||
    stars.starCount < 0 ||
    stars.starCount > 4096 ||
    typeof stars.starSize !== 'number' ||
    !Number.isFinite(stars.starSize) ||
    stars.starSize < 0 ||
    stars.starSize > 4
  )
    return undefined;
  return {
    skyColor: record.skyColor as `#${string}`,
    horizonColor: record.horizonColor as `#${string}`,
    fogColor: record.fogColor as `#${string}`,
    spaceColor: record.spaceColor as `#${string}`,
    starColor: stars.starColor as `#${string}`,
    starCount: stars.starCount,
    starSize: stars.starSize,
    starIntensity: record.starIntensity as number,
    starParallax: record.starParallax as number,
  };
}

export function atmosphereSpaceOpacity(zoom: number): number {
  const progress = Math.max(0, Math.min(1, (zoom - 3) / 3));
  return 1 - progress * progress * (3 - 2 * progress);
}

export function atmosphereAngleDelta(next: number, previous: number): number {
  return ((((next - previous) % 360) + 540) % 360) - 180;
}

export function wrapAtmosphereStar(value: number, extent: number): number {
  return ((value % extent) + extent) % extent;
}

export function createAtmosphereStars(count = 650) {
  let seed = 7321;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  return Array.from({length: count}, () => ({
    x: random(),
    y: random(),
    radius: 0.35 + random() ** 5 * 0.95,
    alpha: 0.18 + random() ** 2 * 0.6,
  }));
}
