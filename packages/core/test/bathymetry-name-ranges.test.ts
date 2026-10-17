import {createExpression, validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bathymetry,
  createStyle,
  disable,
  parseTileflowMap,
  type TileflowSymbolStyle,
  water,
} from '../src';
import {extendStreets} from './map-fixture';

function preciseMap(
  ranges = [
    {minZoom: 7.6, maxZoom: 10},
    {minZoom: 1, maxZoom: 6.5},
  ],
  style: TileflowSymbolStyle = {},
) {
  const options = {
    vectorLayers: {
      landforms: {zoomRanges: [{minZoom: 0, maxZoom: 24}]},
      waterNames: {zoomRanges: ranges},
    },
  };

  return extendStreets({
    marine: {bathymetry: bathymetry(options), nautical: false},
    modules: {poi: disable(), water: water({bathymetryWaterNames: style})},
  });
}

function selects(
  layer: Record<string, unknown>,
  properties: Record<string, unknown>,
  type: 1 | 2 | 3 = 1,
) {
  const compiled = createExpression(layer.filter as never);
  assert.equal(compiled.result, 'success');
  if (compiled.result !== 'success') throw new Error('Invalid expression');

  return compiled.value.evaluate({zoom: 0}, {type, properties});
}

function draws(layer: Record<string, unknown>, properties: Record<string, unknown>, zoom: number) {
  return (
    zoom >= Number(layer.minzoom ?? 0) &&
    zoom < Number(layer.maxzoom ?? 24) &&
    selects(layer, properties)
  );
}

test('exhaustive source ranges compile to exact fractional renderer layer boundaries', () => {
  const style = createStyle(preciseMap());
  const layers = style.layers.filter(
    (layer) => layer.source === 'tileflow-bathymetry' && layer['source-layer'] === 'water_name',
  );
  const feature = {name: 'Alboran Sea', min_zoom: 7.6, max_zoom: 10};

  assert.equal(layers.length, 2);
  assert.equal(layers.filter((layer) => draws(layer, feature, 7.5)).length, 0);
  assert.equal(layers.filter((layer) => draws(layer, feature, 7.6)).length, 1);
  assert.equal(layers.filter((layer) => draws(layer, feature, 7.7)).length, 1);
  assert.equal(layers.filter((layer) => draws(layer, feature, 9.99)).length, 1);
  assert.equal(layers.filter((layer) => draws(layer, feature, 10)).length, 0);
  assert.deepEqual(
    layers.map(({minzoom, maxzoom}) => [minzoom, maxzoom]),
    [
      [1, 6.5],
      [7.6, 10],
    ],
  );
  const detail = layers.find((layer) => layer.minzoom === 7.6)!;
  assert.equal(selects(detail, feature, 2), true);
  assert.equal(selects(detail, feature, 3), true);
  assert.deepEqual(validateStyleMin(style as never), []);

  const reordered = createStyle(
    preciseMap([
      {minZoom: 1, maxZoom: 6.5},
      {minZoom: 7.6, maxZoom: 10},
    ]),
  );
  assert.deepEqual(style, reordered);
});

test('unlisted pairs fail closed and source range defaults match missing, null and invalid fields', () => {
  const style = createStyle(preciseMap());
  const waterNames = style.layers.filter(
    (layer) => layer.source === 'tileflow-bathymetry' && layer['source-layer'] === 'water_name',
  );
  const landforms = style.layers.filter((layer) => layer['source-layer'] === 'seafloor_landform');

  for (const properties of [
    {name: 'Not declared', min_zoom: 7.7, max_zoom: 10},
    {name: 'Not declared', min_zoom: 7.6, max_zoom: 11},
    {name: 'Not declared'},
  ])
    assert.equal(
      waterNames.some((layer) => selects(layer, properties)),
      false,
    );

  for (const properties of [
    {name: 'Unqualified range'},
    {name: 'Null range', min_zoom: null, max_zoom: null},
    {name: 'Invalid range', min_zoom: 'invalid', max_zoom: 'invalid'},
  ]) {
    assert.equal(landforms.length, 1);
    assert.equal(draws(landforms[0]!, properties, 0), true);
    assert.equal(draws(landforms[0]!, properties, 23.99), true);
    assert.equal(draws(landforms[0]!, properties, 24), false);
  }
});

test('fractional source cohorts intersect the resolved symbol style range', () => {
  const style = createStyle(preciseMap(undefined, {minZoom: 8.25, maxZoom: 9.75}));
  const layers = style.layers.filter(
    (layer) => layer.source === 'tileflow-bathymetry' && layer['source-layer'] === 'water_name',
  );

  assert.equal(layers.length, 1);
  assert.equal(layers[0]?.minzoom, 8.25);
  assert.equal(layers[0]?.maxzoom, 9.75);
  assert.equal(selects(layers[0]!, {name: 'Alboran Sea', min_zoom: 7.6, max_zoom: 10}), true);
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('overlapping ranges stay disjoint and the full range budget compiles without order collisions', () => {
  const style = createStyle(
    preciseMap([
      {minZoom: 1, maxZoom: 10},
      {minZoom: 7.6, maxZoom: 10},
    ]),
  );
  const layers = style.layers.filter(
    (layer) => layer.source === 'tileflow-bathymetry' && layer['source-layer'] === 'water_name',
  );
  assert.equal(
    layers.filter((layer) => draws(layer, {name: 'Sea', min_zoom: 7.6, max_zoom: 10}, 8)).length,
    1,
  );

  const maximum = createStyle(
    preciseMap(Array.from({length: 128}, (_, i) => ({minZoom: i / 10, maxZoom: 24}))),
  );
  const maximumLayers = maximum.layers.filter(
    (layer) => layer.source === 'tileflow-bathymetry' && layer['source-layer'] === 'water_name',
  );
  assert.equal(maximumLayers.length, 128);
  assert.equal(new Set(maximumLayers.map(({id}) => id)).size, 128);
  assert.deepEqual(validateStyleMin(maximum as never), []);
});

test('range inventories reject empty, duplicate, invalid and oversized declarations', () => {
  for (const ranges of [
    [],
    [{minZoom: 3, maxZoom: 3}],
    [{minZoom: 4, maxZoom: 3}],
    [{minZoom: -0.1, maxZoom: 3}],
    [{minZoom: 0, maxZoom: 24.1}],
    [{minZoom: 0, maxZoom: Infinity}],
    [
      {minZoom: 1, maxZoom: 3},
      {minZoom: 1, maxZoom: 3},
    ],
    Array.from({length: 129}, (_, i) => ({minZoom: i / 10, maxZoom: 24})),
  ])
    assert.throws(() => parseTileflowMap(preciseMap(ranges)));
});
