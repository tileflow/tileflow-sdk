// How a compiled map's 3D buildings look, as the buildings module describes them for Core's 3D
// buildings renderer: the colour of each building (the map's own 3D building colour, else its
// roofs'), the strength and colour of roof outlines, the night light, the invented night windows,
// and whether shadows and contact shadow fall. The compiler publishes it, resolved for one theme, in
// the style's metadata; the renderer reads it for every theme on screen. It has no DOM dependency.

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
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
