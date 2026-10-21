// What Tileflow's 3D layers build from a tile they read: building meshes, trees and street lamps.
// It runs where the tile is decoded, in the layers' shared worker or, without one, in the page.
import {meshTileflowBuildings, type TileflowBuildingMeshOptions} from './buildings-3d-mesh';
import {
  prepareBuildingTile,
  type PreparedBuildingTile,
  preparedBuildingTileTransfer,
} from './buildings-3d-tile';
import {
  placeTileflowStreetLights,
  type TileflowStreetLightPlacement,
  type TileflowStreetLightPlacementOptions,
} from './street-lights';
import {
  placeTileflowTrees,
  type TileflowTreePlacement,
  type TileflowTreePlacementOptions,
} from './trees-3d';
import {decodeTileflowVectorTile, type TileflowTileLayer} from './vector-tile-decode';

export type CameraTileTask =
  | Readonly<{
      kind: 'buildings';
      layers: Readonly<{building: string; places?: string}>;
      options: Omit<TileflowBuildingMeshOptions, 'places'>;
    }>
  | Readonly<{
      kind: 'trees';
      layers: Readonly<{tree?: string; canopy?: string; hedge?: string}>;
      options: TileflowTreePlacementOptions;
    }>
  | Readonly<{
      kind: 'lights';
      layers: Readonly<{streetFurniture: string; transportation: string; sidewalk?: string}>;
      options: TileflowStreetLightPlacementOptions;
    }>;

type Results = {
  buildings: PreparedBuildingTile;
  trees: TileflowTreePlacement;
  lights: TileflowStreetLightPlacement;
};

/** What a task builds from a tile; undefined when the tile holds nothing for it. */
export type CameraTileResult<Kind extends CameraTileTask['kind']> = Results[Kind] | undefined;

/** The layers a task reads. */
export function cameraTileTaskLayers(task: CameraTileTask): string[] {
  return Object.values(task.layers).filter((name): name is string => typeof name === 'string');
}

/** Builds what a task asks for from a tile's decoded layers. */
export function runCameraTileTask<Task extends CameraTileTask>(
  task: Task,
  layer: (name: string | undefined) => TileflowTileLayer | undefined,
): CameraTileResult<Task['kind']> {
  if (task.kind === 'buildings') {
    const building = layer(task.layers.building);
    if (!building) return undefined;
    const places = layer(task.layers.places);
    const mesh = meshTileflowBuildings(building, {...task.options, ...(places ? {places} : {})});
    return (mesh && prepareBuildingTile(mesh)) as CameraTileResult<Task['kind']>;
  }
  if (task.kind === 'trees') {
    const trees = layer(task.layers.tree);
    const canopy = layer(task.layers.canopy);
    const hedges = layer(task.layers.hedge);
    if (!trees && !canopy && !hedges) return undefined;
    const placement = placeTileflowTrees(
      {...(trees ? {trees} : {}), ...(canopy ? {canopy} : {}), ...(hedges ? {hedges} : {})},
      task.options,
    );
    return (
      placement.trees.length > 0 || placement.hedges.length > 0 ? placement : undefined
    ) as CameraTileResult<Task['kind']>;
  }
  const streetFurniture = layer(task.layers.streetFurniture);
  const transportation = layer(task.layers.transportation);
  const sidewalks = layer(task.layers.sidewalk);
  return placeTileflowStreetLights(
    {
      ...(streetFurniture ? {streetFurniture} : {}),
      ...(transportation ? {transportation} : {}),
      ...(sidewalks ? {sidewalks} : {}),
    },
    task.options,
  ) as CameraTileResult<Task['kind']>;
}

/** The buffers a result moves out of the worker without copying. */
export function cameraTileResultTransfer(
  kind: CameraTileTask['kind'],
  result: CameraTileResult<CameraTileTask['kind']>,
): ArrayBuffer[] {
  if (!result) return [];
  if (kind === 'buildings') return preparedBuildingTileTransfer(result as PreparedBuildingTile);
  if (kind === 'trees') {
    const {trees, hedges} = result as TileflowTreePlacement;
    return [trees.buffer, hedges.buffer].filter(
      (buffer, index, all) => all.indexOf(buffer) === index,
    ) as ArrayBuffer[];
  }
  return [(result as TileflowStreetLightPlacement).lamps.buffer as ArrayBuffer];
}

/**
 * Recently read tiles by address, each layer decoded once whichever task asks for it first, so the
 * layers reading one tile decode it once between them.
 */
export function createDecodedCameraTiles(limit = 16) {
  const tiles = new Map<
    string,
    {bytes: Uint8Array; layers: Map<string, TileflowTileLayer | undefined>}
  >();
  return {
    /** The decoded layers of a tile, decoding those `names` asks for that are not decoded yet. */
    read(url: string, bytes: Uint8Array, names: readonly string[]) {
      let tile = tiles.get(url);
      tiles.delete(url);
      tile ??= {bytes, layers: new Map()};
      tiles.set(url, tile);
      while (tiles.size > limit) tiles.delete(tiles.keys().next().value!);
      const missing = names.filter((name) => !tile.layers.has(name));
      if (missing.length > 0) {
        const decoded = decodeTileflowVectorTile(tile.bytes, {layers: missing});
        for (const name of missing) tile.layers.set(name, decoded[name]);
      }
      const layers = tile.layers;
      return (name: string | undefined) => (name === undefined ? undefined : layers.get(name));
    },
  };
}
