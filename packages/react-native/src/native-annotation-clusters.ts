import {
  createTileflowAnnotationClusterIndex,
  type TileflowAnnotation,
  type TileflowAnnotationClusterIndex,
  type TileflowAnnotationClusterOptions,
} from '@tileflow/interactions';

/** The shared portable grouping, so native and web clusters split at the same zooms. */
export function createNativeAnnotationClusters(
  annotations: readonly TileflowAnnotation[],
  options: TileflowAnnotationClusterOptions,
): TileflowAnnotationClusterIndex {
  return createTileflowAnnotationClusterIndex(annotations, options);
}
