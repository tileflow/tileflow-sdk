import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStyle,
  createStyleResult,
  defineMap,
  hostedTileset,
  maplibreOverlay,
  parseTileflowMap,
  remove,
  resolveMap,
} from '../src';
import {inferTileflowSourceRequirements} from '../src/data/requirements';
import {hashTileflowMapRevision} from '../src/map-build-manifest';
import {insertTileflowOverlays} from '../src/overlays';
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

const stores = hostedTileset({
  attribution: 'Store data © Example',
  local: './data/stores.pmtiles',
  tileset: 'stores',
});

const deliveryZones = hostedTileset({
  attribution: 'Delivery zones © Example',
  local: './data/delivery-zones.pmtiles',
  tileset: 'delivery-zones',
});

test('compiles named hosted sources and ordered MapLibre overlays at semantic boundaries', () => {
  const map = extendStreets({
    sources: {stores, 'delivery-zones': deliveryZones},
    overlays: {
      stores: maplibreOverlay({
        source: 'stores',
        placement: 'above-roads',
        layers: [
          {
            id: 'stores-points',
            type: 'circle',
            'source-layer': 'store-locations',
            paint: {
              'circle-color': ['match', ['get', 'category'], 'restaurant', '#ef4444', '#64748b'],
              'circle-radius': 5,
            },
          },
        ],
      }),
      'delivery-zones': maplibreOverlay({
        source: 'delivery-zones',
        placement: 'below-roads',
        layers: [
          {
            id: 'delivery-zones-fill',
            type: 'fill',
            'source-layer': 'delivery-zones',
            paint: {
              'fill-color': ['match', ['get', 'status'], 'active', '#22c55e', '#94a3b8'],
              'fill-opacity': 0.25,
            },
          },
          {
            id: 'delivery-zones-outline',
            type: 'line',
            'source-layer': 'delivery-zones',
            paint: {'line-color': '#166534', 'line-width': 2},
          },
        ],
      }),
    },
  });

  const first = createStyle(map, {preparedAssets});
  const second = createStyle(map, {preparedAssets});
  assert.deepEqual(second, first);
  assert.deepEqual(first.sources.stores, {
    attribution: 'Store data © Example',
    type: 'vector',
    url: 'tileflow-pmtiles://./data/stores.pmtiles',
  });
  assert.deepEqual(first.sources['delivery-zones'], {
    attribution: 'Delivery zones © Example',
    type: 'vector',
    url: 'tileflow-pmtiles://./data/delivery-zones.pmtiles',
  });

  const ids = first.layers.map((layer) => String(layer.id));
  assert.ok(ids.indexOf('delivery-zones-fill') < ids.indexOf('tileflow-road-area'));
  assert.equal(ids.indexOf('delivery-zones-outline'), ids.indexOf('delivery-zones-fill') + 1);
  assert.ok(ids.indexOf('stores-points') > ids.indexOf('tileflow-label-road-junction'));
  assert.ok(ids.indexOf('stores-points') < ids.indexOf('tileflow-boundary-admin4'));

  const sourceIdentities = first.metadata?.['tileflow:sources'] as Record<
    string,
    Record<string, unknown>
  >;
  assert.deepEqual(sourceIdentities.stores, {
    kind: 'hosted-tileset',
    sourceId: 'stores',
    tileset: 'stores',
    type: 'vector',
  });
  assert.doesNotMatch(JSON.stringify(first.metadata), /data\/stores\.pmtiles/u);
  assert.deepEqual(first.metadata?.['tileflow:overlays'], {
    'delivery-zones': {
      layers: ['delivery-zones-fill', 'delivery-zones-outline'],
      placement: 'below-roads',
      source: 'delivery-zones',
    },
    stores: {layers: ['stores-points'], placement: 'above-roads', source: 'stores'},
  });

  const requirements = inferTileflowSourceRequirements(first);
  assert.deepEqual(requirements.sources.stores?.sourceLayers, [
    {fields: [{name: 'category'}], id: 'store-locations'},
  ]);
  assert.deepEqual(requirements.sources['delivery-zones']?.sourceLayers, [
    {fields: [{name: 'status'}], id: 'delivery-zones'},
  ]);
});

test('places overlays at the six public semantic basemap boundaries', () => {
  const slots = [
    'hydro',
    'building-areas',
    'transport-areas',
    'boundaries',
    'buildings',
    'vegetation',
    'symbols',
  ];
  const placements = [
    'above-water',
    'below-roads',
    'above-roads',
    'above-buildings',
    'below-labels',
    'above-labels',
  ] as const;
  const result = insertTileflowOverlays({
    basemapLayers: slots.map((slot) => ({
      id: `basemap-${slot}`,
      type: 'fill',
      metadata: {
        'tileflow:compiler-owner': 'land',
        'tileflow:compiler-slot': slot,
        'tileflow:compiler-target': `land.${slot}`,
      },
    })),
    mapId: 'placements',
    overlays: Object.fromEntries(
      placements.map((placement) => [
        placement,
        maplibreOverlay({
          source: 'stores',
          placement,
          layers: [{id: `overlay-${placement}`, type: 'fill'}],
        }),
      ]),
    ),
    sourceIds: ['stores'],
  });

  assert.deepEqual(
    result.layers.map(({id}) => id),
    [
      'basemap-hydro',
      'overlay-above-water',
      'basemap-building-areas',
      'overlay-below-roads',
      'basemap-transport-areas',
      'overlay-above-roads',
      'basemap-boundaries',
      'basemap-buildings',
      'overlay-above-buildings',
      'basemap-vegetation',
      'overlay-below-labels',
      'basemap-symbols',
      'overlay-above-labels',
    ],
  );
});

test('accepts the shortest canonical local PMTiles path', () => {
  assert.equal(
    hostedTileset({
      attribution: 'Example',
      local: './a.pmtiles',
      tileset: 'stores',
    }).local,
    './a.pmtiles',
  );
});

test('does not impose an arbitrary layer count on one MapLibre overlay', () => {
  const layers = Array.from({length: 65}, (_, index) => ({
    id: `stores-${index}`,
    type: 'circle',
  }));

  assert.equal(
    maplibreOverlay({layers, placement: 'above-roads', source: 'stores'}).layers.length,
    65,
  );
});

test('inherits keyed sources and overlays through atomic replacement and explicit removal', () => {
  const base = extendStreets({
    id: 'overlay-base',
    sources: {stores},
    overlays: {
      stores: maplibreOverlay({
        source: 'stores',
        placement: 'below-labels',
        layers: [{id: 'stores-points', type: 'circle', 'source-layer': 'store-locations'}],
      }),
    },
  });
  const extended = defineMap({
    id: 'overlay-extended',
    version: 1,
    extends: base,
    sources: {'delivery-zones': deliveryZones},
    overlays: {
      stores: maplibreOverlay({
        source: 'stores',
        placement: 'above-labels',
        layers: [{id: 'stores-selected', type: 'circle', 'source-layer': 'store-locations'}],
      }),
      'delivery-zones': maplibreOverlay({
        source: 'delivery-zones',
        placement: 'below-roads',
        layers: [{id: 'delivery-zones-fill', type: 'fill', 'source-layer': 'delivery-zones'}],
      }),
    },
  });
  const resolved = resolveMap(extended);
  assert.deepEqual(Object.keys(resolved.sources ?? {}), ['delivery-zones', 'stores']);
  assert.deepEqual(Object.keys(resolved.overlays ?? {}), ['delivery-zones', 'stores']);
  assert.equal(resolved.overlays?.stores?.placement, 'above-labels');

  const removed = defineMap({
    id: 'overlay-removed',
    version: 1,
    extends: extended,
    sources: {stores: remove()},
    overlays: {stores: remove()},
  });
  const removedResolved = resolveMap(removed);
  assert.deepEqual(Object.keys(removedResolved.sources ?? {}), ['delivery-zones']);
  assert.deepEqual(Object.keys(removedResolved.overlays ?? {}), ['delivery-zones']);
});

test('reports dangling overlay sources with a stable agent-facing diagnostic', () => {
  const map = extendStreets({
    sources: {stores},
    overlays: {
      stores: maplibreOverlay({
        source: 'missing',
        placement: 'above-roads',
        layers: [{id: 'stores-points', type: 'circle', 'source-layer': 'store-locations'}],
      }),
    },
  });
  const result = createStyleResult(map, {preparedAssets});
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics, [
    {
      code: 'TF_OVERLAY_SOURCE_NOT_FOUND',
      message: 'Overlay "stores" references unknown source "missing". Available: stores.',
      path: 'map.test-map.overlays.stores.source',
      phase: 'lowering',
      severity: 'error',
      suggestion: 'Use one of: stores.',
    },
  ]);
});

test('reports invalid MapLibre overlay layers with a stable validation diagnostic', () => {
  const result = createStyleResult(
    extendStreets({
      sources: {stores},
      overlays: {
        stores: maplibreOverlay({
          source: 'stores',
          placement: 'above-roads',
          layers: [
            {
              id: 'stores-points',
              type: 'circle',
              'source-layer': 'store-locations',
              paint: {'circle-radius': 'large'},
            },
          ],
        }),
      },
    }),
    {preparedAssets},
  );
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0]?.code, 'TF_MAPLIBRE_STYLE_INVALID');
  assert.equal(result.diagnostics[0]?.phase, 'validation');
  assert.match(result.diagnostics[0]?.path ?? '', /layers/u);
});

test('map revision binds logical hosted identity but excludes the local archive locator', async () => {
  const define = (local: string, tileset = 'stores') =>
    parseTileflowMap(
      extendStreets({
        sources: {
          stores: hostedTileset({
            attribution: 'Store data © Example',
            local,
            tileset,
          }),
        },
        overlays: {
          stores: maplibreOverlay({
            source: 'stores',
            placement: 'above-roads',
            layers: [{id: 'stores-points', type: 'circle', 'source-layer': 'store-locations'}],
          }),
        },
      }),
    );
  const sourceAssets = {fonts: [], icons: []};
  const first = await hashTileflowMapRevision(define('./data/stores.pmtiles'), sourceAssets);
  const moved = await hashTileflowMapRevision(define('../fixtures/stores.pmtiles'), sourceAssets);
  const rebound = await hashTileflowMapRevision(
    define('./data/stores.pmtiles', 'stores-next'),
    sourceAssets,
  );
  assert.equal(moved, first);
  assert.notEqual(rebound, first);
});
