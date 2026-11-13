import type {TileflowDataAdapter} from './binding';
import {
  openMapTiles,
  openMapTilesAdapter,
  openMapTilesContractVersion,
  type OpenMapTilesSchema,
} from './openmaptiles';
import {
  tileflowWorldDetailLayers,
  type TileflowWorldFieldName,
  tileflowWorldFields,
  type TileflowWorldLayerName,
  tileflowWorldLayers,
  tileflowWorldNameLanguagePrefix,
  tileflowWorldSchemaVersion,
} from './tileflow-world-schema';
import {
  tileflowWorldDetailTileJsonPath,
  tileflowWorldGeneration,
  tileflowWorldTileJsonPath,
} from './world-generation';
import {isTileflowWorldReleaseId} from './world-release-id';

export type {
  TileflowDataAdapter,
  TileflowDataFieldAccessor,
  TileflowDataLayerPartition,
} from './binding';
export {
  canonicalOpenMapTilesFields,
  canonicalOpenMapTilesLayers,
  isCanonicalOpenMapTilesSchema,
  openMapTiles,
  openMapTilesContractVersion,
} from './openmaptiles';
export type {
  OpenMapTilesFieldBindings,
  OpenMapTilesLayerBindings,
  OpenMapTilesSchema,
  OpenMapTilesSchemaOptions,
  ParkLayerSemantics,
} from './openmaptiles';
export {
  tileflowWorldAllLanguagesMinZoom,
  tileflowWorldDetailLayers,
  tileflowWorldFields,
  tileflowWorldLayers,
  tileflowWorldNameLanguagePrefix,
  tileflowWorldNaturalLanduseClasses,
  tileflowWorldOverviewLanguages,
  tileflowWorldSchemaVersion,
  tileflowWorldTilesetOf,
  tileflowWorldTilesets,
  tileflowWorldVocabularies,
} from './tileflow-world-schema';
export type {
  TileflowWorldFieldName,
  TileflowWorldLayerName,
  TileflowWorldTileset,
} from './tileflow-world-schema';
export {
  isTileflowWorldReleaseId,
  tileflowWorldReleaseIdMaximumLength,
  tileflowWorldReleaseIdMinimumLength,
  tileflowWorldReleaseIdPattern,
  tileflowWorldReleaseIdPatternSource,
  tileflowWorldReleaseIdSchema,
} from './world-release-id';

export const tileflowPrimarySourceId = 'tileflow';
/** The style source of `world-detail` while World serves it apart from `world`. */
export const tileflowDetailSourceId = 'tileflow-detail';

/** Tiles following the Tileflow World schema: Tileflow World itself or tiles made to it. */
export type TileflowWorldSchema = Readonly<{
  type: 'tileflow-world';
  version: typeof tileflowWorldSchemaVersion;
}>;

export function tileflowWorldSchema(): TileflowWorldSchema {
  return {type: 'tileflow-world', version: tileflowWorldSchemaVersion};
}

/** The schema vector tiles follow. */
export type TileflowDataSchema = OpenMapTilesSchema | TileflowWorldSchema;

/** World layers every supported schema provides; the others are optional. */
export const tileflowCoreDataLayers = [
  'admin',
  'aeroway',
  'airportLabel',
  'building',
  'housenumLabel',
  'landuse',
  'landuseOverlay',
  'naturalLabel',
  'placeLabel',
  'poiLabel',
  'road',
  'roadLabel',
  'water',
  'waterway',
] as const satisfies readonly TileflowWorldLayerName[];
export type TileflowCoreDataLayerName = (typeof tileflowCoreDataLayers)[number];

/** World fields every supported schema provides; the others are optional. */
export const tileflowCoreDataFields = [
  'access',
  'adminLevel',
  'bicycle',
  'capital',
  'claimedBy',
  'class',
  'disputed',
  'elevation',
  'expressway',
  'extrude',
  'filterrank',
  'foot',
  'height',
  'horse',
  'houseNum',
  'iata',
  'icao',
  'indoor',
  'intermittent',
  'iso31661',
  'layer',
  'level',
  'link',
  'maritime',
  'minHeight',
  'mtbScale',
  'name',
  'nameEn',
  'nameLatin',
  'network',
  'oneway',
  'ref',
  'reflen',
  'service',
  'sizerank',
  'structure',
  'surface',
  'symbolrank',
  'toll',
  'type',
] as const satisfies readonly TileflowWorldFieldName[];
export type TileflowCoreDataFieldName = (typeof tileflowCoreDataFields)[number];

/** The source layer of each World layer the data provides. */
export type TileflowDataLayerBindings = Record<TileflowCoreDataLayerName, string> &
  Partial<Record<Exclude<TileflowWorldLayerName, TileflowCoreDataLayerName>, string>>;
/**
 * The property of each World field the data provides. A field another schema computes from its
 * own properties names the property it reads; the adapter's layers translate its values.
 */
export type TileflowDataFieldBindings = Record<TileflowCoreDataFieldName, string> &
  Partial<Record<Exclude<TileflowWorldFieldName, TileflowCoreDataFieldName>, string>>;

/**
 * How the SDK reads the data: World's layers and fields, the source layers and properties that
 * hold them, and, for other schemas, how their tiles translate to World's.
 */
export type TileflowDataBinding = Readonly<{
  type: TileflowDataSchema['type'];
  version: number;
  adapter?: TileflowDataAdapter;
  fields: TileflowDataFieldBindings;
  layers: TileflowDataLayerBindings;
  /** Prefix of the language name fields: `name_` in World, `name:` in OpenMapTiles. */
  nameLanguagePrefix: string;
}>;

export type TileflowWorldReleaseReference = Readonly<{
  descriptorSha256: string;
  releaseId: string;
}>;

export type TileflowWorldSelection =
  | Readonly<{kind: 'current'; product: 'world-v1'}>
  | Readonly<{
      kind: 'release';
      product: 'world-v1';
      release: TileflowWorldReleaseReference;
    }>;

export type TileflowWorldData = {
  generation: typeof tileflowWorldGeneration;
  selection: TileflowWorldSelection;
  type: 'tileflow-world';
};

type VectorTilesDataCommon = {
  type: 'vector-tiles';
  attribution: string;
  revision?: string;
  schema: TileflowDataSchema;
};

export type VectorTilesData = VectorTilesDataCommon &
  (
    | {
        bounds?: never;
        maxzoom?: never;
        minzoom?: never;
        tiles?: never;
        url: string;
      }
    | {
        bounds?: [number, number, number, number];
        maxzoom?: number;
        minzoom?: number;
        tiles: [string, ...string[]];
        url?: never;
      }
  );

export type TileflowDataConfig = TileflowWorldData | VectorTilesData;

export type TileflowDataIdentity = {
  /** The OpenMapTiles bindings of vector tiles in that schema. */
  bindings?: {
    fields: Record<string, string>;
    layers: Record<string, string>;
  };
  generation?: typeof tileflowWorldGeneration;
  kind: TileflowDataConfig['type'];
  /** External fixture identity. */
  revision?: string;
  schema: TileflowDataSchema['type'];
  schemaVersion: number;
  /** The park semantics of OpenMapTiles tiles. */
  semantics?: OpenMapTilesSchema['semantics'];
  sourceId: typeof tileflowPrimarySourceId;
  url?: string;
  worldSelection?: TileflowWorldSelection;
};

/**
 * How World serves `world-detail`: one TileJSON that serves both tilesets in the primary source
 * (`composite`, the default: one request per tile and one release resolution), or its own TileJSON
 * in its own style source (`separate`). A map loads `world-detail` only when it draws one of its
 * layers.
 */
export type TileflowWorldDetailDelivery = 'composite' | 'separate';
export const tileflowWorldDetailDelivery: TileflowWorldDetailDelivery = 'composite';

export type ResolvedTileflowWorldDetail =
  | Readonly<{delivery: 'separate'; sourceId: typeof tileflowDetailSourceId; url: string}>
  /** `url` replaces the primary source's URL when the map draws a `world-detail` layer. */
  | Readonly<{delivery: 'composite'; url: string}>;

export type ResolvedTileflowData = {
  attribution: string;
  bounds?: [number, number, number, number];
  /** Where Tileflow World's detail layers come from; without it they are in the primary source. */
  detail?: ResolvedTileflowWorldDetail;
  generation?: typeof tileflowWorldGeneration;
  identity: TileflowDataIdentity;
  kind: TileflowDataConfig['type'];
  maxzoom?: number;
  minzoom?: number;
  revision?: string;
  schema: TileflowDataBinding;
  sourceId: typeof tileflowPrimarySourceId;
  tiles?: string[];
  url?: string;
};

export const tileflowWorldAttribution =
  '<a href="https://tileflow.dev/copyright">© Tileflow</a> ' +
  '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>';

/** How the SDK reads a schema's tiles. */
export function tileflowDataBinding(schema: TileflowDataSchema): TileflowDataBinding {
  if (schema.type === 'tileflow-world') {
    return {
      type: 'tileflow-world',
      version: tileflowWorldSchemaVersion,
      fields: {...tileflowWorldFields},
      layers: {...tileflowWorldLayers},
      nameLanguagePrefix: tileflowWorldNameLanguagePrefix,
    };
  }
  const {adapter, fields, layers} = openMapTilesAdapter(schema);
  return {
    type: 'openmaptiles',
    version: schema.contractVersion,
    adapter,
    fields,
    layers,
    nameLanguagePrefix: 'name:',
  };
}

export function isTileflowWorldDetailLayer(layer: string): layer is TileflowWorldLayerName {
  return (tileflowWorldDetailLayers as readonly string[]).includes(layer);
}

/** Problems with a Tileflow World TileJSON's `vector_layers`, or none. */
export function validateTileflowWorldTilejson(
  tilejson: {vector_layers?: readonly unknown[]} | null | undefined,
  tileset: 'world' | 'world-detail' = 'world',
): string[] {
  const layers = Array.isArray(tilejson?.vector_layers) ? tilejson.vector_layers : [];
  const issues: string[] = [];
  const l = tileflowWorldLayers;
  const require = (name: TileflowWorldLayerName) =>
    requireTilejsonLayer(layers, tileflowWorldLayers[name], issues);
  const field = (
    layer: TilejsonVectorLayer | undefined,
    name: TileflowWorldLayerName,
    fields: readonly TileflowWorldFieldName[],
    types: readonly string[],
  ) => {
    if (!layer) return;
    for (const key of fields) {
      requireTilejsonField(
        layer,
        tileflowWorldLayers[name],
        tileflowWorldFields[key],
        types,
        issues,
      );
    }
  };
  const zooms = (
    layer: TilejsonVectorLayer | undefined,
    name: TileflowWorldLayerName,
    minzoom: number,
    maxzoom: number,
  ) => {
    if (layer && (layer.minzoom !== minzoom || layer.maxzoom !== maxzoom)) {
      issues.push(
        minzoom === maxzoom
          ? `Tileflow World ${tileflowWorldLayers[name]} must declare native z${minzoom}.`
          : `Tileflow World ${tileflowWorldLayers[name]} must declare z${minzoom}-z${maxzoom}.`,
      );
    }
  };

  if (tileset === 'world-detail') {
    for (const name of tileflowWorldDetailLayers) require(name);
    for (const name of Object.keys(l) as TileflowWorldLayerName[]) {
      if (!isTileflowWorldDetailLayer(name)) forbidTilejsonLayer(layers, l[name], tileset, issues);
    }
    return issues;
  }
  for (const name of tileflowWorldDetailLayers) {
    forbidTilejsonLayer(layers, l[name], tileset, issues);
  }

  for (const name of [
    'admin',
    'aeroway',
    'airportLabel',
    'building',
    'housenumLabel',
    'landuse',
    'landuseOverlay',
    'naturalLabel',
    'placeLabel',
    'water',
    'waterway',
  ] as const) {
    field(require(name), name, name === 'admin' || name === 'housenumLabel' ? [] : ['class'], [
      'String',
    ]);
  }

  const bathymetry = require('bathymetry');
  zooms(bathymetry, 'bathymetry', 0, 9);
  field(bathymetry, 'bathymetry', ['bathymetryMinDepth', 'bathymetrySortKey'], ['Number']);

  const landcover = require('landcover');
  zooms(landcover, 'landcover', 0, 10);
  field(landcover, 'landcover', ['class'], ['String']);

  const poi = require('poiLabel');
  zooms(poi, 'poiLabel', 12, 15);
  field(poi, 'poiLabel', ['class', 'icon', 'type'], ['String']);
  field(poi, 'poiLabel', ['filterrank', 'minZoom', 'sizerank'], ['Number']);

  const sidewalk = require('sidewalk');
  zooms(sidewalk, 'sidewalk', 15, 15);
  field(sidewalk, 'sidewalk', ['class', 'type'], ['String']);

  const streetFurniture = require('streetFurniture');
  zooms(streetFurniture, 'streetFurniture', 15, 15);
  field(streetFurniture, 'streetFurniture', ['class', 'type', 'crossing', 'markings'], ['String']);
  field(streetFurniture, 'streetFurniture', ['direction'], ['Number', 'String']);

  const trafficControl = optionalTilejsonLayer(layers, l.trafficControl, issues);
  zooms(trafficControl, 'trafficControl', 15, 15);
  field(trafficControl, 'trafficControl', ['class', 'type'], ['String']);

  field(require('road'), 'road', ['class'], ['String']);

  const roadLabel = require('roadLabel');
  field(
    roadLabel,
    'roadLabel',
    ['class', 'ref', 'shieldKind', 'shieldNetwork', 'shieldText', 'shieldTextColor'],
    ['String'],
  );
  field(roadLabel, 'roadLabel', ['reflen', 'shieldLineLengthMeters', 'shieldRank'], ['Number']);

  const roadShield = require('roadShield');
  zooms(roadShield, 'roadShield', 6, 10);
  field(
    roadShield,
    'roadShield',
    ['class', 'ref', 'shieldKind', 'shieldNetwork', 'shieldText', 'shieldTextColor'],
    ['String'],
  );
  field(roadShield, 'roadShield', ['reflen', 'shieldRank'], ['Number']);

  // z15 holds every point; z14 repeats the lower ranks at the same positions.
  const canopy = optionalTilejsonLayer(layers, l.canopy, issues);
  zooms(canopy, 'canopy', 14, 15);
  field(
    canopy,
    'canopy',
    ['canopyRank', 'canopyClearanceAtZoom15', 'canopyCoverPercent'],
    ['Number'],
  );

  // The outer rings of the `road` areas, which exist from z13.
  const roadOutline = require('roadOutline');
  zooms(roadOutline, 'roadOutline', 13, 15);
  field(roadOutline, 'roadOutline', ['class', 'type'], ['String']);

  return issues;
}

type TilejsonVectorLayer = Readonly<{
  fields?: Readonly<Record<string, unknown>>;
  id?: unknown;
  maxzoom?: unknown;
  minzoom?: unknown;
}>;

function requireTilejsonLayer(
  layers: readonly unknown[],
  id: string,
  issues: string[],
): TilejsonVectorLayer | undefined {
  const matches = layers.filter(
    (layer): layer is TilejsonVectorLayer =>
      typeof layer === 'object' && layer !== null && (layer as TilejsonVectorLayer).id === id,
  );
  if (matches.length === 0) {
    issues.push(`Tileflow World requires ${id}.`);
    return undefined;
  }
  if (matches.length !== 1) {
    issues.push(`Tileflow World requires exactly one ${id} layer.`);
    return undefined;
  }
  return matches[0];
}

/** An optional layer may be absent; once declared, it must occur exactly once. */
function optionalTilejsonLayer(
  layers: readonly unknown[],
  id: string,
  issues: string[],
): TilejsonVectorLayer | undefined {
  const declared = layers.some(
    (layer) =>
      typeof layer === 'object' && layer !== null && (layer as TilejsonVectorLayer).id === id,
  );
  return declared ? requireTilejsonLayer(layers, id, issues) : undefined;
}

function forbidTilejsonLayer(
  layers: readonly unknown[],
  id: string,
  tileset: string,
  issues: string[],
): void {
  if (
    layers.some(
      (layer) =>
        typeof layer === 'object' && layer !== null && (layer as TilejsonVectorLayer).id === id,
    )
  ) {
    issues.push(`Tileflow World ${tileset} must not declare ${id}.`);
  }
}

function requireTilejsonField(
  layer: TilejsonVectorLayer,
  layerId: string,
  field: string,
  acceptedTypes: readonly string[],
  issues: string[],
): void {
  const fields =
    typeof layer.fields === 'object' && layer.fields !== null && !Array.isArray(layer.fields)
      ? layer.fields
      : undefined;
  if (!acceptedTypes.includes(String(fields?.[field] ?? ''))) {
    issues.push(`Tileflow World requires ${acceptedTypes.join(' or ')} ${field} on ${layerId}.`);
  }
}

export function tileflowWorld(
  options: {release?: TileflowWorldReleaseReference} = {},
): TileflowWorldData {
  return {
    generation: tileflowWorldGeneration,
    selection: options.release
      ? {
          kind: 'release',
          product: 'world-v1',
          release: validateWorldReleaseReference(options.release),
        }
      : {kind: 'current', product: 'world-v1'},
    type: 'tileflow-world',
  };
}

export function vectorTiles(options: {
  attribution: string;
  bounds?: [number, number, number, number];
  maxzoom?: number;
  minzoom?: number;
  revision?: string;
  schema: TileflowDataSchema;
  tiles?: readonly [string, ...string[]];
  url?: string;
}): VectorTilesData {
  const attribution = options.attribution.trim();
  if (!attribution) {
    throw new Error('Tileflow vector tile attribution must not be empty.');
  }
  if ((options.url === undefined) === (options.tiles === undefined)) {
    throw new Error('Tileflow vector data requires exactly one TileJSON URL or tiles array.');
  }
  if (options.tiles && (options.tiles.length < 1 || options.tiles.length > 8)) {
    throw new Error('Tileflow vector data requires from one to eight direct tile URLs.');
  }

  const zooms = validateZoomRange(options.minzoom, options.maxzoom);
  const bounds = options.bounds ? validateBounds(options.bounds) : undefined;

  const common: VectorTilesDataCommon = {
    type: 'vector-tiles',
    attribution,
    ...(options.revision ? {revision: validateRevision(options.revision)} : {}),
    schema: validateDataSchema(options.schema),
  };

  if (options.url !== undefined) {
    return {...common, url: validatePublicVectorUrl(options.url)};
  }

  return {
    ...common,
    ...(bounds ? {bounds} : {}),
    ...zooms,
    tiles: options.tiles!.map(validatePublicVectorUrl) as [string, ...string[]],
  };
}

export function resolveTileflowData(
  data: TileflowDataConfig | undefined,
  options: {apiBaseUrl?: string; worldDetail?: TileflowWorldDetailDelivery} = {},
): ResolvedTileflowData {
  const descriptor = data ?? tileflowWorld();

  if (descriptor.type === 'tileflow-world') {
    if (descriptor.generation !== tileflowWorldGeneration) {
      throw new Error(`Tileflow World generation must be ${tileflowWorldGeneration}.`);
    }
    const schema = tileflowWorldSchema();
    const selector = (path: string) => {
      const url = new URL(path, normalizeApiBaseUrl(options.apiBaseUrl));
      if (descriptor.selection.kind === 'release') {
        url.searchParams.set('worldReleaseId', descriptor.selection.release.releaseId);
        url.searchParams.set(
          'worldDescriptorSha256',
          descriptor.selection.release.descriptorSha256,
        );
      }
      return url.toString();
    };
    const selectorUrl = selector(tileflowWorldTileJsonPath);
    const delivery = options.worldDetail ?? tileflowWorldDetailDelivery;

    return {
      attribution: tileflowWorldAttribution,
      detail:
        delivery === 'separate'
          ? {
              delivery,
              sourceId: tileflowDetailSourceId,
              url: selector(tileflowWorldDetailTileJsonPath),
            }
          : {delivery, url: selector(tileflowWorldCompositeTileJsonPath)},
      generation: descriptor.generation,
      identity: dataIdentity(
        descriptor.type,
        schema,
        {
          generation: descriptor.generation,
          worldSelection: descriptor.selection,
        },
        selectorUrl,
      ),
      kind: descriptor.type,
      schema: tileflowDataBinding(schema),
      sourceId: tileflowPrimarySourceId,
      url: selectorUrl,
    };
  }

  const schema = validateDataSchema(descriptor.schema);

  return {
    attribution: descriptor.attribution,
    ...(descriptor.bounds ? {bounds: descriptor.bounds} : {}),
    identity: dataIdentity(
      descriptor.type,
      schema,
      {revision: descriptor.revision},
      descriptor.url ?? descriptor.tiles?.[0],
    ),
    kind: descriptor.type,
    ...(descriptor.maxzoom === undefined ? {} : {maxzoom: descriptor.maxzoom}),
    ...(descriptor.minzoom === undefined ? {} : {minzoom: descriptor.minzoom}),
    ...(descriptor.revision ? {revision: descriptor.revision} : {}),
    schema: tileflowDataBinding(schema),
    sourceId: tileflowPrimarySourceId,
    ...(descriptor.url !== undefined
      ? {url: validatePublicVectorUrl(descriptor.url)}
      : {tiles: descriptor.tiles!.map(validatePublicVectorUrl)}),
  };
}

/** The composite TileJSON that serves `world` and `world-detail` together. */
const tileflowWorldCompositeTileJsonPath = '/tiles/world,world-detail/tiles.json';

function dataIdentity(
  kind: TileflowDataConfig['type'],
  schema: TileflowDataSchema,
  version: {
    generation?: typeof tileflowWorldGeneration;
    revision?: string;
    worldSelection?: TileflowWorldSelection;
  },
  url?: string,
): TileflowDataIdentity {
  return {
    ...(version.generation ? {generation: version.generation} : {}),
    ...('worldSelection' in version && version.worldSelection
      ? {worldSelection: version.worldSelection}
      : {}),
    ...(schema.type === 'openmaptiles'
      ? {bindings: {fields: {...schema.fields}, layers: {...schema.layers}}}
      : {}),
    kind,
    ...(version.revision ? {revision: version.revision} : {}),
    schema: schema.type,
    schemaVersion: schema.type === 'openmaptiles' ? schema.contractVersion : schema.version,
    ...(schema.type === 'openmaptiles' ? {semantics: {...schema.semantics}} : {}),
    sourceId: tileflowPrimarySourceId,
    ...(url ? {url: validatePublicVectorUrl(url)} : {}),
  };
}

function validateWorldReleaseReference(
  value: TileflowWorldReleaseReference,
): TileflowWorldReleaseReference {
  if (!isTileflowWorldReleaseId(value.releaseId)) {
    throw new Error('Tileflow World releaseId is invalid.');
  }
  if (!/^[0-9a-f]{64}$/u.test(value.descriptorSha256)) {
    throw new Error('Tileflow World descriptorSha256 must be a lowercase SHA-256 digest.');
  }
  return {...value};
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const url = new URL(value ?? 'https://api.tileflow.dev');
  if (url.username || url.password) {
    throw new Error('Tileflow API base URL must not contain user information.');
  }
  return url.toString();
}

export function validatePublicVectorUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Tileflow vector tile URL must not be empty.');
  }
  if (value !== normalized || value.length > 4_096 || hasUrlControlCharacter(value)) {
    throw new Error(
      'Tileflow vector tile URL must be bounded and contain no surrounding whitespace or control characters.',
    );
  }
  if (normalized.includes('\\')) {
    throw new Error('Tileflow vector tile URL must not contain backslashes.');
  }
  if (normalized.startsWith('pmtiles://')) {
    return validatePmtilesVectorUrl(normalized);
  }

  if (normalized.startsWith('/')) {
    if (normalized.startsWith('//')) {
      throw new Error('Tileflow vector tile URL must not be protocol-relative.');
    }
    if (normalized.includes('#')) {
      throw new Error('Tileflow vector tile URL must not contain a fragment.');
    }
    return normalized;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('Tileflow vector tile URL must be absolute or root-relative.');
  }

  if (url.username || url.password) {
    throw new Error('Tileflow vector tile URL must not contain user information.');
  }
  if (url.protocol === 'file:') {
    throw new Error('Tileflow vector tile URL must not use the file protocol.');
  }
  if (url.hash) {
    throw new Error('Tileflow vector tile URL must not contain a fragment.');
  }
  if (url.protocol === 'https:' && normalized.startsWith('https://')) return normalized;
  if (
    url.protocol === 'http:' &&
    normalized.startsWith('http://') &&
    isLoopbackVectorHostname(url.hostname)
  ) {
    return normalized;
  }

  throw new Error(
    'Tileflow vector tile URL must use HTTPS, loopback HTTP, a root-relative path, or pmtiles://.',
  );
}

function validatePmtilesVectorUrl(value: string): string {
  const target = value.slice('pmtiles://'.length);
  if (!target || target.includes('#')) {
    throw new Error('Tileflow PMTiles URL requires a fragment-free archive target.');
  }

  if (target.startsWith('https://') || target.startsWith('http://')) {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw new Error('Tileflow PMTiles URL has an invalid HTTP archive target.');
    }
    if (url.username || url.password) {
      throw new Error('Tileflow PMTiles URL must not contain user information.');
    }
    if (
      url.hash ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && isLoopbackVectorHostname(url.hostname)))
    ) {
      throw new Error('Tileflow PMTiles URL requires HTTPS or loopback HTTP.');
    }
    requirePmtilesArchivePath(url.pathname);
    return value;
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target)) {
    throw new Error('Tileflow PMTiles URL has an unsupported archive target protocol.');
  }
  if (target.startsWith('//')) {
    throw new Error('Tileflow PMTiles URL must not use a protocol-relative archive target.');
  }

  const queryIndex = target.indexOf('?');
  const path = queryIndex === -1 ? target : target.slice(0, queryIndex);
  if (!path || hasUnsafePmtilesPath(path)) {
    throw new Error('Tileflow PMTiles URL has an unsafe archive target path.');
  }
  requirePmtilesArchivePath(path);
  return value;
}

function requirePmtilesArchivePath(path: string): void {
  if (!path.toLowerCase().endsWith('.pmtiles')) {
    throw new Error('Tileflow PMTiles URL target must name a .pmtiles archive.');
  }
}

function hasUnsafePmtilesPath(path: string): boolean {
  const segments = path.split('/');
  for (const [index, segment] of segments.entries()) {
    if (!segment) {
      if (index === 0 && path.startsWith('/')) continue;
      return true;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return true;
    }
    if (
      decoded === '..' ||
      (decoded === '.' && index !== 0) ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      decoded.includes(':') ||
      hasUrlControlCharacter(decoded)
    ) {
      return true;
    }
  }
  return false;
}

function hasUrlControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function isLoopbackVectorHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/gu, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1') {
    return true;
  }
  const octets = hostname.split('.');
  return (
    octets.length === 4 &&
    Number(octets[0]) === 127 &&
    octets.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
  );
}

function validateDataSchema(schema: TileflowDataSchema): TileflowDataSchema {
  if (schema.type === 'tileflow-world') {
    if (schema.version !== tileflowWorldSchemaVersion) {
      throw new Error(`Tileflow World schema version must be ${tileflowWorldSchemaVersion}.`);
    }
    return tileflowWorldSchema();
  }
  if (schema.type !== 'openmaptiles' || schema.contractVersion !== openMapTilesContractVersion) {
    throw new Error(
      `Tileflow requires OpenMapTiles contract version ${openMapTilesContractVersion}.`,
    );
  }

  const parkLayer = schema.semantics?.parkLayer;
  if (parkLayer !== 'mixed' && parkLayer !== 'protected-only') {
    throw new Error('Tileflow OpenMapTiles semantics.parkLayer is invalid.');
  }

  const validated = openMapTiles({
    fields: schema.fields,
    layers: schema.layers,
    semantics: {parkLayer},
  });
  for (const [group, bindings] of [
    ['layers', validated.layers],
    ['fields', validated.fields],
  ] as const) {
    for (const [name, value] of Object.entries(bindings)) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Tileflow OpenMapTiles ${group}.${name} must not be empty.`);
      }
    }
  }
  return validated;
}

function validateRevision(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error('Tileflow data revision must be portable.');
  }
  return value;
}

function validateZoomRange(
  minzoom: number | undefined,
  maxzoom: number | undefined,
): {maxzoom?: number; minzoom?: number} {
  for (const [name, value] of [
    ['minzoom', minzoom],
    ['maxzoom', maxzoom],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 30)) {
      throw new Error(`Tileflow vector ${name} must be an integer from 0 to 30.`);
    }
  }
  if (minzoom !== undefined && maxzoom !== undefined && minzoom > maxzoom) {
    throw new Error('Tileflow vector minzoom must not exceed maxzoom.');
  }
  return {
    ...(maxzoom === undefined ? {} : {maxzoom}),
    ...(minzoom === undefined ? {} : {minzoom}),
  };
}

function validateBounds(value: [number, number, number, number]): [number, number, number, number] {
  const [west, south, east, north] = value;
  if (
    !value.every(Number.isFinite) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north
  ) {
    throw new Error('Tileflow vector bounds must be increasing longitude/latitude axes.');
  }
  return [...value];
}

export {
  tileflowWorldDetailTileJsonUrl,
  tileflowWorldGeneration,
  tileflowWorldTileJsonUrl,
} from './world-generation';
