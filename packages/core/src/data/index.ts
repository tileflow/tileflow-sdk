export const tileflowPrimarySourceId = 'tileflow';
export const tileflowWorldRevision = '2026-06-07';
export const openMapTilesContractVersion = 1;

export type OpenMapTilesLayerBindings = {
  aerodromeLabel: string;
  aeroway: string;
  boundary: string;
  building: string;
  landcover: string;
  landuse: string;
  park: string;
  place: string;
  poi: string;
  road: string;
  roadName: string;
  water: string;
  waterName: string;
  waterway: string;
};

export type OpenMapTilesFieldBindings = {
  adminLevel: string;
  brunnel: string;
  class: string;
  disputed: string;
  height: string;
  hide3d: string;
  intermittent: string;
  minHeight: string;
  name: string;
  nameEnglish: string;
  nameLatin: string;
  oneway: string;
  rank: string;
  ref: string;
  renderHeight: string;
  renderMinHeight: string;
  service: string;
  subclass: string;
};

export type OpenMapTilesSchemaOptions = {
  fields?: Partial<OpenMapTilesFieldBindings>;
  layers?: Partial<OpenMapTilesLayerBindings>;
};

export type OpenMapTilesSchema = {
  type: 'openmaptiles';
  contractVersion: typeof openMapTilesContractVersion;
  fields: OpenMapTilesFieldBindings;
  layers: OpenMapTilesLayerBindings;
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
  kind: TileflowDataConfig['type'];
  revision?: string;
  schema: OpenMapTilesSchema['type'];
  schemaVersion: number;
  sourceId: typeof tileflowPrimarySourceId;
};

export type ResolvedTileflowData = {
  attribution: string;
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
  landcover: 'landcover',
  landuse: 'landuse',
  park: 'park',
  place: 'place',
  poi: 'poi',
  road: 'transportation',
  roadName: 'transportation_name',
  water: 'water',
  waterName: 'water_name',
  waterway: 'waterway',
} as const satisfies OpenMapTilesLayerBindings;

const canonicalFields = {
  adminLevel: 'admin_level',
  brunnel: 'brunnel',
  class: 'class',
  disputed: 'disputed',
  height: 'height',
  hide3d: 'hide_3d',
  intermittent: 'intermittent',
  minHeight: 'min_height',
  name: 'name',
  nameEnglish: 'name:en',
  nameLatin: 'name:latin',
  oneway: 'oneway',
  rank: 'rank',
  ref: 'ref',
  renderHeight: 'render_height',
  renderMinHeight: 'render_min_height',
  service: 'service',
  subclass: 'subclass',
} as const satisfies OpenMapTilesFieldBindings;

const defaultAttribution = '© OpenMapTiles © OpenStreetMap contributors';

export function openMapTiles(options: OpenMapTilesSchemaOptions = {}): OpenMapTilesSchema {
  return {
    type: 'openmaptiles',
    contractVersion: openMapTilesContractVersion,
    fields: {...canonicalFields, ...options.fields},
    layers: {...canonicalLayers, ...options.layers},
  };
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
    const schema = openMapTiles();

    return {
      attribution: defaultAttribution,
      identity: dataIdentity(descriptor.type, schema, revision),
      kind: descriptor.type,
      revision,
      schema,
      sourceId: tileflowPrimarySourceId,
      url: url.toString(),
    };
  }

  const schema = validateOpenMapTilesSchema(descriptor.schema);

  return {
    attribution: descriptor.attribution,
    identity: dataIdentity(descriptor.type, schema, descriptor.revision),
    kind: descriptor.type,
    ...(descriptor.revision ? {revision: descriptor.revision} : {}),
    schema,
    sourceId: tileflowPrimarySourceId,
    url: validatePublicVectorUrl(descriptor.url),
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
): TileflowDataIdentity {
  return {
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
