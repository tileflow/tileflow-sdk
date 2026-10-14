// How a compiled map's 3D buildings look, as the buildings module describes them for Core's 3D
// buildings renderer: the colour of each building (the map's own 3D building colour, else its
// roofs'), the strength and colour of roof outlines, the night light, the invented night windows,
// whether shadows and contact shadow fall, and the building models the map places in its city with
// the colours of their parts. The compiler publishes it, resolved for one theme, in the style's
// metadata; the renderer reads it for every theme on screen. It has no DOM dependency.
import {type TileflowModelPart, tileflowModelParts} from './models-3d-model';

/** The style metadata key under which a compiled map describes its 3D buildings. */
export const tileflowBuildingsMetadataKey = 'tileflow:buildings';

/** A compiled map's 3D buildings, resolved for one theme. */
export type TileflowBuildings3DDesign = Readonly<{
  /** The vector source and its layers with the buildings and the places they hold. */
  source: string;
  layers: Readonly<{building: string; places?: string}>;
  /**
   * Each building's colour: a CSS colour, or a MapLibre expression over the building's
   * properties that gives one, as the map colours its 3D buildings (or its roofs).
   */
  color: string | readonly unknown[];
  /** How strongly roof outlines and outer corners catch the light, from 0 to 1. */
  edges: number;
  /** Their own colour, drawn unlit; without it they take the building's colour, lightened. */
  edgeColor?: string;
  /** How bright the buildings light the street at night, from 0 to 2. */
  nightLight: number;
  /** Invented night windows, lit by rooms: decoration, not data. */
  windows: boolean;
  /** Shadows from the sun, and contact shadow at the foot of the walls. */
  shadows: boolean;
  occlusion: boolean;
  /** Building models the map places in its city, each replacing the buildings under it. */
  models?: readonly TileflowBuildingModelPlacement[];
  /** The colours of the models' parts; a part without one takes it from the building colour. */
  modelColors?: Readonly<Partial<Record<TileflowModelPart, string>>>;
}>;

/** A building model standing in the map's city. */
export type TileflowBuildingModelPlacement = Readonly<{
  /** The model's id, its file's name in the map's `models` directories. */
  model: string;
  /** Where the prepared model file is served, absolute or relative to the page. */
  url: string;
  /** Longitude and latitude of the model's origin, where it stands on the ground. */
  at: readonly [number, number];
  /** Degrees clockwise from north that the model's own north is turned to. */
  heading: number;
}>;

/** The 3D buildings of a style compiled without this description. */
export const tileflowDefaultBuildings3DDesign: TileflowBuildings3DDesign = Object.freeze({
  source: 'tileflow',
  layers: Object.freeze({building: 'building', places: 'poi'}),
  color: '#d8d0c0',
  edges: 1,
  nightLight: 1,
  windows: false,
  shadows: true,
  occlusion: true,
});

/** The metadata a compiled style publishes for its 3D buildings. */
export function tileflowBuildingsMetadata(
  design: TileflowBuildings3DDesign,
): Readonly<{version: 1} & TileflowBuildings3DDesign> {
  return {version: 1, ...design};
}

/**
 * Reads the 3D buildings a compiled style describes, or undefined when its metadata has none or a
 * version or shape this Core does not know.
 */
export function readTileflowBuildings3D(metadata: unknown): TileflowBuildings3DDesign | undefined {
  if (!isRecord(metadata)) return undefined;
  const value = metadata[tileflowBuildingsMetadataKey];
  if (!isRecord(value) || value.version !== 1) return undefined;
  const {source, layers, color} = value;
  if (typeof source !== 'string' || !isRecord(layers) || typeof layers.building !== 'string')
    return undefined;
  if (typeof color !== 'string' && !Array.isArray(color)) return undefined;
  const within = (number: unknown, high: number, fallback: number) =>
    typeof number === 'number' && number >= 0 && number <= high ? number : fallback;
  return {
    source,
    layers: {
      building: layers.building,
      ...(typeof layers.places === 'string' ? {places: layers.places} : {}),
    },
    color: color as string | readonly unknown[],
    edges: within(value.edges, 1, 1),
    ...(typeof value.edgeColor === 'string' ? {edgeColor: value.edgeColor} : {}),
    nightLight: within(value.nightLight, 2, 1),
    windows: value.windows === true,
    shadows: value.shadows !== false,
    occlusion: value.occlusion !== false,
    ...modelsOf(value.models),
    ...modelColorsOf(value.modelColors),
  };
}

const modelId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
/** The most models one map places. */
export const tileflowBuildingModelPlacementLimit = 256;

/** The placements a design names, skipping any it cannot read. */
function modelsOf(value: unknown): {models?: readonly TileflowBuildingModelPlacement[]} {
  if (!Array.isArray(value)) return {};
  const models: TileflowBuildingModelPlacement[] = [];
  for (const entry of value.slice(0, tileflowBuildingModelPlacementLimit)) {
    if (!isRecord(entry)) continue;
    const {model, url, at, heading} = entry;
    if (typeof model !== 'string' || !modelId.test(model) || typeof url !== 'string' || !url)
      continue;
    if (!Array.isArray(at) || at.length !== 2) continue;
    const [longitude, latitude] = at as unknown[];
    if (
      typeof longitude !== 'number' ||
      typeof latitude !== 'number' ||
      !(longitude >= -180 && longitude <= 180) ||
      !(latitude >= -85 && latitude <= 85)
    )
      continue;
    const turn = typeof heading === 'number' && Number.isFinite(heading) ? heading : 0;
    models.push({model, url, at: [longitude, latitude], heading: ((turn % 360) + 360) % 360});
  }
  return models.length > 0 ? {models} : {};
}

function modelColorsOf(value: unknown): {
  modelColors?: Readonly<Partial<Record<TileflowModelPart, string>>>;
} {
  if (!isRecord(value)) return {};
  const colors: Partial<Record<TileflowModelPart, string>> = {};
  for (const part of Object.keys(tileflowModelParts) as TileflowModelPart[])
    if (typeof value[part] === 'string') colors[part] = value[part];
  return Object.keys(colors).length > 0 ? {modelColors: colors} : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
