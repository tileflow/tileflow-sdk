import type {MapGeoJSONFeature, Map as MapLibreMap} from 'maplibre-gl';
import assert from 'node:assert/strict';
import test from 'node:test';
import {explainFeatureVisibility} from '../src/inspector/layers/explain';
import type {LayerRecord} from '../src/inspector/layers/model';

const map = {
  getZoom: () => 12.5,
  getGlobalState: () => ({}),
  getFeatureState: () => ({}),
} as unknown as MapLibreMap;
const layer: LayerRecord = {
  id: 'roads',
  type: 'line',
  index: 0,
  source: 'world',
  sourceLayer: 'roads',
  minzoom: 0,
  maxzoom: 24,
  paint: {},
  layout: {},
  contributions: [],
};
const feature = {
  id: 1,
  source: 'world',
  sourceLayer: 'roads',
  type: 'Feature',
  properties: {class: 'secondary'},
  geometry: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [1, 1],
    ],
  },
} as unknown as MapGeoJSONFeature;

test('explains a selected feature filter without treating an empty view as failure', () => {
  const filtered = {...layer, filter: ['==', ['get', 'class'], 'primary']};
  assert.equal(explainFeatureVisibility(map, filtered)[0].state, 'unknown');
  const evidence = explainFeatureVisibility(map, filtered, feature);
  assert.equal(evidence[0].state, 'warn');
  assert.match(evidence[0].value, /Does not match/);
  assert.match(evidence[0].value, /primary/);
  assert.equal(
    explainFeatureVisibility(
      map,
      {...filtered, filter: ['==', ['get', 'class'], 'secondary']},
      feature,
    )[0].state,
    'info',
  );
});

test('zero components are contextual and never claim the entire layer is invisible', () => {
  const transparent = {...layer, paint: {'line-opacity': 0}};
  const evidence = explainFeatureVisibility(map, transparent);
  assert.equal(evidence.length, 1);
  assert.match(evidence[0].value, /other components may still draw/);
  const dependent = {
    ...layer,
    paint: {'line-opacity': ['case', ['==', ['get', 'class'], 'secondary'], 0, 1]},
  };
  assert.deepEqual(explainFeatureVisibility(map, dependent), []);
  assert.equal(explainFeatureVisibility(map, dependent, feature).length, 1);
});

test('invalid rules and missing feature state cannot fabricate visibility evidence', () => {
  assert.deepEqual(
    explainFeatureVisibility(
      map,
      {...layer, paint: {'line-width': ['number', ['get', 'missing']]}},
      feature,
    ),
    [],
  );
  assert.deepEqual(
    explainFeatureVisibility(map, {
      ...layer,
      paint: {'line-opacity': ['coalesce', ['feature-state', 'opacity'], 0]},
    }),
    [],
  );
  assert.deepEqual(
    explainFeatureVisibility(map, {...layer, type: 'custom', paint: {'line-opacity': 0}}),
    [],
  );
});
