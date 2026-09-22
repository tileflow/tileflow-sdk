import type {ReactElement} from 'react';
import type {
  TileflowAnnotation,
  TileflowAnnotationViewContext,
  TileflowInteractionBinding,
  TileflowInteractionDiagnostic,
  TileflowInteractionEvent,
  TileflowResolvedAnnotationTarget,
  TileflowResolvedPoiFeatureTarget,
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
      target: TileflowResolvedAnnotationTarget<TAnnotation> | TileflowResolvedPoiFeatureTarget;
      type: 'target:activate';
    }
  >;

export type MapInteractionProps<TAnnotation extends TileflowAnnotation = TileflowAnnotation> =
  Readonly<{
    annotations?: readonly TAnnotation[];
    interactions?: readonly TileflowInteractionBinding[];
    onInteractionEvent?: (event: MapInteractionEvent<TAnnotation>) => void;
    onInteractionDiagnostic?: (diagnostic: TileflowInteractionDiagnostic) => void;
    renderMarker?: MapMarkerRenderer<TAnnotation>;
  }>;
