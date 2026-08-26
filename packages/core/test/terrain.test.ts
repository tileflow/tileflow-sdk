import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, parseTileflowMap, validateTileflowMap} from '../src';
import {extendStreets} from './map-fixture';

const preparedAssets = {
  icons: {
    ids: [
      'coffee',
      'crosswalk',
      'culture',
      'education',
      'food',
      'health',
      'lodging',
      'major-transit',
      'oneway',
      'services',
      'shopping',
      'sidewalk-dot',
    ],
    sprite: '/tileflow/test/streets/sprite',
  },
} as const;

const contourTerrain = {
  contours: {
    demMaxZoom: 13,
    demUrl: 'https://terrain.example.test/dem/{z}/{x}/{y}.webp?variant=swiss',
    index: {color: '#734F2A', opacity: 0.9, width: 1.2},
    labels: {
      color: '#734F2A',
      haloColor: '#F7F0DE',
      haloWidth: 1.5,
      minZoom: 11,
      opacity: 0.95,
      size: 9,
      spacing: 240,
    },
    maxZoom: 15,
    minZoom: 9,
    minor: {color: '#91683A', opacity: 0.72, width: 0.55},
    multiplier: 1,
    overzoom: 2,
    thresholds: {
      9: [100, 500],
      11: [50, 250],
      13: [20, 100],
      15: [10, 50],
    },
  },
  encoding: 'terrarium',
  mode: 'none',
} as const;

test('compiles contour-only terrain into one standard vector source and three ordered layers', () => {
  const style = createStyle(extendStreets({terrain: contourTerrain}), {preparedAssets});
  const source = style.sources['tileflow-contours']!;
  const tiles = source.tiles as string[];
  const protocolUrl = new URL(tiles[0]!);

  assert.equal(style.sources['tileflow-terrain'], undefined);
  assert.equal(style.terrain, undefined);
  assert.equal(source.type, 'vector');
  assert.equal(source.minzoom, 9);
  assert.equal(source.maxzoom, 15);
  assert.equal(protocolUrl.protocol, 'tileflow-contour:');
  assert.equal(protocolUrl.hostname, 'tiles');
  assert.equal(
    protocolUrl.searchParams.get('demUrl'),
    'https://terrain.example.test/dem/{z}/{x}/{y}.webp?variant=swiss',
  );
  assert.equal(protocolUrl.searchParams.get('encoding'), 'terrarium');
  assert.equal(protocolUrl.searchParams.get('demMaxzoom'), '13');
  assert.equal(protocolUrl.searchParams.get('maxzoom'), '15');
  assert.equal(protocolUrl.searchParams.get('overzoom'), '2');
  assert.equal(protocolUrl.searchParams.get('multiplier'), '1');
  assert.equal(
    protocolUrl.searchParams.get('thresholds'),
    '9:100,500;11:50,250;13:20,100;15:10,50',
  );

  const minor = style.layers.find((layer) => layer.id === 'streets-terrain-contour-minor')!;
  const index = style.layers.find((layer) => layer.id === 'streets-terrain-contour-index')!;
  const labels = style.layers.find((layer) => layer.id === 'streets-terrain-contour-labels')!;
  assert.equal(minor['source-layer'], 'contours');
  assert.equal(index['source-layer'], 'contours');
  assert.equal(labels['source-layer'], 'contours');
  assert.deepEqual(minor.filter, ['==', ['get', 'level'], 0]);
  assert.deepEqual(index.filter, ['>', ['get', 'level'], 0]);
  assert.equal((minor.paint as Record<string, unknown>)['line-color'], '#91683A');
  assert.equal((index.paint as Record<string, unknown>)['line-width'], 1.2);
  assert.equal(labels.minzoom, 11);
  assert.deepEqual((labels.layout as Record<string, unknown>)['text-font'], ['Noto Sans Regular']);
  assert.deepEqual((labels.layout as Record<string, unknown>)['text-field'], [
    'number-format',
    ['get', 'ele'],
    {'max-fraction-digits': 0},
  ]);

  const layerIds = style.layers.map((layer) => layer.id);
  assert.ok(layerIds.indexOf('streets-background') < layerIds.indexOf(String(minor.id)));
  assert.ok(layerIds.indexOf(String(labels.id)) < layerIds.indexOf('streets-water'));
  assert.deepEqual(
    validateStyleMin(style as never).map((error) => error.message),
    [],
  );
});

test('keeps raster terrain compatible while exposing bounded hillshade paint', () => {
  const style = createStyle(
    extendStreets({
      terrain: {
        encoding: 'mapbox',
        hillshade: {
          accentColor: '#000000',
          exaggeration: 0.18,
          highlightColor: '#F0E4CB',
          illuminationAnchor: 'viewport',
          illuminationDirection: 315,
          maxZoom: 17,
          minZoom: 5,
          shadowColor: '#6A4827',
        },
        mode: 'hillshade',
        url: 'https://terrain.example.test/tiles.json',
      },
    }),
    {preparedAssets},
  );
  const layer = style.layers.find((candidate) => candidate.id === 'streets-terrain-hillshade')!;
  const paint = layer.paint as Record<string, unknown>;

  assert.equal(style.sources['tileflow-terrain']?.type, 'raster-dem');
  assert.equal(style.sources['tileflow-contours'], undefined);
  assert.equal(layer.minzoom, 5);
  assert.equal(layer.maxzoom, 17);
  assert.equal(paint['hillshade-accent-color'], '#000000');
  assert.equal(paint['hillshade-exaggeration'], 0.18);
  assert.equal(paint['hillshade-highlight-color'], '#F0E4CB');
  assert.equal(paint['hillshade-illumination-anchor'], 'viewport');
  assert.equal(paint['hillshade-illumination-direction'], 315);
  assert.equal(paint['hillshade-shadow-color'], '#6A4827');
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('validates explicit safe DEM templates, thresholds, and contour bounds', () => {
  assert.deepEqual(
    parseTileflowMap(extendStreets({terrain: contourTerrain})).terrain,
    contourTerrain,
  );
  assert.equal(
    validateTileflowMap(
      extendStreets({
        terrain: {
          contours: {
            demMaxZoom: 12,
            demUrl: 'https://terrain.example.test/{z}/{x}/{y}.webp',
            maxZoom: 13,
            minZoom: 13,
            multiplier: 0.07,
            overzoom: 2,
            thresholds: {13: [0.7, 3.5]},
          },
          mode: 'none',
        },
      }),
    ).valid,
    true,
  );

  for (const contours of [
    {...contourTerrain.contours, demUrl: 'javascript:alert(1)/{z}/{x}/{y}'},
    {...contourTerrain.contours, demUrl: 'https://terrain.example.test/{z}/{x}.webp'},
    {
      ...contourTerrain.contours,
      demUrl: 'https://terrain.example.test/{z}/{z}/{x}/{y}.webp',
    },
    {
      ...contourTerrain.contours,
      demUrl: 'https://user:secret@terrain.example.test/{z}/{x}/{y}.webp',
    },
    {
      ...contourTerrain.contours,
      demUrl: 'https://terrain.example.test/{z}/{x}/{y}.webp#fragment',
    },
    {...contourTerrain.contours, demMaxZoom: 25},
    {...contourTerrain.contours, maxZoom: 14},
    {...contourTerrain.contours, minZoom: 5},
    {...contourTerrain.contours, maxZoom: undefined, minZoom: 20},
    {...contourTerrain.contours, overzoom: 9},
    {...contourTerrain.contours, overzoom: 2, thresholds: {1: [100, 500]}},
    {...contourTerrain.contours, minZoom: 12, labels: {maxZoom: 10}},
    {...contourTerrain.contours, minor: {maxZoom: 9, minZoom: 10}},
    {...contourTerrain.contours, minor: {maxZoom: 8, minZoom: 5}},
    {...contourTerrain.contours, thresholds: {}},
    {...contourTerrain.contours, thresholds: {9: [500, 100]}},
    {...contourTerrain.contours, thresholds: {9: [30, 100]}},
    {...contourTerrain.contours, thresholds: {9: [10, 50]}},
    {...contourTerrain.contours, multiplier: 2, thresholds: {15: [10, 50]}},
  ]) {
    assert.equal(
      validateTileflowMap(extendStreets({terrain: {...contourTerrain, contours} as never})).valid,
      false,
    );
  }
});
