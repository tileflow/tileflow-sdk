import {tileflowWorldGeneration, tileflowWorldTileJsonUrl} from './world-generation';
import {isTileflowWorldReleaseId} from './world-release-id';

export {
  isTileflowWorldReleaseId,
  tileflowWorldReleaseIdMaximumLength,
  tileflowWorldReleaseIdMinimumLength,
  tileflowWorldReleaseIdPattern,
  tileflowWorldReleaseIdPatternSource,
  tileflowWorldReleaseIdSchema,
} from './world-release-id';

export const tileflowPrimarySourceId = 'tileflow';
export const openMapTilesContractVersion = 1;

export type ParkLayerSemantics = 'mixed' | 'protected-only';

export type OpenMapTilesLayerBindings = {
  aerodromeLabel: string;
  aeroway: string;
  boundary: string;
  building: string;
  /** Required low-zoom GEBCO extension in the Tileflow World V1 schema. */
  bathymetry?: string;
  /** Optional derived commercial-activity polygons rendered below buildings. */
  businessCorridor?: string;
  /** Optional generated circle centers used for detailed roundabout rendering. */
  circularFeature?: string;
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
  /** Optional detailed pedestrian-surface polygons. */
  sidewalk?: string;
  /** Optional point features such as pedestrian crossings. */
  streetFurniture?: string;
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
  /** Roundabout geometry kind in the optional circular-feature layer. */
  circularKind?: string;
  /** Precomputed roundabout radius in pixels at zoom 15. */
  circularRadiusAtZoom15?: string;
  /** Extra precomputed clearance around a circular road at zoom 15. */
  circularClearanceExtraAtZoom15?: string;
  /** Roundabout radius in metres. */
  circularRadiusMeters?: string;
  /** Roundabout inner radius in metres. */
  circularInnerRadiusMeters?: string;
  /** Roundabout outer radius in metres. */
  circularOuterRadiusMeters?: string;
  class: string;
  circumference: string;
  classificationConfidence: string;
  confidence: string;
  diameterCrown: string;
  disputed: string;
  /** Direction in degrees for oriented street-furniture symbols. */
  direction?: string;
  elevation: string;
  elevationFeet: string;
  expressway: string;
  foot: string;
  height: string;
  hide3d: string;
  hasBusiness: string;
  /** Whether a building footprint owns separately materialized building parts. */
  hasParts?: string;
  horse: string;
  houseNumber: string;
  /** Optional sparse 1–4 semantic and locally normalized urban-importance tier. */
  importanceTier?: string;
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
  semantics?: {
    /** Whether the bound park layer mixes ordinary parks with protected areas. */
    parkLayer?: ParkLayerSemantics;
  };
};

export type OpenMapTilesSchema = {
  type: 'openmaptiles';
  contractVersion: typeof openMapTilesContractVersion;
  fields: OpenMapTilesFieldBindings;
  layers: OpenMapTilesLayerBindings;
  semantics: {
    parkLayer: ParkLayerSemantics;
  };
};

export type TileflowWorldV1Schema = Omit<OpenMapTilesSchema, 'fields' | 'layers'> & {
  fields: OpenMapTilesFieldBindings & {
    bathymetryMinDepth: string;
    bathymetrySortKey: string;
    circularClearanceExtraAtZoom15: string;
    circularInnerRadiusMeters: string;
    circularKind: string;
    circularOuterRadiusMeters: string;
    circularRadiusAtZoom15: string;
    circularRadiusMeters: string;
    direction: string;
    hasParts: string;
  };
  layers: OpenMapTilesLayerBindings & {
    bathymetry: string;
    circularFeature: string;
    globalLandcover: string;
    sidewalk: string;
    streetFurniture: string;
  };
};

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
  /** External fixture identity. */
  revision?: string;
  schema: OpenMapTilesSchema['type'];
  schemaVersion: number;
  semantics: OpenMapTilesSchema['semantics'];
  sourceId: typeof tileflowPrimarySourceId;
  url?: string;
  worldSelection?: TileflowWorldSelection;
};

export type ResolvedTileflowData = {
  attribution: string;
  bounds?: [number, number, number, number];
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
  circularClearanceExtraAtZoom15: 'clearance_extra_px_z15',
  circularInnerRadiusMeters: 'inner_radius_m',
  circularKind: 'circle_kind',
  circularOuterRadiusMeters: 'outer_radius_m',
  circularRadiusAtZoom15: 'radius_px_z15',
  circularRadiusMeters: 'radius_m',
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
  hasParts: 'has_parts',
  horse: 'horse',
  houseNumber: 'housenumber',
  importanceTier: 'importance_tier',
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
    semantics: {
      parkLayer: options.semantics?.parkLayer ?? 'mixed',
    },
  };
}

/** OpenMapTiles plus the required typed extensions emitted by Tileflow World V1. */
export function tileflowWorldV1Schema(
  options: OpenMapTilesSchemaOptions = {},
): TileflowWorldV1Schema {
  return openMapTiles({
    ...options,
    capabilities: {...options.capabilities, bathymetry: true, globalLandcover: true},
    fields: {
      circularClearanceExtraAtZoom15: 'clearance_extra_px_z15',
      circularInnerRadiusMeters: 'inner_radius_m',
      circularKind: 'circle_kind',
      circularOuterRadiusMeters: 'outer_radius_m',
      circularRadiusAtZoom15: 'radius_px_z15',
      circularRadiusMeters: 'radius_m',
      direction: 'direction',
      hasParts: 'has_parts',
      ...options.fields,
    },
    layers: {
      circularFeature: 'circular_feature',
      sidewalk: 'sidewalk',
      streetFurniture: 'street_furniture',
      ...options.layers,
    },
    semantics: {...options.semantics, parkLayer: 'protected-only'},
  }) as TileflowWorldV1Schema;
}

export function validateTileflowWorldV1Tilejson(
  tilejson: {vector_layers?: readonly unknown[]} | null | undefined,
  schema: TileflowWorldV1Schema = tileflowWorldV1Schema(),
): string[] {
  const layers = Array.isArray(tilejson?.vector_layers) ? tilejson.vector_layers : [];
  const issues: string[] = [];
  const bathymetry = requireTilejsonLayer(layers, schema.layers.bathymetry, issues);
  const globalLandcover = requireTilejsonLayer(layers, schema.layers.globalLandcover, issues);
  const circularFeature = requireTilejsonLayer(layers, schema.layers.circularFeature, issues);
  const sidewalk = requireTilejsonLayer(layers, schema.layers.sidewalk, issues);
  const streetFurniture = requireTilejsonLayer(layers, schema.layers.streetFurniture, issues);

  if (bathymetry) {
    if (bathymetry.minzoom !== 0 || bathymetry.maxzoom !== 9) {
      issues.push(`Tileflow World V1 ${schema.layers.bathymetry} must declare z0-z9.`);
    }
    requireTilejsonField(
      bathymetry,
      schema.layers.bathymetry,
      schema.fields.bathymetryMinDepth,
      ['Number'],
      issues,
    );
    requireTilejsonField(
      bathymetry,
      schema.layers.bathymetry,
      schema.fields.bathymetrySortKey,
      ['Number'],
      issues,
    );
  }

  if (globalLandcover) {
    if (globalLandcover.minzoom !== 0 || globalLandcover.maxzoom !== 10) {
      issues.push(`Tileflow World V1 ${schema.layers.globalLandcover} must declare z0-z10.`);
    }
    requireTilejsonField(
      globalLandcover,
      schema.layers.globalLandcover,
      schema.fields.class,
      ['String'],
      issues,
    );
  }

  if (circularFeature) {
    requireNativeZoom15(circularFeature, schema.layers.circularFeature, issues);
    requireTilejsonField(
      circularFeature,
      schema.layers.circularFeature,
      schema.fields.class,
      ['String'],
      issues,
    );
    requireTilejsonField(
      circularFeature,
      schema.layers.circularFeature,
      schema.fields.circularKind,
      ['String'],
      issues,
    );
    for (const field of [
      schema.fields.circularRadiusAtZoom15,
      schema.fields.circularRadiusMeters,
      schema.fields.circularOuterRadiusMeters,
      schema.fields.circularInnerRadiusMeters,
      schema.fields.circularClearanceExtraAtZoom15,
    ]) {
      requireTilejsonField(
        circularFeature,
        schema.layers.circularFeature,
        field,
        ['Number'],
        issues,
      );
    }
  }

  if (sidewalk) {
    requireNativeZoom15(sidewalk, schema.layers.sidewalk, issues);
    requireTilejsonField(sidewalk, schema.layers.sidewalk, schema.fields.class, ['String'], issues);
    requireTilejsonField(
      sidewalk,
      schema.layers.sidewalk,
      schema.fields.subclass,
      ['String'],
      issues,
    );
  }

  if (streetFurniture) {
    requireNativeZoom15(streetFurniture, schema.layers.streetFurniture, issues);
    requireTilejsonField(
      streetFurniture,
      schema.layers.streetFurniture,
      schema.fields.class,
      ['String'],
      issues,
    );
    requireTilejsonField(
      streetFurniture,
      schema.layers.streetFurniture,
      schema.fields.subclass,
      ['String'],
      issues,
    );
    requireTilejsonField(
      streetFurniture,
      schema.layers.streetFurniture,
      schema.fields.direction,
      ['Number', 'String'],
      issues,
    );
  }
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
    issues.push(`Tileflow World V1 requires ${id}.`);
    return undefined;
  }
  if (matches.length !== 1) {
    issues.push(`Tileflow World V1 requires exactly one ${id} layer.`);
    return undefined;
  }
  return matches[0];
}

function requireNativeZoom15(layer: TilejsonVectorLayer, layerId: string, issues: string[]): void {
  if (layer.minzoom !== 15 || layer.maxzoom !== 15) {
    issues.push(`Tileflow World V1 ${layerId} must declare native z15.`);
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
    issues.push(`Tileflow World V1 requires ${acceptedTypes.join(' or ')} ${field} on ${layerId}.`);
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
  options: {apiBaseUrl?: string} = {},
): ResolvedTileflowData {
  const descriptor = data ?? tileflowWorld();

  if (descriptor.type === 'tileflow-world') {
    if (descriptor.generation !== tileflowWorldGeneration) {
      throw new Error(`Tileflow World generation must be ${tileflowWorldGeneration}.`);
    }
    const schema = tileflowWorldV1Schema();
    const selectorUrl = new URL('/tiles/world/tiles.json', normalizeApiBaseUrl(options.apiBaseUrl));
    if (descriptor.selection.kind === 'release') {
      selectorUrl.searchParams.set('worldReleaseId', descriptor.selection.release.releaseId);
      selectorUrl.searchParams.set(
        'worldDescriptorSha256',
        descriptor.selection.release.descriptorSha256,
      );
    }

    return {
      attribution: defaultAttribution,
      generation: descriptor.generation,
      identity: dataIdentity(
        descriptor.type,
        schema,
        {
          generation: descriptor.generation,
          worldSelection: descriptor.selection,
        },
        selectorUrl.toString(),
      ),
      kind: descriptor.type,
      schema,
      sourceId: tileflowPrimarySourceId,
      url: selectorUrl.toString(),
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
    (schema.semantics?.parkLayer ?? 'mixed') === 'mixed' &&
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
    semantics: {...schema.semantics},
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

function validateOpenMapTilesSchema(schema: OpenMapTilesSchema): OpenMapTilesSchema {
  if (schema.type !== 'openmaptiles' || schema.contractVersion !== openMapTilesContractVersion) {
    throw new Error(
      `Tileflow requires OpenMapTiles contract version ${openMapTilesContractVersion}.`,
    );
  }

  const parkLayer = schema.semantics?.parkLayer ?? 'mixed';
  if (parkLayer !== 'mixed' && parkLayer !== 'protected-only') {
    throw new Error('Tileflow OpenMapTiles semantics.parkLayer is invalid.');
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
    semantics: {parkLayer},
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

export {tileflowWorldGeneration, tileflowWorldTileJsonUrl} from './world-generation';
