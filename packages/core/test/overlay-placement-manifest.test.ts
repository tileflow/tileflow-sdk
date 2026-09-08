import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle} from '../src';
import {
  assertTileflowOverlayPlacementManifestLayers,
  type TileflowOverlayPlacementManifest,
  tileflowOverlayPlacementManifestMetadataKey,
} from '../src/cartography/overlay-placement-manifest';
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

test('embeds exact semantic placement anchors after physical planning', () => {
  const style = createStyle(extendStreets(), {preparedAssets});
  const manifest = style.metadata?.[
    tileflowOverlayPlacementManifestMetadataKey
  ] as TileflowOverlayPlacementManifest;
  const ids = style.layers.map(({id}) => id);

  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(Object.keys(manifest.anchors), [
    'above-water',
    'below-roads',
    'above-roads',
    'above-buildings',
    'below-labels',
    'above-labels',
  ]);
  assert.equal(manifest.anchors['above-labels'], null);
  assert.ok(
    Object.values(manifest.anchors).every((anchor) => anchor === null || ids.includes(anchor)),
  );
  assert.ok(
    style.layers.every(
      (layer) =>
        !Object.keys((layer.metadata ?? {}) as Record<string, unknown>).some((key) =>
          key.startsWith('tileflow:compiler-'),
        ),
    ),
  );
  assert.doesNotMatch(JSON.stringify(manifest), /compiler-owner|compiler-slot|compiler-target/u);
});

test('rejects a missing, reordered, or non-monotonic physical anchor', () => {
  const layers = [
    {id: 'water', type: 'fill'},
    {id: 'roads', type: 'line'},
    {id: 'labels', type: 'symbol'},
  ];
  const valid: TileflowOverlayPlacementManifest = {
    anchors: {
      'above-water': 'roads',
      'below-roads': 'roads',
      'above-roads': 'labels',
      'above-buildings': 'labels',
      'below-labels': 'labels',
      'above-labels': null,
    },
    schemaVersion: 1,
  };

  assert.doesNotThrow(() => assertTileflowOverlayPlacementManifestLayers(valid, layers));
  assert.throws(
    () =>
      assertTileflowOverlayPlacementManifestLayers(
        {...valid, anchors: {...valid.anchors, 'below-labels': 'missing'}},
        layers,
      ),
    /missing/u,
  );
  assert.throws(
    () =>
      assertTileflowOverlayPlacementManifestLayers(
        {...valid, anchors: {...valid.anchors, 'above-roads': 'water'}},
        layers,
      ),
    /order/u,
  );
});
