// The formats of a landmarks tileset, the tiles of building models that other web maps call
// batched models. Its TileJSON names the regions that hold landmarks; a region's index names the
// tiles inside it by the SHA-256 of their bytes; a tile is a prepared model file
// (models-3d-file.ts) holding the landmarks whose origin falls in it. A release of the tileset
// changes only the tiles and indexes whose landmarks changed, and the renderer downloads only the
// indexes and tiles near the camera. It has no DOM dependency.

/** The zoom of a landmarks tileset's tiles. */
export const tileflowLandmarkTileZoom = 14;
/** The zoom of the regions whose indexes name those tiles. */
export const tileflowLandmarkRegionZoom = 6;

/** A landmarks tileset as its TileJSON describes it. */
export type TileflowLandmarksTileJson = Readonly<{
  /** Where the TileJSON was read, which relative addresses resolve against. */
  url: string;
  /** A tile's address, with `{sha256}` in place of its hash. */
  tile: string;
  /** A region index's address, with `{z}`, `{x}` and `{y}`. */
  region: string;
  tileZoom: number;
  regionZoom: number;
  /** The regions that hold landmarks, as `x/y`. */
  regions: ReadonlySet<string>;
}>;

/** A region's index: the tiles inside it that hold landmarks, by their hash. */
export type TileflowLandmarkRegion = Readonly<{
  region: readonly [number, number];
  /** `[x, y, sha256]` of each tile, sorted by x, then y. */
  tiles: readonly (readonly [number, number, string])[];
}>;

const sha256 = /^[a-f0-9]{64}$/u;

/** The zoom-14 tile a landmark's origin, longitude and latitude, stands in. */
export function tileflowLandmarkTileOf(at: readonly [number, number]): [number, number] {
  const [longitude, latitude] = at;
  if (!(longitude >= -180 && longitude <= 180 && latitude >= -85 && latitude <= 85))
    throw new RangeError('A landmark stands at a longitude and a latitude on the map.');
  const n = 2 ** tileflowLandmarkTileZoom;
  const phi = (latitude * Math.PI) / 180;
  return [
    Math.min(n - 1, Math.floor(((longitude + 180) / 360) * n)),
    Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n),
  ];
}

/** The region a zoom-14 tile lies in. */
export function tileflowLandmarkRegionOf(tile: readonly [number, number]): [number, number] {
  const shift = 2 ** (tileflowLandmarkTileZoom - tileflowLandmarkRegionZoom);
  return [Math.floor(tile[0] / shift), Math.floor(tile[1] / shift)];
}

/**
 * Writes a region's index as the bytes a tileset serves: canonical JSON, its tiles sorted. Throws a
 * `RangeError` when a tile lies outside the region, appears twice or has no hash.
 */
export function serializeTileflowLandmarkRegion(region: TileflowLandmarkRegion): Uint8Array {
  const [x, y] = region.region;
  const regions = 2 ** tileflowLandmarkRegionZoom;
  if (![x, y].every((value) => Number.isInteger(value) && value >= 0 && value < regions))
    throw new RangeError(`A region is a zoom-${tileflowLandmarkRegionZoom} tile.`);
  const tiles = [...region.tiles].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [at, [tx, ty, hash]] of tiles.entries()) {
    const [rx, ry] = tileflowLandmarkRegionOf([tx, ty]);
    if (!Number.isInteger(tx) || !Number.isInteger(ty) || rx !== x || ry !== y)
      throw new RangeError(`Tile ${tx}/${ty} lies outside region ${x}/${y}.`);
    if (!sha256.test(hash)) throw new RangeError(`Tile ${tx}/${ty} has no SHA-256.`);
    const before = tiles[at - 1];
    if (before && before[0] === tx && before[1] === ty)
      throw new RangeError(`Tile ${tx}/${ty} appears twice.`);
  }
  if (tiles.length === 0) throw new RangeError('A region index names at least one tile.');
  return new TextEncoder().encode(
    JSON.stringify({
      format: 'tileflow-landmark-region-v1',
      zoom: tileflowLandmarkTileZoom,
      region: [tileflowLandmarkRegionZoom, x, y],
      tiles: tiles.map(([tx, ty, hash]) => [tx, ty, hash]),
    }),
  );
}

/** Reads a region's index, or undefined when it is not one. */
export function readTileflowLandmarkRegion(json: unknown): TileflowLandmarkRegion | undefined {
  if (!isRecord(json) || json.format !== 'tileflow-landmark-region-v1') return undefined;
  const region = json.region;
  if (
    json.zoom !== tileflowLandmarkTileZoom ||
    !Array.isArray(region) ||
    region.length !== 3 ||
    region[0] !== tileflowLandmarkRegionZoom ||
    !Array.isArray(json.tiles)
  )
    return undefined;
  const [, x, y] = region as unknown[];
  if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
  const tiles: [number, number, string][] = [];
  for (const tile of json.tiles) {
    if (!Array.isArray(tile) || tile.length !== 3) return undefined;
    const [tx, ty, hash] = tile as unknown[];
    if (!Number.isInteger(tx) || !Number.isInteger(ty) || typeof hash !== 'string')
      return undefined;
    if (!sha256.test(hash)) return undefined;
    const [rx, ry] = tileflowLandmarkRegionOf([tx as number, ty as number]);
    if (rx !== x || ry !== y) return undefined;
    tiles.push([tx as number, ty as number, hash]);
  }
  return {region: [x as number, y as number], tiles};
}

/** Reads a landmarks tileset's TileJSON, or undefined when it is not one. */
export function readTileflowLandmarksTileJson(
  json: unknown,
  url: string,
): TileflowLandmarksTileJson | undefined {
  if (!isRecord(json) || json.format !== 'tileflow-landmarks-v2') return undefined;
  const tile = Array.isArray(json.tiles) ? json.tiles[0] : undefined;
  const regions = json.regions;
  if (
    typeof tile !== 'string' ||
    !tile.includes('{sha256}') ||
    json.minzoom !== tileflowLandmarkTileZoom ||
    json.maxzoom !== tileflowLandmarkTileZoom ||
    !isRecord(regions) ||
    regions.zoom !== tileflowLandmarkRegionZoom ||
    typeof regions.url !== 'string' ||
    !regions.url.includes('{x}') ||
    !regions.url.includes('{y}') ||
    !Array.isArray(regions.available)
  )
    return undefined;
  const available = new Set<string>();
  for (const region of regions.available) {
    if (!Array.isArray(region) || region.length !== 2) return undefined;
    const [x, y] = region as unknown[];
    if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
    available.add(`${x as number}/${y as number}`);
  }
  return {
    url,
    tile,
    region: regions.url,
    tileZoom: tileflowLandmarkTileZoom,
    regionZoom: tileflowLandmarkRegionZoom,
    regions: available,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
