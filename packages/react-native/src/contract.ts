import type {ReactNode} from 'react';
import type {ViewProps} from 'react-native';
import type {MapErrorEvent} from './map-error';
import type {
  CameraPadding,
  CameraState,
  CameraStop,
  Coordinate,
  JsonObject,
  JsonValue,
  MapBounds,
  MapSource,
  NativeAppearance,
  NativeImage,
  NativeMapOptions,
  NativePointAnnotation,
  NativeUserLocation,
  ScreenPoint,
  StyleState,
} from './native-map-contract';

export type {
  CameraPadding,
  CameraState,
  CameraStop,
  Coordinate,
  MapBounds,
  MapSource,
  ScreenPoint,
  StyleState,
};
export type {MapErrorEvent};
export type Expression = readonly JsonValue[];
export type Feature = import('geojson').Feature;
export type FeatureCollection = import('geojson').FeatureCollection;
export type MapPressEvent = Readonly<{
  type: 'Feature';
  geometry: Readonly<{type: 'Point'; coordinates: Coordinate}>;
  properties: Readonly<{screenPointX: number; screenPointY: number}>;
}>;
export type AnnotationEvent = Readonly<{
  type: 'Feature';
  id: string;
  geometry: Readonly<{type: 'Point'; coordinates: Coordinate}>;
  properties: Readonly<{id: string}>;
}>;
export type PoiEvent = Readonly<{
  id?: string;
  coordinate: Coordinate;
  name?: string;
  category: string;
}>;
export type MapWarningEvent = MapErrorEvent & Readonly<{occurrences?: number}>;
export type LocationPermission = Readonly<{
  authorization: 'notDetermined' | 'denied' | 'restricted' | 'whenInUse' | 'always';
  accuracy: 'full' | 'reduced';
}>;
export type LocationEvent = Readonly<{
  coords: Readonly<{
    longitude: number;
    latitude: number;
    accuracy: number;
    altitude?: number;
    heading?: number;
    speed?: number;
  }>;
  timestamp: number;
}>;
export type FeatureIdentifier = Readonly<{
  sourceID: string;
  sourceLayerID?: string;
  id: string | number;
}>;
export type BoundaryValues = (
  | Readonly<{ids: Readonly<Record<string, number | string>>; refs?: never}>
  | Readonly<{refs: Readonly<Record<string, number | string>>; ids?: never}>
) &
  Readonly<{
    labels?: boolean;
    state?: string;
  }>;
export type MapSun =
  Readonly<{azimuth: number; altitude: number}> | Readonly<{date: number; location?: Coordinate}>;
export type DepthMarker = Readonly<{
  id: string;
  coordinate: Coordinate;
  image: string;
  size: readonly [number, number];
  alignment?: 'screen' | 'ground';
  anchor?: 'center' | 'bottom';
  offset?: ScreenPoint;
  rotation?: number;
  altitude?: number;
  opacity?: number;
  occluded?: boolean;
}>;
export type MapEmphasis = Readonly<{
  recede?: Readonly<Record<string, number>>;
  labels?: number;
  keepArea?: JsonObject;
}>;
export type MapShot = Readonly<{
  keyframes: readonly Readonly<{
    time: number;
    camera: Readonly<{
      centerCoordinate: Coordinate;
      zoomLevel: number;
      heading?: number;
      pitch?: number;
    }>;
    blendPosition?: number;
  }>[];
  themes?: readonly string[];
  easing?: 'linear' | 'smooth';
  cues?: readonly Readonly<{time: number; id: string}>[];
}>;

export type MapViewProps = ViewProps &
  NativeAppearance &
  Omit<NativeMapOptions, 'initialCamera' | 'cameraLimits' | 'eventLevel' | 'contentInset'> & {
    source: MapSource;
    children?: ReactNode;
    contentInset?: number | readonly number[] | CameraPadding;
    boundaryValues?: BoundaryValues | null;
    styleState?: StyleState;
    sun?: MapSun | null;
    emphasis?: MapEmphasis | null;
    onPress?: (event: MapPressEvent) => void;
    onLongPress?: (event: MapPressEvent) => void;
    onPoiPress?: (event: PoiEvent) => void;
    onCameraChanged?: (event: CameraState) => void;
    onMapIdle?: (event: CameraState) => void;
    onWillStartLoadingMap?: () => void;
    onDidFinishLoadingMap?: () => void;
    onMapLoadingError?: (event: MapErrorEvent) => void;
    onWarning?: (event: MapWarningEvent) => void;
    onThemeChange?: (theme: string) => void;
    onThemeTransition?: (event: JsonObject) => void;
    onOpenURL?: (url: string) => void;
    onUserTrackingModeChange?: (event: JsonObject) => void;
  };

export interface MapViewRef {
  getPointInView(coordinate: Coordinate): Promise<ScreenPoint>;
  getCoordinateFromView(point: ScreenPoint): Promise<Coordinate>;
  getVisibleBounds(): Promise<readonly [Coordinate, Coordinate]>;
  getCenter(): Promise<Coordinate>;
  getZoom(): Promise<number>;
  queryRenderedFeaturesAtPoint(
    point: ScreenPoint,
    filter?: Expression,
    layerIDs?: readonly string[],
  ): Promise<FeatureCollection>;
  queryRenderedFeaturesInRect(
    box: readonly [number, number, number, number],
    filter?: Expression,
    layerIDs?: readonly string[],
  ): Promise<FeatureCollection>;
  queryRenderedFeaturesInPolygon(
    points: readonly ScreenPoint[],
    filter?: Expression,
    layerIDs?: readonly string[],
  ): Promise<FeatureCollection>;
  querySourceFeatures(
    sourceId: string,
    options?: Readonly<{sourceLayerID?: string; filter?: Expression}>,
  ): Promise<FeatureCollection>;
  setFeatureState(feature: FeatureIdentifier, state: StyleState): Promise<void>;
  getFeatureState(feature: FeatureIdentifier): Promise<StyleState>;
  removeFeatureState(feature: FeatureIdentifier, key?: string): Promise<void>;
  setBoundaryValues(values: BoundaryValues | null): Promise<void>;
  setStyleState(state: StyleState): Promise<void>;
  setSun(sun: MapSun | null, duration?: number): Promise<void>;
  setDepthMarkers(markers: readonly DepthMarker[]): Promise<void>;
  setEmphasis(emphasis: MapEmphasis | null, duration?: number): Promise<void>;
  getRouteInks(): Promise<JsonObject>;
  animateLineProgress(
    layers: readonly string[],
    to: JsonObject,
    duration: number,
  ): Promise<boolean>;
  playShot(shot: MapShot): Promise<boolean>;
  stopAnimation(): Promise<void>;
  requestLocationPermission(): Promise<LocationPermission>;
  reload(): Promise<void>;
}

export type CameraProps = CameraStop &
  Pick<
    NativeUserLocation,
    'followUserLocation' | 'followUserMode' | 'followZoomLevel' | 'followPitch' | 'followPadding'
  > & {
    defaultSettings?: CameraStop;
    minZoomLevel?: number;
    maxZoomLevel?: number;
    maxBounds?: MapBounds;
  };
export interface CameraRef {
  setCamera(settings: CameraStop): Promise<void>;
  fitBounds(
    ne: Coordinate,
    sw: Coordinate,
    paddingConfig?: number | readonly number[] | CameraPadding,
    animationDuration?: number,
  ): Promise<void>;
  flyTo(centerCoordinate: Coordinate, animationDuration?: number): Promise<void>;
  moveTo(centerCoordinate: Coordinate, animationDuration?: number): Promise<void>;
  zoomTo(zoomLevel: number, animationDuration?: number): Promise<void>;
  stop(): Promise<void>;
}
export type PointAnnotationProps = NativePointAnnotation & {
  onSelected?: (event: AnnotationEvent) => void;
  onDragStart?: (event: AnnotationEvent) => void;
  onDrag?: (event: AnnotationEvent) => void;
  onDragEnd?: (event: AnnotationEvent) => void;
};
export type UserLocationProps = Partial<
  Pick<NativeUserLocation, 'visible' | 'showsUserHeadingIndicator'>
> & {
  onUpdate?: (event: LocationEvent) => void;
};
export interface UserLocationRef {
  requestPermission(): Promise<LocationPermission>;
}
export type ImageEntry = Omit<NativeImage, 'id' | 'uri' | 'variants'> & {
  source: number | Readonly<{uri: string}>;
  variants?: Readonly<Record<string, number | Readonly<{uri: string}>>>;
};
