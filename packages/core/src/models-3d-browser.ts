// The building models in a map's 3D city, for Tileflow's 3D buildings renderer: the models the map
// places itself, and Tileflow's landmarks, which arrive in tiles of their own as other web maps'
// batched models do: the landmarks tileset's TileJSON names the regions that hold landmarks, a
// region's index names its tiles by their hash, and only the indexes and tiles near the camera are
// downloaded. It chooses which stand near the camera, downloads their files once and keeps
// them while they are near, uploads their buffers, picks the level of detail each draws at, and
// gives the renderer the footprints it leaves to them. The map's own models come first: a landmark
// with the same id as one of them, or whose footprint meets one's, is not drawn.
//
// The buildings under a model are never raised and then taken away. Downloads start a zoom before
// the buildings show. A region's index names each landmark's footprint, so while a landmark's tile
// is still on its way its footprint already holds the buildings under it flat; a tile of buildings
// is built once the indexes round it, and the map's own models near it, have arrived (or a moment
// has passed). A model or tile that fails to load, or does not arrive in a few seconds, leaves the
// map's own buildings standing.
import {
  readTileflowTeamModelName,
  type TileflowBuildingModelPlacement,
} from './buildings-3d-design';
import {cameraTileAt} from './camera-tiles-browser';
import {decodeTileflowModels} from './models-3d-file';
import {
  readTileflowLandmarkRegion,
  readTileflowLandmarksTileJson,
  type TileflowLandmarkFootprint,
  tileflowLandmarkRegionOf,
  type TileflowLandmarksTileJson,
} from './models-3d-landmarks';
import {
  type TileflowModelBytes,
  tileflowModelFootprintInTile,
  tileflowModelVertexBytes,
  tileflowRingsOverlap,
} from './models-3d-model';
import {tileflowModelAttributes} from './models-3d-shaders';
import type {TileflowTileRequestTransform} from './tile-reader';

const earth = 40_075_016.686;
// Models are kept while near; beyond this many, the farthest are let go.
const keptModels = 12;
// Landmark tiles and region indexes are kept while near; beyond this many, the least recently
// wanted are let go.
const keptLandmarkTiles = 9;
const keptLandmarkRegions = 8;
// A model is wanted when its origin lies within this many tiles of a tile round the camera.
const reachTiles = 1;
// Levels of detail by distance from the camera's centre, in metres.
const levelDistances = [900, 2600];
// A failed download is tried again after this long, in milliseconds; a landmarks tileset that
// cannot be read, after longer.
const retryAfter = 30_000;
const tilesetRetryAfter = 300_000;
// A landmark's footprint holds the buildings under it flat for this long, in milliseconds, while its
// tile is on its way; then they are raised until it arrives.
const landmarkHold = 3_000;
// A tile of buildings waits at most this long for the indexes and models round it.
const settleWait = 1_500;

export type TileflowPlacedModel = {
  readonly placement: TileflowBuildingModelPlacement;
  readonly key: string;
  readonly model: TileflowModelBytes;
  /** Whether it is one of Tileflow's landmarks rather than one the map places. */
  readonly landmark: boolean;
  gl?: {vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer; type: number}[];
  used: number;
  /** When it last began to stand, from `performance.now()`, for its fade. */
  standingSince?: number;
};

/** A landmark whose footprint holds the buildings under it while its tile is on its way. */
type HeldLandmark = Readonly<{
  key: string;
  placement: Readonly<{at: readonly [number, number]; heading: number}>;
  footprint: readonly (readonly number[])[];
  bounds: readonly [number, number, number, number, number, number];
}>;

export type TileflowPlacedModels = {
  /**
   * Chooses the placements, and the landmarks of the tileset at `landmarks`, near the tiles round
   * the camera (`tiles`, at `zoom`), and downloads the missing ones. A landmark's hold counts down
   * only while the buildings are `shown`.
   */
  update(
    placements: readonly TileflowBuildingModelPlacement[],
    landmarks: string | undefined,
    tiles: readonly Readonly<{x: number; y: number}>[],
    zoom: number,
    shown?: boolean,
  ): void;
  /**
   * Resolves once a tile of buildings can be built without raising what a model will stand on:
   * when the landmark indexes round it and the map's own models near it have arrived or failed,
   * or after a moment.
   */
  settle(tile: Readonly<{x: number; y: number; z: number}>, signal: AbortSignal): Promise<void>;
  /**
   * The footprints standing, or held for a landmark on its way, in a tile, as rings of its tile
   * units, or undefined when none does.
   */
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
    /** How long a landmark holds and a tile of buildings waits, in ms; tests shorten them. */
    timing?: Readonly<{hold?: number; settle?: number}>;
  }>,
): TileflowPlacedModels {
  const holdFor = options.timing?.hold ?? landmarkHold;
  const settleFor = options.timing?.settle ?? settleWait;
  const loaded = new Map<string, TileflowPlacedModel>();
  const loading = new Map<string, AbortController>();
  const failed = new Map<string, number>();
  let wanted = new Set<string>();
  // Tileflow's landmarks: the tileset's TileJSON, the indexes of its regions near the camera by
  // `x/y`, and its tiles near the camera by their hash.
  let tileset: TileflowLandmarksTileJson | undefined;
  let tilesetLoad: {url: string; controller: AbortController} | undefined;
  let tilesetFailed: {url: string; until: number} | undefined;
  const regions = new Map<
    string,
    {
      tiles: Map<string, {hash: string; landmarks?: readonly TileflowLandmarkFootprint[]}>;
      used: number;
    }
  >();
  const regionLoading = new Map<string, AbortController>();
  const regionFailed = new Map<string, number>();
  const landmarkTiles = new Map<string, {entries: TileflowPlacedModel[]; used: number}>();
  const tileLoading = new Map<string, AbortController>();
  const tileFailed = new Map<string, number>();
  let wantedTiles = new Set<string>();
  // What stands now, the map's own models first, and the landmarks held on their way.
  let active: TileflowPlacedModel[] = [];
  let held: HeldLandmark[] = [];
  // When each landmark held, or last held, began to hold.
  const holding = new Map<string, number>();
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let lastLandmarks: string | undefined;
  // Tiles of buildings waiting to be built.
  const waiting = new Set<{settled(): boolean; resolve(): void}>();
  let dirty = true;
  let ownIds = new Set<string>();
  let lastPlacements: readonly TileflowBuildingModelPlacement[] | undefined;
  let disposed = false;
  let version = 0;
  let lastZoom = 15;
  // Models let go of while their buffers are still on the GPU; the next upload deletes them.
  const released: TileflowPlacedModel[] = [];

  const keyOf = (placement: TileflowBuildingModelPlacement) =>
    JSON.stringify([placement.url, placement.at, placement.heading]);

  /** The tiles at `zoom` that a model's, or a held landmark's, footprint reaches. */
  function tilesOf(
    model: Readonly<{
      placement: Readonly<{at: readonly [number, number]}>;
      bounds: readonly number[];
    }>,
    zoom: number,
  ): {x: number; y: number}[] {
    const [x, y] = cameraTileAt(model.placement.at[0], model.placement.at[1], zoom);
    const metres = (earth * Math.cos((model.placement.at[1] * Math.PI) / 180)) / 2 ** zoom;
    const [minX, minY, , maxX, maxY] = model.bounds;
    const radius = Math.hypot(Math.max(-minX, maxX), Math.max(-minY, maxY)) / metres;
    const out: {x: number; y: number}[] = [];
    for (let tx = Math.floor(x - radius); tx <= Math.floor(x + radius); tx += 1)
      for (let ty = Math.floor(y - radius); ty <= Math.floor(y + radius); ty += 1)
        out.push({x: tx, y: ty});
    return out;
  }

  /** Downloads a file through the layer's request transform. */
  async function download(url: string, signal: AbortSignal): Promise<Response> {
    const request = (await options.transformRequest?.(url, 'Tile')) ?? {url};
    signal.throwIfAborted();
    return fetch(request.url, {
      signal,
      ...(request.headers ? {headers: request.headers} : {}),
      ...(request.credentials ? {credentials: request.credentials} : {}),
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    });
  }

  /** Something arrived: what stands is worked out again on the next update. */
  function arrived(): void {
    dirty = true;
    version += 1;
    recheck();
    options.changed([], lastZoom);
  }

  /** Lets the tiles of buildings whose surroundings have now arrived be built. */
  function recheck(): void {
    for (const waiter of waiting)
      if (waiter.settled()) {
        waiting.delete(waiter);
        waiter.resolve();
      }
  }

  function load(placement: TileflowBuildingModelPlacement, key: string): void {
    const controller = new AbortController();
    loading.set(key, controller);
    download(placement.url, controller.signal)
      .then(async (response) => decodeTileflowModels(await response.arrayBuffer()))
      .then((models) => {
        loading.delete(key);
        if (disposed) return;
        const model = models?.find((entry) => entry.id === placement.model) ?? models?.[0];
        if (!model) throw new Error('not a Tileflow model');
        loaded.set(key, {placement, key, model, landmark: false, used: performance.now()});
        arrived();
      })
      .catch(() => {
        loading.delete(key);
        // A model that failed is tried again after a while; the buildings stay meanwhile.
        failed.set(key, performance.now() + retryAfter);
        recheck();
      });
  }

  function loadTileset(url: string): void {
    const controller = new AbortController();
    tilesetLoad = {url, controller};
    download(url, controller.signal)
      .then((response) => response.json())
      .then((json: unknown) => {
        if (tilesetLoad?.controller !== controller) return;
        tilesetLoad = undefined;
        if (disposed) return;
        const read = readTileflowLandmarksTileJson(json, url);
        if (!read) throw new Error('not a Tileflow landmarks tileset');
        tileset = read;
        arrived();
      })
      .catch(() => {
        if (tilesetLoad?.controller !== controller) return;
        tilesetLoad = undefined;
        tilesetFailed = {url, until: performance.now() + tilesetRetryAfter};
        recheck();
      });
  }

  function loadRegion(regionKey: string, x: number, y: number): void {
    const source = tileset!;
    const url = new URL(
      source.region
        .replaceAll('{z}', String(source.regionZoom))
        .replaceAll('{x}', String(x))
        .replaceAll('{y}', String(y)),
      source.url,
    ).href;
    const controller = new AbortController();
    regionLoading.set(regionKey, controller);
    download(url, controller.signal)
      .then((response) => response.json())
      .then((json: unknown) => {
        regionLoading.delete(regionKey);
        if (disposed || tileset !== source) return;
        const region = readTileflowLandmarkRegion(json);
        if (!region || region.region[0] !== x || region.region[1] !== y)
          throw new Error('not this landmarks region');
        const tiles = new Map(
          region.tiles.map((tile) => [
            `${tile[0]}/${tile[1]}`,
            {hash: tile[2], ...(tile[3] ? {landmarks: tile[3]} : {})},
          ]),
        );
        regions.set(regionKey, {tiles, used: performance.now()});
        arrived();
      })
      .catch(() => {
        regionLoading.delete(regionKey);
        regionFailed.set(regionKey, performance.now() + retryAfter);
        recheck();
      });
  }

  function loadTile(hash: string): void {
    const source = tileset!;
    const url = new URL(source.tile.replaceAll('{sha256}', hash), source.url).href;
    const controller = new AbortController();
    tileLoading.set(hash, controller);
    download(url, controller.signal)
      .then(async (response) => decodeTileflowModels(await response.arrayBuffer()))
      .then((models) => {
        tileLoading.delete(hash);
        if (disposed || tileset !== source) return;
        if (!models) throw new Error('not a Tileflow landmarks tile');
        const now = performance.now();
        const entries: TileflowPlacedModel[] = [];
        for (const model of models) {
          if (!model.at) continue;
          const placement = {model: model.id, url, at: model.at, heading: model.heading ?? 0};
          entries.push({placement, key: `landmark:${model.id}`, model, landmark: true, used: now});
        }
        landmarkTiles.set(hash, {entries, used: now});
        arrived();
      })
      .catch(() => {
        tileLoading.delete(hash);
        tileFailed.set(hash, performance.now() + retryAfter);
        // A held landmark whose tile failed lets its buildings rise.
        arrived();
      });
  }

  /** The tileset's tiles near the camera's tiles (`tiles` at `zoom`), as `x/y` with `[x, y]`. */
  function landmarkTilesNear(
    tiles: readonly Readonly<{x: number; y: number}>[],
    zoom: number,
  ): Map<string, [number, number]> {
    const near = new Map<string, [number, number]>();
    if (!tileset || tiles.length === 0) return near;
    const scale = 2 ** (tileset.tileZoom - zoom);
    let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const tile of tiles) {
      left = Math.min(left, Math.floor(tile.x * scale));
      top = Math.min(top, Math.floor(tile.y * scale));
      right = Math.max(right, Math.ceil((tile.x + 1) * scale) - 1);
      bottom = Math.max(bottom, Math.ceil((tile.y + 1) * scale) - 1);
    }
    // A landmark reaches into the tiles beside its own.
    for (let x = left - 1; x <= right + 1 && near.size < 64; x += 1)
      for (let y = top - 1; y <= bottom + 1 && near.size < 64; y += 1)
        near.set(`${x}/${y}`, [x, y]);
    return near;
  }

  /** What stands: the map's own models wanted and loaded, then the landmarks they leave. */
  function standing(): TileflowPlacedModel[] {
    const own: TileflowPlacedModel[] = [];
    for (const key of wanted) {
      const entry = loaded.get(key);
      if (entry) own.push(entry);
    }
    const out = [...own];
    const seen = new Set<string>();
    for (const tileKey of wantedTiles)
      for (const entry of landmarkTiles.get(tileKey)?.entries ?? []) {
        if (seen.has(entry.key) || ownIds.has(entry.placement.model)) continue;
        seen.add(entry.key);
        if (own.some((model) => footprintsMeet(entry, model))) continue;
        out.push(entry);
      }
    return out;
  }

  /**
   * The landmarks whose tile is wanted and on its way, as their region's index names them, that
   * the map's own models leave, held for a few seconds each.
   */
  function holdingNow(
    near: ReadonlyMap<string, readonly TileflowLandmarkFootprint[]>,
    own: readonly TileflowPlacedModel[],
    now: number,
    shown: boolean,
  ): HeldLandmark[] {
    const out: HeldLandmark[] = [];
    const seen = new Set<string>();
    for (const landmarks of near.values())
      for (const landmark of landmarks) {
        const key = `landmark:${landmark.id}`;
        if (seen.has(key) || ownIds.has(landmark.id)) continue;
        seen.add(key);
        // The hold counts down from when the buildings round it show, not while they are hidden.
        const since = holding.get(key) ?? (shown ? now : undefined);
        if (since !== undefined) holding.set(key, since);
        if (since !== undefined && now - since >= holdFor) continue;
        const entry: HeldLandmark = {
          key,
          placement: {at: landmark.at, heading: landmark.heading},
          footprint: landmark.footprint,
          bounds: boundsOf(landmark.footprint),
        };
        if (own.some((model) => footprintsMeet(entry, model))) continue;
        out.push(entry);
      }
    for (const key of [...holding.keys()]) if (!seen.has(key)) holding.delete(key);
    return out;
  }

  /** Works out again what stands once the earliest hold ends. */
  function scheduleHoldEnd(now: number): void {
    if (holdTimer !== undefined) clearTimeout(holdTimer);
    holdTimer = undefined;
    let earliest = Infinity;
    for (const entry of held) {
      const since = holding.get(entry.key);
      if (since !== undefined) earliest = Math.min(earliest, since + holdFor);
    }
    if (earliest === Infinity || disposed) return;
    holdTimer = setTimeout(
      () => {
        holdTimer = undefined;
        dirty = true;
        options.changed([], lastZoom);
      },
      Math.max(0, earliest - now) + 1,
    );
  }

  /** Whether the indexes round a tile of buildings, and the map's own models near it, are in. */
  function settledAround(tile: Readonly<{x: number; y: number; z: number}>): boolean {
    if (disposed) return true;
    const now = performance.now();
    for (const placement of lastPlacements ?? []) {
      const [px, py] = cameraTileAt(placement.at[0], placement.at[1], tile.z);
      if (Math.abs(Math.floor(px) - tile.x) > reachTiles) continue;
      if (Math.abs(Math.floor(py) - tile.y) > reachTiles) continue;
      const key = keyOf(placement);
      if (!loaded.has(key) && (failed.get(key) ?? 0) <= now) return false;
    }
    const url = lastLandmarks;
    if (!url) return true;
    if (!tileset || tileset.url !== url)
      return tilesetFailed?.url === url && tilesetFailed.until > now;
    // The landmark tiles over this tile, and the ones beside them, whose landmarks reach into it.
    const scale = 2 ** (tileset.tileZoom - tile.z);
    const left = Math.floor(tile.x * scale) - 1;
    const right = Math.ceil((tile.x + 1) * scale);
    const top = Math.floor(tile.y * scale) - 1;
    const bottom = Math.ceil((tile.y + 1) * scale);
    for (const x of [left, right])
      for (const y of [top, bottom]) {
        const [rx, ry] = tileflowLandmarkRegionOf([x, y]);
        const regionKey = `${rx}/${ry}`;
        if (!tileset.regions.has(regionKey) || regions.has(regionKey)) continue;
        if ((regionFailed.get(regionKey) ?? 0) > now) continue;
        return false;
      }
    return true;
  }

  return {
    update(placements, landmarks, tiles, zoom, shown = true) {
      if (disposed) return;
      lastZoom = zoom;
      lastLandmarks = landmarks;
      const near = new Set<string>();
      const now = performance.now();
      if (placements !== lastPlacements) {
        lastPlacements = placements;
        ownIds = new Set(placements.map((placement) => placement.model));
        dirty = true;
      }
      if (tiles.length > 0) {
        let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const tile of tiles) {
          left = Math.min(left, tile.x);
          top = Math.min(top, tile.y);
          right = Math.max(right, tile.x);
          bottom = Math.max(bottom, tile.y);
        }
        for (const placement of placements) {
          // A hosted build's placeholder names a Team model before deployment gives it an address.
          if (readTileflowTeamModelName(placement.url)) continue;
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
        dirty = true;
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
        dirty = true;
      }

      // Tileflow's landmarks: the tileset's TileJSON once, then the indexes of the regions round
      // the camera, then the tiles near it that those indexes name.
      if (tileset && tileset.url !== landmarks) {
        for (const tile of landmarkTiles.values()) released.push(...tile.entries);
        landmarkTiles.clear();
        regions.clear();
        for (const controller of [...tileLoading.values(), ...regionLoading.values()])
          controller.abort();
        tileLoading.clear();
        regionLoading.clear();
        tileFailed.clear();
        regionFailed.clear();
        tileset = undefined;
        dirty = true;
      }
      if (tilesetLoad && tilesetLoad.url !== landmarks) {
        tilesetLoad.controller.abort();
        tilesetLoad = undefined;
      }
      if (
        landmarks &&
        !tileset &&
        !tilesetLoad &&
        (tilesetFailed?.url !== landmarks || tilesetFailed.until <= now)
      )
        loadTileset(landmarks);
      const nearRegions = new Set<string>();
      const nearHashes = new Set<string>();
      // The landmarks of the tiles near the camera that are still on their way, by tile hash.
      const onTheirWay = new Map<string, readonly TileflowLandmarkFootprint[]>();
      for (const [tileKey, [x, y]] of landmarkTilesNear(tiles, zoom)) {
        const [rx, ry] = tileflowLandmarkRegionOf([x, y]);
        const regionKey = `${rx}/${ry}`;
        if (!tileset?.regions.has(regionKey)) continue;
        nearRegions.add(regionKey);
        const region = regions.get(regionKey);
        if (!region) {
          if (!regionLoading.has(regionKey) && (regionFailed.get(regionKey) ?? 0) <= now)
            loadRegion(regionKey, rx, ry);
          continue;
        }
        region.used = now;
        const named = region.tiles.get(tileKey);
        if (!named) continue;
        const {hash} = named;
        nearHashes.add(hash);
        const tile = landmarkTiles.get(hash);
        if (tile) tile.used = now;
        else {
          const failing = (tileFailed.get(hash) ?? 0) > now;
          if (!tileLoading.has(hash) && !failing) loadTile(hash);
          if (named.landmarks && !failing) onTheirWay.set(hash, named.landmarks);
        }
      }
      if (
        nearHashes.size !== wantedTiles.size ||
        [...nearHashes].some((hash) => !wantedTiles.has(hash))
      ) {
        wantedTiles = nearHashes;
        dirty = true;
      }
      for (const [regionKey, controller] of regionLoading)
        if (!nearRegions.has(regionKey)) {
          controller.abort();
          regionLoading.delete(regionKey);
        }
      for (const [hash, controller] of tileLoading)
        if (!nearHashes.has(hash)) {
          controller.abort();
          tileLoading.delete(hash);
        }
      const spareRegions = [...regions.entries()]
        .filter(([regionKey]) => !nearRegions.has(regionKey))
        .sort(([, a], [, b]) => b.used - a.used);
      for (const [regionKey] of spareRegions.slice(
        Math.max(0, keptLandmarkRegions - nearRegions.size),
      ))
        regions.delete(regionKey);
      const spareTiles = [...landmarkTiles.entries()]
        .filter(([hash]) => !nearHashes.has(hash))
        .sort(([, a], [, b]) => b.used - a.used);
      for (const [hash, tile] of spareTiles.slice(
        Math.max(0, keptLandmarkTiles - nearHashes.size),
      )) {
        landmarkTiles.delete(hash);
        released.push(...tile.entries);
      }

      recheck();
      const next = dirty ? standing() : active;
      const holdNext = holdingNow(
        onTheirWay,
        next.filter((entry) => !entry.landmark),
        now,
        shown,
      );
      const sameHold =
        holdNext.length === held.length &&
        holdNext.every((entry, at) => entry.key === held[at]!.key);
      if (!dirty && sameHold) return;
      dirty = false;
      const before = new Map(active.map((entry) => [entry, true]));
      const changed: {x: number; y: number}[] = [];
      const reach = (entry: TileflowPlacedModel) =>
        tilesOf({placement: entry.placement, bounds: entry.model.bounds}, zoom);
      for (const entry of next)
        if (!before.delete(entry)) {
          entry.standingSince = now;
          changed.push(...reach(entry));
        }
      for (const entry of before.keys()) {
        entry.standingSince = undefined;
        changed.push(...reach(entry));
      }
      const heldBefore = new Map(held.map((entry) => [entry.key, entry]));
      for (const entry of holdNext)
        if (!heldBefore.delete(entry.key)) changed.push(...tilesOf(entry, zoom));
      for (const entry of heldBefore.values()) changed.push(...tilesOf(entry, zoom));
      active = next;
      held = holdNext;
      scheduleHoldEnd(now);
      if (changed.length > 0) {
        version += 1;
        options.changed(changed, zoom);
      }
    },
    settle(tile, signal) {
      if (settledAround(tile)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const waiter = {
          settled: () => signal.aborted || settledAround(tile),
          resolve: () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
          },
        };
        const done = () => {
          waiting.delete(waiter);
          waiter.resolve();
        };
        const timer = setTimeout(done, settleFor);
        signal.addEventListener('abort', done, {once: true});
        waiting.add(waiter);
      });
    },
    masksIn(tile, extent) {
      let masks: number[][] | undefined;
      const footprints = [
        ...active.map((entry) => ({placement: entry.placement, footprint: entry.model.footprint})),
        ...held,
      ];
      for (const entry of footprints) {
        if (entry.footprint.length === 0) continue;
        const rings = tileflowModelFootprintInTile(
          entry.footprint,
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
    shown: () => active,
    upload(context) {
      for (const entry of released.splice(0)) releaseBuffers(context, entry);
      for (const entry of active) {
        if (entry.gl) continue;
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
      const all = [...loaded.values(), ...released.splice(0)];
      for (const tile of landmarkTiles.values()) all.push(...tile.entries);
      for (const entry of all) releaseBuffers(context, entry);
    },
    dispose() {
      disposed = true;
      if (holdTimer !== undefined) clearTimeout(holdTimer);
      for (const waiter of waiting) waiter.resolve();
      waiting.clear();
      held = [];
      for (const controller of loading.values()) controller.abort();
      for (const controller of [...tileLoading.values(), ...regionLoading.values()])
        controller.abort();
      tilesetLoad?.controller.abort();
      loading.clear();
      tileLoading.clear();
      regionLoading.clear();
      loaded.clear();
      landmarkTiles.clear();
      regions.clear();
      active = [];
    },
  };
}

/** Whether a landmark's footprint meets a model's, both laid in the landmark's zoom-14 tile. */
function footprintsMeet(
  landmark: TileflowPlacedModel | HeldLandmark,
  model: TileflowPlacedModel,
): boolean {
  const footprint = 'model' in landmark ? landmark.model.footprint : landmark.footprint;
  if (footprint.length === 0 || model.model.footprint.length === 0) return false;
  const [x, y] = cameraTileAt(landmark.placement.at[0], landmark.placement.at[1], 14);
  const tile = {x: Math.floor(x), y: Math.floor(y), zoom: 14};
  const ours = tileflowModelFootprintInTile(footprint, landmark.placement, tile, 8192);
  const theirs = tileflowModelFootprintInTile(model.model.footprint, model.placement, tile, 8192);
  return tileflowRingsOverlap(ours, theirs, 0);
}

/** A footprint's bounds in metres, as a model's bounds are, flat. */
function boundsOf(
  footprint: readonly (readonly number[])[],
): readonly [number, number, number, number, number, number] {
  let [minX, minY, maxX, maxY] = [0, 0, 0, 0];
  for (const ring of footprint)
    for (let at = 0; at + 1 < ring.length; at += 2) {
      minX = Math.min(minX, ring[at]!);
      maxX = Math.max(maxX, ring[at]!);
      minY = Math.min(minY, ring[at + 1]!);
      maxY = Math.max(maxY, ring[at + 1]!);
    }
  return [minX, minY, 0, maxX, maxY, 0];
}

function releaseBuffers(context: WebGL2RenderingContext, entry: TileflowPlacedModel): void {
  for (const level of entry.gl ?? []) {
    context.deleteVertexArray(level.vao);
    context.deleteBuffer(level.vbo);
    context.deleteBuffer(level.ibo);
  }
  entry.gl = undefined;
}
