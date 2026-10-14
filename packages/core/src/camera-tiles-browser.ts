// The tiles round the camera that Tileflow's custom WebGL layers draw from (3D buildings, street
// lights): the nearest round a point ahead of the centre, as far as the view reaches, read with the
// map's own tile address and request rules and built a few milliseconds per frame. Layers reading
// the same source share each tile's download.
import {fetchTileflowPmtilesTile, isTileflowPmtilesUrl} from './pmtiles-browser';
import {
  createTileflowTileReader,
  readTileflowMapTileSource,
  type TileflowTile,
  type TileflowTileReader,
  type TileflowTileRequestTransform,
} from './tile-reader';

/** The MapLibre GL JS map capabilities the camera's tiles use. */
export type CameraTilesMap = {
  getBearing(): number;
  getCenter(): {lat: number; lng: number};
  getPitch(): number;
  getSource(id: string): unknown;
  getZoom(): number;
  off(event: string, listener: () => void): unknown;
  on(event: string, listener: () => void): unknown;
  triggerRepaint(): unknown;
};

export type CameraTile<T> = {
  readonly x: number;
  readonly y: number;
  value?: T;
  retryAt?: number;
  loading?: AbortController;
  used: number;
};

export type CameraTilesOptions<T> = Readonly<{
  map: CameraTilesMap;
  source: string;
  layers: readonly string[];
  /** The deepest zoom to read; a source that stops earlier is read at its own maximum. */
  zoom: number;
  /** Tiles are read from a zoom below this one. */
  minzoom: number;
  maxTiles: number;
  transformRequest?: TileflowTileRequestTransform;
  /** Whether the layer wants tiles now. */
  active(): boolean;
  /** Builds a tile's value; a tile without the layers it needs gets `empty`. */
  build(tile: TileflowTile, tileMetres: number): T;
  empty: T;
  /** Lets go of a tile's value when it is forgotten. */
  release(value: T): void;
  /** Called when the tiles to draw change. */
  changed(): void;
}>;

export type CameraTiles<T> = {
  /** Chooses the tiles round the camera and reads the missing ones. */
  update(): void;
  /** The wanted tiles built so far, nearest first. */
  ready(): (CameraTile<T> & {value: T})[];
  /** Every tile held, wanted or not. */
  all(): Iterable<CameraTile<T>>;
  /** The zoom tiles are read at. */
  readonly zoom: number;
  /** The camera's centre as fractional tile coordinates at that zoom. */
  readonly origin: readonly [number, number];
  /** Metres per tile unit (of 8192) at the camera's latitude. */
  readonly metres: number;
  /** A tile's corner from the origin, in tile units of 8192. */
  offsetOf(tile: {x: number; y: number}): [number, number];
  dispose(): void;
};

const earth = 40_075_016.686;
const extent = 8192;
const buildBudgetMs = 6;

export function createCameraTiles<T>(options: CameraTilesOptions<T>): CameraTiles<T> {
  const {map} = options;
  const tiles = new Map<string, CameraTile<T>>();
  const queue: {key: string; tile: TileflowTile; metres: number}[] = [];
  let wanted: string[] = [];
  let reader: TileflowTileReader | undefined;
  let zoom = options.zoom;
  let origin: [number, number] = [0, 0];
  let metres = 1;
  let building = false;
  let disposed = false;

  function ensureReader(): TileflowTileReader | undefined {
    if (reader) return reader;
    const source = readTileflowMapTileSource(map, options.source);
    if (!source) return undefined;
    zoom = Math.min(options.zoom, source.maxzoom);
    reader = createTileflowTileReader({
      ...source,
      layers: options.layers,
      cacheSize: 0,
      fetch: sharedTileFetch,
      ...(options.transformRequest ? {transformRequest: options.transformRequest} : {}),
    });
    return reader;
  }

  function update(): void {
    if (disposed) return;
    const currentZoom = map.getZoom();
    if (currentZoom < options.minzoom - 1 || !options.active()) return;
    const source = ensureReader();
    if (!source) return;
    const centre = map.getCenter();
    const pitch = map.getPitch();
    const reach = Math.min(5000, Math.max(800, 1600 * 2 ** (16 - currentZoom) * (1 + pitch / 60)));
    const bearing = (map.getBearing() * Math.PI) / 180;
    const ahead = reach * 0.35 * Math.min(1, pitch / 60);
    const latitude = centre.lat + (Math.cos(bearing) * ahead) / 111_320;
    const longitude =
      centre.lng + (Math.sin(bearing) * ahead) / (111_320 * Math.cos((centre.lat * Math.PI) / 180));
    const [cx, cy] = cameraTileAt(longitude, latitude, zoom);
    const tileMetres = (earth * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
    const span = Math.ceil(reach / tileMetres);
    const candidates: {x: number; y: number; distance: number}[] = [];
    for (let dx = -span; dx <= span; dx += 1)
      for (let dy = -span; dy <= span; dy += 1) {
        const x = Math.floor(cx) + dx;
        const y = Math.floor(cy) + dy;
        const distance = Math.hypot(
          Math.max(x, Math.min(cx, x + 1)) - cx,
          Math.max(y, Math.min(cy, y + 1)) - cy,
        );
        if (distance * tileMetres <= reach) candidates.push({x, y, distance});
      }
    candidates.sort((a, b) => a.distance - b.distance);
    const chosen = candidates.slice(0, options.maxTiles);
    wanted = chosen.map(({x, y}) => `${x}/${y}`);
    origin = cameraTileAt(centre.lng, centre.lat, zoom);
    metres = (earth * Math.cos((centre.lat * Math.PI) / 180)) / 2 ** zoom / extent;
    const now = performance.now();
    for (const {x, y} of chosen) {
      const key = `${x}/${y}`;
      let entry = tiles.get(key);
      if (!entry) {
        entry = {x, y, used: now};
        tiles.set(key, entry);
      }
      entry.used = now;
      if (!entry.value && !entry.loading && (entry.retryAt ?? 0) <= now)
        load(source, key, entry, tileMetres);
    }
    evict();
    map.triggerRepaint();
  }

  function load(
    source: TileflowTileReader,
    key: string,
    entry: CameraTile<T>,
    tileMetres: number,
  ): void {
    const controller = new AbortController();
    entry.loading = controller;
    source
      .readTile({z: zoom, x: entry.x, y: entry.y}, {signal: controller.signal})
      .then((tile) => {
        entry.loading = undefined;
        if (disposed || tiles.get(key) !== entry) return;
        // An absent tile stays empty; it is not read again.
        if (!tile) {
          entry.value = options.empty;
          return;
        }
        queue.push({key, tile, metres: tileMetres});
        drain();
      })
      .catch(() => {
        entry.loading = undefined;
        // A tile that failed is read again after a while, not at every camera move.
        entry.retryAt = performance.now() + 15_000;
      });
  }

  /** Builds waiting tiles a few milliseconds per frame, so the map keeps its frame rate. */
  function drain(): void {
    if (building || disposed) return;
    building = true;
    const step = () => {
      const started = performance.now();
      let built = false;
      while (queue.length && performance.now() - started < buildBudgetMs) {
        const {key, tile, metres: tileMetres} = queue.shift()!;
        const entry = tiles.get(key);
        if (!entry) continue;
        try {
          entry.value = options.build(tile, tileMetres);
        } catch {
          entry.value = options.empty;
        }
        built = true;
      }
      if (built) options.changed();
      map.triggerRepaint();
      if (queue.length && !disposed) cameraFrame(step);
      else building = false;
    };
    cameraFrame(step);
  }

  /** Forgets the tiles least recently wanted beyond twice the tiles drawn. */
  function evict(): void {
    const keep = new Set(wanted);
    const spare = [...tiles.entries()]
      .filter(([key]) => !keep.has(key))
      .sort((a, b) => b[1].used - a[1].used);
    for (const [key, entry] of spare.slice(options.maxTiles)) {
      entry.loading?.abort();
      if (entry.value && entry.value !== options.empty) options.release(entry.value);
      tiles.delete(key);
      options.changed();
    }
  }

  const onSource = () => {
    if (!reader && ensureReader()) update();
  };
  let throttle: ReturnType<typeof setTimeout> | undefined;
  const onMove = () => {
    if (throttle !== undefined) return;
    throttle = setTimeout(() => {
      throttle = undefined;
      update();
    }, 250);
  };
  const onMoveEnd = () => update();
  map.on('sourcedata', onSource);
  map.on('move', onMove);
  map.on('moveend', onMoveEnd);

  return {
    update,
    ready() {
      const list: (CameraTile<T> & {value: T})[] = [];
      for (const key of wanted) {
        const entry = tiles.get(key);
        if (entry?.value && entry.value !== options.empty)
          list.push(entry as CameraTile<T> & {value: T});
      }
      return list;
    },
    all: () => tiles.values(),
    get zoom() {
      return zoom;
    },
    get origin() {
      return origin;
    },
    get metres() {
      return metres;
    },
    offsetOf(tile) {
      return [(tile.x - origin[0]) * extent, (tile.y - origin[1]) * extent];
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (throttle !== undefined) clearTimeout(throttle);
      map.off('sourcedata', onSource);
      map.off('move', onMove);
      map.off('moveend', onMoveEnd);
      for (const entry of tiles.values()) entry.loading?.abort();
      tiles.clear();
      queue.length = 0;
      reader?.clear();
    },
  };
}

// --- Shared downloads ---

// Recent tile downloads, by request, so layers reading the same tiles fetch each once. A tile is
// kept for a minute, and only the latest few dozen.
const shared = new Map<string, {bytes: Promise<{status: number; body: ArrayBuffer}>; at: number}>();
const sharedLimit = 48;
const sharedFor = 60_000;

async function sharedTileFetch(url: string, init: RequestInit): Promise<Response> {
  const key = `${url}\u0000${JSON.stringify(init.headers ?? {})}\u0000${init.credentials ?? ''}`;
  const now = Date.now();
  let entry = shared.get(key);
  if (!entry || now - entry.at > sharedFor) {
    // The download itself is never cancelled: another layer may be waiting for it. A source served
    // from a Tileflow PMTiles archive is read through Core's own PMTiles protocol.
    const bytes = (
      isTileflowPmtilesUrl(url)
        ? fetchTileflowPmtilesTile(url)
        : fetch(url, {
            ...(init.headers ? {headers: init.headers} : {}),
            ...(init.credentials ? {credentials: init.credentials} : {}),
          })
    ).then(async (response) => ({
      status: response.status,
      body: response.ok ? await response.arrayBuffer() : new ArrayBuffer(0),
    }));
    entry = {bytes, at: now};
    shared.delete(key);
    shared.set(key, entry);
    while (shared.size > sharedLimit) shared.delete(shared.keys().next().value!);
    bytes.catch(() => shared.delete(key));
  }
  const signal = init.signal;
  const {status, body} = await (signal
    ? Promise.race([
        entry.bytes,
        new Promise<never>((_, reject) => {
          if (signal.aborted) reject(signal.reason);
          signal.addEventListener('abort', () => reject(signal.reason), {once: true});
        }),
      ])
    : entry.bytes);
  if (status < 200 || status >= 300) shared.delete(key);
  return new Response(status === 204 || status === 304 ? null : body.slice(0), {status});
}

export function cameraFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback);
  else setTimeout(callback, 16);
}

/** A point as fractional tile coordinates at a zoom. */
export function cameraTileAt(longitude: number, latitude: number, zoom: number): [number, number] {
  const phi = (Math.min(85.05, Math.max(-85.05, latitude)) * Math.PI) / 180;
  return [
    ((longitude + 180) / 360) * 2 ** zoom,
    ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * 2 ** zoom,
  ];
}
