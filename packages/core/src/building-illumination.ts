import type {TileflowModelLightingRole} from './models-3d-model';
import {tileflowModelLightingRoles} from './models-3d-model';
import type {TileflowSun} from './sun';

/** Begin/end height fractions, begin/end multipliers and the base-10 curve exponent. */
export type TileflowModelEmissionGradient = readonly [number, number, number, number, number];

export type TileflowModelRoleLighting = Readonly<{
  emissiveStrength: number;
  emissiveVariation?: number;
  emissiveColor?: string;
  emissiveHeight: TileflowModelEmissionGradient;
  color?: string;
  colorMix?: number;
  /** Relative surface brightness after role and part colours, from zero to one. */
  colorScale?: number;
  metallic?: number;
  roughness?: number;
  /** Map shading normalizes sunlight to the surrounding extruded buildings. */
  shading?: 'physical' | 'map';
  /** Multiplier for the scene's model ambient occlusion. Defaults to one. */
  ambientOcclusion?: number;
  /** Contribution of named part colours after the role tint. Defaults to one. */
  partColorMix?: number;
  colorVariation?: Readonly<{
    hue: readonly [number, number];
    saturation: readonly [number, number];
    lightness: readonly [number, number];
    /** Colour factors may be authored in linear light, as in glTF. Defaults to sRGB. */
    space?: 'srgb' | 'linear';
  }>;
}>;

export type TileflowBuildingFloodLight = Readonly<{
  intensity: number;
  brightnessScale: number;
  color: string;
  groundRadius: readonly [number, number];
  minGroundHeight: number;
  minWallHeight: number;
  wallHeightRatio: number;
}>;

export const defaultBuildingFloodLight: TileflowBuildingFloodLight = Object.freeze({
  intensity: 0,
  brightnessScale: 1,
  color: '#f5cfa8',
  groundRadius: [30, 100] as const,
  minGroundHeight: 30,
  minWallHeight: 200,
  wallHeightRatio: 1 / 3,
});

export const defaultModelEmissionGradient: TileflowModelEmissionGradient = [0, 1, 1, 1, 0];

/** A bounded architectural light profile in compiled style metadata. */
export function readBuildingFloodLight(value: unknown): TileflowBuildingFloodLight | undefined {
  if (!record(value)) return undefined;
  const defaults = defaultBuildingFloodLight;
  const radius = value.groundRadius;
  return {
    intensity: bounded(value.intensity, 0, 1, 0),
    brightnessScale: bounded(value.brightnessScale, 0, 16, 1),
    color: typeof value.color === 'string' ? value.color : defaults.color,
    groundRadius:
      Array.isArray(radius) &&
      radius.length === 2 &&
      radius.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 2048) &&
      radius[0] <= radius[1]
        ? [radius[0], radius[1]]
        : defaults.groundRadius,
    minGroundHeight: bounded(value.minGroundHeight, 0, 6000, defaults.minGroundHeight),
    minWallHeight: bounded(value.minWallHeight, 0, 6000, defaults.minWallHeight),
    wallHeightRatio: bounded(value.wallHeightRatio, 0, 1, defaults.wallHeightRatio),
  };
}

export function readModelRoleLighting(
  value: unknown,
): Partial<Record<TileflowModelLightingRole, TileflowModelRoleLighting>> | undefined {
  if (!record(value)) return undefined;
  const result: Partial<Record<TileflowModelLightingRole, TileflowModelRoleLighting>> = {};
  for (const role of Object.keys(tileflowModelLightingRoles) as TileflowModelLightingRole[]) {
    const entry = value[role];
    if (!record(entry)) continue;
    const gradient = entry.emissiveHeight;
    result[role] = {
      emissiveStrength: bounded(entry.emissiveStrength, 0, 5, 0),
      ...(entry.emissiveVariation === undefined
        ? {}
        : {emissiveVariation: bounded(entry.emissiveVariation, 0, 1, 0)}),
      ...(typeof entry.emissiveColor === 'string' ? {emissiveColor: entry.emissiveColor} : {}),
      ...(typeof entry.color === 'string' ? {color: entry.color} : {}),
      ...(entry.colorMix === undefined ? {} : {colorMix: bounded(entry.colorMix, 0, 1, 1)}),
      ...(entry.colorScale === undefined ? {} : {colorScale: bounded(entry.colorScale, 0, 1, 1)}),
      ...(entry.metallic === undefined ? {} : {metallic: bounded(entry.metallic, 0, 1, 0)}),
      ...(entry.roughness === undefined ? {} : {roughness: bounded(entry.roughness, 0, 1, 1)}),
      ...(entry.shading === 'map' || entry.shading === 'physical' ? {shading: entry.shading} : {}),
      ...(entry.ambientOcclusion === undefined
        ? {}
        : {ambientOcclusion: bounded(entry.ambientOcclusion, 0, 1, 1)}),
      ...(entry.partColorMix === undefined
        ? {}
        : {partColorMix: bounded(entry.partColorMix, 0, 1, 1)}),
      ...readRoleColorVariation(entry.colorVariation),
      emissiveHeight:
        Array.isArray(gradient) &&
        gradient.length === 5 &&
        gradient.every(
          (v, i) =>
            typeof v === 'number' && Number.isFinite(v) && v <= 1 && v >= (i === 4 ? -1 : 0),
        )
          ? (gradient as unknown as TileflowModelEmissionGradient)
          : defaultModelEmissionGradient,
    };
  }
  return Object.keys(result).length ? result : undefined;
}

function readRoleColorVariation(value: unknown): Pick<TileflowModelRoleLighting, 'colorVariation'> {
  if (!record(value)) return {};
  for (const [key, max] of [
    ['hue', 360],
    ['saturation', 100],
    ['lightness', 100],
  ] as const) {
    const range = value[key];
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      range[0] > range[1] ||
      !range.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max)
    )
      return {};
  }
  if (value.space !== undefined && value.space !== 'srgb' && value.space !== 'linear') return {};
  return {colorVariation: value as TileflowModelRoleLighting['colorVariation']};
}

/**
 * Architectural lights respond to the scene's ambient radiance and a linear altitude weight.
 * This keeps the authored dawn/dusk threshold independent of the building palette.
 */
export function buildingFloodLightShare(sun: TileflowSun, brightnessScale = 1): number {
  const luminance = (rgb: readonly number[]) => {
    const linear = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  };
  const brightness =
    (luminance(sun.ambient.rgb) * sun.ambient.intensity +
      luminance(sun.rgb) * sun.intensity * Math.max(0, sun.altitude / 90)) /
    2;
  return Math.min(1, Math.max(0, (0.026 - brightness * brightnessScale) / (0.026 - 0.015)));
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
