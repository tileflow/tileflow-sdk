// How a compiled map's 3D buildings look, as the buildings module describes them for Core's 3D
// buildings renderer: the colour of each building (the map's own 3D building colour, else its
// roofs'), the strength and colour of roof outlines, the night light, the invented night windows,
// whether shadows and contact shadow fall, the building models the map places in its city with the
// colours of their parts, and the tileset of Tileflow's landmarks it shows. The compiler publishes it, resolved for one theme, in the style's
// metadata; the renderer reads it for every theme on screen. It has no DOM dependency.
import {
  readBuildingFloodLight,
  readModelRoleLighting,
  type TileflowBuildingFloodLight,
  type TileflowModelRoleLighting,
} from './building-illumination';
import {
  readTileflowBuildingSurfaces,
  type TileflowBuildingSurfaceDesign,
} from './buildings-3d-surfaces';
import {type TileflowModelPart, tileflowModelParts} from './models-3d-model';
import type {TileflowModelLightingRole} from './models-3d-model';

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
  /** Exterior corner radius and roof lighting transition, in metres; 0 keeps sharp edges. */
  edgeRadius?: number;
  /** Scene sun lighting by default; `style` uses the native extrusion light. */
  lighting: 'style' | 'sun';
  /** Per-building brightness variation, from 0 to 1; 0 preserves the authored colour. */
  colorVariation: number;
  /** The authored extrusion's vertical wall gradient. */
  verticalGradient: boolean;
  /** Their own colour, drawn unlit; without it they take the building's colour, lightened. */
  edgeColor?: string;
  /** How bright the buildings light the street at night, from 0 to 2. */
  nightLight: number;
  /** Height-selected light on ordinary buildings and the ground, independent of shop windows. */
  floodLight?: TileflowBuildingFloodLight;
  /** Emission by architectural role, independent of model palette slots. */
  modelLighting?: Readonly<Partial<Record<TileflowModelLightingRole, TileflowModelRoleLighting>>>;
  /** Invented night windows, lit by rooms: decoration, not data. */
  windows: boolean;
  /** Optional decoration on ordinary walls and roofs, independent of model materials. */
  surfaces?: TileflowBuildingSurfaceDesign;
  /**
   * The zoom bands, `[from, to]`, the buildings and the placed models and landmarks come in over:
   * across its band each fades in and rises from the ground. The renderer's defaults stand for a
   * band left out.
   */
  entrance?: Readonly<{buildings?: readonly [number, number]; models?: readonly [number, number]}>;
  /** Shadows from the sun, and contact shadow at the foot of the walls. */
  shadows: boolean;
  occlusion: boolean;
  /** Strength of prepared model ambient visibility; zero leaves the sky contribution unchanged. */
  modelOcclusion?: number;
  /** Building models the map places in its city, each replacing the buildings under it. */
  models?: readonly TileflowBuildingModelPlacement[];
  /** The colours of the models' parts; a part without one takes it from the building colour. */
  modelColors?: Readonly<Partial<Record<TileflowModelPart, string>>>;
  /**
   * Tileflow's landmarks, drawn as models in place of the buildings under them: the TileJSON of
   * their tileset. Without it, the map shows none.
   */
  landmarks?: Readonly<{url: string}>;
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
export const tileflowDefaultBuildings3DDesign = Object.freeze({
  source: 'tileflow',
  layers: Object.freeze({building: 'building', places: 'poi'}),
  color: '#d8d0c0',
  edges: 0,
  edgeRadius: 0.8,
  lighting: 'sun',
  colorVariation: 0,
  verticalGradient: true,
  nightLight: 0,
  windows: false,
  shadows: true,
  occlusion: true,
  modelOcclusion: 0.75,
} satisfies TileflowBuildings3DDesign);

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
  const defaults = tileflowDefaultBuildings3DDesign;
  const surfaces = readTileflowBuildingSurfaces(value.surfaces);
  const floodLight = readBuildingFloodLight(value.floodLight);
  const modelLighting = readModelRoleLighting(value.modelLighting);

  return {
    source,
    layers: {
      building: layers.building,
      ...(typeof layers.places === 'string' ? {places: layers.places} : {}),
    },
    color: color as string | readonly unknown[],
    edges: within(value.edges, 1, 0),
    edgeRadius: within(value.edgeRadius, 1, defaults.edgeRadius),
    lighting: value.lighting === 'style' ? 'style' : defaults.lighting,
    colorVariation: within(value.colorVariation, 1, 0),
    verticalGradient: value.verticalGradient !== false,
    ...(typeof value.edgeColor === 'string' ? {edgeColor: value.edgeColor} : {}),
    nightLight: within(value.nightLight, 2, 0),
    ...(floodLight ? {floodLight} : {}),
    ...(modelLighting ? {modelLighting} : {}),
    windows: value.windows === true,
    ...(surfaces ? {surfaces} : {}),
    ...readTileflowBuildingsEntrance(value.entrance),
    shadows: typeof value.shadows === 'boolean' ? value.shadows : defaults.shadows,
    occlusion: typeof value.occlusion === 'boolean' ? value.occlusion : defaults.occlusion,
    modelOcclusion: within(value.modelOcclusion, 1, defaults.modelOcclusion),
    ...modelsOf(value.models),
    ...modelColorsOf(value.modelColors),
    ...landmarksOf(value.landmarks),
  };
}

/** The entrance bands a design gives, skipping any that is not a rising band of zooms. */
export function readTileflowBuildingsEntrance(
  value: unknown,
): Pick<TileflowBuildings3DDesign, 'entrance'> {
  if (!isRecord(value)) return {};
  const band = (entry: unknown): readonly [number, number] | undefined =>
    Array.isArray(entry) &&
    entry.length === 2 &&
    entry.every((zoom) => typeof zoom === 'number' && zoom >= 0 && zoom <= 24) &&
    entry[0] < entry[1]
      ? [entry[0], entry[1]]
      : undefined;
  const buildings = band(value.buildings);
  const models = band(value.models);
  return buildings || models
    ? {entrance: {...(buildings ? {buildings} : {}), ...(models ? {models} : {})}}
    : {};
}

const modelId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
/** The most models one map places. */
export const tileflowBuildingModelPlacementLimit = 256;

const teamModelPrefix = 'tileflow://team-models/';

/**
 * The address a hosted build gives a placement of one of the map's own models: a placeholder that
 * Tileflow replaces, when the map is deployed, with that model's address in the map's Team.
 */
export function tileflowTeamModelUrl(model: string): string {
  if (!modelId.test(model) || model.length > 64)
    throw new RangeError(`"${model}" is not a 3D model name.`);
  return `${teamModelPrefix}${model}`;
}

/** The Team model a placement's address is the placeholder of, if it is one. */
export function readTileflowTeamModelName(url: string): string | undefined {
  if (!url.startsWith(teamModelPrefix)) return undefined;
  const model = url.slice(teamModelPrefix.length);
  return modelId.test(model) && model.length <= 64 ? model : undefined;
}

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

function landmarksOf(value: unknown): {landmarks?: Readonly<{url: string}>} {
  if (!isRecord(value) || typeof value.url !== 'string' || !value.url) return {};
  return {landmarks: {url: value.url}};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
