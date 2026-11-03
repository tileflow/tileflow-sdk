import {tileflowMaxPitch} from './camera-limits';

/** Camera policy used by a map's browser 3D scene. */
export type TileflowCameraOptions = Readonly<{
  /** Subtle top-down perspective at street zooms. Omission uses the map's default, else false. */
  adaptivePerspective?: boolean | undefined;
  /** Cap pitch at and below this zoom; closer views keep the application's maximum. */
  pitchLimit?: Readonly<{maxZoom: number; maxPitch: number}>;
}>;

export const tileflowCameraMetadataKey = 'tileflow:camera';

export function readTileflowCamera(metadata: unknown): TileflowCameraOptions {
  if (!metadata || typeof metadata !== 'object') return {};
  const value = (metadata as Record<string, unknown>)[tileflowCameraMetadataKey];
  if (!value || typeof value !== 'object') return {};
  const policy = value as {version?: unknown; adaptivePerspective?: unknown; pitchLimit?: unknown};
  if (policy.version !== 1) return {};
  const limit = policy.pitchLimit as {maxZoom?: unknown; maxPitch?: unknown} | undefined;
  return {
    ...(typeof policy.adaptivePerspective === 'boolean'
      ? {adaptivePerspective: policy.adaptivePerspective}
      : {}),
    ...(limit &&
    typeof limit.maxZoom === 'number' &&
    limit.maxZoom >= 0 &&
    limit.maxZoom <= 24 &&
    typeof limit.maxPitch === 'number' &&
    limit.maxPitch >= 0 &&
    limit.maxPitch <= tileflowMaxPitch
      ? {pitchLimit: {maxZoom: limit.maxZoom, maxPitch: limit.maxPitch}}
      : {}),
  };
}
