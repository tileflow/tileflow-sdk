import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, disable, poi} from '../src';
import {
  assertTileflowInteractionManifestLayers,
  type TileflowInteractionManifest,
  tileflowInteractionManifestMetadataKey,
} from '../src/cartography/interaction-manifest';
import {extendStreets} from './map-fixture';

const preparedAssets = {
  icons: {
    ids: ['food'],
    sprite: '/tileflow/test/poi/sprite',
  },
} as const;

test('emits a versioned post-planning POI interaction lookup without public physical IDs', () => {
  const style = createStyle(
    extendStreets({
      modules: {
        poi: poi({
          categories: ['food-drink'],
          icons: true,
          labels: true,
          placement: {coupleIconAndLabel: false},
        }),
      },
    }),
    {preparedAssets},
  );
  const manifest = style.metadata?.[
    tileflowInteractionManifestMetadataKey
  ] as TileflowInteractionManifest;

  assert.equal(manifest.version, 3);
  assert.equal(manifest.domains.poi?.identity, 'maplibre-feature-id-if-present');
  assert.deepEqual(manifest.domains.poi?.deduplication, {
    identity: ['source', 'source-layer', 'feature-id'],
    representationPriority: ['marker', 'icon', 'combined', 'label'],
  });
  assert.deepEqual(manifest.domains.poi?.hitTesting, {
    frequency: 'animation-frame',
    order: 'rendered-topmost',
  });
  assert.deepEqual(manifest.domains.poi?.fields, {
    category: 'category',
    filterRank: 'filter_rank',
    icon: 'icon',
    name: 'name',
    sizeRank: 'size_rank',
    type: 'type',
  });
  // A layer may draw several categories, so a hit's category comes from the feature itself.
  assert.deepEqual(
    manifest.domains.poi?.layers.map(({layerId, representation}) => ({layerId, representation})),
    [
      {layerId: 'tileflow-poi-icon', representation: 'icon'},
      {layerId: 'tileflow-poi-label', representation: 'label'},
    ],
  );
  assert.ok(manifest.domains.poi?.layers.every((layer) => !('category' in layer)));
  assert.ok(
    manifest.domains.poi?.layers.every(({layerId}) =>
      style.layers.some((layer) => layer.id === layerId),
    ),
  );
  assert.ok(
    style.layers.every(
      (layer) =>
        !Object.keys((layer.metadata ?? {}) as Record<string, unknown>).some((key) =>
          key.startsWith('tileflow:compiler-'),
        ),
    ),
  );
});

test('omits interaction metadata when POIs are disabled', () => {
  const style = createStyle(extendStreets({modules: {poi: disable()}}), {
    preparedAssets: {icons: {ids: [], sprite: '/tileflow/test/empty/sprite'}},
  });

  assert.equal(style.metadata?.[tileflowInteractionManifestMetadataKey], undefined);
});

test('tracks optimized combined and marker POI representations', () => {
  const style = createStyle(
    extendStreets({
      modules: {
        poi: poi({
          categories: ['food-drink'],
          icons: true,
          labels: true,
          placement: {coupleIconAndLabel: true},
          styles: {'food-drink': {marker: {radius: 3}}},
        }),
      },
    }),
    {preparedAssets},
  );
  const manifest = style.metadata?.[
    tileflowInteractionManifestMetadataKey
  ] as TileflowInteractionManifest;

  assert.deepEqual(
    manifest.domains.poi?.layers.map(({layerId, representation}) => ({layerId, representation})),
    [
      {layerId: 'tileflow-poi-marker', representation: 'marker'},
      {layerId: 'tileflow-poi', representation: 'combined'},
    ],
  );
});

test('looks up the prominent tier and per-category layers by their representation', () => {
  const prominent = createStyle(
    extendStreets({
      modules: {
        poi: poi({
          categories: ['food-drink', 'transport'],
          placement: {coupleIconAndLabel: true, prominentRank: 1},
        }),
      },
    }),
    {
      preparedAssets: {
        icons: {ids: ['food', 'major-transit'], sprite: preparedAssets.icons.sprite},
      },
    },
  );
  const byCategory = createStyle(
    extendStreets({
      modules: {
        poi: poi({
          categories: ['food-drink', 'transport'],
          placement: {coupleIconAndLabel: false, order: 'categories'},
        }),
      },
    }),
    {
      preparedAssets: {
        icons: {ids: ['food', 'major-transit'], sprite: preparedAssets.icons.sprite},
      },
    },
  );
  const lookup = (style: typeof prominent) =>
    (
      style.metadata?.[tileflowInteractionManifestMetadataKey] as TileflowInteractionManifest
    ).domains.poi?.layers.map(({layerId, representation}) => `${layerId}:${representation}`);

  assert.deepEqual(lookup(prominent), ['tileflow-poi:combined', 'tileflow-poi-prominent:combined']);
  assert.deepEqual(lookup(byCategory), [
    'tileflow-poi-transport-icon:icon',
    'tileflow-poi-transport-label:label',
    'tileflow-poi-food-drink-icon:icon',
    'tileflow-poi-food-drink-label:label',
  ]);
});

test('rejects semantic metadata that drifts from its finalized physical layer', () => {
  const manifest: TileflowInteractionManifest = {
    domains: {
      poi: {
        deduplication: {
          identity: ['source', 'source-layer', 'feature-id'],
          representationPriority: ['marker', 'icon', 'combined', 'label'],
        },
        fields: {
          category: 'category',
          filterRank: 'filter_rank',
          icon: 'icon',
          name: 'name',
          sizeRank: 'size_rank',
          type: 'type',
        },
        hitTesting: {frequency: 'animation-frame', order: 'rendered-topmost'},
        identity: 'maplibre-feature-id-if-present',
        layers: [
          {
            anchor: 'pointer-coordinate',
            layerId: 'poi-food-drink',
            priority: 1,
            representation: 'icon',
            source: 'expected-source',
            sourceLayer: 'poi',
          },
        ],
      },
    },
    version: 3,
  };

  assert.throws(
    () =>
      assertTileflowInteractionManifestLayers(manifest, [
        {id: 'poi-food-drink', source: 'different-source', 'source-layer': 'poi'},
      ]),
    /does not match finalized layer/u,
  );
});

test('rejects multiple physical POI namespaces that would collide in public feature state', () => {
  const manifest: TileflowInteractionManifest = {
    domains: {
      poi: {
        deduplication: {
          identity: ['source', 'source-layer', 'feature-id'],
          representationPriority: ['marker', 'icon', 'combined', 'label'],
        },
        fields: {
          category: 'category',
          filterRank: 'filter_rank',
          icon: 'icon',
          name: 'name',
          sizeRank: 'size_rank',
          type: 'type',
        },
        hitTesting: {frequency: 'animation-frame', order: 'rendered-topmost'},
        identity: 'maplibre-feature-id-if-present',
        layers: [
          {
            anchor: 'pointer-coordinate',
            layerId: 'poi-food-drink',
            priority: 1,
            representation: 'icon',
            source: 'source-a',
            sourceLayer: 'poi',
          },
          {
            anchor: 'pointer-coordinate',
            layerId: 'poi-retail',
            priority: 2,
            representation: 'label',
            source: 'source-b',
            sourceLayer: 'poi',
          },
        ],
      },
    },
    version: 3,
  };

  assert.throws(
    () =>
      assertTileflowInteractionManifestLayers(manifest, [
        {id: 'poi-food-drink', source: 'source-a', 'source-layer': 'poi'},
        {id: 'poi-retail', source: 'source-b', 'source-layer': 'poi'},
      ]),
    /one source and source-layer namespace/u,
  );
});
