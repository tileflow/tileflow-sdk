import {createRef} from 'react';
import type {FeatureCollection} from 'geojson';
import {Camera, CircleLayer, GeoJSONSource, MapView, UserLocation} from '../src/index';
import type {CameraRef, GeoJSONSourceRef, MapViewRef} from '../src/index';
import {createBoundaryLookup, joinBoundaryRows} from '../src/index';

export async function updateBoundaryValues(view: MapViewRef) {
  const result = await view.joinBoundaryRows([{key: 'ES-MD', value: 8}], {
    joinBy: 'iso_3166_2',
    classes: ['region'],
  });
  await view.setBoundaryValues(result);

  const prepared = joinBoundaryRows([{key: 'Q5756', value: null}], {
    joinBy: 'wikidata',
    lookup: createBoundaryLookup([{id: 41, class: 'region', wikidata: 'Q5756'}]),
  });
  await view.setBoundaryValues(prepared);
}

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
