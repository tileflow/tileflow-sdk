// What a compiled style tells Core's 3D renderers about the map's 3D buildings and street lights:
// their design from the buildings and roads modules, with the data's references still semantic
// (the caller binds them with the rest of the style), and the buildings' colour as the map's own
// final 3D building colour, else its roofs'.
import type {TileflowBuildings3DDesign} from '../buildings-3d-design';
import type {TileflowStreetLightsDesign} from '../street-lights';
import {tileflowDefaultStreetLightsDesign} from '../street-lights';
import type {TileflowDomainCompileContext} from './context';
import {toMapLibreStyleValue} from './values';

type Layer = {id: string; paint?: Record<string, unknown>};

// The colour of the map's buildings in 3D: its 3D building pass, its extrusion, then its roofs.
const colourSources: readonly (readonly [string, string])[] = [
  ['tileflow-buildings-render-extrusion', 'fill-extrusion-color'],
  ['tileflow-buildings-3d', 'fill-extrusion-color'],
  ['tileflow-buildings-fill', 'fill-color'],
];

/** The 3D buildings a map describes, or undefined when its buildings module is off. */
export function tileflowBuildings3DDesignOf(
  module: unknown,
  context: TileflowDomainCompileContext,
  layers: readonly Layer[],
): TileflowBuildings3DDesign | undefined {
  const config = (isRecord(module) ? module : {}) as {
    enabled?: boolean;
    threeDimensional?: Record<string, unknown>;
  };
  if (config.enabled === false) return undefined;
  const style = config.threeDimensional ?? {};
  let color: string | readonly unknown[] | undefined;
  for (const [id, property] of colourSources) {
    const value = layers.find((layer) => layer.id === id)?.paint?.[property];
    if (typeof value === 'string' || Array.isArray(value)) {
      color = value as string | readonly unknown[];
      break;
    }
  }
  const number = (value: unknown, fallback: number) => {
    const resolved = value === undefined ? undefined : toMapLibreStyleValue(value as never);
    return typeof resolved === 'number' ? resolved : fallback;
  };
  const edgeColor =
    style.edgeColor === undefined ? undefined : toMapLibreStyleValue(style.edgeColor as never);
  return {
    source: context.data.sourceId as unknown as string,
    layers: {
      building: context.data.schema.layers.building,
      ...(context.data.schema.layers.poi ? {places: context.data.schema.layers.poi} : {}),
    },
    color: color ?? context.colors.buildings.generic,
    edges: number(style.edges, 1),
    ...(typeof edgeColor === 'string' ? {edgeColor} : {}),
    nightLight: number(style.nightLight, 1),
    windows: style.windows === true,
    shadows: style.shadows !== false,
    occlusion: style.occlusion !== false,
  };
}

/**
 * The street lights a map describes, or undefined when its roads module or their street lights are
 * off, or the data binds no street furniture.
 */
export function tileflowStreetLightsDesignOf(
  module: unknown,
  context: TileflowDomainCompileContext,
): TileflowStreetLightsDesign | undefined {
  const config = (isRecord(module) ? module : {}) as {
    enabled?: boolean;
    streetLights?: Record<string, unknown>;
  };
  const layers = context.data.schema.layers;
  const style = config.streetLights ?? {};
  if (config.enabled === false || style.enabled === false || !layers.streetFurniture)
    return undefined;
  const color = style.color === undefined ? undefined : toMapLibreStyleValue(style.color as never);
  const intensity =
    style.intensity === undefined ? undefined : toMapLibreStyleValue(style.intensity as never);
  const estimate = style.estimate;
  return {
    source: context.data.sourceId as unknown as string,
    layers: {
      streetFurniture: layers.streetFurniture,
      transportation: layers.road,
      ...(layers.sidewalk ? {sidewalk: layers.sidewalk} : {}),
    },
    estimate:
      estimate === 'streets' || estimate === 'none' || estimate === 'lit' ? estimate : 'lit',
    color: typeof color === 'string' ? color : tileflowDefaultStreetLightsDesign.color,
    intensity: typeof intensity === 'number' ? intensity : 1,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
