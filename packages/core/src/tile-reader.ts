// Reads a vector source's tiles for an application's own use (routing over streets, naming the place
// under the camera), with the map's own tile address and request rules: chosen layers decoded,
// a bounded cache, one request per tile however many readers wait for it, and cancellation.
// It has no DOM dependency, so it also runs in a worker.
import {fetchTileflowPmtilesTile, isTileflowPmtilesUrl} from './pmtiles-browser';
import {decodeTileflowVectorTile, type TileflowTileLayer} from './vector-tile-decode';

export type TileflowTileAddress = Readonly<{z: number; x: number; y: number}>;

/** A decoded tile: its address and the chosen layers it holds. */
export type TileflowTile = TileflowTileAddress &
  Readonly<{layers: Readonly<Record<string, TileflowTileLayer>>}>;

/** Rewrites a tile request as a MapLibre map's `transformRequest` does. */
export type TileflowTileRequestTransform = (
  url: string,
  resourceType: 'Tile',
) =>
  | Promise<
      | Readonly<{
          url: string;
          headers?: Readonly<Record<string, string>>;
          credentials?: RequestCredentials;
        }>
      | undefined
    >
  | Readonly<{
      url: string;
      headers?: Readonly<Record<string, string>>;
      credentials?: RequestCredentials;
    }>
  | undefined;

export type TileflowTileReaderOptions = Readonly<{
  /** The tile address with `{z}`, `{x}` and `{y}`, such as a MapLibre vector source's `tiles[0]`. */
  tiles: string;
  /** The lowest zoom the source has tiles for; defaults to 0. */
  minzoom?: number;
  /** The highest zoom the source has tiles for; deeper reads use its tiles. Defaults to 14. */
  maxzoom?: number;
  /** The layers to decode; defaults to every layer. */
  layers?: readonly string[];
  /** Decoded tiles kept for later reads, from 0 to 4096; defaults to 128. */
  cacheSize?: number;
  /** Requests in flight at once, from 1 to 32; defaults to 6. */
  concurrency?: number;
  /** The map's request rules, applied to every tile request. */
  transformRequest?: TileflowTileRequestTransform;
  /**
   * Defaults to the global `fetch`, and to Core's PMTiles protocol for a source served from a
   * Tileflow PMTiles archive (`tileflow-pmtiles://`).
   */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}>;

export type TileflowTileAreaRequest = Readonly<{
  /** `[west, south, east, north]` in degrees. */
  bounds: readonly [number, number, number, number];
  /** The zoom to read at, clamped to the source's zooms. */
  zoom: number;
  /** The most tiles the area may take; a larger area is refused. Defaults to 64. */
  maxTiles?: number;
  signal?: AbortSignal;
}>;

export type TileflowTileReader = {
  /** A tile's chosen layers, or undefined when the source has no tile there (404 or 204). */
  readTile(
    address: TileflowTileAddress,
    options?: {signal?: AbortSignal},
  ): Promise<TileflowTile | undefined>;
  /** The tiles covering an area at a zoom, without the absent ones, nearest the centre first. */
  readArea(request: TileflowTileAreaRequest): Promise<TileflowTile[]>;
  /** Forgets every cached tile. */
  clear(): void;
};

const earthLatitudeLimit = 85.0511287798066;

/** The tiles at `zoom` covering `[west, south, east, north]`, nearest the centre first. */
export function tileflowTilesForBounds(
  bounds: readonly [number, number, number, number],
  zoom: number,
): TileflowTileAddress[] {
  const [west, south, east, north] = bounds;
  if (![west, south, east, north, zoom].every(Number.isFinite) || south > north)
    throw new RangeError('Tile bounds are [west, south, east, north] in degrees.');
  const z = Math.max(0, Math.round(zoom));
  const count = 2 ** z;
  const column = (lng: number) =>
    Math.min(count - 1, Math.max(0, Math.floor(((lng + 180) / 360) * count)));
  const row = (lat: number) => {
    const clamped = Math.min(earthLatitudeLimit, Math.max(-earthLatitudeLimit, lat));
    const radians = (clamped * Math.PI) / 180;
    const y = (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
    return Math.min(count - 1, Math.max(0, Math.floor(y * count)));
  };
  // Bounds across the antimeridian wrap round.
  const columns: number[] = [];
  const first = column(west);
  const last = column(east);
  if (west <= east) for (let x = first; x <= last; x += 1) columns.push(x);
  else {
    for (let x = first; x < count; x += 1) columns.push(x);
    for (let x = 0; x <= last; x += 1) columns.push(x);
  }
  const top = row(north);
  const bottom = row(south);
  const centre = [(first + last + 1) / 2, (top + bottom + 1) / 2];
  const tiles: TileflowTileAddress[] = [];
  for (const x of columns) for (let y = top; y <= bottom; y += 1) tiles.push({z, x, y});
  const distance = ({x, y}: TileflowTileAddress) =>
    (x + 0.5 - centre[0]!) ** 2 + (y + 0.5 - centre[1]!) ** 2;
  return tiles.sort((a, b) => distance(a) - distance(b));
}

/** The longitude and latitude of a point in a tile, given in tile units of an `extent`. */
export function tileflowTilePointToLngLat(
  tile: TileflowTileAddress,
  x: number,
  y: number,
  extent = 4096,
): [number, number] {
  const size = extent * 2 ** tile.z;
  const globalX = tile.x * extent + x;
  const globalY = tile.y * extent + y;
  const lng = (globalX / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * globalY) / size;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return [lng, lat];
}

/**
 * Reads a vector source's tiles in an application: for example a MapLibre map's World source, with
 * `tiles`, `minzoom` and `maxzoom` taken from `map.getSource(id)`, and the map's `transformRequest`.
 */
export function createTileflowTileReader(options: TileflowTileReaderOptions): TileflowTileReader {
  const settings = validated(options);
  const cache = new Map<string, TileflowTile | undefined>();
  const inFlight = new Map<string, Promise<TileflowTile | undefined>>();
  const queue: (() => void)[] = [];
  let running = 0;
  let generation = 0;

  function remember(key: string, tile: TileflowTile | undefined) {
    if (settings.cacheSize === 0) return;
    cache.delete(key);
    cache.set(key, tile);
    while (cache.size > settings.cacheSize) cache.delete(cache.keys().next().value!);
  }

  async function slot<T>(work: () => Promise<T>): Promise<T> {
    if (running >= settings.concurrency) await new Promise<void>((resolve) => queue.push(resolve));
    running += 1;
    try {
      return await work();
    } finally {
      running -= 1;
      queue.shift()?.();
    }
  }

  function load(address: TileflowTileAddress, key: string): Promise<TileflowTile | undefined> {
    const started = generation;
    const pending = slot(async () => {
      const template = settings.tiles
        .replaceAll('{z}', String(address.z))
        .replaceAll('{x}', String(address.x))
        .replaceAll('{y}', String(address.y));
      const request = await settings.transformRequest?.(template, 'Tile');
      if (started !== generation) return undefined;
      const response = await settings.fetch(request?.url ?? template, {
        ...(request?.headers ? {headers: request.headers} : {}),
        ...(request?.credentials ? {credentials: request.credentials} : {}),
      });
      if (response.status === 404 || response.status === 204) return undefined;
      if (!response.ok) throw new Error(`Tile ${key} is unavailable (HTTP ${response.status}).`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return Object.freeze({
        ...address,
        layers: decodeTileflowVectorTile(bytes, {layers: settings.layers}),
      });
    }).then(
      (tile) => {
        inFlight.delete(key);
        if (started === generation) remember(key, tile);
        return tile;
      },
      (error: unknown) => {
        inFlight.delete(key);
        throw error;
      },
    );
    inFlight.set(key, pending);
    return pending;
  }

  function readTile(
    address: TileflowTileAddress,
    {signal}: {signal?: AbortSignal} = {},
  ): Promise<TileflowTile | undefined> {
    const {z, x, y} = address;
    if (
      ![z, x, y].every(Number.isSafeInteger) ||
      z < 0 ||
      x < 0 ||
      y < 0 ||
      x >= 2 ** z ||
      y >= 2 ** z
    )
      return Promise.reject(new RangeError(`Invalid tile address ${z}/${x}/${y}.`));
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    const key = `${z}/${x}/${y}`;
    if (cache.has(key)) {
      const tile = cache.get(key);
      remember(key, tile);
      return Promise.resolve(tile);
    }
    const pending = inFlight.get(key) ?? load(address, key);
    if (!signal) return pending;
    // A reader that stops waiting leaves the request to finish for the cache and other readers.
    return new Promise((resolve, reject) => {
      const abort = () => reject(abortReason(signal));
      signal.addEventListener('abort', abort, {once: true});
      pending.then(
        (tile) => {
          signal.removeEventListener('abort', abort);
          resolve(tile);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        },
      );
    });
  }

  return {
    readTile,
    async readArea({bounds, zoom, maxTiles = 64, signal}) {
      if (!Number.isFinite(zoom)) throw new RangeError('A tile area needs a finite zoom.');
      const z = Math.min(settings.maxzoom, Math.max(settings.minzoom, Math.round(zoom)));
      const addresses = tileflowTilesForBounds(bounds, z);
      if (addresses.length > maxTiles)
        throw new RangeError(
          `The area takes ${addresses.length} tiles at zoom ${z}, more than the ${maxTiles} allowed.`,
        );
      const tiles = await Promise.all(addresses.map((address) => readTile(address, {signal})));
      return tiles.filter((tile): tile is TileflowTile => tile !== undefined);
    },
    clear() {
      generation += 1;
      cache.clear();
    },
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The tile read was aborted.', 'AbortError');
}

function validated(options: TileflowTileReaderOptions) {
  const {tiles} = options;
  if (
    typeof tiles !== 'string' ||
    !tiles.includes('{z}') ||
    !tiles.includes('{x}') ||
    !tiles.includes('{y}')
  )
    throw new TypeError('A tile reader needs a tile address with {z}, {x} and {y}.');
  const minzoom = options.minzoom ?? 0;
  const maxzoom = options.maxzoom ?? 14;
  if (!(
    Number.isInteger(minzoom) &&
    Number.isInteger(maxzoom) &&
    minzoom >= 0 &&
    maxzoom <= 30 &&
    minzoom <= maxzoom
  ))
    throw new RangeError('Tile reader zooms are whole numbers from 0 to 30, minzoom first.');
  const cacheSize = options.cacheSize ?? 128;
  if (!(Number.isInteger(cacheSize) && cacheSize >= 0 && cacheSize <= 4096))
    throw new RangeError('Tile reader cacheSize runs from 0 to 4096 tiles.');
  const concurrency = options.concurrency ?? 6;
  if (!(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 32))
    throw new RangeError('Tile reader concurrency runs from 1 to 32 requests.');
  if (typeof (options.fetch ?? globalThis.fetch) !== 'function')
    throw new TypeError('A tile reader needs fetch.');
  const fetcher = options.fetch ?? fetchTile;
  if (
    options.layers !== undefined &&
    (!Array.isArray(options.layers) || options.layers.some((layer) => typeof layer !== 'string'))
  )
    throw new TypeError('Tile reader layers are layer names.');
  return {
    tiles,
    minzoom,
    maxzoom,
    cacheSize,
    concurrency,
    fetch: fetcher,
    layers: options.layers,
    transformRequest: options.transformRequest,
  };
}

// A source served from a Tileflow PMTiles archive is read through Core's own PMTiles protocol,
// sharing the map's archives; any other address through the global fetch.
function fetchTile(url: string, init: RequestInit): Promise<Response> {
  return isTileflowPmtilesUrl(url) ? fetchTileflowPmtilesTile(url) : globalThis.fetch(url, init);
}

/** Structural MapLibre capability; importing this module never loads a renderer. */
export type TileflowTileSourceMap = {getSource(id: string): unknown};

/**
 * The tile address and zooms of a map's vector source once the map has loaded it, ready for
 * `createTileflowTileReader`; undefined while the source is not loaded or has no tile address.
 */
export function readTileflowMapTileSource(
  map: TileflowTileSourceMap,
  sourceId: string,
): {tiles: string; minzoom: number; maxzoom: number} | undefined {
  const source = map.getSource(sourceId) as
    {tiles?: unknown; minzoom?: unknown; maxzoom?: unknown} | undefined;
  const tiles = Array.isArray(source?.tiles) ? (source.tiles[0] as unknown) : undefined;
  if (typeof tiles !== 'string') return undefined;
  const zoom = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 30
      ? value
      : fallback;
  return {tiles, minzoom: zoom(source!.minzoom, 0), maxzoom: zoom(source!.maxzoom, 14)};
}
