export const tileflowPrimarySourceId = 'tileflow';
export const tileflowWorldRevision = '2026-06-07';
export const openMapTilesContractVersion = 1;

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
  type: 'tileflow-world';
  revision?: string;
};

export type VectorTilesData = {
  type: 'vector-tiles';
  attribution: string;
  revision?: string;
  schema: OpenMapTilesSchema;
  url: string;
};

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
  kind: TileflowDataConfig['type'];
  revision?: string;
  schema: OpenMapTilesSchema['type'];
  schemaVersion: number;
  sourceId: typeof tileflowPrimarySourceId;
  url?: string;
};

export type ResolvedTileflowData = {
  /** Omitted when the versioned TileJSON is the authoritative attribution source. */
  attribution?: string;
  identity: TileflowDataIdentity;
  kind: TileflowDataConfig['type'];
  revision?: string;
  schema: OpenMapTilesSchema;
  sourceId: typeof tileflowPrimarySourceId;
  url: string;
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
    type: 'tileflow-world',
    ...(options.revision ? {revision: validateRevision(options.revision)} : {}),
  };
}

export function vectorTiles(options: {
  attribution: string;
  revision?: string;
  schema: OpenMapTilesSchema;
  url: string;
}): VectorTilesData {
  const attribution = options.attribution.trim();
  if (!attribution) {
    throw new Error('Tileflow vector tile attribution must not be empty.');
  }

  return {
    type: 'vector-tiles',
    attribution,
    ...(options.revision ? {revision: validateRevision(options.revision)} : {}),
    schema: validateOpenMapTilesSchema(options.schema),
    url: validatePublicVectorUrl(options.url),
  };
}

export function resolveTileflowData(
  data: TileflowDataConfig | undefined,
  options: {apiBaseUrl?: string} = {},
): ResolvedTileflowData {
  const descriptor = data ?? tileflowWorld();

  if (descriptor.type === 'tileflow-world') {
    const revision = descriptor.revision ?? tileflowWorldRevision;
    const url = new URL('/tiles/world/tiles.json', normalizeApiBaseUrl(options.apiBaseUrl));
    url.searchParams.set('archiveVersion', revision);
    const schema = tileflowWorldV1Schema();

    return {
      ...(revision === tileflowWorldRevision ? {attribution: defaultAttribution} : {}),
      identity: dataIdentity(descriptor.type, schema, revision, url.toString()),
      kind: descriptor.type,
      revision,
      schema,
      sourceId: tileflowPrimarySourceId,
      url: url.toString(),
    };
  }

  const schema = validateOpenMapTilesSchema(descriptor.schema);

  const url = validatePublicVectorUrl(descriptor.url);
  return {
    attribution: descriptor.attribution,
    identity: dataIdentity(descriptor.type, schema, descriptor.revision, url),
    kind: descriptor.type,
    ...(descriptor.revision ? {revision: descriptor.revision} : {}),
    schema,
    sourceId: tileflowPrimarySourceId,
    url,
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
  revision: string | undefined,
  url: string,
): TileflowDataIdentity {
  return {
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
          url,
        }
      : {}),
    kind,
    ...(revision ? {revision} : {}),
    schema: schema.type,
    schemaVersion: schema.contractVersion,
    sourceId: tileflowPrimarySourceId,
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
