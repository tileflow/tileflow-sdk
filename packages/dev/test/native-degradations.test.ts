import assert from 'node:assert/strict';
import test from 'node:test';
import type {MapLibreStyle} from '@tileflow/core';
import {readTileflowNativeDegradations} from '@tileflow/core/native-profile';
import {degradeTileflowNativeStyle, NativeDegradationError} from '../src/native-degradations';

const world = {type: 'vector', url: 'https://tiles.example.test/world.json'};
const contours = {
  type: 'vector',
  tiles: ['tileflow-contour://tiles/{z}/{x}/{y}.pbf?demUrl=https%3A%2F%2Fdem.example.test'],
};
const buildings = {
  version: 1,
  source: 'world',
  layers: {building: 'building'},
  color: '#d89270',
  verticalGradient: false,
  landmarks: {url: 'https://tiles.example.test/landmarks.json'},
};

function style(overrides: Partial<MapLibreStyle> & Record<string, unknown> = {}): MapLibreStyle {
  return {
    version: 8,
    name: 'test',
    sources: {world, contours},
    layers: [
      {id: 'background', type: 'background'},
      {id: 'buildings', type: 'fill', source: 'world', 'source-layer': 'building'},
      {id: 'contour-lines', type: 'line', source: 'contours', 'source-layer': 'contours'},
      {id: 'contour-labels', type: 'symbol', source: 'contours', 'source-layer': 'contours'},
      {
        id: 'relief',
        type: 'hillshade',
        source: 'dem',
        paint: {resampling: 'linear', 'hillshade-exaggeration': 0.5},
      },
      {
        id: 'places',
        type: 'symbol',
        source: 'world',
        'source-layer': 'poi',
        layout: {'text-overlap': 'cooperative', 'icon-overlap': 'never'},
      },
    ],
    metadata: {
      'tileflow:buildings': buildings,
      'tileflow:contours': {version: 1},
      'tileflow:interaction-manifest': {
        version: 3,
        domains: {poi: {layers: [{layerId: 'places', priority: 5}]}},
      },
      'tileflow:overlay-placement-manifest': {
        schemaVersion: 1,
        anchors: {'below-labels': 'contour-labels', 'above-labels': null},
      },
    },
    ...overrides,
  } as MapLibreStyle;
}

test('leaves out browser contours with their layers and records each change', () => {
  const input = style();
  const before = JSON.stringify(input);
  const result = degradeTileflowNativeStyle(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(Object.keys(result.style.sources), ['world']);
  assert.deepEqual(result.removedLayers, [2, 3]);
  assert.deepEqual(
    result.style.layers.map((layer) => layer.id),
    ['background', 'buildings', 'tileflow-buildings-native-extrusion', 'relief', 'places'],
  );
  assert.deepEqual(result.inputIndexes, [0, 1, -1, 4, 5]);
  assert.deepEqual(
    result.degradations.map(({id, fallback, layers}) => [id, fallback, layers]),
    [
      ['deviceContours:contours', 'none', ['contour-lines', 'contour-labels']],
      ['models3d', 'extrusions', []],
      ['reliefResampling', 'engine-default', ['relief']],
      ['scene3d', 'extrusions', []],
      ['symbolOverlap', 'allow-overlap', ['places']],
    ],
  );
  assert.deepEqual(readTileflowNativeDegradations(result.style.metadata), result.degradations);
  assert.deepEqual(result.style.layers[3]!.paint, {'hillshade-exaggeration': 0.5});
  // Browser-only metadata leaves; references follow the remaining layers.
  const metadata = result.style.metadata!;
  assert.equal(metadata['tileflow:buildings'], undefined);
  assert.equal(metadata['tileflow:contours'], undefined);
  assert.deepEqual(metadata['tileflow:interaction-manifest'], {
    version: 3,
    domains: {poi: {layers: [{layerId: 'places', priority: 4}]}},
  });
  assert.deepEqual(metadata['tileflow:overlay-placement-manifest'], {
    schemaVersion: 1,
    anchors: {'below-labels': 'relief', 'above-labels': null},
  });
});

test('generates the building extrusion from the map’s 3D buildings design', () => {
  const extrusion = degradeTileflowNativeStyle(style()).style.layers[2]!;
  assert.deepEqual(extrusion, {
    id: 'tileflow-buildings-native-extrusion',
    type: 'fill-extrusion',
    source: 'world',
    'source-layer': 'building',
    minzoom: 15,
    filter: [
      'all',
      ['!=', ['get', 'hide_3d'], true],
      ['!=', ['get', 'hide_3d'], 1],
      ['!=', ['get', 'hide_3d'], '1'],
    ],
    paint: {
      'fill-extrusion-base': [
        'interpolate',
        ['linear'],
        ['zoom'],
        15,
        0,
        15.3,
        [
          'max',
          0,
          [
            'min',
            ['to-number', ['coalesce', ['get', 'render_min_height'], 0], 0],
            ['max', 0, ['to-number', ['coalesce', ['get', 'render_height'], 5], 5]],
          ],
        ],
      ],
      'fill-extrusion-color': '#d89270',
      'fill-extrusion-height': [
        'interpolate',
        ['linear'],
        ['zoom'],
        15,
        0,
        15.3,
        ['max', 0, ['to-number', ['coalesce', ['get', 'render_height'], 5], 5]],
      ],
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.3, 1],
      'fill-extrusion-vertical-gradient': false,
    },
    metadata: {'tileflow:3d-toggle': 'building', 'tileflow:domain': 'buildings'},
  });
  // Without building layers it goes below the first symbol layer.
  const plain = style({
    layers: [
      {id: 'background', type: 'background'},
      {id: 'labels', type: 'symbol', source: 'world', 'source-layer': 'place'},
    ],
    metadata: {'tileflow:buildings': buildings},
  });
  assert.deepEqual(
    degradeTileflowNativeStyle(plain).style.layers.map((layer) => layer.id),
    ['background', 'tileflow-buildings-native-extrusion', 'labels'],
  );
});

test('shows a map’s own extrusion pass instead of adding one', () => {
  const input = style({
    sources: {world},
    layers: [
      {id: 'background', type: 'background'},
      {
        id: 'extrusion',
        type: 'fill-extrusion',
        source: 'world',
        'source-layer': 'building',
        layout: {visibility: 'none'},
        metadata: {'tileflow:3d-toggle': 'building'},
      },
    ],
    metadata: {'tileflow:buildings': {...buildings, landmarks: undefined}},
  });
  const result = degradeTileflowNativeStyle(input);
  assert.deepEqual(result.removedLayers, []);
  assert.deepEqual(result.inputIndexes, [0, 1]);
  assert.equal(result.style.layers[1]!.layout, undefined);
  assert.deepEqual(
    result.degradations.map(({id, layers}) => [id, layers]),
    [['scene3d', ['extrusion']]],
  );
});

test('records trees, lights, terrain, sky, globe and steady nautical lights', () => {
  const input = style({
    sources: {world},
    layers: [
      {
        id: 'lights',
        type: 'circle',
        source: 'world',
        'source-layer': 'lights',
        paint: {
          'circle-opacity': ['number', ['feature-state', 'tileflowLightIntensity'], 1],
        },
      },
    ],
    terrain: {source: 'dem'},
    sky: {'sky-color': '#000000'},
    projection: {type: 'globe'},
    metadata: {
      'tileflow:vegetation': {
        version: 1,
        source: 'world',
        layers: {tree: 'tree'},
        fields: {},
        colors: {bark: '#333333', broadleaf: ['#226622'], conifer: ['#114411']},
      },
      'tileflow:vegetation-display': {
        version: 1,
        mode: 'auto',
        fallback: 'flat',
        visible: true,
        flatLayers: [],
      },
      'tileflow:street-lights': {
        version: 1,
        source: 'world',
        layers: {streetFurniture: 'street_furniture', transportation: 'transportation'},
      },
      'tileflow:nautical-lights': {
        version: 1,
        layers: ['lights'],
        source: 'world',
        sourceLayer: 'lights',
      },
    },
  });
  const result = degradeTileflowNativeStyle(input);
  const ids = result.degradations.map(({id, fallback}) => `${id}:${fallback}`);
  assert.ok(ids.includes('trees3d:flat'), ids.join());
  for (const expected of [
    'nauticalLightRhythm:steady',
    'terrain3d:flat',
    'sky:none',
    'globe:mercator',
  ])
    assert.ok(ids.includes(expected), `${expected} in ${ids.join()}`);
  assert.equal((result.style as {terrain?: unknown}).terrain, undefined);
  assert.equal(result.style.metadata?.['tileflow:vegetation'], undefined);
  assert.equal(result.style.metadata?.['tileflow:street-lights'], undefined);
  assert.equal(result.style.metadata?.['tileflow:nautical-lights'], undefined);
  assert.deepEqual(
    result.style.metadata?.['tileflow:vegetation-display'],
    input.metadata!['tileflow:vegetation-display'],
  );
  assert.deepEqual(result.style.layers[0]!.paint, {'circle-opacity': 1});
});

test('a POI layer drawn from a removed source cannot be degraded', () => {
  const input = style({
    metadata: {
      'tileflow:interaction-manifest': {
        version: 3,
        domains: {poi: {layers: [{layerId: 'contour-labels', priority: 3}]}},
      },
    },
  });
  assert.throws(() => degradeTileflowNativeStyle(input), NativeDegradationError);
});

test('a style without anything to degrade is returned with an empty record list', () => {
  const input = style({
    sources: {world},
    layers: [{id: 'background', type: 'background'}],
    metadata: {},
  });
  const result = degradeTileflowNativeStyle(input);
  assert.deepEqual(result.degradations, []);
  assert.deepEqual(result.style.layers, input.layers);
  assert.deepEqual(result.style.metadata, {'tileflow:nativeDegradations': []});
});
