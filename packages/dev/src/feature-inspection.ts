import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {compareCodeUnits, type MapLibreStyle} from '@tileflow/core';
import {
  createStyleFromCatalog,
  type TileflowBuildCatalog,
  type TileflowPreparedMapAssets,
} from '@tileflow/core/build';
import {assertValidTileflowStyle} from './style-validation';

const mercatorLatitudeLimit = 85.0511287798066;
const maxTileJsonBytes = 1024 * 1024;
const maxTileBytes = 6 * 1024 * 1024;
const maxTotalTileBytes = 24 * 1024 * 1024;
const maxTiles = 32;
const maxScannedFeatures = 20_000;
const maxStringLength = 256;

export type TileflowFeatureInspectionOptions = {
  apiBaseUrl?: string;
  center: readonly [number, number];
  fetch?: typeof fetch;
  height?: number;
  limit?: number;
  properties?: readonly string[];
  /** Build-owned assets required to compile the selected map exactly. */
  preparedAssets?: TileflowPreparedMapAssets;
  signal?: AbortSignal;
  sourceLayers: readonly string[];
  timeoutMs?: number;
  width?: number;
  zoom: number;
};

export type TileflowInspectedProperty = boolean | number | string;

export type TileflowInspectedFeature = {
  sourceLayer: string;
  id: number | null;
  geometry: {
    type: string;
    center: [number, number];
    bounds: [number, number, number, number];
  };
  properties: Record<string, TileflowInspectedProperty>;
};

export type TileflowFeatureInspection = {
  schemaVersion: 1;
  map: string;
  camera: {
    center: [number, number];
    zoom: number;
    viewport: {width: number; height: number};
  };
  source: {
    id: string;
    origin: string;
    tileJsonPath: string | null;
    tileOrigins: string[];
    version: string | null;
  };
  sourceLayers: string[];
  properties: string[];
  tileZoom: number;
  tilesRead: number;
  scannedFeatures: number;
  truncated: boolean;
  features: TileflowInspectedFeature[];
};

type TileCoordinate = {x: number; y: number; z: number};
type Bounds = [number, number, number, number];
type TileJson = {
  maxzoom?: number;
  minzoom?: number;
  scheme?: string;
  tiles: string[];
};

export async function inspectTileflowFeatures(
  project: TileflowBuildCatalog,
  mapName: string,
  input: TileflowFeatureInspectionOptions,
): Promise<TileflowFeatureInspection> {
  const options = validateInspectionOptions(input);
  if (!Object.hasOwn(project.maps, mapName)) {
    const available = Object.keys(project.maps).sort(compareCodeUnits);
    throw new Error(
      `Unknown map "${mapName}". Available maps: ${available.join(', ') || '(none)'}`,
    );
  }

  const style = createStyleFromCatalog(project, mapName, {
    apiBaseUrl: options.apiBaseUrl,
    preparedAssets: options.preparedAssets,
  });
  assertValidTileflowStyle(style, mapName);
  const source = resolveVectorSource(style, options.sourceLayers);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const remoteOrigins = new Set<string>();
  const tileSource = await resolveTileSource(
    source.definition,
    fetchImplementation,
    options,
    remoteOrigins,
  );
  const bounds = viewportBounds(options.center, options.zoom, options.width, options.height);
  const tileZoom = resolveTileZoom(options.zoom, tileSource.minzoom, tileSource.maxzoom);
  const tileCoordinates = tileCover(bounds, tileZoom);

  if (tileCoordinates.length > maxTiles) {
    throw new Error(
      `Feature inspection would read ${tileCoordinates.length} tiles; narrow the viewport or increase zoom (maximum ${maxTiles}).`,
    );
  }

  const features: TileflowInspectedFeature[] = [];
  let scannedFeatures = 0;
  let totalTileBytes = 0;
  let scanTruncated = false;

  for (const coordinate of tileCoordinates) {
    const tileUrl = resolveTileUrl(tileSource.template, coordinate, tileSource.scheme);
    const bytes = await fetchBytes(tileUrl, {
      fetchImplementation,
      label: 'vector tile',
      limit: maxTileBytes,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
    remoteOrigins.add(safeOrigin(bytes.finalUrl));
    totalTileBytes += bytes.body.byteLength;
    if (totalTileBytes > maxTotalTileBytes) {
      throw new Error(
        `Feature inspection exceeded the ${maxTotalTileBytes}-byte total vector-tile limit.`,
      );
    }

    // @mapbox/vector-tile still types its reader against pbf v4's combined
    // reader/writer class, while its runtime only consumes the reader API.
    const reader = new PbfReader(bytes.body) as unknown as ConstructorParameters<
      typeof VectorTile
    >[0];
    const tile = new VectorTile(reader);
    for (const sourceLayer of options.sourceLayers) {
      const layer = tile.layers[sourceLayer];
      if (!layer) continue;

      for (let index = 0; index < layer.length; index += 1) {
        scannedFeatures += 1;
        if (scannedFeatures > maxScannedFeatures) {
          scanTruncated = true;
          break;
        }

        const vectorFeature = layer.feature(index);
        const geoJsonFeature = vectorFeature.toGeoJSON(coordinate.x, coordinate.y, coordinate.z);
        const geometry = summarizeGeometry(geoJsonFeature.geometry);
        if (!geometry || !boundsIntersect(bounds, geometry.bounds)) continue;

        features.push({
          sourceLayer,
          id:
            typeof vectorFeature.id === 'number' && Number.isSafeInteger(vectorFeature.id)
              ? vectorFeature.id
              : null,
          geometry,
          properties: projectProperties(vectorFeature.properties, options.properties),
        });
      }

      if (scanTruncated) break;
    }

    if (scanTruncated) break;
  }

  const uniqueFeatures = deduplicateFeatures(features).sort(compareInspectedFeatures);
  const limitedFeatures = uniqueFeatures.slice(0, options.limit);
  const dataIdentity = style.metadata?.['tileflow:data'];
  const metadataVersion =
    dataIdentity && typeof dataIdentity === 'object' && 'revision' in dataIdentity
      ? (dataIdentity as {revision?: unknown}).revision
      : undefined;

  return {
    schemaVersion: 1,
    map: mapName,
    camera: {
      center: [...options.center],
      zoom: options.zoom,
      viewport: {width: options.width, height: options.height},
    },
    source: {
      id: source.id,
      origin: tileSource.origin,
      tileJsonPath: tileSource.tileJsonPath,
      tileOrigins: [...remoteOrigins].sort(compareCodeUnits),
      version: typeof metadataVersion === 'string' ? metadataVersion : null,
    },
    sourceLayers: options.sourceLayers,
    properties: options.properties,
    tileZoom,
    tilesRead: tileCoordinates.length,
    scannedFeatures: Math.min(scannedFeatures, maxScannedFeatures),
    truncated: scanTruncated || uniqueFeatures.length > options.limit,
    features: limitedFeatures,
  };
}

function validateInspectionOptions(input: TileflowFeatureInspectionOptions) {
  const center = input.center;
  if (
    !Array.isArray(center) ||
    center.length !== 2 ||
    !Number.isFinite(center[0]) ||
    !Number.isFinite(center[1]) ||
    center[0] < -180 ||
    center[0] > 180 ||
    center[1] < -mercatorLatitudeLimit ||
    center[1] > mercatorLatitudeLimit
  ) {
    throw new Error(
      `Feature inspection center must be [longitude, latitude] inside Web Mercator bounds.`,
    );
  }
  if (!Number.isFinite(input.zoom) || input.zoom < 0 || input.zoom > 24) {
    throw new Error('Feature inspection zoom must be between 0 and 24.');
  }

  const width = boundedInteger(input.width ?? 512, 64, 2048, 'width');
  const height = boundedInteger(input.height ?? 512, 64, 2048, 'height');
  const limit = boundedInteger(input.limit ?? 200, 1, 500, 'limit');
  const timeoutMs = boundedInteger(input.timeoutMs ?? 10_000, 100, 60_000, 'timeout');
  const sourceLayers = normalizeNames(input.sourceLayers, 1, 12, 'source layer');
  const properties = normalizeNames(input.properties ?? [], 0, 16, 'property');

  return {
    ...input,
    center: [center[0], center[1]] as [number, number],
    height,
    limit,
    properties,
    sourceLayers,
    timeoutMs,
    width,
  };
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `Feature inspection ${label} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

function normalizeNames(
  values: readonly string[],
  minimum: number,
  maximum: number,
  label: string,
): string[] {
  if (!Array.isArray(values) || values.length < minimum || values.length > maximum) {
    throw new Error(
      `Feature inspection requires ${minimum}-${maximum} ${label}${maximum === 1 ? '' : 's'}.`,
    );
  }
  const normalized = [...new Set(values)].sort(compareCodeUnits);
  for (const value of normalized) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value)) {
      throw new Error(`Invalid feature inspection ${label} "${value}".`);
    }
  }
  return normalized;
}

function resolveVectorSource(style: MapLibreStyle, sourceLayers: readonly string[]) {
  const requested = new Set(sourceLayers);
  const referencedSourceIds = new Set(
    style.layers
      .filter((layer) => requested.has(String(layer['source-layer'] ?? '')))
      .map((layer) => layer.source)
      .filter((sourceId): sourceId is string => typeof sourceId === 'string'),
  );
  const vectorSources = Object.entries(style.sources).filter(
    ([, definition]) => definition.type === 'vector',
  );
  const candidates =
    referencedSourceIds.size > 0
      ? vectorSources.filter(([sourceId]) => referencedSourceIds.has(sourceId))
      : vectorSources;

  if (candidates.length !== 1) {
    throw new Error(
      `Feature inspection requires exactly one vector source for the selected layers; found ${candidates.length}.`,
    );
  }
  const [id, definition] = candidates[0]!;
  return {id, definition};
}

async function resolveTileSource(
  definition: Record<string, unknown>,
  fetchImplementation: typeof fetch,
  options: ReturnType<typeof validateInspectionOptions>,
  origins: Set<string>,
): Promise<{
  maxzoom: number;
  minzoom: number;
  origin: string;
  scheme: 'xyz' | 'tms';
  template: URL;
  tileJsonPath: string | null;
}> {
  if (Array.isArray(definition.tiles) && typeof definition.tiles[0] === 'string') {
    const template = safeHttpUrl(definition.tiles[0], 'vector tile template');
    origins.add(template.origin);
    return {
      maxzoom: finiteZoom(definition.maxzoom, 22),
      minzoom: finiteZoom(definition.minzoom, 0),
      origin: template.origin,
      scheme: definition.scheme === 'tms' ? 'tms' : 'xyz',
      template,
      tileJsonPath: null,
    };
  }

  if (typeof definition.url !== 'string') {
    throw new Error('Feature inspection vector source must define an HTTP(S) TileJSON URL.');
  }
  const tileJsonUrl = safeHttpUrl(definition.url, 'TileJSON URL');
  const response = await fetchBytes(tileJsonUrl, {
    fetchImplementation,
    label: 'TileJSON',
    limit: maxTileJsonBytes,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  const finalTileJsonUrl = safeHttpUrl(response.finalUrl, 'TileJSON response URL');
  origins.add(finalTileJsonUrl.origin);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(response.body));
  } catch {
    throw new Error('Feature inspection received invalid TileJSON JSON.');
  }
  const tileJson = parseTileJson(parsed);
  const template = safeHttpUrl(
    new URL(tileJson.tiles[0]!, finalTileJsonUrl).toString(),
    'vector tile template',
  );
  origins.add(template.origin);

  return {
    maxzoom: finiteZoom(tileJson.maxzoom, 22),
    minzoom: finiteZoom(tileJson.minzoom, 0),
    origin: finalTileJsonUrl.origin,
    scheme: tileJson.scheme === 'tms' ? 'tms' : 'xyz',
    template,
    tileJsonPath: finalTileJsonUrl.pathname,
  };
}

function parseTileJson(value: unknown): TileJson {
  if (!isRecord(value) || !Array.isArray(value.tiles) || value.tiles.length === 0) {
    throw new Error('Feature inspection TileJSON must contain a non-empty tiles array.');
  }
  const tiles = value.tiles.filter((entry): entry is string => typeof entry === 'string');
  if (tiles.length !== value.tiles.length || tiles.length > 8) {
    throw new Error('Feature inspection TileJSON tiles must contain 1-8 URL templates.');
  }
  return {
    tiles,
    ...(typeof value.maxzoom === 'number' ? {maxzoom: value.maxzoom} : {}),
    ...(typeof value.minzoom === 'number' ? {minzoom: value.minzoom} : {}),
    ...(typeof value.scheme === 'string' ? {scheme: value.scheme} : {}),
  };
}

function finiteZoom(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 24
    ? value
    : fallback;
}

function resolveTileZoom(zoom: number, minzoom: number, maxzoom: number): number {
  if (minzoom > maxzoom) throw new Error('Feature inspection source minzoom exceeds maxzoom.');
  return Math.max(minzoom, Math.min(maxzoom, Math.floor(zoom)));
}

function viewportBounds(
  center: readonly [number, number],
  zoom: number,
  width: number,
  height: number,
): Bounds {
  const centerX = longitudeToWorldX(center[0]);
  const centerY = latitudeToWorldY(center[1]);
  const scale = 512 * 2 ** zoom;
  const westX = centerX - width / 2 / scale;
  const eastX = centerX + width / 2 / scale;
  if (westX < 0 || eastX > 1) {
    throw new Error('Feature inspection viewports that cross the antimeridian are not supported.');
  }
  const northY = Math.max(0, centerY - height / 2 / scale);
  const southY = Math.min(1, centerY + height / 2 / scale);
  return [
    worldXToLongitude(westX),
    worldYToLatitude(southY),
    worldXToLongitude(eastX),
    worldYToLatitude(northY),
  ];
}

function tileCover(bounds: Bounds, zoom: number): TileCoordinate[] {
  const count = 2 ** zoom;
  const minimumX = clampTile(Math.floor(longitudeToWorldX(bounds[0]) * count), count);
  const maximumX = clampTile(Math.floor(longitudeToWorldX(bounds[2]) * count), count);
  const minimumY = clampTile(Math.floor(latitudeToWorldY(bounds[3]) * count), count);
  const maximumY = clampTile(Math.floor(latitudeToWorldY(bounds[1]) * count), count);
  const coordinates: TileCoordinate[] = [];
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) coordinates.push({x, y, z: zoom});
  }
  return coordinates;
}

function clampTile(value: number, count: number): number {
  return Math.max(0, Math.min(count - 1, value));
}

function resolveTileUrl(template: URL, coordinate: TileCoordinate, scheme: 'xyz' | 'tms'): URL {
  const y = scheme === 'tms' ? 2 ** coordinate.z - 1 - coordinate.y : coordinate.y;
  const replacements = {
    z: coordinate.z,
    x: coordinate.x,
    y,
    '-y': 2 ** coordinate.z - 1 - coordinate.y,
  } as const;
  let value = template.toString();
  for (const [token, replacement] of Object.entries(replacements)) {
    value = value.replace(
      new RegExp(`(?:\\{${token}\\}|%7B${token}%7D)`, 'giu'),
      String(replacement),
    );
  }
  if (/(?:\{(?:z|x|-?y)\}|%7B(?:z|x|-?y)%7D)/iu.test(value)) {
    throw new Error('Feature inspection tile template contains unresolved coordinates.');
  }
  return new URL(value);
}

async function fetchBytes(
  url: URL,
  options: {
    fetchImplementation: typeof fetch;
    label: string;
    limit: number;
    signal?: AbortSignal;
    timeoutMs: number;
  },
): Promise<{body: Uint8Array; finalUrl: string}> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await options.fetchImplementation(url, {signal});
  if (!response.ok) {
    throw new Error(`${options.label} request failed with HTTP ${response.status}.`);
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > options.limit) {
    throw new Error(`${options.label} exceeds the ${options.limit}-byte limit.`);
  }
  if (!response.body) throw new Error(`${options.label} response had no body.`);

  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body.getReader();
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.byteLength;
    if (length > options.limit) {
      await reader.cancel();
      throw new Error(`${options.label} exceeds the ${options.limit}-byte limit.`);
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {body, finalUrl: response.url || url.toString()};
}

function summarizeGeometry(value: unknown): TileflowInspectedFeature['geometry'] | undefined {
  if (!isRecord(value) || typeof value.type !== 'string' || !('coordinates' in value)) return;
  const points: Array<[number, number]> = [];
  collectCoordinates(value.coordinates, points);
  if (points.length === 0) return;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [longitude, latitude] of points) {
    west = Math.min(west, longitude);
    south = Math.min(south, latitude);
    east = Math.max(east, longitude);
    north = Math.max(north, latitude);
  }
  return {
    type: value.type,
    center: [roundCoordinate((west + east) / 2), roundCoordinate((south + north) / 2)],
    bounds: [
      roundCoordinate(west),
      roundCoordinate(south),
      roundCoordinate(east),
      roundCoordinate(north),
    ],
  };
}

function collectCoordinates(value: unknown, points: Array<[number, number]>): void {
  if (!Array.isArray(value)) return;
  if (
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  ) {
    points.push([value[0], value[1]]);
    return;
  }
  for (const child of value) collectCoordinates(child, points);
}

function boundsIntersect(left: Bounds, right: Bounds): boolean {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

function projectProperties(
  source: Record<string, boolean | number | string>,
  properties: readonly string[],
): Record<string, TileflowInspectedProperty> {
  const projected: Record<string, TileflowInspectedProperty> = {};
  for (const property of properties) {
    const value = source[property];
    if (typeof value === 'string') projected[property] = value.slice(0, maxStringLength);
    else if (typeof value === 'boolean') projected[property] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) projected[property] = value;
  }
  return projected;
}

function deduplicateFeatures(features: TileflowInspectedFeature[]): TileflowInspectedFeature[] {
  const unique = new Map<string, TileflowInspectedFeature>();
  for (const feature of features) {
    const key =
      feature.id === null
        ? `${feature.sourceLayer}|${JSON.stringify(feature.geometry)}|${JSON.stringify(feature.properties)}`
        : `${feature.sourceLayer}|id:${feature.id}`;
    if (!unique.has(key)) unique.set(key, feature);
  }
  return [...unique.values()];
}

function compareInspectedFeatures(
  left: TileflowInspectedFeature,
  right: TileflowInspectedFeature,
): number {
  const leftName = typeof left.properties.name === 'string' ? left.properties.name : '';
  const rightName = typeof right.properties.name === 'string' ? right.properties.name : '';
  return (
    compareCodeUnits(left.sourceLayer, right.sourceLayer) ||
    Number(rightName.length > 0) - Number(leftName.length > 0) ||
    compareCodeUnits(leftName, rightName) ||
    (left.id ?? Number.MAX_SAFE_INTEGER) - (right.id ?? Number.MAX_SAFE_INTEGER) ||
    compareCodeUnits(JSON.stringify(left), JSON.stringify(right))
  );
}

function safeHttpUrl(value: string | URL, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Feature inspection ${label} is not a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Feature inspection ${label} must use HTTP or HTTPS.`);
  }
  return parsed;
}

function safeOrigin(value: string): string {
  return safeHttpUrl(value, 'response URL').origin;
}

function longitudeToWorldX(longitude: number): number {
  return (longitude + 180) / 360;
}

function worldXToLongitude(x: number): number {
  return x * 360 - 180;
}

function latitudeToWorldY(latitude: number): number {
  const radians = (latitude * Math.PI) / 180;
  return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
}

function worldYToLatitude(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10_000_000) / 10_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
