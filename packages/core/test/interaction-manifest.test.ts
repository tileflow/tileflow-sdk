import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, poi} from '../src';
import {
  assertTileflowInteractionManifestLayers,
  tileflowInteractionManifestMetadataKey,
  type TileflowInteractionManifest,
} from '../src/cartography/interaction-manifest';
import {extendStreets} from './map-fixture';

const preparedAssets = {
  icons: {
    ids: ['food'],
    sprite: '/tileflow/test/poi/sprite',
  },
} as const;

test('emits a versioned post-optimizer POI interaction lookup without public semantic IDs', () => {
  const style = createStyle(
    extendStreets({
      modules: {
        poi: poi({
          categories: ['food'],
          icons: 'full',
          labels: 'balanced',
          placement: {coupleIconAndLabel: false},
        }),
      },
    }),
    {preparedAssets},
  );
  const manifest = style.metadata?.[
    tileflowInteractionManifestMetadataKey
  ] as TileflowInteractionManifest;

  assert.equal(manifest.version, 1);
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
    class: 'class',
    name: 'name',
    rank: 'rank',
    subclass: 'subclass',
  });
  assert.deepEqual(
    manifest.domains.poi?.layers.map(({category, layerId, representation}) => ({
      category,
      layerId,
      representation,
    })),
    [
      {category: 'food', layerId: 'streets-poi-food-icon', representation: 'icon'},
      {category: 'food', layerId: 'streets-poi-food-label', representation: 'label'},
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
  const style = createStyle(extendStreets({modules: {poi: poi({preset: 'none'})}}), {
    preparedAssets: {icons: {ids: [], sprite: '/tileflow/test/empty/sprite'}},
  });

  assert.equal(style.metadata?.[tileflowInteractionManifestMetadataKey], undefined);
});

test('tracks optimized combined and marker POI representations by semantic category', () => {
  const style = createStyle(
    extendStreets({
      modules: {
        poi: poi({
          categories: ['food'],
          icons: 'full',
          labels: 'balanced',
          placement: {coupleIconAndLabel: true},
          styles: {food: {marker: {radius: 3}}},
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
      {category: 'food', layerId: 'streets-poi-food-marker', representation: 'marker'},
      {category: 'food', layerId: 'streets-poi-food', representation: 'combined'},
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
        fields: {class: 'class', name: 'name', rank: 'rank', subclass: 'subclass'},
        hitTesting: {frequency: 'animation-frame', order: 'rendered-topmost'},
        identity: 'maplibre-feature-id-if-present',
        layers: [
          {
            anchor: 'pointer-coordinate',
            category: 'food',
            layerId: 'poi-food',
            priority: 1,
            representation: 'icon',
            source: 'expected-source',
            sourceLayer: 'poi',
          },
        ],
      },
    },
    version: 1,
  };

  assert.throws(
    () =>
      assertTileflowInteractionManifestLayers(manifest, [
        {id: 'poi-food', source: 'different-source', 'source-layer': 'poi'},
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
        fields: {class: 'class', name: 'name', rank: 'rank', subclass: 'subclass'},
        hitTesting: {frequency: 'animation-frame', order: 'rendered-topmost'},
        identity: 'maplibre-feature-id-if-present',
        layers: [
          {
            anchor: 'pointer-coordinate',
            category: 'food',
            layerId: 'poi-food',
            priority: 1,
            representation: 'icon',
            source: 'source-a',
            sourceLayer: 'poi',
          },
          {
            anchor: 'pointer-coordinate',
            category: 'coffee',
            layerId: 'poi-coffee',
            priority: 2,
            representation: 'label',
            source: 'source-b',
            sourceLayer: 'poi',
          },
        ],
      },
    },
    version: 1,
  };

  assert.throws(
    () =>
      assertTileflowInteractionManifestLayers(manifest, [
        {id: 'poi-food', source: 'source-a', 'source-layer': 'poi'},
        {id: 'poi-coffee', source: 'source-b', 'source-layer': 'poi'},
      ]),
    /one source and source-layer namespace/u,
  );
});
