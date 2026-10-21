// What a compiled style tells Core's 3D renderers about the map's 3D buildings and street lights:
// their design from the buildings and roads modules, with the data's references still semantic
// (the caller binds them with the rest of the style), the buildings' colour as the map's own final
// 3D building colour, else its roofs', and the tileset of Tileflow's landmarks the map shows.
import {readBuildingFloodLight, readModelRoleLighting} from '../building-illumination';
import {
  type TileflowBuildingModelPlacement,
  type TileflowBuildings3DDesign,
  readTileflowBuildingsEntrance,
  tileflowDefaultBuildings3DDesign,
} from '../buildings-3d-design';
import type {TileflowModelPart} from '../models-3d-model';
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
  /** Where each of the map's prepared building models is served, by id. */
  buildingModels?: Readonly<Record<string, string>>,
  /** The TileJSON of Tileflow's landmarks, when the map's data is Tileflow World. */
  tileflowLandmarks?: string,
): TileflowBuildings3DDesign | undefined {
  const config = (isRecord(module) ? module : {}) as {
    enabled?: boolean;
    threeDimensional?: Record<string, unknown>;
  };
  if (config.enabled === false) return undefined;
  const style = config.threeDimensional ?? {};
  const defaults = tileflowDefaultBuildings3DDesign;
  let color: string | readonly unknown[] | undefined;
  let verticalGradient = true;
  for (const [id, property] of colourSources) {
    const value = layers.find((layer) => layer.id === id)?.paint?.[property];
    if (typeof value === 'string' || Array.isArray(value)) {
      color = value as string | readonly unknown[];
      verticalGradient =
        layers.find((layer) => layer.id === id)?.paint?.['fill-extrusion-vertical-gradient'] !==
        false;
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
    lighting: style.lighting === 'style' ? 'style' : defaults.lighting,
    colorVariation: number(style.colorVariation, 0),
    verticalGradient,
    edges: number(style.edges, 0),
    edgeRadius: number(style.edgeRadius, defaults.edgeRadius),
    ...(typeof edgeColor === 'string' ? {edgeColor} : {}),
    nightLight: number(style.nightLight, 0),
    ...(isRecord(style.floodLight)
      ? {
          floodLight: readBuildingFloodLight({
            ...style.floodLight,
            intensity: number(style.floodLight.intensity, 0),
            brightnessScale: number(style.floodLight.brightnessScale, 1),
            color:
              style.floodLight.color === undefined
                ? undefined
                : toMapLibreStyleValue(style.floodLight.color as never),
          }),
        }
      : {}),
    ...(isRecord(style.modelLighting)
      ? {
          modelLighting: readModelRoleLighting(
            Object.fromEntries(
              Object.entries(style.modelLighting)
                .filter(([, entry]) => isRecord(entry))
                .map(([role, entry]) => {
                  const own = entry as Record<string, unknown>;
                  return [
                    role,
                    {
                      ...own,
                      emissiveStrength: number(own.emissiveStrength, 0),
                      ...Object.fromEntries(
                        ['emissiveVariation', 'colorMix', 'metallic', 'roughness']
                          .filter((key) => own[key] !== undefined)
                          .map((key) => [key, number(own[key], 0)]),
                      ),
                      ...(Array.isArray(own.emissiveHeight)
                        ? {emissiveHeight: own.emissiveHeight.map((v) => number(v, 0))}
                        : {}),
                      ...(isRecord(own.colorVariation)
                        ? {
                            colorVariation: {
                              ...own.colorVariation,
                              ...Object.fromEntries(
                                ['hue', 'saturation', 'lightness'].map((key) => [
                                  key,
                                  Array.isArray(
                                    (own.colorVariation as Record<string, unknown>)[key],
                                  )
                                    ? (
                                        (own.colorVariation as Record<string, unknown>)[
                                          key
                                        ] as unknown[]
                                      ).map((v) => number(v, 0))
                                    : [],
                                ]),
                              ),
                            },
                          }
                        : {}),
                      color:
                        own.color === undefined
                          ? undefined
                          : toMapLibreStyleValue(own.color as never),
                      emissiveColor:
                        own.emissiveColor === undefined
                          ? undefined
                          : toMapLibreStyleValue(own.emissiveColor as never),
                    },
                  ];
                }),
            ),
          ),
        }
      : {}),
    windows: style.windows === true,
    ...readTileflowBuildingsEntrance(style.entrance),
    shadows: typeof style.shadows === 'boolean' ? style.shadows : defaults.shadows,
    occlusion: typeof style.occlusion === 'boolean' ? style.occlusion : defaults.occlusion,
    modelOcclusion: number(style.modelOcclusion, defaults.modelOcclusion),
    ...placedModels(style.models, buildingModels),
    ...modelColours(style.modelColors),
    ...landmarksOf(style.landmarks, tileflowLandmarks),
  };
}

/**
 * The landmarks a map shows: Tileflow's with Tileflow World buildings unless it switches them
 * off, or the tileset it names.
 */
function landmarksOf(
  value: unknown,
  tileflowLandmarks: string | undefined,
): {landmarks?: {url: string}} {
  if (value === false) return {};
  if (isRecord(value) && typeof value.url === 'string') return {landmarks: {url: value.url}};
  return tileflowLandmarks ? {landmarks: {url: tileflowLandmarks}} : {};
}

/** The models a map places, each with where its prepared file is served. */
function placedModels(
  value: unknown,
  served: Readonly<Record<string, string>> | undefined,
): {models?: TileflowBuildingModelPlacement[]} {
  if (!Array.isArray(value) || value.length === 0) return {};
  const placements = value as {
    model: string;
    at: [number, number];
    heading?: number;
    url?: string;
  }[];
  // A placement that names where its prepared file is served needs no model of the map's own.
  const missing = [
    ...new Set(
      placements
        .filter((entry) => !entry.url)
        .map((entry) => entry.model)
        .filter((id) => !served?.[id]),
    ),
  ].sort();
  if (missing.length > 0)
    throw new Error(
      `The buildings module places missing 3D models: ${missing.join(', ')}. Add ${missing
        .map((id) => `${id}.glb`)
        .join(
          ', ',
        )} to a map.models directory, with materials named surface, secondary, glass, accent or roof, and run the Node build so the directories are prepared.`,
    );
  return {
    models: placements.map((entry) => ({
      model: entry.model,
      url: entry.url ?? served![entry.model]!,
      at: [entry.at[0], entry.at[1]] as const,
      heading: (((entry.heading ?? 0) % 360) + 360) % 360,
    })),
  };
}

/** The colours of the models' parts, resolved for the theme. */
function modelColours(value: unknown): {
  modelColors?: Partial<Record<TileflowModelPart, string>>;
} {
  if (!isRecord(value)) return {};
  const colours: Partial<Record<TileflowModelPart, string>> = {};
  for (const [part, colour] of Object.entries(value)) {
    const resolved = colour === undefined ? undefined : toMapLibreStyleValue(colour as never);
    if (typeof resolved === 'string') colours[part as TileflowModelPart] = resolved;
  }
  return Object.keys(colours).length > 0 ? {modelColors: colours} : {};
}

/**
 * The street lights a map describes, or undefined when its roads module or their street lights are
 * not explicitly enabled, or the data binds no street furniture.
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
  if (config.enabled === false || style.enabled !== true || !layers.streetFurniture)
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
