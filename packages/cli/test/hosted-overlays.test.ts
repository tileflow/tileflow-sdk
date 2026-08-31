import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStyle,
  defineMap,
  disable,
  hostedTileset,
  maplibreOverlay,
  resolveMap,
} from '@tileflow/core';
import {streets} from '@tileflow/maps';
import {
  inspectTileflowHostedCompatibility,
  prepareTileflowHostedThemeFamily,
} from '../src/hosted-preflight';

const map = defineMap({
  id: 'hosted-overlays',
  version: 1,
  extends: streets,
  icons: [],
  modules: {
    addresses: disable(),
    aeroways: disable(),
    boundaries: disable(),
    buildings: disable(),
    labels: disable(),
    land: disable(),
    landforms: disable(),
    poi: disable(),
    roads: disable(),
    transit: disable(),
    vegetation: disable(),
    water: disable(),
  },
  sources: {
    stores: hostedTileset({
      attribution: 'Store data © Example',
      local: './data/stores.pmtiles',
      tileset: 'stores',
    }),
  },
  overlays: {
    stores: maplibreOverlay({
      source: 'stores',
      placement: 'above-roads',
      layers: [
        {
          id: 'stores-points',
          type: 'circle',
          'source-layer': 'store-locations',
          paint: {'circle-color': ['match', ['get', 'category'], 'food', '#ef4444', '#64748b']},
        },
      ],
    }),
  },
});

test('prepares path-free hosted styles and one canonical logical Team source record', () => {
  const style = createStyle(map);
  const project = {maps: {'hosted-overlays': map}};
  const prepared = prepareTileflowHostedThemeFamily('hosted-overlays', map, {light: style});
  assert.deepEqual(prepared.teamSources, {
    stores: {
      tileset: 'stores',
      type: 'vector',
    },
  });
  assert.equal(prepared.styles.light?.sources.stores?.url, 'tileflow://hosted-sources/stores');
  assert.doesNotMatch(JSON.stringify(prepared), /data\/stores\.pmtiles|\.\/data/u);
  assert.deepEqual(
    inspectTileflowHostedCompatibility(project, {'hosted-overlays': prepared.styles}),
    [],
  );
});

test('prepares an empty Team source record for a World-only Map', () => {
  const worldOnly = defineMap({
    id: 'world-only',
    version: 1,
    extends: streets,
    icons: [],
    modules: map.modules,
  });
  const style = createStyle(worldOnly);
  const prepared = prepareTileflowHostedThemeFamily('world-only', worldOnly, {light: style});

  assert.deepEqual(prepared.teamSources, {});
});

test('derives hosted layer relationships from the final Style instead of source bindings', () => {
  const manyLayers = defineMap({
    id: 'many-layers',
    version: 1,
    extends: map,
    overlays: {
      first: maplibreOverlay({
        source: 'stores',
        placement: 'above-roads',
        layers: Array.from({length: 40}, (_, index) => ({
          id: `stores-first-${index}`,
          'source-layer': 'store-locations',
          type: 'circle',
        })),
      }),
      second: maplibreOverlay({
        source: 'stores',
        placement: 'below-labels',
        layers: Array.from({length: 40}, (_, index) => ({
          id: `stores-second-${index}`,
          'source-layer': 'store-locations',
          type: 'circle',
        })),
      }),
    },
  });
  const resolved = resolveMap(manyLayers);
  const prepared = prepareTileflowHostedThemeFamily('many-layers', resolved, {
    light: createStyle(manyLayers),
  });

  assert.deepEqual(prepared.teamSources, {
    stores: {tileset: 'stores', type: 'vector'},
  });
  assert.equal(prepared.styles.light?.layers.filter(({source}) => source === 'stores').length, 81);
});
