import {boundaryValuesInput} from './boundary-input';
import type {
  FeatureCollection,
  FeatureIdentifier,
  LocationPermission,
  MapViewRef,
} from './contract';
import type {TileflowBoundaryJoinResult} from './generated/boundary-join';
import type {MapController} from './map-controller';
import {TileflowMapError} from './map-error';
import type {
  CameraStop,
  Coordinate,
  JsonObject,
  MapBounds,
  NativeFeatureIdentifier,
  ScreenPoint,
  StyleState,
} from './native-map-contract';
import type {StyleRegistry} from './style-registry';

function feature(value: FeatureIdentifier): NativeFeatureIdentifier {
  if (typeof value.id === 'number' && !Number.isSafeInteger(value.id))
    throw new TileflowMapError({
      code: 'invalidRequest',
      message: 'Feature identifiers must be strings or safe integers.',
      recoverable: false,
    });
  return {
    sourceId: value.sourceID,
    featureId: String(value.id),
    ...(value.sourceLayerID ? {sourceLayer: value.sourceLayerID} : {}),
  };
}

function collection(value: unknown): FeatureCollection {
  if (!Array.isArray(value))
    throw new TileflowMapError({
      code: 'rendererFailed',
      message: 'The native map returned an invalid feature collection.',
      recoverable: true,
    });
  return {type: 'FeatureCollection', features: value};
}

export function createMapRef(map: MapController, style: StyleRegistry): MapViewRef {
  return {
    joinBoundaryRows: async (rows, options) => {
      const {lookup, ...configuration} = options;
      return (await map.call('joinBoundaryRows', {
        rows,
        options: {...configuration, ...(lookup ? {lookup: {rows: lookup.rows}} : {})},
      })) as TileflowBoundaryJoinResult;
    },
    getPointInView: async (coordinate) => (await map.call('project', {coordinate})) as ScreenPoint,
    getCoordinateFromView: async (point) => (await map.call('unproject', {point})) as Coordinate,
    getVisibleBounds: async () => {
      const bounds = (await map.call('getVisibleBounds', {})) as MapBounds;
      return [bounds.ne, bounds.sw];
    },
    getCenter: async () => ((await map.call('getCamera', {})) as CameraStop).centerCoordinate!,
    getZoom: async () => ((await map.call('getCamera', {})) as CameraStop).zoomLevel!,
    queryRenderedFeaturesAtPoint: async (point, filter, layerIds) => {
      await style.synchronize();
      return collection(
        await map.call('queryRenderedFeatures', {
          geometry: {type: 'point', point},
          ...(filter ? {filter} : {}),
          ...(layerIds ? {layerIds} : {}),
        }),
      );
    },
    queryRenderedFeaturesInRect: async (box, filter, layerIds) => {
      await style.synchronize();
      return collection(
        await map.call('queryRenderedFeatures', {
          geometry: {type: 'box', box},
          ...(filter ? {filter} : {}),
          ...(layerIds ? {layerIds} : {}),
        }),
      );
    },
    queryRenderedFeaturesInPolygon: async (points, filter, layerIds) => {
      await style.synchronize();
      return collection(
        await map.call('queryRenderedFeatures', {
          geometry: {type: 'polygon', points},
          ...(filter ? {filter} : {}),
          ...(layerIds ? {layerIds} : {}),
        }),
      );
    },
    querySourceFeatures: async (sourceId, options) => {
      await style.synchronize();
      return collection(
        await map.call('querySourceFeatures', {
          sourceId,
          ...(options?.sourceLayerID ? {sourceLayer: options.sourceLayerID} : {}),
          ...(options?.filter ? {filter: options.filter} : {}),
        }),
      );
    },
    setFeatureState: async (target, state) => {
      await style.synchronize();
      await map.call('setFeatureState', {...feature(target), state});
    },
    getFeatureState: async (target) => {
      await style.synchronize();
      return (await map.call('getFeatureState', feature(target))) as StyleState;
    },
    removeFeatureState: async (target, key) => {
      await style.synchronize();
      await map.call('removeFeatureState', {...feature(target), ...(key ? {key} : {})});
    },
    setBoundaryValues: async (values) => {
      await map.call('setBoundaryValues', {values: boundaryValuesInput(values)});
    },
    setStyleState: async (state) => {
      await map.call('setStyleState', {state});
    },
    setDepthMarkers: async (markers) => {
      await map.call('setDepthMarkers', {markers});
    },
    setSun: async (sun, duration) => {
      await map.call('setSun', {
        sun: sun as JsonObject | null,
        ...(duration === undefined ? {} : {duration}),
      });
    },
    setEmphasis: async (emphasis, duration) => {
      await map.call('setEmphasis', {
        emphasis: emphasis as JsonObject | null,
        ...(duration === undefined ? {} : {duration}),
      });
    },
    getRouteInks: async () => (await map.call('getRouteInks', {})) as JsonObject,
    animateLineProgress: async (layers, to, duration) =>
      (await map.call('animateLineProgress', {layers, to, duration})) as boolean,
    playShot: async (shot) => (await map.call('playShot', {shot: shot as JsonObject})) as boolean,
    stopAnimation: async () => {
      await map.call('stopAnimation', {});
    },
    requestLocationPermission: async () =>
      (await map.call('requestLocationPermission', {})) as LocationPermission,
    reload: async () => {
      await map.call('reload', {});
    },
  };
}
