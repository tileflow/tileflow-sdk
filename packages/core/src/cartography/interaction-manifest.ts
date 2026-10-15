import {tileflowCompilerMetadataKeys} from './contributions';
import {tileflowPoiCategories} from '../types';

export const tileflowInteractionManifestMetadataKey = 'tileflow:interaction-manifest' as const;
export const tileflowInteractionManifestVersion = 3 as const;

/**
 * One physical layer that draws POIs. A layer may draw several categories, so the category of a
 * hit is read from the feature's own `category` field.
 */
export type TileflowPoiInteractionLayer = {
  anchor: 'pointer-coordinate';
  layerId: string;
  priority: number;
  representation: 'combined' | 'icon' | 'label' | 'marker';
  source: string;
  sourceLayer: string;
};

export type TileflowPoiInteractionFields = {
  category: string;
  filterRank: string;
  icon: string;
  name: string;
  sizeRank: string;
  type: string;
};

export type TileflowInteractionManifest = {
  domains: {
    poi?: {
      deduplication: {
        identity: readonly ['source', 'source-layer', 'feature-id'];
        representationPriority: readonly ['marker', 'icon', 'combined', 'label'];
      };
      fields: TileflowPoiInteractionFields;
      hitTesting: {
        frequency: 'animation-frame';
        order: 'rendered-topmost';
      };
      identity: 'maplibre-feature-id-if-present';
      layers: TileflowPoiInteractionLayer[];
    };
  };
  version: typeof tileflowInteractionManifestVersion;
};

/**
 * Builds the private runtime lookup only after physical-planner decisions are final.
 * Applications target `poi`; only the runtime consumes the physical layer IDs.
 */
export function createTileflowInteractionManifest(
  layers: readonly Record<string, unknown>[],
  fields: TileflowPoiInteractionFields,
): TileflowInteractionManifest | undefined {
  const poiLayers = layers.flatMap((layer, priority): TileflowPoiInteractionLayer[] => {
    const id = typeof layer.id === 'string' ? layer.id : undefined;
    const source = typeof layer.source === 'string' ? layer.source : undefined;
    const sourceLayer =
      typeof layer['source-layer'] === 'string' ? layer['source-layer'] : undefined;
    const target = semanticTarget(layer);
    if (!id || !source || !sourceLayer || (target !== 'poi' && !target?.startsWith('poi.'))) {
      return [];
    }

    const parsed = parsePoiTarget(target);
    if (!parsed) return [];
    return [
      {
        ...parsed,
        anchor: 'pointer-coordinate',
        layerId: id,
        priority,
        source,
        sourceLayer,
      },
    ];
  });

  if (poiLayers.length === 0) return undefined;

  return {
    domains: {
      poi: {
        deduplication: {
          identity: ['source', 'source-layer', 'feature-id'],
          representationPriority: ['marker', 'icon', 'combined', 'label'],
        },
        fields: {...fields},
        hitTesting: {frequency: 'animation-frame', order: 'rendered-topmost'},
        identity: 'maplibre-feature-id-if-present',
        layers: poiLayers,
      },
    },
    version: tileflowInteractionManifestVersion,
  };
}

export function assertTileflowInteractionManifestLayers(
  manifest: TileflowInteractionManifest | undefined,
  layers: readonly Record<string, unknown>[],
): void {
  const poiLayers = manifest?.domains.poi?.layers ?? [];
  if (poiLayers.length > 256) {
    throw new Error('Tileflow interaction manifest exceeds the 256-layer POI lookup limit.');
  }
  const layersById = new Map(
    layers.flatMap((layer) => (typeof layer.id === 'string' ? ([[layer.id, layer]] as const) : [])),
  );
  const poiNamespaces = new Set(
    poiLayers.map((layer) => `${layer.source}\u0000${layer.sourceLayer}`),
  );
  if (poiNamespaces.size > 1) {
    throw new Error(
      'Tileflow POI interaction metadata requires one source and source-layer namespace.',
    );
  }
  for (const layer of poiLayers) {
    if (
      !isSafeArtifactName(layer.layerId) ||
      !isSafeArtifactName(layer.source) ||
      !isSafeArtifactName(layer.sourceLayer)
    ) {
      throw new Error('Tileflow interaction manifest contains an invalid physical POI lookup.');
    }
    const finalized = layersById.get(layer.layerId);
    if (!finalized) {
      throw new Error(
        `Tileflow interaction manifest references missing finalized layer: ${layer.layerId}`,
      );
    }
    if (finalized.source !== layer.source || finalized['source-layer'] !== layer.sourceLayer) {
      throw new Error(
        `Tileflow interaction manifest physical lookup does not match finalized layer: ${layer.layerId}`,
      );
    }
  }

  for (const [name, field] of Object.entries(manifest?.domains.poi?.fields ?? {})) {
    if (!isSafeArtifactName(field)) {
      throw new Error(`Tileflow interaction manifest has an invalid POI ${name} field.`);
    }
  }
}

/**
 * `poi`, `poi.prominent` and their `.<part>` are the module's shared placement layers;
 * `poi.<category>` and `poi.<category>.<part>` are per-category layers of
 * `placement.order: 'categories'`.
 */
function parsePoiTarget(
  target: string,
): Pick<TileflowPoiInteractionLayer, 'representation'> | undefined {
  const segments = target.split('.');
  if (segments[0] !== 'poi' || segments.length > 3) return undefined;
  const [, first, second] = segments;
  if (first === undefined) return {representation: 'combined'};
  if (segments.length === 2 && isRepresentationPart(first)) return {representation: first};
  if (first !== 'prominent' && !isTileflowPoiCategory(first)) return undefined;
  if (second === undefined) return {representation: 'combined'};
  return isRepresentationPart(second) ? {representation: second} : undefined;
}

function isRepresentationPart(value: string): value is 'icon' | 'label' | 'marker' {
  return value === 'icon' || value === 'label' || value === 'marker';
}

function isTileflowPoiCategory(value: unknown): boolean {
  return typeof value === 'string' && (tileflowPoiCategories as readonly string[]).includes(value);
}

function semanticTarget(layer: Record<string, unknown>): string | undefined {
  if (!isRecord(layer.metadata)) return undefined;
  const value = layer.metadata[tileflowCompilerMetadataKeys.target];
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isSafeArtifactName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  );
}
