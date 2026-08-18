import {
  parseWorldGenerationDescriptor,
  tileflowWorldGeneration,
  tileflowWorldTileUrl,
  type WorldGenerationDescriptor,
} from './world-generation';

export const tileflowPrimarySourceId = 'tileflow';
export const openMapTilesContractVersion = 1;

export type OpenMapTilesLayerBindings = {
  aerodromeLabel: string;
  aeroway: string;
  boundary: string;
  building: string;
  /** Optional low-zoom global land-cover extension. Defaults to `globallandcover`. */
  globalLandcover?: string;
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
  access: string;
  adminLevel: string;
  bicycle: string;
  brunnel: string;
  class: string;
  disputed: string;
  expressway: string;
  foot: string;
  height: string;
  hide3d: string;
  horse: string;
  indoor: string;
  intermittent: string;
  layer: string;
  level: string;
  minHeight: string;
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
  renderHeight: string;
  renderMinHeight: string;
  service: string;
  subclass: string;
  surface: string;
  toll: string;
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
  generation: typeof tileflowWorldGeneration;
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
  generation?: typeof tileflowWorldGeneration;
  kind: TileflowDataConfig['type'];
  /** External fixture identity, or a legacy World diagnostic retained for receipt compatibility. */
  revision?: string;
  schema: OpenMapTilesSchema['type'];
  schemaVersion: number;
  sourceId: typeof tileflowPrimarySourceId;
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
  globalLandcover: 'globallandcover',
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
  access: 'access',
  adminLevel: 'admin_level',
  bicycle: 'bicycle',
  brunnel: 'brunnel',
  class: 'class',
  disputed: 'disputed',
  expressway: 'expressway',
  foot: 'foot',
  height: 'height',
  hide3d: 'hide_3d',
  horse: 'horse',
  indoor: 'indoor',
  intermittent: 'intermittent',
  layer: 'layer',
  level: 'level',
  minHeight: 'min_height',
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
  renderHeight: 'render_height',
  renderMinHeight: 'render_min_height',
  service: 'service',
  subclass: 'subclass',
  surface: 'surface',
  toll: 'toll',
} as const satisfies OpenMapTilesFieldBindings;

const defaultAttribution = '© OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors';

export function openMapTiles(options: OpenMapTilesSchemaOptions = {}): OpenMapTilesSchema {
  return {
    type: 'openmaptiles',
    contractVersion: openMapTilesContractVersion,
    fields: {...canonicalFields, ...options.fields},
    layers: {
      ...canonicalLayers,
      ...options.layers,
      globalLandcover: options.layers?.globalLandcover ?? canonicalLayers.globalLandcover,
    },
  };
}

export function tileflowWorld(): TileflowWorldData {
  return {
    generation: tileflowWorldGeneration,
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
  options: {worldGeneration?: WorldGenerationDescriptor} = {},
): ResolvedTileflowData {
  const descriptor = data ?? tileflowWorld();

  if (descriptor.type === 'tileflow-world') {
    if (descriptor.generation !== tileflowWorldGeneration) {
      throw new Error(`Tileflow World generation must be ${tileflowWorldGeneration}.`);
    }
    const schema = openMapTiles();
    const generationDescriptor = options.worldGeneration
      ? parseWorldGenerationDescriptor(options.worldGeneration)
      : undefined;

    return {
      ...(generationDescriptor ? {assetSet: generationDescriptor.assetSet} : {}),
      attribution: generationDescriptor?.attribution ?? defaultAttribution,
      ...(generationDescriptor ? {bounds: generationDescriptor.bounds} : {}),
      generation: descriptor.generation,
      identity: dataIdentity(descriptor.type, schema, {
        generation: descriptor.generation,
      }),
      kind: descriptor.type,
      ...(generationDescriptor ? {maxzoom: generationDescriptor.maxzoom} : {}),
      ...(generationDescriptor ? {minzoom: generationDescriptor.minzoom} : {}),
      schema,
      sourceId: tileflowPrimarySourceId,
      tiles: [generationDescriptor?.tileUrl ?? tileflowWorldTileUrl],
    };
  }

  const schema = validateOpenMapTilesSchema(descriptor.schema);

  return {
    attribution: descriptor.attribution,
    ...(descriptor.bounds ? {bounds: descriptor.bounds} : {}),
    identity: dataIdentity(descriptor.type, schema, {revision: descriptor.revision}),
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
      ([key, value]) =>
        (schema.layers[key as keyof typeof canonicalLayers] ??
          (key === 'globalLandcover' ? canonicalLayers.globalLandcover : undefined)) === value,
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
): TileflowDataIdentity {
  return {
    ...(version.generation ? {generation: version.generation} : {}),
    kind,
    ...(version.revision ? {revision: version.revision} : {}),
    schema: schema.type,
    schemaVersion: schema.contractVersion,
    sourceId: tileflowPrimarySourceId,
  };
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
    layers: {
      ...schema.layers,
      globalLandcover: schema.layers.globalLandcover ?? canonicalLayers.globalLandcover,
    },
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
