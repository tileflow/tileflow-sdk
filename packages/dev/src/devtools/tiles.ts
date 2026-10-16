import {VectorTile} from '@mapbox/vector-tile';
import type {Map as MapLibreMap} from 'maplibre-gl';
import {PbfReader} from 'pbf';
import type {TileRecord} from './types';

/** Version-isolated observation of MapLibre 6 tile managers. Never mutates renderer caches. */
export function visibleTiles(map: MapLibreMap): {supported: boolean; tiles: TileRecord[]} {
  const managers = (map as unknown as {style?: {tileManagers?: Record<string, any>}}).style
    ?.tileManagers;
  if (!managers) return {supported: false, tiles: []};
  const tiles: TileRecord[] = [];
  for (const [source, manager] of Object.entries(managers)) {
    if (source.startsWith('__tileflow-devtools-')) continue;
    for (const tile of manager?._inViewTiles?.getAllTiles?.() || []) {
      const canonical = tile.tileID?.canonical;
      if (!canonical || ![canonical.z, canonical.x, canonical.y].every(Number.isInteger)) continue;
      tiles.push({
        key: `${source}:${tile.tileID.key}`,
        source,
        z: canonical.z,
        x: canonical.x,
        y: canonical.y,
        overscaledZ: tile.tileID.overscaledZ ?? canonical.z,
        state: String(tile.state || 'unknown'),
        bytes: tile.latestRawTileData?.byteLength,
        wrap: tile.tileID.wrap ?? 0,
      });
      if (tiles.length >= 1000) return {supported: true, tiles};
    }
  }
  return {supported: true, tiles};
}

export function tilePolygon(tile: Pick<TileRecord, 'z' | 'x' | 'y' | 'wrap'>) {
  const n = 2 ** tile.z;
  const longitude = (x: number) => (x / n) * 360 - 180 + (tile.wrap ?? 0) * 360;
  const latitude = (y: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const w = longitude(tile.x),
    e = longitude(tile.x + 1),
    north = latitude(tile.y),
    south = latitude(tile.y + 1);
  return {
    type: 'Polygon' as const,
    coordinates: [
      [
        [w, north],
        [e, north],
        [e, south],
        [w, south],
        [w, north],
      ],
    ],
  };
}

export type TileContents = {
  type: string;
  tileSize?: number;
  encoding?: string;
  layers?: VectorTile['layers'];
  terrain?: {size: number; min: number; max: number; bytes: number};
  message?: string;
  revision?: object;
};

const decodedTiles = new WeakMap<object, Pick<TileContents, 'layers' | 'message'>>();

/** Decode only the selected resident tile. No requests, viewport queries or cache writes. */
export function inspectTile(map: MapLibreMap, record: TileRecord): TileContents {
  const source = map.getStyle()?.sources[record.source];
  const type = source?.type ?? 'unknown';
  const managers = (map as unknown as {style?: {tileManagers?: Record<string, any>}}).style
    ?.tileManagers;
  const tile = managers?.[record.source]?._inViewTiles
    ?.getAllTiles?.()
    .find((tile: any) => `${record.source}:${tile.tileID?.key}` === record.key);
  if (!tile)
    return {
      type,
      message: 'This tile is no longer in view. Select a resident tile to inspect its contents.',
    };
  const result: TileContents = {
    type,
    tileSize: tile.tileSize,
    encoding:
      tile.latestEncoding ??
      (source?.type === 'raster-dem' ? (source.encoding ?? 'mapbox') : undefined),
  };
  if (type === 'raster-dem') {
    const dem = tile.dem;
    if (dem && [dem.dim, dem.min, dem.max].every(Number.isFinite)) {
      result.terrain = {
        size: dem.dim,
        min: dem.min,
        max: dem.max,
        bytes: dem.data?.byteLength ?? 0,
      };
      result.revision = dem;
    } else result.message = 'Elevation data is not available in the renderer yet.';
    return result;
  }
  if (type !== 'vector' && type !== 'geojson') {
    return {...result, message: 'This source contains raster pixels, not vector features.'};
  }
  const raw = tile.latestRawTileData as ArrayBuffer | undefined;
  if (!raw?.byteLength)
    return {...result, message: 'Raw tile data is not available in the renderer yet.'};
  result.revision = raw;
  if (tile.latestEncoding === 'mlt') {
    return {
      ...result,
      message: 'Feature decoding for MLT tiles is not available in this inspector.',
    };
  }
  let decoded = decodedTiles.get(raw);
  if (!decoded) {
    try {
      decoded = {layers: new VectorTile(new PbfReader(new Uint8Array(raw))).layers};
    } catch {
      decoded = {message: 'The resident tile could not be decoded as vector data.'};
    }
    decodedTiles.set(raw, decoded);
  }
  return {...result, ...decoded};
}

/** Encoded MVT layer-message bytes, before HTTP compression. Includes keys and values. */
export function sourceLayerBytes(
  map: MapLibreMap,
  record: TileRecord,
): Record<string, number> | undefined {
  const managers = (map as any).style?.tileManagers;
  const tile = managers?.[record.source]?._inViewTiles
    ?.getAllTiles?.()
    .find((item: any) => `${record.source}:${item.tileID?.key}` === record.key);
  const raw = tile?.latestRawTileData;
  if (!raw || tile.latestEncoding === 'mlt') return undefined;
  try {
    const pbf = new PbfReader(new Uint8Array(raw)),
      result: Record<string, number> = {};
    pbf.readFields((tag, _result, reader) => {
      if (tag !== 3) return;
      const length = reader.readVarint(),
        end = reader.pos + length;
      let name = '';
      reader.readFields(
        (field, _layer, input) => {
          if (field === 1) name = input.readString();
        },
        {},
        end,
      );
      if (name) result[name] = (result[name] ?? 0) + length;
    }, result);
    return result;
  } catch {
    return undefined;
  }
}
