import type {Map as MapLibreMap, MapOptions as MapLibreMapOptions} from 'maplibre-gl';
import type {Snippet, SvelteComponentTyped} from 'svelte';
import type {TileflowThemeTransition} from '@tileflow/core/browser';
import type {
  TileflowAnalytics,
  TileflowMapMarker,
  TileflowRuntimeSource,
  TileflowThemeSelection,
} from '@tileflow/core/runtime';
import type {
  TileflowAnnotation,
  TileflowAnnotationViewContext,
  TileflowInteractionBinding,
  TileflowInteractionDiagnostic,
  TileflowInteractionEvent,
  TileflowInteractionState,
  TileflowInteractionViewContext,
} from '@tileflow/interactions';

export type TileflowMapMode = 'interactive' | 'image';
export type TileflowMapOptions = Omit<MapLibreMapOptions, 'container' | 'style'>;
export type TileflowMapSource = TileflowRuntimeSource;

export type TileflowMapMarkerSnippet<TAnnotation extends TileflowAnnotation = TileflowAnnotation> =
  Snippet<[context: TileflowAnnotationViewContext<TAnnotation>]>;

export type TileflowMapAnnotationSnippet<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = TileflowMapMarkerSnippet<TAnnotation>;

export type TileflowMapInteractionSnippet<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = Snippet<[context: TileflowInteractionViewContext<TAnnotation>]>;

type TileflowMapBaseProps = {
  alt?: string;
  analytics?: TileflowAnalytics;
  center?: [number, number];
  captureId?: string;
  className?: string;
  height?: number | string;
  imageLoading?: HTMLImageElement['loading'];
  imageUrl?: string;
  interactive?: boolean;
  mapOptions?: TileflowMapOptions;
  onThemeChange?: (transition: TileflowThemeTransition) => void;
  theme?: TileflowThemeSelection;
  zoom?: number;
};

export type TileflowMapAnnotationProps<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> =
  | {
      annotations?: readonly TAnnotation[];
      markers?: never;
    }
  | {
      annotations?: never;
      markers?: readonly TileflowMapMarker[];
    };

export type TileflowMapInteractionStateProps =
  | {
      defaultInteractionState?: TileflowInteractionState;
      interactionState?: never;
    }
  | {
      defaultInteractionState?: never;
      interactionState?: TileflowInteractionState;
    };

type TileflowMapStyleSourceProps = {
  source: TileflowRuntimeSource;
};

type TileflowMapInteractiveProps<TAnnotation extends TileflowAnnotation> =
  TileflowMapAnnotationProps<TAnnotation> &
    TileflowMapInteractionStateProps & {
      interactions?: readonly TileflowInteractionBinding[];
      marker?: TileflowMapMarkerSnippet<TAnnotation>;
      mode?: 'interactive';
      onInteractionDiagnostic?: (diagnostic: TileflowInteractionDiagnostic) => void;
      onInteractionEvent?: (event: TileflowInteractionEvent<TAnnotation>) => void;
      onInteractionStateChange?: (state: TileflowInteractionState) => void;
      popup?: TileflowMapInteractionSnippet<TAnnotation>;
      tooltip?: TileflowMapInteractionSnippet<TAnnotation>;
    };

type TileflowMapImageProps = {
  annotations?: never;
  defaultInteractionState?: never;
  interactions?: never;
  interactionState?: never;
  marker?: never;
  markers?: never;
  mode: 'image';
  onInteractionDiagnostic?: never;
  onInteractionEvent?: never;
  onInteractionStateChange?: never;
  popup?: never;
  tooltip?: never;
};

export type TileflowMapProps<TAnnotation extends TileflowAnnotation = TileflowAnnotation> =
  TileflowMapBaseProps &
    TileflowMapStyleSourceProps &
    (TileflowMapInteractiveProps<TAnnotation> | TileflowMapImageProps);

export default class TileflowMap<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> extends SvelteComponentTyped<TileflowMapProps<TAnnotation>, {load: CustomEvent<MapLibreMap>}> {}

export {TileflowMap};
