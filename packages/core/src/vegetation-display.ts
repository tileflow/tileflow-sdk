import type {TileflowVegetationMode} from './modules/vegetation';
import {readTileflowVegetation3D} from './trees-3d';

export type TileflowViewMode = '2d' | '3d';
export type TileflowVegetationRepresentation = 'none' | 'flat' | '3d';
export const tileflowVegetationDisplayMetadataKey = 'tileflow:vegetation-display';

/** Display policy, separate from the models' design and the camera's pitch. */
export type TileflowVegetationDisplay = Readonly<{
  version: 1;
  mode: TileflowVegetationMode;
  fallback: 'flat' | 'none';
  visible: boolean;
  /** Authored visibility before the compiler applies the static fallback. */
  flatLayers: readonly Readonly<{id: string; visible: boolean}>[];
}>;

export function readTileflowVegetationDisplay(
  metadata: unknown,
): TileflowVegetationDisplay | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const value = (metadata as Record<string, unknown>)[tileflowVegetationDisplayMetadataKey];
  if (value && typeof value === 'object') {
    const policy = value as Partial<TileflowVegetationDisplay>;
    if (
      policy.version !== 1 ||
      !['3d', 'flat', 'auto'].includes(policy.mode ?? '') ||
      !['flat', 'none'].includes(policy.fallback ?? '') ||
      typeof policy.visible !== 'boolean' ||
      !Array.isArray(policy.flatLayers) ||
      !policy.flatLayers.every(
        (layer) => layer && typeof layer.id === 'string' && typeof layer.visible === 'boolean',
      )
    )
      return undefined;
    return policy as TileflowVegetationDisplay;
  }
  // Older compiled maps describe models and their flat fallback without a display policy.
  const legacy = readTileflowVegetation3D(metadata);
  return legacy
    ? {
        version: 1,
        mode: '3d',
        fallback: 'flat',
        visible: true,
        flatLayers: legacy.flatLayers.map((id) => ({id, visible: true})),
      }
    : undefined;
}

export function resolveTileflowVegetationRepresentation(
  policy: TileflowVegetationDisplay | undefined,
  options: {visible?: boolean | undefined; viewMode?: TileflowViewMode; supports3D: boolean},
): TileflowVegetationRepresentation {
  if (!policy || !(options.visible ?? policy.visible)) return 'none';
  if (policy.mode === 'flat' || (policy.mode === 'auto' && options.viewMode !== '3d'))
    return 'flat';
  return options.supports3D ? '3d' : policy.fallback;
}
