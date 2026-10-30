import type {TileflowThemeColorValue, TileflowThemeNumberValue} from './cartography/values';
import {mixTileflowColours} from './theme-blend';

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
  /** The light round a low sun, which glows on the horizon towards it. Default: `#ffc68a`. */
  glowColor?: TileflowThemeColorValue;
  /** The brightest the stars shine, from 0 (none) to 1, reached where the sky is dark. Default: 0.6. */
  starIntensity?: TileflowThemeNumberValue;
};

export type TileflowSky = boolean | TileflowSkyOptions;

export type TileflowResolvedSky = {
  color: `#${string}`;
  horizonColor: `#${string}`;
  horizonBlend: number;
  glowColor: `#${string}`;
  starIntensity: number;
};

export const tileflowSkyMetadataKey = 'tileflow:sky';

/** One theme's sky colours, as a time of day lends them to a sky that follows the sun. */
export type TileflowSkyColours = Readonly<{
  color: string;
  horizonColor: string;
  horizonBlend: number;
  glowColor: string;
}>;

/** The skies of a theme's time-of-day family, from which a sky that follows the sun is mixed. */
export type TileflowSkyTimesOfDay = Readonly<
  Record<'day' | 'dawn' | 'dusk' | 'night', TileflowSkyColours>
>;

/**
 * The versioned runtime payload: what the browser needs to draw the stars and the glow round the
 * sun, and, for a theme in a time-of-day family, the family's skies, so that a sun an application
 * places brings the sky of its hour.
 */
export type TileflowSkyMetadata = Readonly<{
  version: 1;
  starIntensity: number;
  glowColor: string;
  timesOfDay?: TileflowSkyTimesOfDay;
}>;

const hexColour = /^#[0-9a-f]{6}$/iu;
const unit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

function readColours(value: unknown): TileflowSkyColours | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4) return undefined;
  const {color, horizonColor, horizonBlend, glowColor} = record;
  if (
    typeof color !== 'string' ||
    !hexColour.test(color) ||
    typeof horizonColor !== 'string' ||
    !hexColour.test(horizonColor) ||
    typeof glowColor !== 'string' ||
    !hexColour.test(glowColor) ||
    !unit(horizonBlend)
  )
    return undefined;
  return {color, horizonColor, horizonBlend, glowColor};
}

/** Validate the runtime payload without loading authoring schemas. */
export function readTileflowSky(value: unknown): TileflowSkyMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (record.version !== 1 || keys.length !== (record.timesOfDay === undefined ? 3 : 4))
    return undefined;
  const {starIntensity, glowColor, timesOfDay} = record;
  if (!unit(starIntensity) || typeof glowColor !== 'string' || !hexColour.test(glowColor))
    return undefined;
  if (timesOfDay === undefined) return {version: 1, starIntensity, glowColor};
  if (!timesOfDay || typeof timesOfDay !== 'object' || Array.isArray(timesOfDay)) return undefined;
  const times = timesOfDay as Record<string, unknown>;
  if (Object.keys(times).length !== 4) return undefined;
  const day = readColours(times.day);
  const dawn = readColours(times.dawn);
  const dusk = readColours(times.dusk);
  const night = readColours(times.night);
  if (!day || !dawn || !dusk || !night) return undefined;
  return {version: 1, starIntensity, glowColor, timesOfDay: {day, dawn, dusk, night}};
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

const smooth = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/**
 * How strongly a sun at this height, in degrees above the horizon, glows on the horizon, from 0 to
 * 1: brightest as it touches the horizon, gone by mid-morning, and gone once it is well below.
 */
export function tileflowSkyGlowStrength(altitude: number): number {
  return smooth(-9, -1, altitude) * (1 - smooth(6, 24, altitude));
}

function mixColours(from: TileflowSkyColours, to: TileflowSkyColours, t: number) {
  if (t <= 0) return from;
  if (t >= 1) return to;
  return {
    color: mixTileflowColours(from.color, to.color, t) ?? to.color,
    horizonColor: mixTileflowColours(from.horizonColor, to.horizonColor, t) ?? to.horizonColor,
    horizonBlend: from.horizonBlend + (to.horizonBlend - from.horizonBlend) * t,
    glowColor: mixTileflowColours(from.glowColor, to.glowColor, t) ?? to.glowColor,
  };
}

/**
 * The sky of a sun at this height and direction, mixed from a time-of-day family's skies: the day
 * sky above the golden hour, the dawn or dusk sky within two degrees of sunrise or sunset (dawn while the sun is in
 * the eastern half of the sky), and the night sky once twilight ends. Every colour comes from the
 * family's themes, so a monochrome or a client's own family keeps its palette.
 */
export function tileflowSkyAtSun(
  times: TileflowSkyTimesOfDay,
  sun: Readonly<{altitude: number; azimuth: number}>,
): TileflowSkyColours {
  const azimuth = ((sun.azimuth % 360) + 360) % 360;
  const twilight = azimuth < 180 ? times.dawn : times.dusk;
  if (sun.altitude >= 2) return mixColours(twilight, times.day, smooth(2, 14, sun.altitude));
  if (sun.altitude >= -2) return twilight;
  return mixColours(times.night, twilight, smooth(-10, -2, sun.altitude));
}

/**
 * Where a theme controller publishes the sun on screen for the map's sky layer. A symbol on the
 * map object keeps it shared between copies of the browser runtime on one page.
 */
export const tileflowSkySunKey = Symbol.for('tileflow.skySun');

/** The sun a theme controller placed on this map, if any. */
export type TileflowSkySun = Readonly<{
  altitude: number;
  azimuth: number;
  direction: readonly [number, number, number];
  source: 'theme' | 'direction' | 'date';
}>;
