import {readTileflowCompilerProvenance} from './cartography/compiler-inspection';
import {tileflowLayerSlots} from './cartography/contributions';
import {isTileflowPortableId} from './portable-identity';

export const tileflowOverlayPlacements = [
  'above-water',
  'below-roads',
  'above-roads',
  'above-buildings',
  'below-labels',
  'above-labels',
] as const;

export const tileflowHostedSourceLimit = 16 as const;

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
  Record<string, TileflowHostedTilesetSource | TileflowRemoveOperation>
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

  constructor(code: string, path: string, message: string, suggestion?: string) {
    super(message);
    this.code = code;
    this.name = 'TileflowOverlayCompilationError';
    this.path = path;
    if (suggestion) this.suggestion = suggestion;
  }
}

export function resolveTileflowHostedSources(
  mapId: string,
  sources: Readonly<Record<string, TileflowHostedTilesetSource>> | undefined,
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

export function insertTileflowOverlays(input: {
  basemapLayers: readonly Record<string, unknown>[];
  mapId: string;
  overlays: Readonly<Record<string, TileflowMapLibreOverlay>> | undefined;
  sourceIds: readonly string[];
}): {
  identities: Record<string, TileflowOverlayIdentity>;
  layers: Record<string, unknown>[];
} {
  const availableSources = new Set(input.sourceIds);
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
      if (layerIds.has(layer.id)) {
        throw new TileflowOverlayCompilationError(
          'TF_OVERLAY_LAYER_ID_DUPLICATE',
          `${path}.layers.${index}.id`,
          `Overlay layer ID "${layer.id}" is already used.`,
        );
      }
      layerIds.add(layer.id);
      return {
        ...cloneJson(layer),
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
    const index = insertionIndex(layers, placement);
    layers = [...layers.slice(0, index), ...overlayLayers, ...layers.slice(index)];
  }

  return {identities, layers};
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

function insertionIndex(
  layers: readonly Record<string, unknown>[],
  placement: TileflowOverlayPlacement,
): number {
  const threshold = {
    'above-water': tileflowLayerSlots.indexOf('building-areas'),
    'below-roads': tileflowLayerSlots.indexOf('transport-areas'),
    'above-roads': tileflowLayerSlots.indexOf('boundaries'),
    'above-buildings': tileflowLayerSlots.indexOf('vegetation'),
    'below-labels': tileflowLayerSlots.indexOf('symbols'),
    'above-labels': Number.POSITIVE_INFINITY,
  }[placement];
  if (!Number.isFinite(threshold)) return layers.length;
  const index = layers.findIndex((layer) => {
    const ranks = readTileflowCompilerProvenance(layer).map(({slot}) =>
      tileflowLayerSlots.indexOf(slot),
    );
    return ranks.length > 0 && Math.min(...ranks) >= threshold;
  });
  return index < 0 ? layers.length : index;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
