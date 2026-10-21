// The tiles round the camera that Tileflow's custom WebGL layers draw from (3D buildings, trees,
// street lights): the nearest round a point ahead of the centre, as far as the view reaches, read
// with the map's own tile address and request rules, nearest first, and built from their bytes off
// the page. Layers reading the same source share each tile's download.
import {fetchTileflowPmtilesTile, isTileflowPmtilesUrl} from './pmtiles-browser';
import {
  createTileLoader,
  readTileflowMapTileSource,
  type TileflowTileBytes,
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
  /** From the point the camera reads round, in tiles. */
  distance?: number;
  retryAt?: number;
  loading?: AbortController;
  used: number;
};

export type CameraTilesOptions<T> = Readonly<{
  map: CameraTilesMap;
  source: string;
  /** The deepest zoom to read; a source that stops earlier is read at its own maximum. */
  zoom: number;
  /** Tiles are read from a zoom below this one. */
  minzoom: number;
  maxTiles: number;
  transformRequest?: TileflowTileRequestTransform;
  /** Whether the layer wants tiles now. */
  active(): boolean;
  /**
   * Builds a tile's value from its bytes; a tile without the layers it needs gets `empty`. Nearer
   * tiles have a lower `priority`.
   */
  build(
    tile: TileflowTileBytes,
    tileMetres: number,
    signal: AbortSignal,
    priority: number,
  ): T | Promise<T>;
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
  /**
   * Every tile wanted round the camera, nearest first, whether it has been read, holds nothing for
   * the layer, or the style has no source to read it from.
   */
  coverage(): readonly Readonly<{x: number; y: number}>[];
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
  /**
   * Builds the tiles `which` names again, from a fresh read; each keeps drawing what it held until
   * its new build is ready.
   */
  refresh(which: (tile: Readonly<{x: number; y: number}>) => boolean): void;
  dispose(): void;
};

const earth = 40_075_016.686;
const extent = 8192;
const buildBudgetMs = 6;

export function createCameraTiles<T>(options: CameraTilesOptions<T>): CameraTiles<T> {
  const {map} = options;
  const tiles = new Map<string, CameraTile<T>>();
  const queue: {
    key: string;
    entry: CameraTile<T>;
    controller: AbortController;
    tile: TileflowTileBytes;
    metres: number;
  }[] = [];
  let wanted: string[] = [];
  let covered: Readonly<{x: number; y: number}>[] = [];
  type Loader = ReturnType<typeof createTileLoader<TileflowTileBytes>>;
  let reader: Loader | undefined;
  let zoom = options.zoom;
  let origin: [number, number] = [0, 0];
  let metres = 1;
  let building = false;
  let disposed = false;

  function ensureReader(): Loader | undefined {
    if (reader) return reader;
    const source = readTileflowMapTileSource(map, options.source);
    if (!source) return undefined;
    zoom = Math.min(options.zoom, source.maxzoom);
    // The bytes are decoded where the tile is built.
    reader = createTileLoader(
      {
        ...source,
        cacheSize: 0,
        fetch: sharedTileFetch,
        ...(options.transformRequest ? {transformRequest: options.transformRequest} : {}),
      },
      (bytes, address, url) => ({...address, url, bytes}),
    );
    return reader;
  }

  function update(): void {
    if (disposed) return;
    const currentZoom = map.getZoom();
    if (currentZoom < options.minzoom - 1 || !options.active()) return;
    // Without a source to read, the tiles round the camera are still chosen: what stands on them
    // without the source's data, such as a placed model, needs to know them.
    const source = ensureReader();
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
    covered = chosen.map(({x, y}) => ({x, y}));
    origin = cameraTileAt(centre.lng, centre.lat, zoom);
    metres = (earth * Math.cos((centre.lat * Math.PI) / 180)) / 2 ** zoom / extent;
    if (!source) {
      map.triggerRepaint();
      return;
    }
    const now = performance.now();
    for (const {x, y, distance} of chosen) {
      const key = `${x}/${y}`;
      let entry = tiles.get(key);
      if (!entry) {
        entry = {x, y, used: now};
        tiles.set(key, entry);
      }
      entry.used = now;
      entry.distance = distance;
      if (
        (!entry.value || entry.retryAt !== undefined) &&
        !entry.loading &&
        (entry.retryAt ?? 0) <= now
      )
        load(source, key, entry, tileMetres);
    }
    evict();
    map.triggerRepaint();
  }

  function load(source: Loader, key: string, entry: CameraTile<T>, tileMetres: number): void {
    const controller = new AbortController();
    entry.loading = controller;
    entry.retryAt = undefined;
    source
      .read(
        {z: zoom, x: entry.x, y: entry.y},
        {signal: controller.signal, priority: entry.distance ?? 0},
      )
      .then((tile) => {
        if (disposed || tiles.get(key) !== entry || entry.loading !== controller) return;
        // An absent tile stays empty; it is not read again.
        if (!tile) {
          if (entry.value && entry.value !== options.empty) options.release(entry.value);
          entry.value = options.empty;
          entry.loading = undefined;
          options.changed();
          map.triggerRepaint();
          return;
        }
        // Rapid refreshes need not retain decoded tiles for superseded queued builds.
        for (let at = queue.length - 1; at >= 0; at -= 1) {
          const queued = queue[at]!;
          if (queued.entry.loading !== queued.controller || queued.controller.signal.aborted)
            queue.splice(at, 1);
        }
        queue.push({key, entry, controller, tile, metres: tileMetres});
        drain();
      })
      .catch(() => {
        if (disposed || entry.loading !== controller) return;
        entry.loading = undefined;
        // A tile that failed is read again after a while, not at every camera move.
        entry.retryAt = performance.now() + 15_000;
      });
  }

  /** Async builders keep expensive work off the map thread; synchronous layers retain a frame budget. */
  function drain(): void {
    if (building || disposed) return;
    building = true;
    const step = async () => {
      const started = performance.now();
      let built = false;
      while (!disposed && queue.length && performance.now() - started < buildBudgetMs) {
        // The nearest tile goes first.
        let nearest = 0;
        for (let at = 1; at < queue.length; at += 1)
          if ((queue[at]!.entry.distance ?? 0) < (queue[nearest]!.entry.distance ?? 0))
            nearest = at;
        const {key, entry, controller, tile, metres: tileMetres} = queue.splice(nearest, 1)[0]!;
        const current = () =>
          !disposed &&
          tiles.get(key) === entry &&
          entry.loading === controller &&
          !controller.signal.aborted;
        if (!current()) continue;
        let value: T;
        try {
          value = await options.build(tile, tileMetres, controller.signal, entry.distance ?? 0);
        } catch {
          if (current()) {
            entry.loading = undefined;
            entry.retryAt = performance.now() + 15_000;
          }
          continue;
        }
        if (!current()) {
          if (value !== options.empty) options.release(value);
          continue;
        }
        const previous = entry.value;
        entry.value = value;
        entry.loading = undefined;
        if (previous && previous !== options.empty && previous !== value) options.release(previous);
        built = true;
      }
      if (built && !disposed) {
        options.changed();
        map.triggerRepaint();
      }
      if (queue.length && !disposed)
        cameraFrame(() => {
          void step();
        });
      else building = false;
    };
    cameraFrame(() => {
      void step();
    });
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
    coverage: () => covered,
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
    refresh(which) {
      const source = reader;
      if (!source || disposed) return;
      for (const [key, entry] of tiles) {
        if (!which(entry)) continue;
        entry.loading?.abort();
        entry.retryAt = undefined;
        // A tile's width in metres at its middle.
        const latitude =
          (Math.atan(Math.sinh(Math.PI * (1 - (2 * (entry.y + 0.5)) / 2 ** zoom))) * 180) / Math.PI;
        load(source, key, entry, (earth * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom);
      }
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
// kept for a minute, and only the latest few dozen. A download stops once every layer waiting for
// it has stopped waiting.
type SharedDownload = {
  bytes: Promise<{status: number; body: ArrayBuffer}>;
  at: number;
  readers: number;
  settled: boolean;
  controller: AbortController;
};
const shared = new Map<string, SharedDownload>();
const sharedLimit = 48;
const sharedFor = 60_000;

async function sharedTileFetch(url: string, init: RequestInit): Promise<Response> {
  const key = `${url}\u0000${JSON.stringify(init.headers ?? {})}\u0000${init.credentials ?? ''}`;
  const now = Date.now();
  let entry = shared.get(key);
  if (!entry || now - entry.at > sharedFor) {
    // A source served from a Tileflow PMTiles archive is read through Core's own PMTiles protocol.
    const controller = new AbortController();
    const bytes = (
      isTileflowPmtilesUrl(url)
        ? fetchTileflowPmtilesTile(url, controller.signal)
        : fetch(url, {
            ...(init.headers ? {headers: init.headers} : {}),
            ...(init.credentials ? {credentials: init.credentials} : {}),
            signal: controller.signal,
          })
    ).then(async (response) => ({
      status: response.status,
      body: response.ok ? await response.arrayBuffer() : new ArrayBuffer(0),
    }));
    const download: SharedDownload = {bytes, at: now, readers: 0, settled: false, controller};
    entry = download;
    shared.delete(key);
    shared.set(key, download);
    while (shared.size > sharedLimit) shared.delete(shared.keys().next().value!);
    bytes.then(
      () => {
        download.settled = true;
      },
      () => {
        download.settled = true;
        if (shared.get(key) === download) shared.delete(key);
      },
    );
  }
  const download = entry;
  const signal = init.signal;
  download.readers += 1;
  try {
    const {status, body} = await (signal
      ? Promise.race([
          download.bytes,
          new Promise<never>((_, reject) => {
            if (signal.aborted) reject(signal.reason);
            signal.addEventListener('abort', () => reject(signal.reason), {once: true});
          }),
        ])
      : download.bytes);
    if (status < 200 || status >= 300) shared.delete(key);
    return new Response(status === 204 || status === 304 ? null : body.slice(0), {status});
  } finally {
    download.readers -= 1;
    if (signal?.aborted && download.readers === 0 && !download.settled) {
      download.controller.abort(signal.reason);
      if (shared.get(key) === download) shared.delete(key);
    }
  }
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
