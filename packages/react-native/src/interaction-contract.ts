import type {ReactElement} from 'react';
import type {
  TileflowAnnotation,
  TileflowAnnotationViewContext,
  TileflowInteractionBinding,
  TileflowInteractionDiagnostic,
  TileflowInteractionEvent,
  TileflowInteractionState,
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

/** Ownership is fixed for a mounted Map. Popup-named fields are portable state, not native UI. */
export type MapInteractionStateProps =
  | Readonly<{
      interactionState: TileflowInteractionState;
      defaultInteractionState?: never;
    }>
  | Readonly<{
      interactionState?: never;
      defaultInteractionState?: TileflowInteractionState;
    }>;

export type MapInteractionProps<TAnnotation extends TileflowAnnotation = TileflowAnnotation> =
  MapInteractionStateProps &
    Readonly<{
      annotations?: readonly TAnnotation[];
      interactions?: readonly TileflowInteractionBinding[];
      onInteractionEvent?: (event: TileflowInteractionEvent<TAnnotation>) => void;
      onInteractionStateChange?: (state: TileflowInteractionState) => void;
      onInteractionDiagnostic?: (diagnostic: TileflowInteractionDiagnostic) => void;
      renderMarker?: MapMarkerRenderer<TAnnotation>;
    }>;
