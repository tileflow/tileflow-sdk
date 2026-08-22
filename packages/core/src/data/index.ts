import {
  parseWorldGenerationDescriptor,
  tileflowWorldGeneration,
  tileflowWorldTileUrl,
  type WorldGenerationDescriptor,
} from './world-generation';

export const tileflowPrimarySourceId = 'tileflow';
export const openMapTilesContractVersion = 1;
/** Legacy archive selector retained for explicit revision-based consumers. */
export const tileflowWorldRevision = '2026-06-07';

export type OpenMapTilesLayerBindings = {
  aerodromeLabel: string;
  aeroway: string;
  boundary: string;
  building: string;
  /** Required low-zoom GEBCO extension in the Tileflow World V1 schema. */
  bathymetry?: string;
  /** Optional derived commercial-activity polygons rendered below buildings. */
  businessCorridor?: string;
  /** Optional low-zoom global land-cover extension. Defaults to `globallandcover`. */
  globalLandcover?: string;
  houseNumber: string;
  landcover: string;
  landuse: string;
  mountainPeak: string;
  park: string;
  place: string;
  poi: string;
  road: string;
  roadName: string;
  /** Optional individual-tree point extension used by the vegetation module. */
  tree?: string;
  water: string;
  waterName: string;
  waterway: string;
};

export type OpenMapTilesFieldBindings = {
  access: string;
  activityScore: string;
  adminLevel: string;
  bicycle: string;
  /** GEBCO depth-band upper boundary in metres. */
  bathymetryMinDepth?: string;
  /** Stable shallow-to-deep ordering for GEBCO bands. */
  bathymetrySortKey?: string;
  brunnel: string;
  buildingKind: string;
  buildingTone: string;
  capital: string;
  class: string;
  circumference: string;
  classificationConfidence: string;
  confidence: string;
  diameterCrown: string;
  disputed: string;
  elevation: string;
  elevationFeet: string;
  expressway: string;
  foot: string;
  height: string;
  hide3d: string;
  hasBusiness: string;
  horse: string;
  houseNumber: string;
  iata: string;
  icao: string;
  indoor: string;
  intermittent: string;
  genus: string;
  layer: string;
  leafCycle: string;
  leafType: string;
  level: string;
  maritime: string;
  minHeight: string;
  minZoom: string;
  mtbScale: string;
  name: string;
  nameEnglish: string;
  nameLatin: string;
  network: string;
  official: string;
  oneway: string;
  ramp: string;
  rank: string;
  ref: string;
  refLength: string;
  renderHeight: string;
  renderMinZoom: string;
  renderMinHeight: string;
  service: string;
  species: string;
  speciesWikidata: string;
  subclass: string;
  surface: string;
  toll: string;
};

export type OpenMapTilesSchemaOptions = {
  capabilities?: {
    businessCorridor?: boolean;
    bathymetry?: boolean;
    globalLandcover?: boolean;
    tree?: boolean;
  };
  fields?: Partial<OpenMapTilesFieldBindings>;
  layers?: Partial<OpenMapTilesLayerBindings>;
};

export type OpenMapTilesSchema = {
  type: 'openmaptiles';
  contractVersion: typeof openMapTilesContractVersion;
  fields: OpenMapTilesFieldBindings;
  layers: OpenMapTilesLayerBindings;
};

export type TileflowWorldV1Schema = Omit<OpenMapTilesSchema, 'fields' | 'layers'> & {
  fields: OpenMapTilesFieldBindings & {
    bathymetryMinDepth: string;
    bathymetrySortKey: string;
  };
  layers: OpenMapTilesLayerBindings & {bathymetry: string};
};

export type TileflowWorldData = {
  generation: typeof tileflowWorldGeneration;
  revision?: string;
  type: 'tileflow-world';
};

type VectorTilesDataCommon = {
  type: 'vector-tiles';
  attribution: string;
  revision?: string;
  schema: OpenMapTilesSchema;
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
  bindings?: {
    fields: OpenMapTilesFieldBindings;
    layers: OpenMapTilesLayerBindings;
  };
  capabilities?: {
    businessCorridor: boolean;
    bathymetry: boolean;
    globalLandcover: boolean;
    tree: boolean;
  };
  generation?: typeof tileflowWorldGeneration;
  kind: TileflowDataConfig['type'];
  /** External fixture identity, or a legacy World diagnostic retained for receipt compatibility. */
  revision?: string;
  schema: OpenMapTilesSchema['type'];
  schemaVersion: number;
  sourceId: typeof tileflowPrimarySourceId;
  url?: string;
};

export type ResolvedTileflowData = {
  assetSet?: WorldGenerationDescriptor['assetSet'];
  attribution: string;
  bounds?: WorldGenerationDescriptor['bounds'];
  generation?: typeof tileflowWorldGeneration;
  identity: TileflowDataIdentity;
  kind: TileflowDataConfig['type'];
  maxzoom?: number;
  minzoom?: number;
  revision?: string;
  schema: OpenMapTilesSchema;
  sourceId: typeof tileflowPrimarySourceId;
  tiles?: string[];
  url?: string;
};

const canonicalLayers = {
  aerodromeLabel: 'aerodrome_label',
  aeroway: 'aeroway',
  boundary: 'boundary',
  building: 'building',
  businessCorridor: 'business_corridor',
  globalLandcover: 'globallandcover',
  houseNumber: 'housenumber',
  landcover: 'landcover',
  landuse: 'landuse',
  mountainPeak: 'mountain_peak',
  park: 'park',
  place: 'place',
  poi: 'poi',
  road: 'transportation',
  roadName: 'transportation_name',
  tree: 'tree',
  water: 'water',
  waterName: 'water_name',
  waterway: 'waterway',
} as const satisfies OpenMapTilesLayerBindings;

const canonicalFields = {
  access: 'access',
  activityScore: 'activity_score',
  adminLevel: 'admin_level',
  bicycle: 'bicycle',
  brunnel: 'brunnel',
  buildingKind: 'building_kind',
  buildingTone: 'building_tone',
  capital: 'capital',
  class: 'class',
  circumference: 'circumference',
  classificationConfidence: 'classification_confidence',
  confidence: 'confidence',
  diameterCrown: 'diameter_crown',
  disputed: 'disputed',
  elevation: 'ele',
  elevationFeet: 'ele_ft',
  expressway: 'expressway',
  foot: 'foot',
  height: 'height',
  hide3d: 'hide_3d',
  hasBusiness: 'has_business',
  horse: 'horse',
  houseNumber: 'housenumber',
  iata: 'iata',
  icao: 'icao',
  indoor: 'indoor',
  intermittent: 'intermittent',
  genus: 'genus',
  layer: 'layer',
  leafCycle: 'leaf_cycle',
  leafType: 'leaf_type',
  level: 'level',
  maritime: 'maritime',
  minHeight: 'min_height',
  minZoom: 'min_zoom',
  mtbScale: 'mtb_scale',
  name: 'name',
  nameEnglish: 'name:en',
  nameLatin: 'name:latin',
  network: 'network',
  official: 'official',
  oneway: 'oneway',
  ramp: 'ramp',
  rank: 'rank',
  ref: 'ref',
  refLength: 'ref_length',
  renderHeight: 'render_height',
  renderMinZoom: 'render_min_zoom',
  renderMinHeight: 'render_min_height',
  service: 'service',
  species: 'species',
  speciesWikidata: 'species:wikidata',
  subclass: 'subclass',
  surface: 'surface',
  toll: 'toll',
} as const satisfies OpenMapTilesFieldBindings;

const defaultAttribution = '© OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors';

export function openMapTiles(options: OpenMapTilesSchemaOptions = {}): OpenMapTilesSchema {
  const layers: OpenMapTilesLayerBindings = {...canonicalLayers, ...options.layers};
  const fields: OpenMapTilesFieldBindings = {...canonicalFields, ...options.fields};
  if (options.capabilities?.businessCorridor === false) delete layers.businessCorridor;
  if (options.capabilities?.bathymetry === true) {
    layers.bathymetry ??= 'bathymetry';
    fields.bathymetryMinDepth ??= 'min_depth';
    fields.bathymetrySortKey ??= 'sort_key';
  } else {
    delete layers.bathymetry;
    delete fields.bathymetryMinDepth;
    delete fields.bathymetrySortKey;
  }
  if (options.capabilities?.globalLandcover === false) delete layers.globalLandcover;
  if (options.capabilities?.tree === false) delete layers.tree;
  return {
    type: 'openmaptiles',
    contractVersion: openMapTilesContractVersion,
    fields,
    layers,
  };
}

/** OpenMapTiles plus the required typed extensions emitted by Tileflow World V1. */
export function tileflowWorldV1Schema(
  options: OpenMapTilesSchemaOptions = {},
): TileflowWorldV1Schema {
  return openMapTiles({
    ...options,
    capabilities: {...options.capabilities, bathymetry: true},
  }) as TileflowWorldV1Schema;
}

export function validateTileflowWorldV1Tilejson(
  tilejson: {vector_layers?: readonly unknown[]} | null | undefined,
  schema: TileflowWorldV1Schema = tileflowWorldV1Schema(),
): string[] {
  const layers = Array.isArray(tilejson?.vector_layers) ? tilejson.vector_layers : [];
  const bathymetry = layers.find(
    (layer) =>
      typeof layer === 'object' &&
      layer !== null &&
      (layer as {id?: unknown}).id === schema.layers.bathymetry,
  ) as {fields?: Record<string, unknown>; maxzoom?: unknown; minzoom?: unknown} | undefined;
  const issues: string[] = [];
  if (!bathymetry) return [`Tileflow World V1 requires ${schema.layers.bathymetry}.`];
  if (bathymetry.minzoom !== 0 || bathymetry.maxzoom !== 9) {
    issues.push('Tileflow World V1 bathymetry must declare z0-z9.');
  }
  if (bathymetry.fields?.[schema.fields.bathymetryMinDepth] !== 'Number') {
    issues.push(`Tileflow World V1 requires numeric ${schema.fields.bathymetryMinDepth}.`);
  }
  if (bathymetry.fields?.[schema.fields.bathymetrySortKey] !== 'Number') {
    issues.push(`Tileflow World V1 requires numeric ${schema.fields.bathymetrySortKey}.`);
  }
  return issues;
}

export function tileflowWorld(options: {revision?: string} = {}): TileflowWorldData {
  return {
    generation: tileflowWorldGeneration,
    ...(options.revision ? {revision: validateRevision(options.revision)} : {}),
    type: 'tileflow-world',
  };
}

export function vectorTiles(options: {
  attribution: string;
  bounds?: [number, number, number, number];
  maxzoom?: number;
  minzoom?: number;
  revision?: string;
  schema: OpenMapTilesSchema;
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
    schema: validateOpenMapTilesSchema(options.schema),
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
  options: {apiBaseUrl?: string; worldGeneration?: WorldGenerationDescriptor} = {},
): ResolvedTileflowData {
  const descriptor = data ?? tileflowWorld();

  if (descriptor.type === 'tileflow-world') {
    if (descriptor.generation !== tileflowWorldGeneration) {
      throw new Error(`Tileflow World generation must be ${tileflowWorldGeneration}.`);
    }
    const schema = tileflowWorldV1Schema();
    const generationDescriptor = options.worldGeneration
      ? parseWorldGenerationDescriptor(options.worldGeneration)
      : undefined;
    const legacyUrl = descriptor.revision
      ? new URL('/tiles/world/tiles.json', normalizeApiBaseUrl(options.apiBaseUrl))
      : undefined;
    legacyUrl?.searchParams.set('archiveVersion', descriptor.revision!);

    return {
      ...(generationDescriptor ? {assetSet: generationDescriptor.assetSet} : {}),
      attribution: generationDescriptor?.attribution ?? defaultAttribution,
      ...(generationDescriptor ? {bounds: generationDescriptor.bounds} : {}),
      generation: descriptor.generation,
      identity: dataIdentity(
        descriptor.type,
        schema,
        {
          generation: descriptor.generation,
          revision: descriptor.revision,
        },
        legacyUrl?.toString(),
      ),
      kind: descriptor.type,
      ...(generationDescriptor ? {maxzoom: generationDescriptor.maxzoom} : {}),
      ...(generationDescriptor ? {minzoom: generationDescriptor.minzoom} : {}),
      ...(descriptor.revision ? {revision: descriptor.revision} : {}),
      schema,
      sourceId: tileflowPrimarySourceId,
      ...(legacyUrl
        ? {url: legacyUrl.toString()}
        : {tiles: [generationDescriptor?.tileUrl ?? tileflowWorldTileUrl]}),
    };
  }

  const schema = validateOpenMapTilesSchema(descriptor.schema);

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
    schema,
    sourceId: tileflowPrimarySourceId,
    ...(descriptor.url !== undefined
      ? {url: validatePublicVectorUrl(descriptor.url)}
      : {tiles: descriptor.tiles!.map(validatePublicVectorUrl)}),
  };
}

export function isCanonicalOpenMapTilesSchema(schema: OpenMapTilesSchema): boolean {
  return (
    Object.entries(canonicalLayers).every(
      ([key, value]) => schema.layers[key as keyof typeof canonicalLayers] === value,
    ) &&
    Object.entries(canonicalFields).every(
      ([key, value]) => schema.fields[key as keyof typeof canonicalFields] === value,
    )
  );
}

function dataIdentity(
  kind: TileflowDataConfig['type'],
  schema: OpenMapTilesSchema,
  version: {generation?: typeof tileflowWorldGeneration; revision?: string},
  url?: string,
): TileflowDataIdentity {
  return {
    ...(version.generation ? {generation: version.generation} : {}),
    ...(kind === 'vector-tiles'
      ? {
          bindings: {
            fields: {...schema.fields},
            layers: {...schema.layers},
          },
          capabilities: {
            businessCorridor: Boolean(schema.layers.businessCorridor),
            bathymetry: Boolean(schema.layers.bathymetry),
            globalLandcover: Boolean(schema.layers.globalLandcover),
            tree: Boolean(schema.layers.tree),
          },
        }
      : {}),
    kind,
    ...(version.revision ? {revision: version.revision} : {}),
    schema: schema.type,
    schemaVersion: schema.contractVersion,
    sourceId: tileflowPrimarySourceId,
    ...(url ? {url: validatePublicVectorUrl(url)} : {}),
  };
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const url = new URL(value ?? 'https://api.tileflow.dev');
  if (url.username || url.password) {
    throw new Error('Tileflow API base URL must not contain user information.');
  }
  return url.toString();
}

function validatePublicVectorUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Tileflow vector tile URL must not be empty.');
  }

  if (normalized.startsWith('/')) {
    if (normalized.startsWith('//')) {
      throw new Error('Tileflow vector tile URL must not be protocol-relative.');
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

  return normalized;
}

function validateOpenMapTilesSchema(schema: OpenMapTilesSchema): OpenMapTilesSchema {
  if (schema.type !== 'openmaptiles' || schema.contractVersion !== openMapTilesContractVersion) {
    throw new Error(
      `Tileflow requires OpenMapTiles contract version ${openMapTilesContractVersion}.`,
    );
  }

  for (const [group, bindings] of [
    ['layers', schema.layers],
    ['fields', schema.fields],
  ] as const) {
    for (const [name, value] of Object.entries(bindings)) {
      if (!value.trim()) {
        throw new Error(`Tileflow OpenMapTiles ${group}.${name} must not be empty.`);
      }
    }
  }

  return {
    ...schema,
    fields: {...schema.fields},
    layers: {...schema.layers},
  };
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
  parseWorldGenerationDescriptor,
  tileflowWorldGeneration,
  tileflowWorldTileUrl,
  worldGenerationDescriptorSchema,
} from './world-generation';
export type {WorldDataDescriptor, WorldGenerationDescriptor} from './world-generation';
