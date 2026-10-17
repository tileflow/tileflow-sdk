import type {MapGeoJSONFeature, Map as MapLibreMap, StyleSpecification} from 'maplibre-gl';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  labelSizeSample,
  sampledTextSize,
  scaleContinuitySample,
} from '../src/devtools/beacon/quality';
import {sampleLabels} from '../src/devtools/beacon/runner';

const camera = {center: [0, 0] as [number, number], zoom: 14, bearing: 0, pitch: 0};

test('label sampling shares the budget across dense POIs, roads and place layers', () => {
  const layers = ['poi', 'roads', 'places'].map((id) => ({
    id,
    type: 'symbol',
    layout: {'text-field': ['get', 'name']},
  }));
  const features = layers.flatMap((layer, i) =>
    Array.from({length: i === 0 ? 200 : 1}, (_, id) => ({
      id,
      layer,
      properties: {name: `${layer.id}-${id}`},
      geometry: {type: 'Point', coordinates: [0, 0]},
    })),
  );
  const map = {
    getStyle: () => ({layers}),
    getCenter: () => ({lng: 0, lat: 0}),
    getZoom: () => 14,
    getBearing: () => 0,
    getPitch: () => 45,
    queryRenderedFeatures: () => features,
    getLayer: (id: string) => layers.find((l) => l.id === id),
    listImages: () => [],
    getPaintProperty: () => undefined,
    getLayoutProperty: (_: string, name: string) =>
      name === 'text-field' ? ['get', 'name'] : name === 'text-size' ? 12 : undefined,
  } as unknown as MapLibreMap;
  assert.deepEqual(
    sampleLabels(map, 3).map((s) => s.layer),
    ['poi', 'roads', 'places'],
  );
});
function measure(
  width: unknown,
  properties: Record<string, unknown>[] = [{}],
  minzoom = 0,
  opacity: unknown = 1,
) {
  const layer = {
    id: 'roads',
    type: 'line',
    source: 'roads',
    minzoom,
    paint: {'line-width': width, 'line-opacity': opacity},
  };
  const style = {version: 8, sources: {}, layers: [layer]} as unknown as StyleSpecification;
  const map = {
    getMinZoom: () => 0,
    getMaxZoom: () => 22,
    getZoom: () => camera.zoom,
    getLayer: () => layer,
    getFeatureState: () => ({}),
    listImages: () => [],
    getPaintProperty: (_: string, name: keyof typeof layer.paint) => layer.paint[name],
  } as unknown as MapLibreMap;
  const features = properties.map((p, id) => ({
    id,
    source: 'roads',
    properties: p,
    layer,
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
  })) as unknown as MapGeoJSONFeature[];
  return scaleContinuitySample(map, style, features, camera);
}

test('label budget reports actual counts, excludes unknown size and retains small-label evidence', () => {
  const sample = labelSizeSample(
    [8, 9.9, 10, 16, undefined, NaN, 0].map((size) => ({
      size,
      message: 'Label',
      layer: 'places',
      background: '',
    })),
  );
  assert.deepEqual([sample.passed, sample.total, sample.skipped], [2, 4, 3]);
  assert.match(sample.findings[0].message, /8.00 CSS px/);
  assert.equal(labelSizeSample([]).total, 0);
});

test('constant widths and continuous physical doubling are not false positive zoom jumps', () => {
  for (const width of [2, ['interpolate', ['exponential', 2], ['zoom'], 0, 1, 20, 1048576]]) {
    const sample = measure(width);
    assert.deepEqual([sample.passed, sample.total, sample.skipped], [1, 1, 0]);
    assert.deepEqual(sample.findings, []);
  }
});

test('fractional zoom steps in either direction produce exact layer, zoom and size evidence', () => {
  for (const [before, after] of [
    [2, 6],
    [6, 2],
  ]) {
    const sample = measure(['step', ['zoom'], before, 12.5, after]);
    assert.deepEqual([sample.passed, sample.total, sample.skipped], [0, 1, 0]);
    assert.equal(sample.findings[0].camera?.zoom, 12.5);
    assert.equal(sample.findings[0].layer, 'roads');
    assert.match(sample.findings[0].message, new RegExp(`${before}.00 → ${after}.00`));
  }
});

test('small steps and changes at layer entry do not fail the continuity budget', () => {
  for (const width of [
    ['step', ['zoom'], 1, 12.5, 1.9],
    ['step', ['zoom'], 10, 12.5, 12],
  ])
    assert.equal(measure(width).passed, 1);
  assert.equal(measure(['step', ['zoom'], 2, 12.5, 6], [{}], 12.5).passed, 1);
  assert.equal(
    measure(['step', ['zoom'], 2, 12.5, 6], [{}], 0, ['step', ['zoom'], 0, 13, 1]).passed,
    1,
  );
});

test('missing feature-dependent text sizes do not become default-size passes', () => {
  const map = {
    getZoom: () => 14,
    getLayoutProperty: () => ['number', ['get', 'size']],
  } as unknown as MapLibreMap;
  const feature = {
    layer: {id: 'places'},
    geometry: {type: 'Point'},
    properties: {},
  } as unknown as MapGeoJSONFeature;
  assert.equal(sampledTextSize(map, feature), undefined);
  feature.properties.size = 8;
  assert.equal(sampledTextSize(map, feature), 8);
});

test('feature-dependent rules use feature data and never pass on evaluation defaults', () => {
  const width = [
    'step',
    ['zoom'],
    ['number', ['get', 'width']],
    12.5,
    ['*', 2, ['number', ['get', 'width']]],
  ];
  const good = measure(width, [{width: 0.5}]);
  assert.equal(good.passed, 1);
  const bad = measure(width, [{width: 3}]);
  assert.equal(bad.total, 1);
  assert.equal(bad.passed, 0);
  const missing = measure(width, [{}]);
  assert.equal(missing.total, 0);
  assert.equal(missing.skipped, 1);
  const partial = measure(width, [{width: 0.5}, {}]);
  assert.equal(partial.total, 0);
  const proven = measure(width, [{width: 3}, {}]);
  assert.equal(proven.total, 1);
  assert.equal(proven.passed, 0);
});

test('absent, hidden, invalid and excessively large rules do not manufacture passing samples', () => {
  assert.equal(measure(2, []).total, 0);
  assert.equal(measure(2, [{}], 0, 0).total, 0);
  assert.equal(measure(2, [{}], 0, ['number', ['get', 'missing-opacity']]).total, 0);
  assert.equal(measure(['invalid-expression']).total, 0);
  const oversized = [
    'step',
    ['zoom'],
    2,
    ...Array.from({length: 130}, (_, i) => [i / 10, i + 1]).flat(),
  ];
  assert.equal(measure(oversized).total, 0);
});
