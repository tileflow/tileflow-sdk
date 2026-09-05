import {
  tileflowOverlayInsertionIndex,
  type TileflowOverlayPlacement,
  tileflowOverlayPlacements,
} from '../overlays';

export const tileflowOverlayPlacementManifestMetadataKey =
  'tileflow:overlay-placement-manifest' as const;
export const tileflowOverlayPlacementManifestSchemaVersion = 1 as const;

export type TileflowOverlayPlacementManifest = {
  anchors: Record<TileflowOverlayPlacement, string | null>;
  schemaVersion: typeof tileflowOverlayPlacementManifestSchemaVersion;
};

export function createTileflowOverlayPlacementManifest(
  layers: readonly Record<string, unknown>[],
): TileflowOverlayPlacementManifest {
  const anchors = Object.fromEntries(
    tileflowOverlayPlacements.map((placement) => {
      const index = tileflowOverlayInsertionIndex(layers, placement);
      const id = index < layers.length ? layers[index]?.id : undefined;
      if (id !== undefined && typeof id !== 'string') {
        throw new Error(`Tileflow overlay placement ${placement} resolved an invalid layer ID.`);
      }
      return [placement, id ?? null];
    }),
  ) as Record<TileflowOverlayPlacement, string | null>;

  return {
    anchors,
    schemaVersion: tileflowOverlayPlacementManifestSchemaVersion,
  };
}

export function assertTileflowOverlayPlacementManifestLayers(
  manifest: TileflowOverlayPlacementManifest,
  layers: readonly Record<string, unknown>[],
): void {
  if (manifest.schemaVersion !== tileflowOverlayPlacementManifestSchemaVersion) {
    throw new Error('Tileflow overlay placement manifest schema version is unsupported.');
  }
  const keys = Object.keys(manifest.anchors);
  if (
    keys.length !== tileflowOverlayPlacements.length ||
    keys.some((key, index) => key !== tileflowOverlayPlacements[index])
  ) {
    throw new Error('Tileflow overlay placement manifest keys are invalid.');
  }

  const layerIndexes = new Map(
    layers.flatMap((layer, index) =>
      typeof layer.id === 'string' ? ([[layer.id, index]] as const) : [],
    ),
  );
  let previous = -1;

  for (const placement of tileflowOverlayPlacements) {
    const anchor = manifest.anchors[placement];
    const index = anchor === null ? layers.length : layerIndexes.get(anchor);
    if (index === undefined) {
      throw new Error(`Tileflow overlay placement manifest references missing layer: ${anchor}`);
    }
    if (index < previous) {
      throw new Error('Tileflow overlay placement manifest anchor order is invalid.');
    }
    previous = index;
  }
  if (manifest.anchors['above-labels'] !== null) {
    throw new Error('Tileflow above-labels placement must not have a physical anchor.');
  }
}
