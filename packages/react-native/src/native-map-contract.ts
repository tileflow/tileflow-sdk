import type {MapMethod} from './specs/NativeTileflowMapModule';

export type Coordinate = readonly [number, number];
export type ScreenPoint = readonly [number, number];
export type MapBounds = Readonly<{ne: Coordinate; sw: Coordinate}>;
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export type JsonObject = {readonly [key: string]: JsonValue};
export type StyleState = Readonly<Record<string, null | boolean | number | string>>;

export type MapSource =
  | Readonly<{mapId: string}>
  | Readonly<{
      map: string;
      manifestUrl: string;
      resourceOrigins?: readonly string[];
      allowsLoopbackHttp?: boolean;
    }>;

export type CameraPadding = Readonly<{
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
}>;

export type CameraStop = Readonly<{
  centerCoordinate?: Coordinate;
  zoomLevel?: number;
  heading?: number;
  pitch?: number;
  bounds?: MapBounds;
  padding?: CameraPadding;
  animationMode?: 'flyTo' | 'easeTo' | 'linearTo' | 'moveTo' | 'none';
  animationDuration?: number;
}>;

export type CameraState = Readonly<{
  properties: Readonly<{
    center: Coordinate;
    bounds: MapBounds;
    zoom: number;
    heading: number;
    pitch: number;
  }>;
  gestures: Readonly<{isGestureActive: boolean}>;
  timestamp: number;
}>;

export type NativeAppearance = Readonly<{
  theme?: string;
  timeOfDay?: 'day' | 'dawn' | 'dusk' | 'night';
  themeBlend?: Readonly<{from: string; to: string; mix: number}> | Readonly<{themes: readonly string[]; position: number; hold?: boolean}>;
  themeTransition?: Readonly<{duration: number}>;
  viewMode?: '2d' | '3d';
}>;

export type NativeMapOptions = Readonly<{
  surfaceId?: string;
  initialCamera?: CameraStop;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  scrollEnabled?: boolean;
  zoomEnabled?: boolean;
  rotateEnabled?: boolean;
  pitchEnabled?: boolean;
  compassEnabled?: boolean;
  scaleBarEnabled?: boolean;
  attributionPosition?: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
  contentInset?: CameraPadding;
  cameraLimits?: Readonly<{minZoomLevel?: number; maxZoomLevel?: number; maxBounds?: MapBounds}>;
  eventLevel?: 'essential' | 'camera' | 'continuous';
}>;

export type NativeLayerPosition = Readonly<{
  aboveLayerId?: string;
  belowLayerId?: string;
  index?: number;
  slot?: string;
}>;

export type NativeFeatureIdentifier = Readonly<{
  sourceId: string;
  sourceLayer?: string;
  featureId: string;
}>;

export type NativeQueryGeometry =
  | Readonly<{type: 'point'; point: ScreenPoint}>
  | Readonly<{type: 'box'; box: readonly [number, number, number, number]}>
  | Readonly<{type: 'polygon'; points: readonly ScreenPoint[]}>
  | Readonly<{type: 'view'}>;

export type NativeImage = Readonly<{
  id: string;
  uri: string;
  sdf?: boolean;
  scale?: number;
  variants?: Readonly<Record<string, string>>;
}>;

export type NativePointAnnotation = Readonly<{
  id: string;
  coordinate: Coordinate;
  iconImage?: string;
  iconSize?: number;
  iconRotate?: number;
  iconColor?: string;
  draggable?: boolean;
  accessibilityLabel?: string;
}>;

export type NativeMarkerOptions = Readonly<{
  coordinate: Coordinate;
  anchor?: Readonly<{x: number; y: number}>;
  offset?: ScreenPoint;
  allowOverlap?: boolean;
  isSelected?: boolean;
  priority?: number;
}>;

export type NativeUserLocation = Readonly<{
  visible: boolean;
  showsUserHeadingIndicator?: boolean;
  followsCourse?: boolean;
  followUserLocation?: boolean;
  followUserMode?: 'normal' | 'compass' | 'course';
  followZoomLevel?: number;
  followPitch?: number;
  followPadding?: CameraPadding;
  emitsUpdates?: boolean;
}>;

/** JSON objects consumed by both native adapters. Durations and timestamps use milliseconds. */
export type MapCommandPayloads = {
  getCamera: Record<string, never>;
  setCamera: CameraStop;
  stopCamera: Record<string, never>;
  cameraForBounds: Readonly<{
    bounds: MapBounds;
    padding?: CameraPadding;
    heading?: number;
    pitch?: number;
  }>;
  getVisibleBounds: Record<string, never>;
  project: Readonly<{coordinate: Coordinate}>;
  unproject: Readonly<{point: ScreenPoint}>;
  addSource: Readonly<{id: string; properties: JsonObject}>;
  updateSource: Readonly<{id: string; properties: JsonObject}>;
  removeSource: Readonly<{id: string}>;
  setGeoJSONSourceData: Readonly<{id: string; data: JsonObject | string}>;
  updateGeoJSONSource: Readonly<{
    id: string;
    update: Readonly<{
      add?: readonly JsonObject[];
      update?: readonly JsonObject[];
      remove?: readonly string[];
    }>;
  }>;
  addLayer: Readonly<{properties: JsonObject; position?: NativeLayerPosition}>;
  updateLayer: Readonly<{properties: JsonObject}>;
  moveLayer: Readonly<{id: string; position: NativeLayerPosition}>;
  removeLayer: Readonly<{id: string}>;
  setFeatureState: NativeFeatureIdentifier & Readonly<{state: StyleState}>;
  getFeatureState: NativeFeatureIdentifier;
  removeFeatureState: NativeFeatureIdentifier & Readonly<{key?: string}>;
  queryRenderedFeatures: Readonly<{
    geometry: NativeQueryGeometry;
    layerIds?: readonly string[];
    filter?: JsonValue;
  }>;
  querySourceFeatures: Readonly<{sourceId: string; sourceLayer?: string; filter?: JsonValue}>;
  getClusterChildren: Readonly<{sourceId: string; clusterId: number}>;
  getClusterLeaves: Readonly<{
    sourceId: string;
    clusterId: number;
    limit?: number;
    offset?: number;
  }>;
  getClusterExpansionZoom: Readonly<{sourceId: string; clusterId: number}>;
  setImages: Readonly<{images: readonly NativeImage[]}>;
  setBoundaryValues: Readonly<{values: JsonObject | null}>;
  setStyleState: Readonly<{state: StyleState}>;
  setEmphasis: Readonly<{emphasis: JsonObject | null; duration?: number}>;
  setSun: Readonly<{sun: JsonObject | null; duration?: number}>;
  setDepthMarkers: Readonly<{markers: readonly JsonObject[]}>;
  getRouteInks: Record<string, never>;
  animateLineProgress: Readonly<{layers: readonly string[]; to: JsonObject; duration: number}>;
  playShot: Readonly<{shot: JsonObject}>;
  stopAnimation: Record<string, never>;
  setPointAnnotations: Readonly<{annotations: readonly NativePointAnnotation[]}>;
  requestLocationPermission: Record<string, never>;
  setUserLocation: NativeUserLocation;
  reload: Record<string, never>;
};

export type MapCommand = <M extends MapMethod>(
  method: M,
  payload: MapCommandPayloads[M],
) => Promise<unknown>;
