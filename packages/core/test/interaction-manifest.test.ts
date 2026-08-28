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

  assert.equal(manifest.version, 2);
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
  assert.deepEqual(
    manifest.domains.poi?.layers.map(({category, layerId, representation}) => ({
      category,
      layerId,
      representation,
    })),
    [
      {
        category: 'food-drink',
        layerId: 'tileflow-poi-food-drink-icon',
        representation: 'icon',
      },
      {
        category: 'food-drink',
        layerId: 'tileflow-poi-food-drink-label',
        representation: 'label',
      },
    ],
  );
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

test('tracks optimized combined and marker POI representations by semantic category', () => {
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
    manifest.domains.poi?.layers.map(({category, layerId, representation}) => ({
      category,
      layerId,
      representation,
    })),
    [
      {
        category: 'food-drink',
        layerId: 'tileflow-poi-food-drink-marker',
        representation: 'marker',
      },
      {
        category: 'food-drink',
        layerId: 'tileflow-poi-food-drink',
        representation: 'combined',
      },
    ],
  );
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
            category: 'food-drink',
            layerId: 'poi-food-drink',
            priority: 1,
            representation: 'icon',
            source: 'expected-source',
            sourceLayer: 'poi',
          },
        ],
      },
    },
    version: 2,
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
            category: 'food-drink',
            layerId: 'poi-food-drink',
            priority: 1,
            representation: 'icon',
            source: 'source-a',
            sourceLayer: 'poi',
          },
          {
            anchor: 'pointer-coordinate',
            category: 'retail',
            layerId: 'poi-retail',
            priority: 2,
            representation: 'label',
            source: 'source-b',
            sourceLayer: 'poi',
          },
        ],
      },
    },
    version: 2,
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
