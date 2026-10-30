// A tile's buildings as the renderer uploads them, prepared where they are meshed.
import {
  type BuildingMeshGroup,
  type TileflowBuildingMesh,
  tileflowBuildingVertexBytes,
} from './buildings-3d-mesh';
import {buildingContactSegments} from './buildings-3d-occlusion';

/** A tile's buildings as the renderer keeps them once their arrays are on the GPU. */
export type BuildingTileMesh = Readonly<{
  groups?: readonly BuildingMeshGroup[];
  /** The first wall index: roofs come before it, walls from it. */
  wallsFrom: number;
  /** The tallest building, in metres. */
  top: number;
  features: TileflowBuildingMesh['features'];
  vertexCount: number;
  indexCount: number;
}>;

/** The arrays a tile uploads once: vertices, indices and the walls' contact segments. */
export type BuildingTileData = Readonly<{
  vertices: Uint8Array;
  /** 16-bit when every vertex fits. */
  indices: Uint16Array | Uint32Array;
  contact: Uint8Array;
}>;

export type PreparedBuildingTile = Readonly<{mesh: BuildingTileMesh; data: BuildingTileData}>;

/**
 * Prepares a tile's mesh for upload, off the main thread when a worker meshes it: the renderer
 * keeps the mesh and lets go of the data once it is on the GPU.
 */
export function prepareBuildingTile(mesh: TileflowBuildingMesh): PreparedBuildingTile {
  const vertexCount = mesh.vertices.length / tileflowBuildingVertexBytes;
  return {
    mesh: {
      ...(mesh.groups ? {groups: mesh.groups} : {}),
      wallsFrom: mesh.wallsFrom,
      top: mesh.top,
      features: mesh.features,
      vertexCount,
      indexCount: mesh.indices.length,
    },
    data: {
      vertices: mesh.vertices,
      indices: vertexCount <= 0x10000 ? Uint16Array.from(mesh.indices) : mesh.indices,
      contact: buildingContactSegments(mesh),
    },
  };
}

/** The buffers a prepared tile moves from the worker without copying. */
export function preparedBuildingTileTransfer({data}: PreparedBuildingTile): ArrayBuffer[] {
  return [data.vertices.buffer, data.indices.buffer, data.contact.buffer] as ArrayBuffer[];
}
