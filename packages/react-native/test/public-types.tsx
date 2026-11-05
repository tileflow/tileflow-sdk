import {createRef} from 'react';
import type {FeatureCollection} from 'geojson';
import {Camera, CircleLayer, GeoJSONSource, MapView, UserLocation} from '../src/index';
import type {CameraRef, GeoJSONSourceRef, MapViewRef} from '../src/index';

const points: FeatureCollection = {type: 'FeatureCollection', features: []};
export const map = createRef<MapViewRef>();
export const source = createRef<GeoJSONSourceRef>();
export const camera = createRef<CameraRef>();
export const example = (
  <MapView ref={map} source={{mapId: 'map_example'}}>
    <Camera ref={camera} zoomLevel={16} centerCoordinate={[-3.7, 40.4]} />
    <GeoJSONSource ref={source} id="places" shape={points} cluster clusterRadius={80}>
      <CircleLayer
        id="dots"
        style={{
          circleRadius: 8,
          circleColor: ['case', ['boolean', ['feature-state', 'selected'], false], '#f00', '#00f'],
        }}
      />
    </GeoJSONSource>
    <UserLocation
      visible={false}
      onUpdate={(location) => {
        void location.coords.longitude;
      }}
    />
  </MapView>
);
