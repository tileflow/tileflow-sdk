import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {parseTileflowMap, poi, resolveTileflowData} from '../src';
import {compilePoi} from '../src/modules/poi/compiler';
import {resolveColors} from '../src/themes';
import {extendStreets} from './map-fixture';

test('type rank ceilings survive zoom detail, placement order and all POI representations', () => {
  for (const order of ['importance', 'categories'] as const) {
    for (const coupleIconAndLabel of [true, false]) {
      const contributions = compilePoi(
        poi({
          categories: ['park-nature'],
          density: 5,
          maxRankByType: {garden: 1},
          placement: {order, coupleIconAndLabel, prominentRank: 1},
          styles: {'park-nature': {marker: {radius: 4}}},
        }),
        {
          colors: resolveColors(),
          data: resolveTileflowData(undefined),
          images: {},
          typography: {
            font: 'Noto Sans Regular',
            places: {font: 'Noto Sans Bold'},
            roads: {font: 'Noto Sans Regular'},
            water: {font: 'Noto Sans Regular'},
            poi: {font: 'Noto Sans Regular'},
          },
        },
      );
      for (const zoom of [12, 15, 16, 18, 22, 24]) {
        const accepts = (type: string, rank: number) =>
          contributions.some(({layer}) =>
            featureFilter(layer.filter as never).filter(
              {zoom},
              {
                type: 1,
                properties: {
                  category: 'park-nature',
                  type,
                  filter_rank: rank,
                  size_rank: 0,
                  name: 'Destination',
                },
              },
            ),
          );
        for (const rank of [0, 1, 2, 3, 4, 5]) {
          assert.equal(accepts('garden', rank), rank <= 1, `${order}, z${zoom}, rank ${rank}`);
          assert.equal(accepts('park', rank), true);
        }
      }
    }
  }
});

test('type rank ceilings validate World types and integer ranks from zero to five', () => {
  for (const rank of [0, 5]) {
    const map = parseTileflowMap(
      extendStreets({modules: {poi: poi({maxRankByType: {garden: rank as 0 | 5}})}}),
    );
    assert.equal(map.modules.poi?.maxRankByType?.garden, rank);
  }
  for (const maxRankByType of [{garden: -1}, {garden: 6}, {garden: 1.5}, {'Garden name': 1}]) {
    assert.throws(() =>
      parseTileflowMap(extendStreets({modules: {poi: {type: 'poi', maxRankByType} as never}})),
    );
  }
});
