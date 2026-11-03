/** Camera policy used by a map's browser 3D scene. */
export type TileflowCameraOptions = Readonly<{
  /** Subtle top-down perspective at street zooms. Omission uses the map's default, else false. */
  adaptivePerspective?: boolean | undefined;
}>;

export const tileflowCameraMetadataKey = 'tileflow:camera';

export function readTileflowCamera(metadata: unknown): TileflowCameraOptions {
  if (!metadata || typeof metadata !== 'object') return {};
  const value = (metadata as Record<string, unknown>)[tileflowCameraMetadataKey];
  if (!value || typeof value !== 'object') return {};
  const policy = value as {version?: unknown; adaptivePerspective?: unknown};
  return policy.version === 1 && typeof policy.adaptivePerspective === 'boolean'
    ? {adaptivePerspective: policy.adaptivePerspective}
    : {};
}
