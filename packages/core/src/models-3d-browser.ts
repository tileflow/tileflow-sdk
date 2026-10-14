// The building models a map places in its 3D city, for Tileflow's 3D buildings renderer: which
// placements stand near the camera, their files downloaded once and kept while they are near, their
// buffers on the GPU, the level of detail each draws at, and the footprints the renderer leaves to
// them. A model that fails to load leaves the map's own buildings standing.
import type {TileflowBuildingModelPlacement} from './buildings-3d-design';
import {cameraTileAt} from './camera-tiles-browser';
import {
  decodeTileflowModel,
  type TileflowModelBytes,
  tileflowModelFootprintInTile,
  tileflowModelVertexBytes,
} from './models-3d-model';
import {tileflowModelAttributes} from './models-3d-shaders';
import type {TileflowTileRequestTransform} from './tile-reader';

const earth = 40_075_016.686;
// Models are kept while near; beyond this many, the farthest are let go.
const keptModels = 12;
// A model is wanted when its origin lies within this many tiles of a tile round the camera.
const reachTiles = 1;
// Levels of detail by distance from the camera's centre, in metres.
const levelDistances = [900, 2600];

export type TileflowPlacedModel = {
  readonly placement: TileflowBuildingModelPlacement;
  readonly key: string;
  readonly model: TileflowModelBytes;
  gl?: {vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer; type: number}[];
  used: number;
};

export type TileflowPlacedModels = {
  /**
   * Chooses the placements near the tiles round the camera (`tiles`, at `zoom`) and downloads the
   * missing ones. `onMasks` is told the tiles whose footprints changed.
   */
  update(
    placements: readonly TileflowBuildingModelPlacement[],
    tiles: readonly Readonly<{x: number; y: number}>[],
    zoom: number,
  ): void;
  /** The footprints standing in a tile, as rings of its tile units, or undefined when none does. */
  masksIn(
    tile: Readonly<{x: number; y: number; z: number}>,
    extent: number,
  ): number[][] | undefined;
  /** The models loaded and wanted now. */
  shown(): readonly TileflowPlacedModel[];
  /** Uploads loaded models to the GPU. */
  upload(context: WebGL2RenderingContext): void;
  /** The level of detail to draw a model at, from the camera's centre. */
  levelOf(model: TileflowPlacedModel, centre: Readonly<{lat: number; lng: number}>): number;
  /** Changes whenever the models shown change. */
  key(): string;
  /** Lets go of every buffer. */
  release(context: WebGL2RenderingContext): void;
  dispose(): void;
};

export function createTileflowPlacedModels(
  options: Readonly<{
    transformRequest?: TileflowTileRequestTransform;
    /** Called with the tiles (at `zoom`) whose masks changed, and when a model is ready to draw. */
    changed(tiles: readonly Readonly<{x: number; y: number}>[], zoom: number): void;
  }>,
): TileflowPlacedModels {
  const loaded = new Map<string, TileflowPlacedModel>();
  const loading = new Map<string, AbortController>();
  const failed = new Map<string, number>();
  let wanted = new Set<string>();
  let disposed = false;
  let version = 0;
  let lastZoom = 15;
  // Models let go of while their buffers are still on the GPU; the next upload deletes them.
  const released: TileflowPlacedModel[] = [];

  const keyOf = (placement: TileflowBuildingModelPlacement) =>
    JSON.stringify([placement.url, placement.at, placement.heading]);

  /** The tiles at `zoom` that a model's footprint reaches. */
  function tilesOf(model: TileflowPlacedModel, zoom: number): {x: number; y: number}[] {
    const [x, y] = cameraTileAt(model.placement.at[0], model.placement.at[1], zoom);
    const metres = (earth * Math.cos((model.placement.at[1] * Math.PI) / 180)) / 2 ** zoom;
    const [minX, minY, , maxX, maxY] = model.model.bounds;
    const radius = Math.hypot(Math.max(-minX, maxX), Math.max(-minY, maxY)) / metres;
    const out: {x: number; y: number}[] = [];
    for (let tx = Math.floor(x - radius); tx <= Math.floor(x + radius); tx += 1)
      for (let ty = Math.floor(y - radius); ty <= Math.floor(y + radius); ty += 1)
        out.push({x: tx, y: ty});
    return out;
  }

  function load(placement: TileflowBuildingModelPlacement, key: string): void {
    const controller = new AbortController();
    loading.set(key, controller);
    const request = options.transformRequest?.(placement.url, 'Tile') ?? {url: placement.url};
    fetch(request.url, {
      signal: controller.signal,
      ...(request.headers ? {headers: request.headers} : {}),
      ...(request.credentials ? {credentials: request.credentials} : {}),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return decodeTileflowModel(await response.arrayBuffer());
      })
      .then((model) => {
        loading.delete(key);
        if (disposed) return;
        if (!model) throw new Error('not a Tileflow model');
        const entry: TileflowPlacedModel = {placement, key, model, used: performance.now()};
        loaded.set(key, entry);
        version += 1;
        options.changed(tilesOf(entry, lastZoom), lastZoom);
      })
      .catch(() => {
        loading.delete(key);
        // A model that failed is tried again after a while; the buildings stay meanwhile.
        failed.set(key, performance.now() + 30_000);
      });
  }

  return {
    update(placements, tiles, zoom) {
      if (disposed) return;
      lastZoom = zoom;
      const near = new Set<string>();
      const now = performance.now();
      if (tiles.length > 0) {
        let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const tile of tiles) {
          left = Math.min(left, tile.x);
          top = Math.min(top, tile.y);
          right = Math.max(right, tile.x);
          bottom = Math.max(bottom, tile.y);
        }
        for (const placement of placements) {
          const [x, y] = cameraTileAt(placement.at[0], placement.at[1], zoom);
          if (
            x < left - reachTiles ||
            x >= right + 1 + reachTiles ||
            y < top - reachTiles ||
            y >= bottom + 1 + reachTiles
          )
            continue;
          const key = keyOf(placement);
          near.add(key);
          const entry = loaded.get(key);
          if (entry) entry.used = now;
          else if (!loading.has(key) && (failed.get(key) ?? 0) <= now) load(placement, key);
        }
      }
      if (near.size !== wanted.size || [...near].some((key) => !wanted.has(key))) {
        wanted = near;
        version += 1;
      }
      // Downloads no longer wanted stop; the farthest models beyond the kept few are let go.
      for (const [key, controller] of loading)
        if (!near.has(key)) {
          controller.abort();
          loading.delete(key);
        }
      const spare = [...loaded.values()]
        .filter((entry) => !near.has(entry.key))
        .sort((a, b) => b.used - a.used);
      for (const entry of spare.slice(Math.max(0, keptModels - near.size))) {
        loaded.delete(entry.key);
        released.push(entry);
        version += 1;
        options.changed(tilesOf(entry, zoom), zoom);
      }
    },
    masksIn(tile, extent) {
      let masks: number[][] | undefined;
      for (const entry of loaded.values()) {
        if (entry.model.footprint.length === 0) continue;
        const rings = tileflowModelFootprintInTile(
          entry.model.footprint,
          entry.placement,
          {x: tile.x, y: tile.y, zoom: tile.z},
          extent,
        );
        const inside = rings.some((ring) => {
          let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
          for (let at = 0; at + 1 < ring.length; at += 2) {
            left = Math.min(left, ring[at]!);
            right = Math.max(right, ring[at]!);
            top = Math.min(top, ring[at + 1]!);
            bottom = Math.max(bottom, ring[at + 1]!);
          }
          return right >= 0 && bottom >= 0 && left <= extent && top <= extent;
        });
        if (inside) (masks ??= []).push(...rings);
      }
      return masks;
    },
    shown() {
      const list: TileflowPlacedModel[] = [];
      for (const key of wanted) {
        const entry = loaded.get(key);
        if (entry) list.push(entry);
      }
      return list;
    },
    upload(context) {
      for (const entry of released.splice(0)) releaseBuffers(context, entry);
      for (const key of wanted) {
        const entry = loaded.get(key);
        if (!entry || entry.gl) continue;
        entry.gl = entry.model.levels.map((level) => {
          const vao = context.createVertexArray()!;
          context.bindVertexArray(vao);
          const vbo = context.createBuffer()!;
          context.bindBuffer(context.ARRAY_BUFFER, vbo);
          context.bufferData(context.ARRAY_BUFFER, level.vertices, context.STATIC_DRAW);
          for (const [
            index,
            [, size, type, normalised, offset],
          ] of tileflowModelAttributes.entries()) {
            context.enableVertexAttribArray(index);
            context.vertexAttribPointer(
              index,
              size,
              context[type],
              normalised,
              tileflowModelVertexBytes,
              offset,
            );
          }
          const ibo = context.createBuffer()!;
          context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, ibo);
          context.bufferData(context.ELEMENT_ARRAY_BUFFER, level.indices, context.STATIC_DRAW);
          context.bindVertexArray(null);
          return {
            vao,
            vbo,
            ibo,
            type:
              level.indices instanceof Uint32Array ? context.UNSIGNED_INT : context.UNSIGNED_SHORT,
          };
        });
        version += 1;
      }
    },
    levelOf(model, centre) {
      const [longitude, latitude] = model.placement.at;
      const north = (latitude - centre.lat) * 111_320;
      const east = (longitude - centre.lng) * 111_320 * Math.cos((centre.lat * Math.PI) / 180);
      const distance = Math.hypot(north, east);
      const level = levelDistances.findIndex((limit) => distance < limit);
      return Math.min(model.model.levels.length - 1, level < 0 ? levelDistances.length : level);
    },
    key: () => String(version),
    release(context) {
      for (const entry of [...loaded.values(), ...released.splice(0)])
        releaseBuffers(context, entry);
    },
    dispose() {
      disposed = true;
      for (const controller of loading.values()) controller.abort();
      loading.clear();
      loaded.clear();
    },
  };
}

function releaseBuffers(context: WebGL2RenderingContext, entry: TileflowPlacedModel): void {
  for (const level of entry.gl ?? []) {
    context.deleteVertexArray(level.vao);
    context.deleteBuffer(level.vbo);
    context.deleteBuffer(level.ibo);
  }
  entry.gl = undefined;
}
