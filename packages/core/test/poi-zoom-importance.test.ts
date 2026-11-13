import {
  createExpression,
  createPropertyExpression,
  featureFilter,
  latest,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {parseTileflowMap, poi, resolveTileflowData} from '../src';
import {compilePoi} from '../src/modules/poi/compiler';
import {resolveColors} from '../src/themes';
import {extendStreets} from './map-fixture';

const context = {
  colors: resolveColors(),
  data: resolveTileflowData(undefined),
  images: {},
  typography: {
    font: 'Noto Sans Regular',
    places: {font: 'Noto Sans Regular'},
    roads: {font: 'Noto Sans Regular'},
    water: {font: 'Noto Sans Regular'},
    poi: {font: 'Noto Sans Regular'},
  },
};
const candidate = {
  class: 'landmark',
  type: 'monument',
  name: 'Destination',
  filterrank: 5,
  sizerank: 16,
};

test('type zoom gates apply to every representation and do not override density or type caps', () => {
  for (const order of ['importance', 'categories'] as const)
    for (const coupleIconAndLabel of [true, false]) {
      const layers = compilePoi(
        poi({
          density: 3,
          minZoomByType: {public_restroom: 17, bus_stop: 17},
          maxRankByType: {garden: 1},
          placement: {order, coupleIconAndLabel},
          styles: {landmark: {marker: {radius: 4}}},
        }),
        context,
        'en',
      );
      const accepts = (zoom: number, properties: Record<string, unknown>) =>
        layers.some(({layer}) =>
          featureFilter(layer.filter as never).filter(
            {zoom},
            {type: 1, properties: {...candidate, ...properties}},
          ),
        );
      assert.equal(accepts(16.99, {type: 'bus_stop', filterrank: 1}), false);
      assert.equal(accepts(17, {type: 'bus_stop', filterrank: 1}), true);
      assert.equal(accepts(17, {type: 'public_restroom', filterrank: 1}), true);
      assert.equal(accepts(17, {type: 'garden', filterrank: 4}), false);
      assert.equal(accepts(15, {type: 'monument', filterrank: 4}), false);
    }
});

test('semantic importance gets placement priority without bypassing the density filter', () => {
  const layers = compilePoi(
    poi({density: 3, detailZoom: 18, placement: {prominentRank: 1, prominentImportance: 3}}),
    context,
    'en',
  );
  const selected = (zoom: number, properties: Record<string, unknown>) =>
    layers.filter(({layer}) =>
      featureFilter(layer.filter as never).filter(
        {zoom},
        {type: 1, properties: {...candidate, ...properties}},
      ),
    );
  assert.equal(selected(16, {importance_tier: 4}).length, 0);
  assert.equal(selected(18, {importance_tier: 3})[0]?.target, 'poi.prominent');
  assert.equal(selected(18, {importance_tier: 2})[0]?.target, 'poi');
  assert.equal(selected(18, {filterrank: 1})[0]?.target, 'poi.prominent');
  const prominent = layers.find(({target}) => target === 'poi.prominent')!.layer;
  const key = createExpression(prominent.layout?.['symbol-sort-key']);
  assert.equal(key.result, 'success');
  if (key.result !== 'success') throw new Error('Invalid priority');
  const score = (importance_tier: number, filterrank: number) =>
    key.value.evaluate(
      {zoom: 18},
      {type: 'Point', properties: {...candidate, importance_tier, filterrank}},
    );
  assert.ok(score(4, 5) < score(3, 0));
  assert.ok(score(3, 5) < score(0, 0));
});

test('a transit pictogram precedes its localized name without opening excluded POIs', () => {
  for (const coupleIconAndLabel of [true, false]) {
    const layers = compilePoi(
      poi({
        categories: ['transport'],
        density: 5,
        minZoomByType: {bus_stop: 17},
        labelMinZoomByType: {bus_stop: 18, train_station: 13},
        placement: {coupleIconAndLabel, unnamedIconTypes: ['bus_stop']},
      }),
      context,
      'en',
    );
    const stop = {...candidate, class: 'transport', type: 'bus_stop', name_en: 'Bus stop'};
    const eligible = (zoom: number) =>
      layers.filter(({layer}) =>
        featureFilter(layer.filter as never).filter({zoom}, {type: 1, properties: stop}),
      );
    assert.equal(eligible(16).length, 0);
    assert.ok(eligible(17).some(({layer}) => layer.layout?.['icon-image']));
    const unnamedStop = {...stop, name: '', name_en: ''};
    assert.ok(
      layers.some(
        ({layer}) =>
          layer.layout?.['icon-image'] &&
          featureFilter(layer.filter as never).filter(
            {zoom: 17},
            {type: 1, properties: unnamedStop},
          ),
      ),
    );
    assert.equal(
      layers.some(
        ({layer}) =>
          layer.layout?.['icon-image'] &&
          featureFilter(layer.filter as never).filter(
            {zoom: 17},
            {type: 1, properties: {...unnamedStop, type: 'taxi'}},
          ),
      ),
      false,
    );
    const label = layers.find(({layer}) => layer.layout?.['text-field'])!.layer;
    const field = createPropertyExpression(
      label.layout?.['text-field'],
      latest.layout_symbol['text-field'] as never,
    );
    assert.equal(field.result, 'success');
    if (field.result !== 'success') throw new Error('Invalid transit name');
    const evaluate = (zoom: number, properties = stop) =>
      String(field.value.evaluate({zoom}, {type: 1, properties}));
    assert.equal(evaluate(17), '');
    assert.equal(evaluate(18), 'Bus stop');
    assert.equal(evaluate(12, {...stop, type: 'train_station'}), '');
    assert.equal(evaluate(13, {...stop, type: 'train_station'}), 'Bus stop');
    assert.equal(evaluate(12, {...stop, type: 'taxi'}), 'Bus stop');
  }
});

test('type zoom and prominence options reject malformed or out-of-range values', () => {
  for (const options of [
    {minZoomByType: {bus_stop: -1}},
    {minZoomByType: {bus_stop: 25}},
    {minZoomByType: {'Invalid type': 17}},
    {labelMinZoomByType: {bus_stop: 25}},
    {placement: {prominentImportance: 0}},
    {placement: {prominentImportance: 5}},
  ])
    assert.throws(() =>
      parseTileflowMap(extendStreets({modules: {poi: {type: 'poi', ...options} as never}})),
    );
});
