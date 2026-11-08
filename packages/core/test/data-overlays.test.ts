import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clusterOverlay,
  createStyle,
  geojsonSource,
  heatmapOverlay,
  hostedTileset,
  parseTileflowMap,
  remove,
  resolveMap,
  tileflowAuthoringManifest,
  tileflowInlineGeoJsonByteLimit,
} from '../src';
import {hashTileflowMapRevision} from '../src/map-build-manifest';
import {validateTileflowNativeStyle} from '../src/native-profile';
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

const data = {
  features: [
    {
      geometry: {coordinates: [-3.7, 40.4], type: 'Point'},
      properties: {price: 320_000},
      type: 'Feature',
    },
  ],
  type: 'FeatureCollection',
} as const;

function clusteredMap(source = geojsonSource({cluster: true, clusterRadius: 40, data})) {
  return extendStreets({
    overlays: {
      stores: clusterOverlay({id: 'stores', placement: 'below-labels', source: 'stores'}),
    },
    sources: {stores: source},
  });
}

test('compiles a clustered GeoJSON source with counts in the map label font', () => {
  const style = createStyle(clusteredMap(), {preparedAssets});

  assert.deepEqual(style.sources.stores, {
    cluster: true,
    clusterRadius: 40,
    data,
    type: 'geojson',
  });
  const ids = style.layers.map(({id}) => String(id));
  const bubbles = ids.indexOf('stores-clusters');
  assert.ok(bubbles >= 0);
  assert.deepEqual(ids.slice(bubbles, bubbles + 3), [
    'stores-clusters',
    'stores-cluster-count',
    'stores-points',
  ]);

  const firstLabel = style.layers.find(
    (layer) =>
      layer.id !== 'stores-cluster-count' &&
      (layer.layout as Record<string, unknown> | undefined)?.['text-font'],
  );
  const count = style.layers[bubbles + 1]!;
  assert.deepEqual(
    (count.layout as Record<string, unknown>)['text-font'],
    (firstLabel?.layout as Record<string, unknown>)['text-font'],
  );
  assert.deepEqual(
    (style.layers[bubbles]!.metadata as Record<string, unknown>)['tileflow:cluster'],
    {
      expandOnClick: true,
      role: 'cluster',
    },
  );
});

test('reports a cluster overlay whose source cannot cluster at the source path', () => {
  const map = clusteredMap(geojsonSource({data}));

  assert.throws(
    () => createStyle(map, {preparedAssets}),
    (error: {code?: string; path?: string}) =>
      error.code === 'TF_OVERLAY_CLUSTER_SOURCE_INVALID' &&
      error.path === `map.${map.id}.overlays.stores.source`,
  );
});

test('rejects source and heatmap inputs MapLibre could not use', () => {
  assert.throws(() => geojsonSource({data: 'http://example.com/a.json'}), /https/u);
  assert.throws(() => geojsonSource({data: './stores.json'}), /https/u);
  assert.throws(
    () => geojsonSource({data: {features: [], type: 'Feature'} as never}),
    /FeatureCollection/u,
  );
  assert.throws(() => geojsonSource({clusterRadius: 40}), /require cluster: true/u);
  assert.throws(() => geojsonSource({cluster: true, clusterRadius: 0}), /clusterRadius/u);
  assert.throws(() => geojsonSource({cluster: true, clusterMinPoints: 1}), /clusterMinPoints/u);
  assert.throws(
    () => geojsonSource({cluster: true, clusterProperties: {total: ['+'] as never}}),
    /clusterProperties/u,
  );
  assert.throws(
    () =>
      heatmapOverlay({
        colors: [
          [0.5, '#000'],
          [0.2, '#fff'],
        ],
        id: 'heat',
        placement: 'below-labels',
        source: 'stores',
      }),
    /increasing/u,
  );
});

test('compiles heatmaps over GeoJSON sources and hosted vector tilesets', () => {
  const map = extendStreets({
    overlays: {
      demand: heatmapOverlay({
        id: 'demand',
        maxZoom: 15,
        placement: 'below-labels',
        source: 'listings',
        sourceLayer: 'listings',
        weight: ['/', ['get', 'price'], 1_000_000],
      }),
      stores: heatmapOverlay({id: 'stores-heat', placement: 'above-roads', source: 'stores'}),
    },
    sources: {
      listings: hostedTileset({
        attribution: 'Listings © Example',
        local: './data/listings.pmtiles',
        tileset: 'listings',
      }),
      stores: geojsonSource({data}),
    },
  });

  const style = createStyle(map, {preparedAssets});
  const demand = style.layers.find(({id}) => id === 'demand')!;
  assert.equal(demand.type, 'heatmap');
  assert.equal(demand.maxzoom, 15);
  assert.equal(demand['source-layer'], 'listings');
  assert.deepEqual((demand.paint as Record<string, unknown>)['heatmap-weight'], [
    '/',
    ['get', 'price'],
    1_000_000,
  ]);
  const ids = style.layers.map(({id}) => id);
  assert.ok(ids.includes('stores-heat'));
});

test('the inline GeoJSON limit applies to config, not to runtime data', () => {
  const large = {
    features: [{note: 'x'.repeat(tileflowInlineGeoJsonByteLimit)}],
    type: 'FeatureCollection',
  } as const;
  const source = geojsonSource({cluster: true, data: large});

  assert.equal(source.kind, 'geojson');
  assert.throws(() => parseTileflowMap(clusteredMap(source)), /inline GeoJSON/u);
});

test('semantic config validates and inherits GeoJSON sources like other keyed resources', () => {
  const map = clusteredMap();
  assert.equal(parseTileflowMap(map).id, map.id);

  const invalid = {
    ...map,
    sources: {stores: {data: 'http://example.com/stores.json', kind: 'geojson'}},
  };
  assert.throws(() => parseTileflowMap(invalid), /https/u);

  const child = extendStreets({
    extends: map,
    overlays: {stores: remove()},
    sources: {stores: remove()},
  });
  const resolved = resolveMap(child);
  assert.equal(resolved.sources?.stores, undefined);
  assert.equal(resolved.overlays?.stores, undefined);
});

test('cluster settings are part of the map revision', async () => {
  const assets = {fonts: [], icons: [], models: []} as never;
  const first = await hashTileflowMapRevision(resolveMap(clusteredMap()), assets);
  const second = await hashTileflowMapRevision(
    resolveMap(clusteredMap(geojsonSource({cluster: true, clusterRadius: 41, data}))),
    assets,
  );
  assert.notEqual(first, second);
});

test('clustered GeoJSON and heatmaps stay inside the native style profile', () => {
  const map = extendStreets({
    overlays: {
      density: heatmapOverlay({id: 'density', placement: 'below-labels', source: 'stores'}),
      stores: clusterOverlay({id: 'stores', placement: 'below-labels', source: 'stores'}),
    },
    sources: {
      stores: geojsonSource({
        cluster: true,
        clusterProperties: {total: ['+', ['get', 'price']]},
        data,
      }),
    },
  });
  const style = createStyle(map, {preparedAssets});
  const paths = new Set(['/sources/stores']);
  style.layers.forEach(({id}, index) => {
    if (
      ['density', 'stores-clusters', 'stores-cluster-count', 'stores-points'].includes(String(id))
    ) {
      paths.add(`/layers/${index}/`);
    }
  });
  const diagnostics = validateTileflowNativeStyle(style).filter(({path}) =>
    [...paths].some((prefix) => path?.startsWith(prefix)),
  );
  assert.deepEqual(diagnostics, []);
  assert.equal(paths.size, 5);
});

test('the authoring manifest names every data overlay operation', () => {
  const operations = tileflowAuthoringManifest.operations.map(({name}) => name);
  for (const name of ['geojson-source', 'cluster-overlay', 'heatmap-overlay']) {
    assert.ok((operations as string[]).includes(name));
  }
});
