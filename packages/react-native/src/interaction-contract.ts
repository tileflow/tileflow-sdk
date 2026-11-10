import type {ReactElement} from 'react';
import type {TileflowGeoJsonSource, TileflowMapLibreOverlay} from '@tileflow/core/native';
import type {
  TileflowAnnotation,
  TileflowAnnotationClusterOptions,
  TileflowAnnotationViewContext,
  TileflowInteractionBinding,
  TileflowInteractionDiagnostic,
  TileflowInteractionEvent,
  TileflowResolvedAnnotationTarget,
  TileflowResolvedClusterTarget,
  TileflowResolvedPoiFeatureTarget,
  TileflowResolvedStyleFeatureTarget,
} from '@tileflow/interactions';

/** Marker composition only. Selection presentation and native handles are not part of this context. */
export type MapMarkerRenderContext<TAnnotation extends TileflowAnnotation = TileflowAnnotation> =
  Readonly<
    Pick<
      TileflowAnnotationViewContext<TAnnotation>,
      'annotation' | 'target' | 'content' | 'viewName'
    >
  >;

/** Return marker content; Tileflow supplies the accessible activation wrapper. */
export type MapMarkerRenderer<TAnnotation extends TileflowAnnotation = TileflowAnnotation> = (
  context: MapMarkerRenderContext<TAnnotation>,
) => ReactElement;

/** Mobile reports activation; the application owns any persistent selection. */
export type MapInteractionEvent<TAnnotation extends TileflowAnnotation = TileflowAnnotation> =
  Readonly<
    Omit<TileflowInteractionEvent<TAnnotation>, 'target' | 'type'> & {
      target:
        | TileflowResolvedAnnotationTarget<TAnnotation>
        | TileflowResolvedClusterTarget
        | TileflowResolvedPoiFeatureTarget
        | TileflowResolvedStyleFeatureTarget;
      type: 'target:activate';
    }
  >;

export type MapInteractionProps<TAnnotation extends TileflowAnnotation = TileflowAnnotation> =
  Readonly<{
    /** Group `annotations` into accessible native cluster buttons. Up to 1,000 annotations. */
    annotationClusters?: TileflowAnnotationClusterOptions;
    annotations?: readonly TAnnotation[];
    /** Overlays drawn over `dataSources` or compiled sources, keyed as in `defineMap`. */
    dataOverlays?: Readonly<Record<string, TileflowMapLibreOverlay>>;
    /** Application GeoJSON, keyed as in `defineMap`. A compiled source of the same key is filled. */
    dataSources?: Readonly<Record<string, TileflowGeoJsonSource>>;
    interactions?: readonly TileflowInteractionBinding[];
    onInteractionEvent?: (event: MapInteractionEvent<TAnnotation>) => void;
    onInteractionDiagnostic?: (diagnostic: TileflowInteractionDiagnostic) => void;
    renderMarker?: MapMarkerRenderer<TAnnotation>;
  }>;
