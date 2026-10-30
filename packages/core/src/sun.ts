// The sun of a map: where it stands, the light it and the sky give, and how dark the shadows it
// casts fall. A theme describes its own sun (`lighting.sun`, `lighting.ambient`), as a designer's
// light for that theme; the compiler publishes it in the style's metadata and points the map's
// light at it. In a browser, the theme controller mixes the suns of blended themes and lets an
// application place the sun itself, by direction or by the real sun of a date and place.
import {mixTileflowColours, tileflowColourChannels} from './theme-blend';
import type {TileflowLight} from './types';

export const tileflowSunMetadataKey = 'tileflow:sun';

/** A theme's sun and sky light with every value resolved; see `TileflowThemeSun`. */
export type TileflowSunPreset = Readonly<{
  /** Degrees clockwise from north, from 0 to 360. */
  azimuth: number;
  /** Degrees above the horizon, from -90 to 90. */
  altitude: number;
  /** The direct light's colour. */
  color: string;
  /** The direct light's strength, from 0 to 1. */
  intensity: number;
  /** How dark the shadows the sun casts fall, from 0 (none) to 1. */
  shadowIntensity: number;
  /** The light from the sky, which reaches every surface and fills the shadows. */
  ambient: Readonly<{color: string; intensity: number}>;
}>;

/** The sun as the map shows it, ready for an application's own layers. */
export type TileflowSun = Readonly<{
  /** Degrees clockwise from north, from 0 to 360. */
  azimuth: number;
  /** Degrees above the horizon, from -90 to 90. */
  altitude: number;
  /** A unit vector towards the sun: x east, y north, z up. */
  direction: readonly [number, number, number];
  /** The direct light's colour, as a CSS colour. */
  color: string;
  /** The direct light's colour as sRGB channels from 0 to 1. */
  rgb: readonly [number, number, number];
  /**
   * The direct light's strength, from 0 to 1. It fades to 0 as the sun sets: a sun below the
   * horizon lights nothing and casts no shadow.
   */
  intensity: number;
  /** How dark the shadows the sun casts fall, from 0 (none) to 1. */
  shadowIntensity: number;
  /** The light from the sky, which reaches every surface and fills the shadows. */
  ambient: Readonly<{
    color: string;
    rgb: readonly [number, number, number];
    intensity: number;
  }>;
  /**
   * How bright flat, open ground is under this light, from 0 (dark) to 1: the sky's light plus the
   * sun's at its height, each weighted by its colour's luminance. Use it to switch lamps or windows
   * on as a scene darkens, whatever theme or sun lights it.
   */
  brightness: number;
  /** Where the direction comes from: the themes, angles, or a date and place. */
  source: 'theme' | 'direction' | 'date';
}>;

/** Unset sun values: high in the south-south-west, with soft white daylight and ambient fill. */
export const tileflowDefaultSunPreset: TileflowSunPreset = Object.freeze({
  azimuth: 210,
  altitude: 60,
  color: '#ffffff',
  intensity: 0.2,
  shadowIntensity: 1,
  ambient: Object.freeze({color: '#ffffff', intensity: 0.8}),
});

const degrees = Math.PI / 180;

/** An angle in degrees from 0 (inclusive) to 360 (exclusive). */
export function normalizeTileflowAzimuth(azimuth: number): number {
  const turned = azimuth % 360;
  return turned < 0 ? turned + 360 : turned === 0 ? 0 : turned;
}

/**
 * Where the sun stands for an instant and a place ([longitude, latitude] in degrees): its azimuth
 * in degrees clockwise from north and its apparent altitude above the horizon, with atmospheric
 * refraction. It follows NOAA's solar equations, accurate to about a hundredth of a degree for
 * years 1800 to 2200.
 */
export function tileflowSunPosition(
  date: Date | number,
  location: readonly [number, number],
): Readonly<{azimuth: number; altitude: number}> {
  const time = typeof date === 'number' ? date : date.getTime();
  const [longitude, latitude] = location;
  if (!Number.isFinite(time)) throw new TypeError('The sun position needs a valid date.');
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    throw new TypeError(
      'The sun position needs a [longitude, latitude] location in degrees, latitude from -90 to 90.',
    );
  }
  // Julian centuries since J2000.0.
  const t = (time / 86_400_000 + 2_440_587.5 - 2_451_545) / 36_525;
  const meanLongitude = normalizeTileflowAzimuth(280.46646 + t * (36_000.76983 + t * 0.0003032));
  const meanAnomaly = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const m = meanAnomaly * degrees;
  const centre =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;
  const omega = (125.04 - 1934.136 * t) * degrees;
  const apparentLongitude =
    (meanLongitude + centre - 0.00569 - 0.00478 * Math.sin(omega)) * degrees;
  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = (meanObliquity + 0.00256 * Math.cos(omega)) * degrees;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparentLongitude));
  const y = Math.tan(obliquity / 2) ** 2;
  const l0 = meanLongitude * degrees;
  // The equation of time, in minutes.
  const equation =
    (4 / degrees) *
    (y * Math.sin(2 * l0) -
      2 * eccentricity * Math.sin(m) +
      4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * m));
  const minutes = (((time % 86_400_000) + 86_400_000) % 86_400_000) / 60_000;
  const solarMinutes = (((minutes + equation + 4 * longitude) % 1440) + 1440) % 1440;
  const hourAngle = (solarMinutes / 4 - 180) * degrees;
  const phi = latitude * degrees;
  const cosZenith = Math.min(
    1,
    Math.max(
      -1,
      Math.sin(phi) * Math.sin(declination) +
        Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle),
    ),
  );
  const elevation = 90 - Math.acos(cosZenith) / degrees;
  // Measured from south towards west, then turned to north and clockwise.
  const azimuth = normalizeTileflowAzimuth(
    Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(phi) - Math.tan(declination) * Math.cos(phi),
    ) /
      degrees +
      180,
  );
  return Object.freeze({azimuth, altitude: Math.min(90, elevation + refraction(elevation))});
}

/** NOAA's approximation of atmospheric refraction near the horizon, in degrees. */
function refraction(elevation: number): number {
  if (elevation > 85) return 0;
  const tangent = Math.tan(elevation * degrees);
  let seconds: number;
  if (elevation > 5) seconds = 58.1 / tangent - 0.07 / tangent ** 3 + 0.000086 / tangent ** 5;
  else if (elevation > -0.575)
    seconds =
      1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
  else seconds = -20.772 / tangent;
  return seconds / 3600;
}

/** A unit vector towards a direction in the sky: x east, y north, z up. */
export function tileflowSunDirection(
  azimuth: number,
  altitude: number,
): readonly [number, number, number] {
  const a = azimuth * degrees;
  const h = altitude * degrees;
  return Object.freeze([
    Math.sin(a) * Math.cos(h),
    Math.cos(a) * Math.cos(h),
    Math.sin(h),
  ] as const);
}

/**
 * The sun as the map shows it: a preset's light from a direction. Direct light fades out over the
 * sun's last degrees above the horizon and is gone below it.
 */
export function resolveTileflowSun(
  preset: TileflowSunPreset,
  direction: Readonly<{azimuth: number; altitude: number}> = preset,
  source: TileflowSun['source'] = 'theme',
): TileflowSun {
  const azimuth = normalizeTileflowAzimuth(direction.azimuth);
  const altitude = Math.min(90, Math.max(-90, direction.altitude));
  const horizon = smoothstep(-0.5, 3, altitude);
  const intensity = clamp01(preset.intensity) * horizon;
  const rgb = rgbOf(preset.color);
  const ambientRgb = rgbOf(preset.ambient.color);
  const ambientIntensity = clamp01(preset.ambient.intensity);
  const brightness = clamp01(
    (luminance(ambientRgb) * ambientIntensity +
      luminance(rgb) * intensity * Math.max(0, Math.sin(altitude * degrees))) /
      2,
  );
  return Object.freeze({
    azimuth,
    altitude,
    direction: tileflowSunDirection(azimuth, altitude),
    color: preset.color,
    rgb,
    intensity,
    shadowIntensity: clamp01(preset.shadowIntensity),
    ambient: Object.freeze({
      color: preset.ambient.color,
      rgb: ambientRgb,
      intensity: ambientIntensity,
    }),
    brightness: Number(brightness.toFixed(6)),
    source,
  });
}

/**
 * A preset `t` of the way from `from` to `to`: the azimuth turns the short way round, colours mix
 * in OKLab, as theme blends mix paint colours, and numbers linearly.
 */
export function mixTileflowSunPresets(
  from: TileflowSunPreset,
  to: TileflowSunPreset,
  t: number,
): TileflowSunPreset {
  const at = clamp01(Number.isFinite(t) ? t : 0);
  if (at === 0) return from;
  if (at === 1) return to;
  const colour = (a: string, b: string) => mixTileflowColours(a, b, at) ?? (at < 0.5 ? a : b);
  const number = (a: number, b: number) => a + (b - a) * at;
  return Object.freeze({
    azimuth: mixTileflowAzimuths(from.azimuth, to.azimuth, at),
    altitude: number(from.altitude, to.altitude),
    color: colour(from.color, to.color),
    intensity: number(from.intensity, to.intensity),
    shadowIntensity: number(from.shadowIntensity, to.shadowIntensity),
    ambient: Object.freeze({
      color: colour(from.ambient.color, to.ambient.color),
      intensity: number(from.ambient.intensity, to.ambient.intensity),
    }),
  });
}

/** The preset at a blend position over the blended themes' presets, in blend order. */
export function tileflowSunPresetAt(
  presets: readonly TileflowSunPreset[],
  position: number,
): TileflowSunPreset | undefined {
  if (presets.length === 0) return undefined;
  const at = Math.min(presets.length - 1, Math.max(0, Number.isFinite(position) ? position : 0));
  const lower = Math.floor(at);
  const upper = Math.min(presets.length - 1, lower + 1);
  return mixTileflowSunPresets(presets[lower]!, presets[upper]!, at - lower);
}

/** An azimuth `t` of the way from `from` to `to`, turning the short way round. */
export function mixTileflowAzimuths(from: number, to: number, t: number): number {
  let delta = normalizeTileflowAzimuth(to) - normalizeTileflowAzimuth(from);
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return normalizeTileflowAzimuth(from + delta * t);
}

/** The metadata entry a compiled style carries for its theme's sun. */
export function tileflowSunMetadata(preset: TileflowSunPreset): Readonly<Record<string, unknown>> {
  return Object.freeze({version: 1, ...preset});
}

/** Reads the sun a compiled style publishes, or undefined when its metadata has none. */
export function readTileflowSunPreset(metadata: unknown): TileflowSunPreset | undefined {
  if (!isRecord(metadata)) return undefined;
  const value = metadata[tileflowSunMetadataKey];
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.ambient)) return undefined;
  const {azimuth, altitude, color, intensity, shadowIntensity} = value;
  const ambient = value.ambient;
  if (
    !isFiniteNumber(azimuth) ||
    !isFiniteNumber(altitude) ||
    !isUnit(intensity) ||
    !isUnit(shadowIntensity) ||
    !isUnit(ambient.intensity) ||
    !isColour(color) ||
    !isColour(ambient.color)
  )
    return undefined;
  return Object.freeze({
    azimuth: normalizeTileflowAzimuth(azimuth),
    altitude: Math.min(90, Math.max(-90, altitude)),
    color,
    intensity,
    shadowIntensity,
    ambient: Object.freeze({color: ambient.color, intensity: ambient.intensity}),
  });
}

/**
 * The sun of a compiled style: the one it publishes, else one read from its light (a style whose
 * theme describes no sun lights its extrusions from `light.position`), else the default.
 */
export function tileflowStyleSunPreset(
  style: {light?: unknown; metadata?: unknown} | undefined,
): TileflowSunPreset {
  const published = readTileflowSunPreset(style?.metadata);
  if (published) return published;
  const light = isRecord(style?.light) ? (style.light as TileflowLight) : undefined;
  const position = light?.position;
  if (!position) return tileflowDefaultSunPreset;
  return Object.freeze({
    ...tileflowDefaultSunPreset,
    azimuth: normalizeTileflowAzimuth(position[1]),
    altitude: Math.min(90, Math.max(-90, 90 - position[2])),
    ...(typeof light.color === 'string' && isColour(light.color) ? {color: light.color} : {}),
  });
}

/**
 * The map's light for a sun: anchored to the map and pointing from the sun's direction, so 3D
 * buildings are shaded from where the sun stands. `base` keeps a theme's other light values
 * (colour, strength, distance), which tune MapLibre's extrusion shading.
 */
export function tileflowSunLight(
  direction: Readonly<{azimuth: number; altitude: number}>,
  base: TileflowLight | undefined,
): TileflowLight {
  const radial = base?.position?.[0] ?? 1.15;
  return {
    ...(base ?? {}),
    anchor: 'map',
    position: [
      radial,
      Number(normalizeTileflowAzimuth(direction.azimuth).toFixed(3)),
      // MapLibre lights the extrusions from above the horizon only.
      Number(Math.min(90, Math.max(0, 90 - direction.altitude)).toFixed(3)),
    ],
  };
}

function rgbOf(colour: string): readonly [number, number, number] {
  const channels = tileflowColourChannels(colour) ?? [1, 1, 1, 1];
  return Object.freeze([channels[0], channels[1], channels[2]] as const);
}

// Relative luminance of an sRGB colour (WCAG).
function luminance([r, g, b]: readonly [number, number, number]): number {
  const linear = (value: number) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function smoothstep(from: number, to: number, value: number): number {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUnit(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isColour(value: unknown): value is string {
  return typeof value === 'string' && tileflowColourChannels(value) !== null;
}
