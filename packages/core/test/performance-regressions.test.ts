import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeTileflowStylePerformance} from '../src';
import type {MapLibreStyle} from '../src';

function style(layers: MapLibreStyle['layers'], name = 'test'): MapLibreStyle {
  return {version: 8, name, sources: {}, layers};
}

test('performance report measures UTF-8 bytes and samples fractional zoom boundaries through z24', () => {
  const input = style(
    [
      {
        id: 'fractional',
        type: 'line',
        source: 'vector',
        'source-layer': 'road',
        minzoom: 15.2,
        maxzoom: 15.8,
      },
    ],
    '¢',
  );
  const report = analyzeTileflowStylePerformance(input);

  assert.equal(report.styleBytes, new TextEncoder().encode(JSON.stringify(input)).byteLength);
  assert.ok(report.zooms.some(({zoom}) => zoom === 24));
  assert.equal(report.zooms.find(({zoom}) => zoom === 15.2)?.activeLayers, 1);
  assert.equal(report.zooms.find(({zoom}) => zoom === 15.8)?.activeLayers, 0);
});

test('style layer family signatures are canonical but preserve explicit zoom properties', () => {
  const report = analyzeTileflowStylePerformance(
    style([
      {
        id: 'first',
        type: 'line',
        source: 'vector',
        'source-layer': 'road',
        layout: {'line-cap': 'round', 'line-join': 'round'},
      },
      {
        id: 'same-layout-different-key-order',
        type: 'line',
        source: 'vector',
        'source-layer': 'road',
        layout: {'line-join': 'round', 'line-cap': 'round'},
      },
      {
        id: 'explicit-zero-minzoom',
        type: 'line',
        source: 'vector',
        'source-layer': 'road',
        minzoom: 0,
        layout: {'line-cap': 'round', 'line-join': 'round'},
      },
      {id: 'background', type: 'background'},
    ]),
    [0],
  ).zooms[0]!;

  assert.equal(report.styleLayerFamilies, 2);
});
