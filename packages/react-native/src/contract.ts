import type {MapProps as NativeMapProps} from '@maplibre/maplibre-react-native';
import type {ReactNode, Ref} from 'react';
import type {ViewProps} from 'react-native';
import type {
  TileflowNativeInitialView,
  TileflowNativeInitialViewOptions,
  TileflowNativeSource,
  TileflowNativeSourceError,
  TileflowNativeSourceOptions,
  TileflowNativeSourceState,
} from '@tileflow/core/native';

export type MapSource = TileflowNativeSource;
export type MapThemeSelection = NonNullable<TileflowNativeSourceOptions['theme']>;
export type MapColorScheme = NonNullable<TileflowNativeSourceOptions['colorScheme']>;
export type MapView = TileflowNativeInitialView;
/** Portable composition inputs, independent from source acquisition. */
export type MapInitialViewInputs = TileflowNativeInitialViewOptions;

export type MapSourceProps =
  | Readonly<{source: Extract<MapSource, {kind: 'tileflow'}>; theme?: MapThemeSelection}>
  | Readonly<{source: Extract<MapSource, {kind: 'maplibre'}>; theme?: never}>;

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
}>;

type TileflowReady = Extract<TileflowNativeSourceState, {status: 'ready'; kind: 'tileflow'}>;
export type MapTheme = Readonly<Pick<TileflowReady['theme'], 'name' | 'colorScheme'>>;
export type MapSourceError = Readonly<Pick<TileflowNativeSourceError, 'code' | 'field' | 'kind'>>;

/** Safe identity only: no URL, style body, credentials or native object. */
export type MapSelection =
  | Readonly<{kind: 'tileflow'; map: TileflowReady['map']['name']; theme: MapTheme}>
  | Readonly<{kind: 'maplibre'}>;

/** Source readiness is not renderer/frame readiness. */
export type MapSourceState =
  | Readonly<{status: 'loading'; generation: number}>
  | (Readonly<{status: 'ready'; generation: number}> & MapSelection)
  | Readonly<{status: 'error'; generation: number; error: MapSourceError}>;

/** A synchronous read of the last source snapshot. Does not trigger loading or native commands. */
export type MapRef = Readonly<{
  getSourceState(): MapSourceState | undefined;
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
  | Readonly<{type: 'renderer-error'; generation: number}>;

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

/** Type contract only; this package does not export a Map component. */
export type MapProps = MapBaseProps & MapCameraProps;
