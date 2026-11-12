import {readTileflowCompilerProvenance} from './cartography/compiler-inspection';
import {tileflowBandPlacementIndex, tileflowLayerSlots} from './cartography/contributions';
import type {TileflowLayerPositionContext} from './layer-position-context';
import {isTileflowPortableId} from './portable-identity-rules';
import {parseTileflowLineBackgroundFontStack} from './text-background';

export const tileflowOverlayPlacements = [
  'above-water',
  'below-roads',
  'above-roads',
  'above-buildings',
  'below-labels',
  'above-labels',
] as const;

export const tileflowHostedSourceLimit = 16 as const;
/** Larger data belongs behind a URL or in runtime `dataSources`, not in every compiled style. */
export const tileflowInlineGeoJsonByteLimit = 512_000 as const;
/** Marks cluster overlay layers so runtimes find them without knowing their names. */
export const tileflowClusterMetadataKey = 'tileflow:cluster' as const;

export type TileflowClusterLayerRole = 'cluster' | 'count' | 'point';

export type TileflowOverlayPlacement = (typeof tileflowOverlayPlacements)[number];
export type TileflowHostedTilesetType = 'raster' | 'vector';

export type TileflowHostedTilesetSource = Readonly<{
  attribution: string;
  kind: 'hosted-tileset';
  local: string;
  tileset: string;
  tileSize?: 256 | 512;
  type: TileflowHostedTilesetType;
}>;

/**
 * A GeoJSON FeatureCollection, the shape MapLibre clustering and `setData` accept. Features are
 * plain objects because typed GeoJSON interfaces, such as `Feature<Point>`, have no index signature.
 */
export type TileflowGeoJsonFeatureCollection = Readonly<{
  features: readonly object[];
  type: 'FeatureCollection';
}>;

/** MapLibre aggregate: `[operator, mapExpression]`, summed into each cluster's properties. */
export type TileflowClusterProperty = readonly [operator: unknown, map: unknown];

/** Clustering options named as in the Mapbox and MapLibre source specifications. */
export type TileflowGeoJsonClusterOptions = Readonly<{
  /** Group nearby points in the worker. Defaults to false. */
  cluster?: boolean;
  /** The last zoom that clusters; points are separate above it. MapLibre's default is 14. */
  clusterMaxZoom?: number;
  /** The fewest points that form a cluster. MapLibre's default is 2. */
  clusterMinPoints?: number;
  /** Aggregates kept on clusters, such as `{total: ['+', ['get', 'price']]}`. */
  clusterProperties?: Readonly<Record<string, TileflowClusterProperty>>;
  /** Cluster radius in CSS pixels. MapLibre's default is 50. */
  clusterRadius?: number;
}>;

export type TileflowGeoJsonSource = Readonly<
  TileflowGeoJsonClusterOptions & {
    attribution?: string;
    data: TileflowGeoJsonFeatureCollection | string;
    kind: 'geojson';
  }
>;

export type TileflowSource = TileflowGeoJsonSource | TileflowHostedTilesetSource;

export type TileflowMapLibreOverlayLayer = Readonly<
  Record<string, unknown> & {
    id: string;
    source?: never;
    type: string;
  }
>;

export type TileflowMapLibreOverlay = Readonly<{
  kind: 'maplibre-overlay';
  layers: readonly TileflowMapLibreOverlayLayer[];
  placement: TileflowOverlayPlacement;
  source: string;
}>;

export type TileflowRemoveOperation = Readonly<{op: 'remove'}>;

export type TileflowHostedSourceIdentity = Readonly<{
  kind: 'hosted-tileset';
  sourceId: string;
  tileset: string;
  type: TileflowHostedTilesetType;
}>;

export type TileflowOverlayIdentity = Readonly<{
  layers: readonly string[];
  placement: TileflowOverlayPlacement;
  source: string;
}>;

export type TileflowHostedSourceCollection = Readonly<
  Record<string, TileflowSource | TileflowRemoveOperation>
>;

export type TileflowOverlayCollection = Readonly<
  Record<string, TileflowMapLibreOverlay | TileflowRemoveOperation>
>;

const tilesetIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/** Bind one logical Team tileset to an explicit account-free local PMTiles archive. */
export function hostedTileset(options: {
  attribution: string;
  local: string;
  tileset: string;
  tileSize?: 256 | 512;
  type?: TileflowHostedTilesetType;
}): TileflowHostedTilesetSource {
  const attribution = options.attribution.trim();
  if (!attribution) throw new Error('Tileflow hosted tileset attribution must not be empty.');
  if (!tilesetIdPattern.test(options.tileset) || ['terrain', 'world'].includes(options.tileset)) {
    throw new Error(`Invalid logical Tileflow hosted tileset ID: ${options.tileset}.`);
  }
  if (!isSafeLocalPmtilesPath(options.local)) {
    throw new Error(
      'Tileflow hosted tileset local must be a canonical relative .pmtiles path beginning with ./ or ../.',
    );
  }
  if (options.tileSize !== undefined && options.tileSize !== 256 && options.tileSize !== 512) {
    throw new Error('Tileflow hosted raster tileSize must be 256 or 512.');
  }
  const type = options.type ?? 'vector';
  if (type !== 'vector' && type !== 'raster') {
    throw new Error(`Unsupported Tileflow hosted tileset type: ${String(type)}.`);
  }
  if (type === 'vector' && options.tileSize !== undefined) {
    throw new Error('Tileflow hosted vector tilesets do not accept tileSize.');
  }

  return Object.freeze({
    attribution,
    kind: 'hosted-tileset',
    local: options.local,
    tileset: options.tileset,
    ...(options.tileSize === undefined ? {} : {tileSize: options.tileSize}),
    type,
  });
}

/**
 * Declare a named GeoJSON source. Omit `data` for a source the application fills at runtime through
 * a framework adapter's `dataSources`.
 */
export function geojsonSource(
  options: Readonly<
    TileflowGeoJsonClusterOptions & {
      attribution?: string;
      data?: TileflowGeoJsonFeatureCollection | string;
    }
  > = {},
): TileflowGeoJsonSource {
  const data = options.data ?? {features: [], type: 'FeatureCollection'};
  if (typeof data === 'string') {
    if (!isHttpsUrl(data)) {
      throw new Error('Tileflow GeoJSON source URLs must be absolute https:// URLs.');
    }
  } else if (
    !isPlainRecord(data) ||
    data.type !== 'FeatureCollection' ||
    !Array.isArray(data.features)
  ) {
    throw new Error('Tileflow GeoJSON source data must be a FeatureCollection or an https:// URL.');
  }
  assertClusterOptions(options);
  const attribution = options.attribution?.trim();
  return Object.freeze({
    ...(attribution ? {attribution} : {}),
    ...pickClusterOptions(options),
    data: typeof data === 'string' ? data : (Object.freeze(cloneJson(data)) as typeof data),
    kind: 'geojson',
  });
}

/** Group one or more ordinary MapLibre layers around one named Tileflow source. */
export function maplibreOverlay(options: {
  layers: readonly TileflowMapLibreOverlayLayer[];
  placement: TileflowOverlayPlacement;
  source: string;
}): TileflowMapLibreOverlay {
  if (!isTileflowPortableId(options.source)) {
    throw new Error(`Invalid Tileflow overlay source ID: ${options.source}.`);
  }
  if (!tileflowOverlayPlacements.includes(options.placement)) {
    throw new Error(`Invalid Tileflow overlay placement: ${String(options.placement)}.`);
  }
  if (!Array.isArray(options.layers) || options.layers.length < 1) {
    throw new Error('Tileflow MapLibre overlays require at least one layer.');
  }

  const layers = options.layers.map((layer, index) => {
    if (!isPlainRecord(layer)) {
      throw new Error(`Tileflow overlay layer ${index} must be a plain object.`);
    }
    if (!isTileflowPortableId(layer.id)) {
      throw new Error(`Invalid Tileflow overlay layer ID: ${String(layer.id)}.`);
    }
    if (layer.id === 'tileflow' || layer.id.startsWith('tileflow-')) {
      throw new Error(`Tileflow overlay layer ID is reserved: ${layer.id}.`);
    }
    if (typeof layer.type !== 'string' || !layer.type) {
      throw new Error(`Tileflow overlay layer ${layer.id} requires a MapLibre type.`);
    }
    if (Object.hasOwn(layer, 'source')) {
      throw new Error(
        `Tileflow overlay layer ${layer.id} inherits its source from the overlay and must not declare source.`,
      );
    }
    return Object.freeze(cloneJson(layer)) as TileflowMapLibreOverlayLayer;
  });

  return Object.freeze({
    kind: 'maplibre-overlay',
    layers: Object.freeze(layers),
    placement: options.placement,
    source: options.source,
  });
}

/**
 * Draw a clustering GeoJSON source: sized bubbles, their counts, and the separate points. Layers are
 * named `<id>-clusters`, `<id>-cluster-count` and `<id>-points`. The count uses the map's label font
 * unless `font` names another. Framework adapters zoom into a clicked cluster.
 */
export function clusterOverlay(options: {
  /** Bubble colours by point count: the first applies below `steps[0]`. */
  colors?: readonly [string, string, string];
  /** Zoom in when a cluster is clicked or tapped. Defaults to true. */
  expandOnClick?: boolean;
  /** An exact text-font stack, for maps whose labels use another font. */
  font?: readonly string[];
  id: string;
  placement: TileflowOverlayPlacement;
  /** Colour of the separate points. */
  pointColor?: string;
  /** Bubble radii in pixels, matching `colors`. */
  radii?: readonly [number, number, number];
  source: string;
  /** The two point counts where bubbles change size and colour. */
  steps?: readonly [number, number];
  textColor?: string;
}): TileflowMapLibreOverlay {
  const colors = options.colors ?? ['#2563eb', '#7c3aed', '#db2777'];
  const radii = options.radii ?? [16, 22, 30];
  const [low, high] = options.steps ?? [100, 750];
  if (!(low > 0 && high > low) || !radii.every((radius) => radius > 0)) {
    throw new Error('Tileflow cluster steps must increase and radii must be positive.');
  }
  const metadata = (role: TileflowClusterLayerRole) => ({
    [tileflowClusterMetadataKey]: {
      expandOnClick: options.expandOnClick ?? true,
      role,
    },
  });
  const step = (values: readonly (number | string)[]) => [
    'step',
    ['get', 'point_count'],
    values[0],
    low,
    values[1],
    high,
    values[2],
  ];
  return maplibreOverlay({
    layers: [
      {
        filter: ['has', 'point_count'],
        id: `${options.id}-clusters`,
        metadata: metadata('cluster'),
        paint: {
          'circle-color': step(colors),
          'circle-radius': step(radii),
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
        type: 'circle',
      },
      {
        filter: ['has', 'point_count'],
        id: `${options.id}-cluster-count`,
        layout: {
          'text-allow-overlap': true,
          'text-field': ['get', 'point_count_abbreviated'],
          ...(options.font ? {'text-font': [...options.font]} : {}),
          'text-ignore-placement': true,
          'text-size': 13,
        },
        metadata: metadata('count'),
        paint: {'text-color': options.textColor ?? '#ffffff'},
        type: 'symbol',
      },
      {
        filter: ['!', ['has', 'point_count']],
        id: `${options.id}-points`,
        metadata: metadata('point'),
        paint: {
          'circle-color': options.pointColor ?? colors[0],
          'circle-radius': 6,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
        type: 'circle',
      },
    ],
    placement: options.placement,
    source: options.source,
  });
}

/**
 * Draw point density from a GeoJSON source or a hosted vector tileset. `weight` is a number or a
 * MapLibre expression; values above 1 make a point count for more than one.
 */
export function heatmapOverlay(options: {
  /** `[density, color]` stops from 0 to 1. Start transparent so empty areas stay clear. */
  colors?: readonly (readonly [density: number, color: string])[];
  id: string;
  intensity?: unknown;
  /** Above this zoom the layer is not drawn, for handing over to points or clusters. */
  maxZoom?: number;
  opacity?: unknown;
  placement: TileflowOverlayPlacement;
  radius?: unknown;
  source: string;
  /** The source-layer of a vector tileset. GeoJSON sources have none. */
  sourceLayer?: string;
  weight?: unknown;
}): TileflowMapLibreOverlay {
  const colors = options.colors ?? [
    [0, 'rgba(33, 102, 172, 0)'],
    [0.2, '#67a9cf'],
    [0.4, '#d1e5f0'],
    [0.6, '#fddbc7'],
    [0.8, '#ef8a62'],
    [1, '#b2182b'],
  ];
  if (
    colors.length < 2 ||
    colors.some(([density], index) => {
      const previous = colors[index - 1]?.[0] ?? -1;
      return !(density >= 0 && density <= 1 && density > previous);
    })
  ) {
    throw new Error('Tileflow heatmap colors need at least two increasing densities from 0 to 1.');
  }
  const paint: Record<string, unknown> = {
    'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], ...colors.flat()],
    'heatmap-intensity': options.intensity ?? 1,
    'heatmap-opacity': options.opacity ?? 0.8,
    'heatmap-radius': options.radius ?? 30,
    'heatmap-weight': options.weight ?? 1,
  };
  return maplibreOverlay({
    layers: [
      {
        id: options.id,
        ...(options.maxZoom === undefined ? {} : {maxzoom: options.maxZoom}),
        paint,
        ...(options.sourceLayer === undefined ? {} : {'source-layer': options.sourceLayer}),
        type: 'heatmap',
      },
    ],
    placement: options.placement,
    source: options.source,
  });
}

/** Remove one inherited keyed source or overlay. */
export function remove(): TileflowRemoveOperation {
  return Object.freeze({op: 'remove'});
}

export function isTileflowRemoveOperation(value: unknown): value is TileflowRemoveOperation {
  return isPlainRecord(value) && value.op === 'remove' && Object.keys(value).length === 1;
}

export class TileflowOverlayCompilationError extends Error {
  readonly code: string;
  readonly path: string;
  readonly phase = 'lowering' as const;
  readonly suggestion?: string;
  readonly context?: TileflowLayerPositionContext;

  constructor(
    code: string,
    path: string,
    message: string,
    suggestion?: string,
    context?: TileflowLayerPositionContext,
  ) {
    super(message);
    this.code = code;
    this.name = 'TileflowOverlayCompilationError';
    this.path = path;
    if (suggestion) this.suggestion = suggestion;
    if (context) this.context = context;
  }
}

export function resolveTileflowHostedSources(
  mapId: string,
  sources: Readonly<Record<string, TileflowSource>> | undefined,
  reservedSourceIds: ReadonlySet<string>,
): {
  definitions: Record<string, Record<string, unknown>>;
  identities: Record<string, TileflowHostedSourceIdentity>;
} {
  const definitions: Record<string, Record<string, unknown>> = {};
  const identities: Record<string, TileflowHostedSourceIdentity> = {};
  const tilesets = new Map<string, string>();

  for (const [sourceId, source] of Object.entries(sources ?? {}).sort(([left], [right]) =>
    compareCodeUnits(left, right),
  )) {
    const path = `map.${mapId}.sources.${sourceId}`;
    if (!isTileflowPortableId(sourceId)) {
      throw new TileflowOverlayCompilationError(
        'TF_SOURCE_ID_INVALID',
        path,
        `Source ID "${sourceId}" is not portable.`,
      );
    }
    if (
      sourceId === 'tileflow' ||
      sourceId.startsWith('tileflow-') ||
      reservedSourceIds.has(sourceId)
    ) {
      throw new TileflowOverlayCompilationError(
        'TF_SOURCE_ID_RESERVED',
        path,
        `Source ID "${sourceId}" conflicts with a Tileflow source.`,
      );
    }
    if (source.kind === 'geojson') {
      definitions[sourceId] = createTileflowGeoJsonSourceDefinition(source);
      continue;
    }
    const duplicate = tilesets.get(source.tileset);
    if (duplicate) {
      throw new TileflowOverlayCompilationError(
        'TF_SOURCE_TILESET_DUPLICATE',
        `${path}.tileset`,
        `Sources "${duplicate}" and "${sourceId}" bind the same logical tileset "${source.tileset}".`,
      );
    }
    tilesets.set(source.tileset, sourceId);
    definitions[sourceId] = {
      attribution: source.attribution,
      type: source.type,
      url: `tileflow-pmtiles://${source.local}`,
      ...(source.tileSize === undefined ? {} : {tileSize: source.tileSize}),
    };
    identities[sourceId] = Object.freeze({
      kind: 'hosted-tileset',
      sourceId,
      tileset: source.tileset,
      type: source.type,
    });
  }

  return {definitions, identities};
}

/** The MapLibre source definition of one declared GeoJSON source. */
export function createTileflowGeoJsonSourceDefinition(
  source: TileflowGeoJsonSource,
): Record<string, unknown> {
  return {
    ...(source.attribution === undefined ? {} : {attribution: source.attribution}),
    ...pickClusterOptions(source),
    data: cloneJson(source.data),
    type: 'geojson',
  };
}

export function insertTileflowOverlays(input: {
  basemapLayers: readonly Record<string, unknown>[];
  mapId: string;
  overlays: Readonly<Record<string, TileflowMapLibreOverlay>> | undefined;
  sourceDefinitions?: Readonly<Record<string, Record<string, unknown>>>;
  sourceIds: readonly string[];
}): {
  identities: Record<string, TileflowOverlayIdentity>;
  layers: Record<string, unknown>[];
} {
  const availableSources = new Set(input.sourceIds);
  const labelFont = readTileflowLabelFont(input.basemapLayers);
  const identities: Record<string, TileflowOverlayIdentity> = {};
  const groups = new Map<TileflowOverlayPlacement, Record<string, unknown>[]>();
  const layerIds = new Set(
    input.basemapLayers.flatMap((layer) => (typeof layer.id === 'string' ? [layer.id] : [])),
  );

  for (const [overlayId, overlay] of Object.entries(input.overlays ?? {}).sort(([left], [right]) =>
    compareCodeUnits(left, right),
  )) {
    const path = `map.${input.mapId}.overlays.${overlayId}`;
    if (!availableSources.has(overlay.source)) {
      const available = [...availableSources].sort(compareCodeUnits);
      throw new TileflowOverlayCompilationError(
        'TF_OVERLAY_SOURCE_NOT_FOUND',
        `${path}.source`,
        `Overlay "${overlayId}" references unknown source "${overlay.source}". Available: ${available.join(', ') || '(none)'}.`,
        available.length > 0 ? `Use one of: ${available.join(', ')}.` : 'Declare the source first.',
      );
    }

    const layers = overlay.layers.map((layer, index) => {
      assertAuthoredLayerPosition(layer, overlay.placement, `${path}.layers.${index}`);
      if (layerIds.has(layer.id)) {
        throw new TileflowOverlayCompilationError(
          'TF_OVERLAY_LAYER_ID_DUPLICATE',
          `${path}.layers.${index}.id`,
          `Overlay layer ID "${layer.id}" is already used.`,
        );
      }
      layerIds.add(layer.id);
      if (readClusterRole(layer) && input.sourceDefinitions?.[overlay.source]?.cluster !== true) {
        throw new TileflowOverlayCompilationError(
          'TF_OVERLAY_CLUSTER_SOURCE_INVALID',
          `${path}.source`,
          `Cluster overlay "${overlayId}" needs a GeoJSON source declared with cluster: true.`,
          `Use geojsonSource({cluster: true}) for source "${overlay.source}".`,
        );
      }
      const label =
        readClusterRole(layer) === 'count' ? withLabelFont(layer, labelFont, path) : layer;
      return {
        ...cloneJson(label),
        source: overlay.source,
        metadata: {
          ...(isPlainRecord(layer.metadata) ? cloneJson(layer.metadata) : {}),
          'tileflow:overlay': overlayId,
        },
      };
    });
    groups.set(overlay.placement, [...(groups.get(overlay.placement) ?? []), ...layers]);
    identities[overlayId] = Object.freeze({
      layers: Object.freeze(overlay.layers.map(({id}) => id)),
      placement: overlay.placement,
      source: overlay.source,
    });
  }

  let layers = input.basemapLayers.map(cloneJson);
  for (const placement of tileflowOverlayPlacements) {
    const overlayLayers = groups.get(placement);
    if (!overlayLayers?.length) continue;
    const index = tileflowOverlayInsertionIndex(layers, placement);
    layers = [...layers.slice(0, index), ...overlayLayers, ...layers.slice(index)];
  }

  return {identities, layers};
}

function assertAuthoredLayerPosition(
  layer: TileflowMapLibreOverlayLayer,
  placement: TileflowOverlayPlacement,
  path: string,
): void {
  for (const field of [
    'slot',
    'slotIndex',
    'layerIndex',
    'aboveLayerId',
    'belowLayerId',
    'aboveLayerID',
    'belowLayerID',
    'beforeId',
  ]) {
    if (!Object.hasOwn(layer, field)) continue;
    const slot =
      layer.slot === null ||
      (typeof layer.slot === 'string' &&
        tileflowOverlayPlacements.includes(layer.slot as TileflowOverlayPlacement))
        ? (layer.slot as string | null)
        : undefined;
    const conflict = field === 'slot' && slot !== undefined && slot !== placement;
    const fieldPath = `${path}.${field}`;
    const corrections = [
      {
        code: 'useOverlayPlacement',
        message: 'Set the overlay placement and order its layers array.',
      },
      {
        code: 'removeRuntimePosition',
        message: 'Remove the runtime positioning field from the authored layer.',
      },
    ];
    throw new TileflowOverlayCompilationError(
      conflict ? 'TF_LAYER_POSITION_CONFLICT' : 'TF_LAYER_POSITION_UNSUPPORTED',
      fieldPath,
      conflict
        ? `Layer "${layer.id}" contradicts its overlay placement.`
        : `Authored layer "${layer.id}" cannot use runtime positioning field "${field}".`,
      corrections.map(({message}) => message).join(' '),
      {
        reason: conflict ? 'layerPositionConflict' : 'invalidLayerPosition',
        operation: 'compileOverlay',
        path: fieldPath,
        layerId: layer.id,
        ...(slot === undefined ? {} : {slot}),
        referenceSlot: placement,
        rule: conflict ? 'sameSlot' : 'authoredOverlayPlacement',
        corrections,
      },
    );
  }
}

/** The font stack of the style's first text layer that a new label can share. */
export function readTileflowLabelFont(
  layers: readonly Record<string, unknown>[],
): readonly string[] | undefined {
  for (const layer of layers) {
    const font = isPlainRecord(layer.layout) ? layer.layout['text-font'] : undefined;
    if (
      Array.isArray(font) &&
      font.length > 0 &&
      font.every((face) => typeof face === 'string' && !parseTileflowLineBackgroundFontStack(face))
    ) {
      return font as string[];
    }
  }
  return undefined;
}

function readClusterRole(
  layer: TileflowMapLibreOverlayLayer,
): TileflowClusterLayerRole | undefined {
  const metadata = isPlainRecord(layer.metadata) ? layer.metadata : undefined;
  const cluster = metadata?.[tileflowClusterMetadataKey];
  return isPlainRecord(cluster) ? (cluster.role as TileflowClusterLayerRole) : undefined;
}

function withLabelFont(
  layer: TileflowMapLibreOverlayLayer,
  font: readonly string[] | undefined,
  path: string,
): TileflowMapLibreOverlayLayer {
  const layout = layer.layout as Record<string, unknown>;
  if (layout['text-font'] !== undefined) return layer;
  if (!font) {
    throw new TileflowOverlayCompilationError(
      'TF_OVERLAY_FONT_UNAVAILABLE',
      `${path}.font`,
      `Cluster count layer "${layer.id}" has no label font to share.`,
      'Pass font to clusterOverlay() with a stack the map declares.',
    );
  }
  return {...layer, layout: {...layout, 'text-font': [...font]}};
}

function pickClusterOptions(source: TileflowGeoJsonClusterOptions): TileflowGeoJsonClusterOptions {
  return {
    ...(source.cluster === undefined ? {} : {cluster: source.cluster}),
    ...(source.clusterMaxZoom === undefined ? {} : {clusterMaxZoom: source.clusterMaxZoom}),
    ...(source.clusterMinPoints === undefined ? {} : {clusterMinPoints: source.clusterMinPoints}),
    ...(source.clusterProperties === undefined
      ? {}
      : {clusterProperties: cloneJson(source.clusterProperties)}),
    ...(source.clusterRadius === undefined ? {} : {clusterRadius: source.clusterRadius}),
  };
}

function assertClusterOptions(options: TileflowGeoJsonClusterOptions): void {
  const {cluster, clusterMaxZoom, clusterMinPoints, clusterProperties, clusterRadius} = options;
  if (cluster !== undefined && typeof cluster !== 'boolean') {
    throw new Error('Tileflow GeoJSON cluster must be a boolean.');
  }
  if (clusterRadius !== undefined && !(Number.isFinite(clusterRadius) && clusterRadius > 0)) {
    throw new Error('Tileflow clusterRadius must be a positive number of pixels.');
  }
  if (
    clusterMaxZoom !== undefined &&
    !(Number.isFinite(clusterMaxZoom) && clusterMaxZoom >= 0 && clusterMaxZoom <= 24)
  ) {
    throw new Error('Tileflow clusterMaxZoom must be a zoom from 0 to 24.');
  }
  if (
    clusterMinPoints !== undefined &&
    !(Number.isInteger(clusterMinPoints) && clusterMinPoints >= 2)
  ) {
    throw new Error('Tileflow clusterMinPoints must be an integer of at least 2.');
  }
  if (
    !cluster &&
    [clusterMaxZoom, clusterMinPoints, clusterProperties, clusterRadius].some(
      (value) => value !== undefined,
    )
  ) {
    throw new Error('Tileflow cluster options require cluster: true.');
  }
  for (const [name, value] of Object.entries(clusterProperties ?? {})) {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error(`Tileflow clusterProperties.${name} must be [operator, mapExpression].`);
    }
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function isSafeLocalPmtilesPath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 512 ||
    !value.endsWith('.pmtiles') ||
    value.includes('\\') ||
    /[\p{Cc}?#]/u.test(value)
  ) {
    return false;
  }

  let remainder: string;
  if (value.startsWith('./')) {
    remainder = value.slice(2);
  } else if (value.startsWith('../')) {
    remainder = value;
    while (remainder.startsWith('../')) remainder = remainder.slice(3);
  } else {
    return false;
  }

  return (
    remainder.length > '.pmtiles'.length &&
    remainder.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
  );
}

function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneJson) as T;
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneJson(child)]),
  ) as T;
}

export function tileflowOverlayInsertionIndex(
  layers: readonly Record<string, unknown>[],
  placement: TileflowOverlayPlacement,
): number {
  const ranks = layers.map((layer) => {
    const slots = readTileflowCompilerProvenance(layer).map(({slot}) =>
      tileflowLayerSlots.indexOf(slot),
    );
    return slots.length > 0 ? Math.min(...slots) : undefined;
  });
  return tileflowBandPlacementIndex(ranks, placement);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
