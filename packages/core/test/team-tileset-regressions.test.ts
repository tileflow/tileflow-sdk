import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, hostedTileset, tileflowAuthoringManifest, type MapLibreStyle} from '../src';
import {inferTileflowSourceRequirements} from '../src/data/requirements';
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

test('allows sixteen Team sources in addition to Tileflow World', () => {
  const sources = Object.fromEntries(
    Array.from({length: 16}, (_, index) => {
      const id = `source-${index + 1}`;
      return [
        id,
        hostedTileset({
          attribution: `Source ${index + 1} © Example`,
          local: `./data/${id}.pmtiles`,
          tileset: `tileset-${index + 1}`,
        }),
      ];
    }),
  );

  const style = createStyle(extendStreets({sources}), {preparedAssets});

  assert.equal(Object.keys(style.sources).length, 17);
});

test('authoring manifest reports the Team-source limit without counting platform sources', () => {
  const limits = tileflowAuthoringManifest.resources.hostedSources as unknown as Record<
    string,
    unknown
  >;

  assert.equal(limits.maxPerMap, 16);
  assert.equal(Object.hasOwn(limits, 'maxPerMapIncludingPlatformSources'), false);
});

test('infers fields from valid legacy MapLibre filters', () => {
  const style = {
    layers: [
      {
        filter: ['==', 'category', 'restaurant'],
        id: 'stores',
        source: 'stores',
        'source-layer': 'store-locations',
        type: 'circle',
      },
    ],
    sources: {stores: {type: 'vector', url: 'https://example.test/stores.json'}},
    version: 8,
  } as MapLibreStyle;

  assert.deepEqual(inferTileflowSourceRequirements(style).sources.stores?.sourceLayers, [
    {fields: [{name: 'category'}], id: 'store-locations'},
  ]);
});

test('does not treat MapLibre object lookups as feature-property requirements', () => {
  const style = {
    layers: [
      {
        id: 'stores',
        paint: {
          'circle-radius': ['get', 'radius', ['literal', {ignored: ['get', 'secret'], radius: 5}]],
        },
        source: 'stores',
        'source-layer': 'store-locations',
        type: 'circle',
      },
    ],
    sources: {stores: {type: 'vector', url: 'https://example.test/stores.json'}},
    version: 8,
  } as MapLibreStyle;

  assert.deepEqual(inferTileflowSourceRequirements(style).sources.stores?.sourceLayers, [
    {fields: [], id: 'store-locations'},
  ]);
});

test('infers fields from valid legacy MapLibre property functions', () => {
  const style = {
    layers: [
      {
        id: 'stores',
        paint: {
          'circle-radius': {
            property: 'revenue',
            stops: [
              [0, 2],
              [100, 10],
            ],
          },
        },
        source: 'stores',
        'source-layer': 'store-locations',
        type: 'circle',
      },
    ],
    sources: {stores: {type: 'vector', url: 'https://example.test/stores.json'}},
    version: 8,
  } as MapLibreStyle;

  assert.deepEqual(inferTileflowSourceRequirements(style).sources.stores?.sourceLayers, [
    {fields: [{name: 'revenue'}], id: 'store-locations'},
  ]);
});
