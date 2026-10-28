import type {MapProps as NativeMapProps} from '@maplibre/maplibre-react-native';
import type {ReactNode, Ref} from 'react';
import type {ViewProps} from 'react-native';
import type {
  TileflowBoundaryFamily,
  TileflowBoundaryValues,
  TileflowNativeInitialView,
  TileflowNativeInitialViewOptions,
  TileflowNativeSource,
  TileflowNativeSourceError,
  TileflowNativeSourceOptions,
  TileflowNativeSourceState,
} from '@tileflow/core/native';
import type {TileflowAnnotation} from '@tileflow/interactions';
import type {MapInteractionProps} from './interaction-contract';

export type MapSource = TileflowNativeSource;
export type MapThemeSelection = NonNullable<TileflowNativeSourceOptions['theme']>;
export type MapColorScheme = NonNullable<TileflowNativeSourceOptions['colorScheme']>;
export type MapView = TileflowNativeInitialView;
/** Portable composition inputs, independent from source acquisition. */
export type MapInitialViewInputs = TileflowNativeInitialViewOptions;

/**
 * How a theme change appears. By default, a snapshot of the current frame covers the map,
 * follows the camera, and fades out once the new theme is drawn. The device's reduce-motion
 * setting changes at once.
 */
export type MapThemeTransition = Readonly<{
  /** Cross-fade length in milliseconds, from 0 (immediate) to 5000. Defaults to 450. */
  duration?: number;
}>;

/**
 * A continuous blend of two to eight concrete themes of the map, shown instead of `theme`.
 * `position` runs from 0 (the first theme) to `themes.length - 1`; 1.25 is a quarter of the way
 * from the second theme to the third. Ground colours and widths follow the position; labels and
 * icons cross-fade when the nearest theme changes.
 */
export type MapThemeBlend = Readonly<{
  themes: readonly string[];
  position: number;
}>;

export type MapSourceProps = Readonly<{
  source: MapSource;
  theme?: MapThemeSelection;
  timeOfDay?: TileflowNativeSourceOptions['timeOfDay'];
  /** Cross-fades theme changes, including entering and leaving a blend. */
  themeTransition?: MapThemeTransition;
  /**
   * Shows a blend of themes instead of `theme`. The first blend of a set of themes prepares one
   * style that holds all of them; moving `position` later changes the map without loading.
   */
  themeBlend?: MapThemeBlend;
}>;

/**
 * Application values on the map's Boundaries areas, for a choropleth that reads them with
 * `feature-state`. The same rows and options as `useBoundaryFeatureState` on the web: rows keyed by
 * the source's feature ID (`id`, or `ref` when the map promotes it), joined with
 * `joinBoundaryRows` when the data carries other codes. Values survive theme changes; `null`
 * removes them.
 */
export type MapBoundaryFeatureState = Readonly<{
  values: TileflowBoundaryValues | null;
  /** Defaults to `boundaries`. */
  family?: TileflowBoundaryFamily;
  /** Also set the values on `boundary_label` points, for labels styled by value. */
  labels?: boolean;
  /** Feature-state key; it must match the choropleth's `state`. Defaults to `value`. */
  state?: string;
}>;

type AllowedMapOptions =
  | 'dragPan'
  | 'touchZoom'
  | 'doubleTapZoom'
  | 'doubleTapHoldZoom'
  | 'touchRotate'
  | 'touchPitch'
  | 'compass'
  | 'compassHiddenFacingNorth'
  | 'scaleBar';

type OwnedMapOptions =
  | Exclude<keyof NativeMapProps, AllowedMapOptions>
  | 'container'
  | 'styleURL'
  | 'styleUrl'
  | 'transformRequest'
  | 'requestTransform'
  | 'requestHeaders';

/** A positive allowlist. Style, interception, view and lifecycle remain adapter-owned. */
export type MapOptions = Readonly<Pick<NativeMapProps, AllowedMapOptions>> & {
  readonly [Key in OwnedMapOptions]?: never;
};

export type MapPresentationProps = Readonly<{
  children?: ReactNode;
  style?: ViewProps['style'];
  testID?: ViewProps['testID'];
  mapOptions?: MapOptions;
  boundaryFeatureState?: MapBoundaryFeatureState;
}>;

type TileflowReady = Extract<TileflowNativeSourceState, {status: 'ready'}>;
export type MapTheme = Readonly<Pick<TileflowReady['theme'], 'name' | 'colorScheme'>>;
export type MapSourceError = Readonly<Pick<TileflowNativeSourceError, 'code' | 'field' | 'kind'>>;

/** Safe Tileflow identity only: no URL, style body, credentials or native object. */
export type MapSelection = Readonly<{map: TileflowReady['map']['name']; theme: MapTheme}>;

/** Source readiness is not renderer/frame readiness. */
export type MapSourceState =
  | Readonly<{status: 'loading'; generation: number}>
  | (Readonly<{status: 'ready'; generation: number}> & MapSelection)
  | Readonly<{status: 'error'; generation: number; error: MapSourceError}>;

/**
 * The Hosted session stopped: its credential, Map or quota was rejected, or Tileflow refused the
 * session for another reason that trying again will not change (`NATIVE_SESSION_REJECTED`). The map
 * keeps what it has drawn and loads nothing new until `ref.retry()` or another source. Service
 * outages and rate limits retry on their own and are not reported.
 */
export type MapSessionError = Readonly<{
  code:
    | 'NATIVE_SESSION_CREDENTIAL_REJECTED'
    | 'NATIVE_SESSION_MAP_MISMATCH'
    | 'NATIVE_SESSION_MAP_NOT_FOUND'
    | 'NATIVE_SESSION_QUOTA_EXCEEDED'
    | 'NATIVE_SESSION_REJECTED'
    | 'NATIVE_SESSION_INPUT_INVALID';
  kind: 'terminal';
  /**
   * For `NATIVE_SESSION_REJECTED`, the service's code when its answer carried one, such as
   * `MOBILE_SESSION_MODE_REQUIRED`. A bounded identifier, never a message or response body.
   */
  reason?: string;
}>;

export type MapRef = Readonly<{
  /** A synchronous read of the last source snapshot. Does not trigger loading or native commands. */
  getSourceState(): MapSourceState | undefined;
  /**
   * Loads again a map that stopped: after a `session-error` once its cause is resolved, for
   * example a raised quota, or after a source or renderer error. A shown map is unaffected.
   */
  retry(): void;
}>;

/** The current style was accepted by the renderer; this alone does not establish a rendered frame. */
export type MapLoadEvent = Readonly<{
  type: 'load';
  generation: number;
  selection: MapSelection;
}>;

/** Renderer failures expose no native event, message or remote cause. */
export type MapErrorEvent =
  | Readonly<{type: 'source-error'; generation: number; error: MapSourceError}>
  | Readonly<{type: 'renderer-error'; generation: number}>
  | Readonly<{type: 'session-error'; generation: number; error: MapSessionError}>;

/** The renderer owner must confirm readiness; a ready manifest alone is insufficient. */
export type MapReadinessChangeEvent = Readonly<{
  type: 'readiness-change';
  generation: number;
}> &
  (Readonly<{status: 'loading'}> | Readonly<{status: 'ready'}> | Readonly<{status: 'error'}>);

/** Theme transitions retain concrete names; source/renderer error details use onError. */
export type MapThemeChangeEvent = Readonly<{
  type: 'theme-change';
  generation: number;
  map: TileflowReady['map']['name'];
}> &
  (
    | Readonly<{phase: 'preloading' | 'applying'; targetTheme: MapTheme; currentTheme?: MapTheme}>
    | Readonly<{phase: 'ready'; currentTheme: MapTheme}>
    | Readonly<{phase: 'error'; targetTheme?: MapTheme; currentTheme?: MapTheme}>
  );

export type MapEventHandlers = Readonly<{
  onLoad?: (event: MapLoadEvent) => void;
  onError?: (event: MapErrorEvent) => void;
  onReadinessChange?: (event: MapReadinessChangeEvent) => void;
  onThemeChange?: (event: MapThemeChangeEvent) => void;
}>;

/** Common source/presentation/lifecycle pieces; MapProps adds camera ownership. */
export type MapBaseProps = MapSourceProps &
  MapPresentationProps &
  MapEventHandlers &
  Readonly<{ref?: Ref<MapRef>}>;

/** Canonical user-driven change only. Commands, renderer events and source generations stay private. */
export type MapViewChangeEvent = Readonly<{
  type: 'view-change';
  view: MapView;
}>;

/** The ownership mode is fixed for one mounted native instance. */
export type MapCameraProps =
  | Readonly<{
      view: MapView;
      initialView?: never;
      onViewChange: (event: MapViewChangeEvent) => void;
    }>
  | Readonly<{
      view?: never;
      initialView?: MapInitialViewInputs['view'];
      /** Observation alone does not make the camera controlled. */
      onViewChange?: (event: MapViewChangeEvent) => void;
    }>;

/** Complete Tileflow source, presentation, mount-stable camera and portable interaction inputs. */
export type MapProps<TAnnotation extends TileflowAnnotation = TileflowAnnotation> = MapBaseProps &
  MapCameraProps &
  MapInteractionProps<TAnnotation>;
