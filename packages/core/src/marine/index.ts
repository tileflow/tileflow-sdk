import type {
  TileflowFillStyle,
  TileflowLineStyle,
  TileflowSymbolStyle,
} from '../cartography/styles';
import type {TileflowThemeNumberValue} from '../cartography/values';
import {validatePublicVectorUrl} from '../data';
import type {TileflowTerrainEncoding, TileflowTerrainHillshadeStyle} from '../types';

export const tileflowBathymetrySourceId = 'tileflow-bathymetry' as const;
export const tileflowBathymetryDemSourceId = 'tileflow-bathymetry-dem' as const;
export const tileflowNauticalSourceId = 'tileflow-nautical' as const;

export const tileflowBathymetryV1Schema = Object.freeze({
  fields: Object.freeze({
    class: 'class',
    depth: 'depth',
    id: 'id',
    maxZoom: 'max_zoom',
    minDepth: 'min_depth',
    minZoom: 'min_zoom',
    name: 'name',
    sortKey: 'sort_key',
  }),
  layer: 'bathymetry',
  layers: Object.freeze({
    bands: 'bathymetry',
    contours: 'bathymetry_contour',
    coverage: 'bathymetry_coverage',
    landforms: 'seafloor_landform',
    waterNames: 'water_name',
  }),
  optionalLayers: Object.freeze(['contours', 'coverage', 'landforms', 'waterNames'] as const),
  product: 'bathymetry-v1',
  requiredLayers: Object.freeze(['bands'] as const),
  schemaVersion: 1,
  sources: Object.freeze({
    dem: Object.freeze({
      encoding: 'terrarium',
      sourceId: tileflowBathymetryDemSourceId,
      tileSize: 512,
    }),
    vector: Object.freeze({sourceId: tileflowBathymetrySourceId}),
  }),
});

/**
 * The `nautical-v1` vector contract styled by the `nautical` module. Every feature carries the
 * provenance fields (`provider`, `provenance`, `edition`, `coverage`, `licence`) and `min_zoom`,
 * the first zoom at which it appears; `rank` (1 is most important within its layer) and `name`
 * are optional. Colours are S-57 colour names, and multi-valued colours and categories are
 * comma-separated in source order, for example `black,yellow`. A light's `sequence` lists its
 * phases in seconds, eclipses in parentheses, for example `0.5+(1.5)+0.5+(4.5)`. Clearances,
 * depths, and heights are in metres.
 */
export const tileflowNauticalV1Schema = Object.freeze({
  fields: Object.freeze({
    category: 'category',
    cell: 'cell',
    character: 'character',
    class: 'class',
    color: 'color',
    colorPattern: 'color_pattern',
    country: 'country',
    coverage: 'coverage',
    depth: 'depth',
    distance: 'distance',
    distanceUnit: 'distance_unit',
    edition: 'edition',
    families: 'families',
    group: 'group',
    heightM: 'height_m',
    horizontalClearance: 'horizontal_clearance',
    impact: 'impact',
    information: 'information',
    label: 'label',
    licence: 'licence',
    lit: 'lit',
    minZoom: 'min_zoom',
    name: 'name',
    orientation: 'orientation',
    periodS: 'period_s',
    position: 'position',
    provenance: 'provenance',
    provider: 'provider',
    rangeNm: 'range_nm',
    rank: 'rank',
    reference: 'reference',
    restriction: 'restriction',
    scale: 'scale',
    sectorEnd: 'sector_end',
    sectorStart: 'sector_start',
    sequence: 'sequence',
    shape: 'shape',
    size: 'size',
    subclass: 'subclass',
    system: 'system',
    topmark: 'topmark',
    unlocode: 'unlocode',
    update: 'update',
    verticalClearance: 'vertical_clearance',
    verticalClearanceClosed: 'vertical_clearance_closed',
    verticalClearanceOpen: 'vertical_clearance_open',
    verticalClearanceSafe: 'vertical_clearance_safe',
    waterLevel: 'water_level',
  }),
  geometryTypes: Object.freeze({
    aids: Object.freeze(['Point'] as const),
    coverage: Object.freeze(['Polygon'] as const),
    hazards: Object.freeze(['Point', 'LineString', 'Polygon'] as const),
    lights: Object.freeze(['Point'] as const),
    navigationAreas: Object.freeze(['Point', 'LineString', 'Polygon'] as const),
    reefs: Object.freeze(['Polygon'] as const),
    soundings: Object.freeze(['Point'] as const),
    wrecks: Object.freeze(['Point', 'Polygon'] as const),
  }),
  layers: Object.freeze({
    aids: 'aid',
    coverage: 'coverage',
    hazards: 'hazard',
    lights: 'light',
    navigationAreas: 'navigation_area',
    reefs: 'reef',
    soundings: 'sounding',
    wrecks: 'wreck',
  }),
  product: 'nautical-v1',
  /**
   * Known `provider` values and the `class` of their `coverage` cells. The source's TileJSON owns
   * each provider's credit; the module never adds attribution.
   */
  providers: Object.freeze({
    'nga-list-of-lights': 'list',
    'noaa-office-of-coast-survey': 'chart',
    openstreetmap: 'community',
    'usace-ienc': 'chart',
  }),
  schemaVersion: 1,
});

export type TileflowMarineMode = 'none' | 'bathymetry' | 'nautical' | 'chart';

/** One schema-compatible vector TileJSON source used by a marine sidecar. */
export type TileflowMarineSourceConfig = {
  attribution?: string;
  sourceId?: string;
  url?: string;
};

export type TileflowBathymetryDisplay = 'bands' | 'relief' | 'hybrid';

export const tileflowBathymetryNameLayerLimits = Object.freeze({maxZoomRanges: 128});

/** One exact, inclusive minimum and exclusive maximum nominal source range. */
export type TileflowBathymetryNameZoomRange = Readonly<{minZoom: number; maxZoom: number}>;

/** Exhaustive source range inventory; unmatched pairs are omitted from rendering. */
export type TileflowBathymetryNameLayer =
  | boolean
  | {
      zoomRanges: readonly TileflowBathymetryNameZoomRange[];
    };

/** Explicit availability of compatible optional vector layers; compilation never probes TileJSON. */
export type TileflowBathymetryVectorLayers = {
  contours?: boolean;
  landforms?: TileflowBathymetryNameLayer;
  waterNames?: TileflowBathymetryNameLayer;
};

/**
 * Styling and physical-source overrides for the optional Bathymetry DEM.
 * Terrarium and 512 px tiles are the hosted defaults; advanced compatible sources may override
 * either. `opacity` applies to both the continuous color relief and the hillshade tint.
 */
export type TileflowBathymetryReliefConfig = TileflowTerrainHillshadeStyle & {
  attribution?: string;
  encoding?: TileflowTerrainEncoding;
  illuminationAltitude?: TileflowThemeNumberValue;
  multidirectional?: boolean;
  opacity?: TileflowThemeNumberValue;
  sourceId?: string;
  tileSize?: 256 | 512;
  url?: string;
};

/** One logical Bathymetry product backed by vector bands and, when requested, a DEM. */
export type TileflowBathymetryConfig = TileflowMarineSourceConfig & {
  bands?: false | TileflowFillStyle;
  contours?: false | TileflowLineStyle;
  display?: TileflowBathymetryDisplay;
  labels?: false | TileflowSymbolStyle;
  relief?: false | TileflowBathymetryReliefConfig;
  type: 'bathymetry';
  vectorLayers?: TileflowBathymetryVectorLayers;
};

export type TileflowBathymetryOptions = Omit<TileflowBathymetryConfig, 'type'>;

/** Configure Bathymetry as one product while loading only the physical sources its display needs. */
export function bathymetry(options: TileflowBathymetryOptions = {}): TileflowBathymetryConfig {
  return {type: 'bathymetry', ...cloneJson(options)};
}

/**
 * Advanced marine selection. An omitted member selects Tileflow's current product; `false`
 * disables only that member. Therefore `{}` is equivalent to `"chart"`.
 */
export type TileflowMarineConfig = {
  bathymetry?: false | TileflowBathymetryConfig | TileflowMarineSourceConfig;
  nautical?: false | TileflowMarineSourceConfig;
};

export type TileflowMarine = TileflowMarineMode | TileflowMarineConfig;

export type TileflowMarineSourceIdentity = Readonly<{
  kind: 'tileflow-bathymetry' | 'tileflow-nautical';
  product: 'bathymetry-v1' | 'nautical-v1';
  schemaVersion: 1;
  sourceId: string;
  url: string;
}>;

export type TileflowBathymetryDemSourceIdentity = Readonly<{
  encoding: TileflowTerrainEncoding;
  kind: 'tileflow-bathymetry-dem';
  product: 'bathymetry-v1';
  schemaVersion: 1;
  sourceId: string;
  tileSize: 256 | 512;
  url: string;
}>;

export type ResolvedMarineSource = Readonly<{
  identity: TileflowMarineSourceIdentity;
  source: Readonly<Record<string, unknown> & {type: 'vector'; url: string}>;
  sourceId: string;
}>;

export type ResolvedBathymetryRelief = Readonly<{
  identity: TileflowBathymetryDemSourceIdentity;
  source: Readonly<
    Record<string, unknown> & {
      encoding: TileflowTerrainEncoding;
      tileSize: 256 | 512;
      type: 'raster-dem';
      url: string;
    }
  >;
  sourceId: string;
  style: TileflowBathymetryReliefConfig;
}>;

export type ResolvedBathymetry = Readonly<{
  bands?: false | TileflowFillStyle;
  contours?: false | TileflowLineStyle;
  display: TileflowBathymetryDisplay;
  labels?: false | TileflowSymbolStyle;
  relief?: ResolvedBathymetryRelief;
  vector?: ResolvedMarineSource;
  vectorLayers?: TileflowBathymetryVectorLayers;
}>;

export type ResolvedMarine = Readonly<{
  bathymetry?: ResolvedBathymetry;
  nautical?: ResolvedMarineSource;
}>;

/** Resolve the optional marine sidecars without fetching their TileJSON documents. */
export function resolveMarine(
  marine: TileflowMarine | undefined,
  apiBaseUrl = 'https://api.tileflow.dev',
): ResolvedMarine | undefined {
  if (marine === undefined) return undefined;

  if (typeof marine === 'string') {
    switch (marine) {
      case 'none':
        return {};
      case 'bathymetry':
        return {bathymetry: resolveBathymetry({}, apiBaseUrl)};
      case 'nautical':
        return {nautical: resolveNauticalSource({}, apiBaseUrl)};
      case 'chart':
        return {
          bathymetry: resolveBathymetry({}, apiBaseUrl),
          nautical: resolveNauticalSource({}, apiBaseUrl),
        };
    }
  }

  return {
    ...(marine.bathymetry === false
      ? {}
      : {bathymetry: resolveBathymetry(marine.bathymetry ?? {}, apiBaseUrl)}),
    ...(marine.nautical === false
      ? {}
      : {nautical: resolveNauticalSource(marine.nautical ?? {}, apiBaseUrl)}),
  };
}

function resolveBathymetry(
  input: TileflowBathymetryConfig | TileflowMarineSourceConfig,
  apiBaseUrl: string,
): ResolvedBathymetry {
  const advanced = 'type' in input && input.type === 'bathymetry' ? input : undefined;
  const display = advanced?.display ?? 'bands';
  const usesVector = display === 'bands' || display === 'hybrid';
  const usesRelief = display === 'relief' || display === 'hybrid';
  const vectorConfig = {
    ...(input.attribution === undefined ? {} : {attribution: input.attribution}),
    ...(input.sourceId === undefined ? {} : {sourceId: input.sourceId}),
    ...(input.url === undefined ? {} : {url: input.url}),
  };
  const reliefConfig = advanced?.relief === false ? undefined : advanced?.relief;
  const reliefVisible =
    usesRelief &&
    reliefConfig?.visible !== false &&
    !(typeof reliefConfig?.opacity === 'number' && reliefConfig.opacity === 0);

  return {
    ...(advanced?.bands === undefined ? {} : {bands: advanced.bands}),
    ...(advanced?.contours === undefined ? {} : {contours: advanced.contours}),
    display,
    ...(advanced?.labels === undefined ? {} : {labels: advanced.labels}),
    ...(advanced?.vectorLayers === undefined
      ? {}
      : {vectorLayers: cloneJson(advanced.vectorLayers)}),
    ...(reliefVisible ? {relief: resolveBathymetryRelief(reliefConfig ?? {}, apiBaseUrl)} : {}),
    ...(usesVector
      ? {
          vector: resolveMarineSource({
            config: vectorConfig,
            defaultPath: '/tiles/bathymetry/tiles.json',
            defaultSourceId: tileflowBathymetrySourceId,
            kind: 'tileflow-bathymetry',
            product: tileflowBathymetryV1Schema.product,
            apiBaseUrl,
          }),
        }
      : {}),
  };
}

function resolveBathymetryRelief(
  style: TileflowBathymetryReliefConfig,
  apiBaseUrl: string,
): ResolvedBathymetryRelief {
  const sourceId = validateSourceId(style.sourceId ?? tileflowBathymetryDemSourceId);
  const url = validateBathymetryDemUrl(
    style.url ??
      new URL('/tiles/bathymetry/dem/tiles.json', normalizeApiBaseUrl(apiBaseUrl)).toString(),
  );
  const encoding = style.encoding ?? 'terrarium';
  const tileSize = style.tileSize ?? 512;
  return {
    identity: {
      encoding,
      kind: 'tileflow-bathymetry-dem',
      product: tileflowBathymetryV1Schema.product,
      schemaVersion: 1,
      sourceId,
      tileSize,
      url,
    },
    source: {
      ...(style.attribution ? {attribution: validateAttribution(style.attribution)} : {}),
      encoding,
      tileSize,
      type: 'raster-dem',
      url,
    },
    sourceId,
    style: cloneJson(style),
  };
}

/**
 * Feature IDs the Nautical source promotes for MapLibre feature state: each light's unique
 * `provenance`, which is what animated lights are keyed by.
 */
export const tileflowNauticalPromoteId = Object.freeze({
  [tileflowNauticalV1Schema.layers.lights]: tileflowNauticalV1Schema.fields.provenance,
});

function resolveNauticalSource(
  config: TileflowMarineSourceConfig,
  apiBaseUrl: string,
): ResolvedMarineSource {
  const resolved = resolveMarineSource({
    config,
    defaultPath: '/tiles/nautical/tiles.json',
    defaultSourceId: tileflowNauticalSourceId,
    kind: 'tileflow-nautical',
    product: tileflowNauticalV1Schema.product,
    apiBaseUrl,
  });
  return {...resolved, source: {...resolved.source, promoteId: {...tileflowNauticalPromoteId}}};
}

function resolveMarineSource(options: {
  apiBaseUrl: string;
  config: TileflowMarineSourceConfig;
  defaultPath: string;
  defaultSourceId: string;
  kind: TileflowMarineSourceIdentity['kind'];
  product: TileflowMarineSourceIdentity['product'];
}): ResolvedMarineSource {
  const sourceId = validateSourceId(options.config.sourceId ?? options.defaultSourceId);
  const url = validatePublicVectorUrl(
    options.config.url ??
      new URL(options.defaultPath, normalizeApiBaseUrl(options.apiBaseUrl)).toString(),
  );
  const identity: TileflowMarineSourceIdentity = {
    kind: options.kind,
    product: options.product,
    schemaVersion: 1,
    sourceId,
    url,
  };
  return {
    identity,
    source: {
      ...(options.config.attribution
        ? {attribution: validateAttribution(options.config.attribution)}
        : {}),
      type: 'vector',
      url,
    },
    sourceId,
  };
}

function validateSourceId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(normalized) || normalized !== value) {
    throw new Error(
      'Tileflow marine sourceId must be a portable identifier of at most 64 characters.',
    );
  }
  return normalized;
}

function validateAttribution(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized !== value || normalized.length > 2_048) {
    throw new Error(
      'Tileflow marine attribution must be non-empty, trimmed, and at most 2048 characters.',
    );
  }
  return normalized;
}

function validateBathymetryDemUrl(value: string): string {
  const url = validatePublicVectorUrl(value);
  if (url.startsWith('pmtiles://')) {
    throw new Error(
      'Tileflow bathymetry DEM TileJSON must use HTTPS, loopback HTTP, or a root-relative URL.',
    );
  }
  return url;
}

function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password) {
    throw new Error('Tileflow API base URL must not contain user information.');
  }
  return url.toString();
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
