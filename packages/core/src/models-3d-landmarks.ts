// The formats of a landmarks tileset, the tiles of building models that other web maps call
// batched models. Its TileJSON names the regions that hold landmarks; a region's index names the
// tiles inside it by the SHA-256 of their bytes, with where each landmark stands and the footprint
// it replaces; a tile is a prepared model file (models-3d-file.ts) holding the landmarks whose
// origin falls in it. A release of the tileset changes only the tiles and indexes whose landmarks
// changed, and the renderer downloads only the indexes and tiles near the camera. Knowing the
// footprints from the index, it keeps the buildings under a landmark flat while its tile loads
// instead of raising them and then taking them away. It has no DOM dependency.
import {tileflowModelLimits} from './models-3d-model';

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

/** A landmark as its region's index names it: where it stands and the footprint it replaces. */
export type TileflowLandmarkFootprint = Readonly<{
  id: string;
  /** Its origin, longitude and latitude. */
  at: readonly [number, number];
  /** Degrees clockwise from north. */
  heading: number;
  /** Rings as flat `[x, y, ...]` arrays in metres, x east and y north of the origin. */
  footprint: readonly (readonly number[])[];
}>;

/** A tile in a region's index: `[x, y, sha256, landmarks]`. */
export type TileflowLandmarkRegionTile = readonly [
  number,
  number,
  string,
  readonly TileflowLandmarkFootprint[],
];

/** A region's index: the tiles inside it that hold landmarks, by their hash. */
export type TileflowLandmarkRegion = Readonly<{
  region: readonly [number, number];
  /** Each tile, sorted by x, then y, with the landmarks it holds. */
  tiles: readonly TileflowLandmarkRegionTile[];
}>;

const sha256 = /^[a-f0-9]{64}$/u;
const landmarkId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
// Footprints travel in whole decimetres: a region's index stays small, and a few centimetres do
// not change which buildings a footprint covers.
const footprintStep = 10;

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
 * Writes a region's index as the bytes a tileset serves: canonical JSON, its tiles sorted and each
 * tile's landmarks sorted by id, footprints in whole decimetres. Throws a `RangeError` when a tile
 * lies outside the region, appears twice, has no hash or names no landmark, or when a landmark
 * stands outside its tile or has no valid footprint.
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
      format: 'tileflow-landmark-region-v2',
      zoom: tileflowLandmarkTileZoom,
      region: [tileflowLandmarkRegionZoom, x, y],
      tiles: tiles.map((tile) => [tile[0], tile[1], tile[2], landmarksOf(tile)]),
    }),
  );
}

/** A tile's landmarks as its index writes them, checked. */
function landmarksOf(tile: TileflowLandmarkRegionTile) {
  const [tx, ty] = tile;
  const landmarks = tile[3];
  if (!landmarks || landmarks.length === 0)
    throw new RangeError(`Tile ${tx}/${ty} names no landmark.`);
  const sorted = [...landmarks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sorted.map((landmark, at) => {
    const {id, heading} = landmark;
    if (!landmarkId.test(id)) throw new RangeError(`Landmark ${JSON.stringify(id)} has no id.`);
    if (sorted[at - 1]?.id === id) throw new RangeError(`Landmark ${id} appears twice.`);
    let own: [number, number];
    try {
      own = tileflowLandmarkTileOf(landmark.at);
    } catch {
      throw new RangeError(`Landmark ${id} stands at no place on the map.`);
    }
    if (own[0] !== tx || own[1] !== ty)
      throw new RangeError(`Landmark ${id} stands in tile ${own.join('/')}, not ${tx}/${ty}.`);
    if (!(typeof heading === 'number' && heading >= 0 && heading < 360))
      throw new RangeError(`Landmark ${id} is turned 0 to 360 degrees.`);
    const footprint = landmark.footprint.map((ring) =>
      ring.map((value) => Math.round(value * footprintStep)),
    );
    if (!validFootprint(footprint)) throw new RangeError(`Landmark ${id} has no valid footprint.`);
    return {id, at: [landmark.at[0], landmark.at[1]], heading, footprint};
  });
}

/** One to the model limit of rings of at least three points, in whole numbers. */
function validFootprint(footprint: unknown): footprint is number[][] {
  if (!Array.isArray(footprint) || footprint.length === 0) return false;
  let points = 0;
  for (const ring of footprint) {
    if (!Array.isArray(ring) || ring.length < 6 || ring.length % 2 !== 0) return false;
    if (!ring.every((value) => Number.isSafeInteger(value))) return false;
    points += ring.length / 2;
  }
  return points <= tileflowModelLimits.footprintPoints;
}

/** Reads a region's index, or undefined when it is not one. */
export function readTileflowLandmarkRegion(json: unknown): TileflowLandmarkRegion | undefined {
  if (!isRecord(json)) return undefined;
  if (json.format !== 'tileflow-landmark-region-v2') return undefined;
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
  const tiles: TileflowLandmarkRegionTile[] = [];
  for (const tile of json.tiles) {
    if (!Array.isArray(tile) || tile.length !== 4) return undefined;
    const [tx, ty, hash, listed] = tile as unknown[];
    if (!Number.isInteger(tx) || !Number.isInteger(ty) || typeof hash !== 'string')
      return undefined;
    if (!sha256.test(hash)) return undefined;
    const [rx, ry] = tileflowLandmarkRegionOf([tx as number, ty as number]);
    if (rx !== x || ry !== y) return undefined;
    const landmarks = readLandmarks(listed, tx as number, ty as number);
    if (!landmarks) return undefined;
    tiles.push([tx as number, ty as number, hash, landmarks]);
  }
  return {region: [x as number, y as number], tiles};
}

function readLandmarks(
  listed: unknown,
  tx: number,
  ty: number,
): TileflowLandmarkFootprint[] | undefined {
  if (!Array.isArray(listed) || listed.length === 0) return undefined;
  const out: TileflowLandmarkFootprint[] = [];
  for (const landmark of listed) {
    if (!isRecord(landmark)) return undefined;
    const {id, at, heading, footprint} = landmark;
    if (typeof id !== 'string' || !landmarkId.test(id)) return undefined;
    if (!Array.isArray(at) || at.length !== 2 || !at.every((value) => typeof value === 'number'))
      return undefined;
    if (!(typeof heading === 'number' && heading >= 0 && heading < 360)) return undefined;
    if (!validFootprint(footprint)) return undefined;
    let own: [number, number];
    try {
      own = tileflowLandmarkTileOf([at[0] as number, at[1] as number]);
    } catch {
      return undefined;
    }
    if (own[0] !== tx || own[1] !== ty) return undefined;
    out.push({
      id,
      at: [at[0] as number, at[1] as number],
      heading,
      footprint: footprint.map((ring) => ring.map((value) => value / footprintStep)),
    });
  }
  return out;
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
