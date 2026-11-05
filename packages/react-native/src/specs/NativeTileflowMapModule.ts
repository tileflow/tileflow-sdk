import type {CodegenTypes, TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export type MapMethod =
  | 'getCamera'
  | 'setCamera'
  | 'stopCamera'
  | 'cameraForBounds'
  | 'getVisibleBounds'
  | 'project'
  | 'unproject'
  | 'addSource'
  | 'updateSource'
  | 'removeSource'
  | 'setGeoJSONSourceData'
  | 'updateGeoJSONSource'
  | 'addLayer'
  | 'updateLayer'
  | 'moveLayer'
  | 'removeLayer'
  | 'setFeatureState'
  | 'getFeatureState'
  | 'removeFeatureState'
  | 'queryRenderedFeatures'
  | 'querySourceFeatures'
  | 'getClusterChildren'
  | 'getClusterLeaves'
  | 'getClusterExpansionZoom'
  | 'setImages'
  | 'setBoundaryValues'
  | 'setStyleState'
  | 'setEmphasis'
  | 'setSun'
  | 'setDepthMarkers'
  | 'getRouteInks'
  | 'animateLineProgress'
  | 'playShot'
  | 'stopAnimation'
  | 'setPointAnnotations'
  | 'requestLocationPermission'
  | 'setUserLocation'
  | 'reload';

export interface Spec extends TurboModule {
  call(
    reactTag: CodegenTypes.Double,
    instanceId: string,
    method: MapMethod,
    payload: string,
  ): Promise<string>;
}

export default function nativeTileflowMap(): Spec | null {
  return TurboModuleRegistry.get<Spec>('TileflowMapModule');
}
