import Supercluster from 'supercluster';
import type {TileflowAnnotation, TileflowInteractionCoordinate} from './contracts';

export type TileflowAnnotationClusterOptions = Readonly<{
  /** The last zoom that clusters; annotations are separate above it. Defaults to 14. */
  clusterMaxZoom?: number;
  /** The fewest annotations that form a cluster. Defaults to 2. */
  clusterMinPoints?: number;
  /** Cluster radius in CSS pixels or density-independent points. Defaults to 50. */
  clusterRadius?: number;
  /** Zoom in when a cluster is activated. Defaults to true. */
  expandOnClick?: boolean;
  /** The accessible name of a cluster. Defaults to `${count} places`. */
  formatAriaLabel?: (count: number) => string;
}>;

export type TileflowAnnotationCluster = Readonly<{
  annotationIds: readonly string[];
  clusterId: number;
  coordinate: TileflowInteractionCoordinate;
  /** The zoom at which this cluster splits. */
  expansionZoom: number;
  /** `point_count_abbreviated`, such as `1.2k`. */
  label: string;
  pointCount: number;
}>;

export type TileflowAnnotationClusterView = Readonly<{
  clusters: readonly TileflowAnnotationCluster[];
  /** Annotations a cluster stands in for at this zoom. */
  hiddenAnnotationIds: ReadonlySet<string>;
}>;

export type TileflowAnnotationClusterIndex = Readonly<{
  /** Groups for one map zoom. Results depend on its integer part only. */
  at: (zoom: number) => TileflowAnnotationClusterView;
}>;

/**
 * Groups annotations the way a clustering GeoJSON source groups points, with the same option names.
 * It is pure, so web and native renderers share one result.
 */
export function createTileflowAnnotationClusterIndex(
  annotations: readonly TileflowAnnotation[],
  options: TileflowAnnotationClusterOptions = {},
): TileflowAnnotationClusterIndex {
  const index = new Supercluster<{id: string}>({
    extent: 512,
    maxZoom: Math.floor(options.clusterMaxZoom ?? 14),
    minPoints: options.clusterMinPoints ?? 2,
    radius: options.clusterRadius ?? 50,
  }).load(
    annotations.map(({coordinate, id}) => ({
      geometry: {coordinates: [coordinate[0], coordinate[1]], type: 'Point'},
      properties: {id},
      type: 'Feature',
    })),
  );
  const views = new Map<number, TileflowAnnotationClusterView>();
  return Object.freeze({
    at(zoom: number) {
      const level = Math.max(0, Math.floor(Number.isFinite(zoom) ? zoom : 0));
      const cached = views.get(level);
      if (cached) return cached;
      const hidden = new Set(annotations.map(({id}) => id));
      const clusters: TileflowAnnotationCluster[] = [];
      for (const feature of index.getClusters([-180, -90, 180, 90], level)) {
        const properties = feature.properties as Supercluster.AnyProps;
        if (!properties.cluster) {
          hidden.delete(properties.id as string);
          continue;
        }
        const clusterId = properties.cluster_id as number;
        const [longitude, latitude] = feature.geometry.coordinates as [number, number];
        clusters.push(
          Object.freeze({
            annotationIds: Object.freeze(
              index.getLeaves(clusterId, Infinity).map((leaf) => leaf.properties.id),
            ),
            clusterId,
            coordinate: Object.freeze([longitude, latitude]) as TileflowInteractionCoordinate,
            expansionZoom: index.getClusterExpansionZoom(clusterId),
            label: String(properties.point_count_abbreviated),
            pointCount: properties.point_count as number,
          }),
        );
      }
      const view = Object.freeze({clusters: Object.freeze(clusters), hiddenAnnotationIds: hidden});
      views.set(level, view);
      return view;
    },
  });
}
