import type {TileflowGeoJsonSource, TileflowMapLibreOverlay} from '@tileflow/core';
import type {TileflowTimeOfDay} from '@tileflow/core/runtime';
import type {TileflowAnnotationClusterOptions} from '@tileflow/interactions/maplibre';
import type {Map as MapLibreMap, MapOptions as MapLibreMapOptions} from 'maplibre-gl';
import type {Snippet, SvelteComponentTyped} from 'svelte';
import type {
  TileflowBounds,
  TileflowBrowserThemeBlendSelection,
  TileflowColorOverrides,
  TileflowEmphasis,
  TileflowFitBoundsOptions,
  TileflowMapError,
  TileflowThemeTransition,
  TileflowViewMode,
  TileflowThemeTransitionOptions,
  TileflowNavigationControlInput,
} from '@tileflow/core/browser';
import type {
  TileflowAnalytics,
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
export type TileflowMapLibreConfiguration = Readonly<{workerUrl: string}>;

/** Configure the application-owned worker before mounting an interactive Tileflow map. */
export function configureTileflowMapLibre(configuration: TileflowMapLibreConfiguration): void;

export type TileflowMapAnnotationSnippet<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = Snippet<[context: TileflowAnnotationViewContext<TAnnotation>]>;

export type TileflowMapInteractionSnippet<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = Snippet<[context: TileflowInteractionViewContext<TAnnotation>]>;

type TileflowMapBaseProps = {
  vegetation?: boolean;
  viewMode?: TileflowViewMode;
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
  /**
   * Called with `{code, error}` when the map cannot load its manifest, apply a theme, blend,
   * `colors` or `emphasis`, start its runtime or load its 3D scene. Without it, those failures go to
   * `console.error`.
   */
  onError?: (event: TileflowMapError) => void;
  onThemeChange?: (transition: TileflowThemeTransition) => void;
  theme?: TileflowThemeSelection;
  timeOfDay?: TileflowTimeOfDay;
  /**
   * Shows a continuous blend of the map's themes instead of `theme`. Moving `position` changes the
   * map at once; changing `themes` prepares a new blend. `hold` keeps labels, icons, and mixed
   * artwork back during a camera move; clearing it brings them in at once.
   */
  themeBlend?: TileflowBrowserThemeBlendSelection;
  /** Cross-fades theme changes, including entering and leaving a blend. */
  themeTransition?: TileflowThemeTransitionOptions;
  zoom?: number;
};

export type TileflowMapAnnotationProps<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = {
  /** Group `annotations` into accessible cluster buttons. Up to 1,000 annotations. */
  annotationClusters?: TileflowAnnotationClusterOptions;
  annotations?: readonly TAnnotation[];
};

export type TileflowMapAppearanceProps = {
  /**
   * Colour token overrides for the map, for example `{'surface.land': '#f4f1ea'}`. The overrides ease in over
   * `themeTransition`, stay through theme changes, and an empty object restores the map's own
   * colours. The map must be configurable at run time; an unknown token or an invalid value is
   * logged and leaves the colours unchanged.
   */
  colors?: TileflowColorOverrides;
  /**
   * Makes chosen modules of the map recede and its labels fade, so your own content reads first.
   * It eases in over `themeTransition` and stays through theme changes; leave it out for the map
   * as designed.
   */
  emphasis?: TileflowEmphasis;
};

export type TileflowMapDataProps = {
  /** Overlays drawn over `dataSources` or compiled sources, keyed as in `defineMap`. */
  dataOverlays?: Readonly<Record<string, TileflowMapLibreOverlay>>;
  /** Application GeoJSON, keyed as in `defineMap`. A compiled source of the same key is filled. */
  dataSources?: Readonly<Record<string, TileflowGeoJsonSource>>;
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
    TileflowMapAppearanceProps &
    TileflowMapDataProps &
    TileflowMapInteractionStateProps & {
      interactions?: readonly TileflowInteractionBinding[];
      marker?: TileflowMapAnnotationSnippet<TAnnotation>;
      mode?: 'interactive';
      /**
       * The zoom and compass buttons of an interactive map. A map shows none unless asked: `true` shows
       * them at `top-right`, and an object moves them or limits their buttons.
       */
      navigationControl?: TileflowNavigationControlInput;
      /**
       * Shows these bounds, `[west, south, east, north]` or `[[west, south], [east, north]]`. The
       * map starts there, and moves to new bounds when this prop changes. `center` and `zoom` set
       * the view only until bounds are given.
       */
      bounds?: TileflowBounds;
      /**
       * Fits the map to all `annotations`, with 48 pixels of padding and at most zoom 15 unless
       * options say otherwise, and again whenever their positions change. `bounds` takes
       * precedence.
       */
      fitAnnotations?: boolean | TileflowFitBoundsOptions;
      /** How `bounds` is fitted: `padding`, `maxZoom` and `duration`. */
      fitBoundsOptions?: TileflowFitBoundsOptions;
      onInteractionDiagnostic?: (diagnostic: TileflowInteractionDiagnostic) => void;
      onInteractionEvent?: (event: TileflowInteractionEvent<TAnnotation>) => void;
      onInteractionStateChange?: (state: TileflowInteractionState) => void;
      popup?: TileflowMapInteractionSnippet<TAnnotation>;
      tooltip?: TileflowMapInteractionSnippet<TAnnotation>;
    };

type TileflowMapImageProps = {
  annotationClusters?: never;
  annotations?: never;
  colors?: never;
  dataOverlays?: never;
  dataSources?: never;
  defaultInteractionState?: never;
  emphasis?: never;
  interactions?: never;
  interactionState?: never;
  marker?: never;
  mode: 'image';
  navigationControl?: never;
  bounds?: never;
  fitAnnotations?: never;
  fitBoundsOptions?: never;
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
