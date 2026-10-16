import type {MapGeoJSONFeature, Map as MapLibreMap} from 'maplibre-gl';
import assert from 'node:assert/strict';
import test from 'node:test';
import {LayerHighlight} from '../src/devtools/layers/highlight';
import {
  contextMarkdown,
  diagnoseLayer,
  eligibility,
  expressionDependencies,
  layerChanges,
  layerContext,
  layerGroups,
  layerInventory,
  layerMatches,
  queryLayer,
  safeContext,
  sampleLimit,
} from '../src/devtools/layers/model';
import {LayerPreview} from '../src/devtools/layers/preview';
import {layersInView} from '../src/devtools/layers/visibility';
import {evaluatedValue} from '../src/devtools/style-edits';
import type {Side} from '../src/devtools/types';

function fixture() {
  const layer = {
    id: 'opaque-42',
    type: 'line',
    source: 'world',
    'source-layer': 'transportation',
    minzoom: 10,
    maxzoom: 18,
    paint: {'line-color': '#aa3355'},
    layout: {} as Record<string, unknown>,
  };
  const custom = {id: 'runtime-buildings', type: 'custom'};
  const internal = {id: '__tileflow-devtools-preview', type: 'fill'};
  const order = [layer.id, internal.id, custom.id];
  const feature = {
    id: 0,
    type: 'Feature',
    source: 'world',
    sourceLayer: 'transportation',
    layer,
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
    properties: {class: 'primary', name: 'Main road'},
  } as unknown as MapGeoJSONFeature;
  let zoom = 12;
  const features = [feature];
  let queries = 0;
  const map = {
    getStyle: () => ({
      layers: [layer, internal],
      sources: {
        world: {
          type: 'vector',
          url: 'https://user:password@example.test/data.json?token=secret',
          data: {private: true},
        },
      },
      metadata: {'tileflow:map': 'streets', 'tileflow:theme': 'day-light'},
    }),
    getLayer: (id: string) =>
      [layer, custom, internal].find((entry) => order.includes(entry.id) && entry.id === id),
    getLayersOrder: () => order,
    getZoom: () => zoom,
    getCenter: () => ({lng: 0, lat: 0}),
    getBearing: () => 0,
    getPitch: () => 45,
    getContainer: () => ({clientWidth: 800, clientHeight: 600}),
    getSource: (id: string) => (id === 'world' ? {} : undefined),
    isSourceLoaded: () => true,
    queryRenderedFeatures: (_: unknown, options: {layers: string[]}) => {
      assert.deepEqual(options.layers, [layer.id]);
      queries++;
      return features;
    },
    getPaintProperty: (_: string, key: string) => (layer.paint as Record<string, unknown>)[key],
    getLayoutProperty: (_: string, key: string) => layer.layout[key],
    getFeatureState: () => ({}),
    listImages: () => [],
  } as unknown as MapLibreMap;
  const side = {
    id: 'left',
    map,
    definition: {label: 'Streets', basePath: '/left'},
    loadEpoch: 1,
    artifactGeneration: 3,
    artifactStatus: 'ready',
    runtimeErrors: [],
    frame: {
      contentWindow: {
        __tileflowDescribeRuntimeLayers: () => ({
          [custom.id]: {controller: 'Buildings', state: {shown: true}, stats: {buildings: 123}},
        }),
      },
    },
    sidecar: {
      layers: [
        {
          id: layer.id,
          contributions: [
            {owner: 'roads', target: 'road.primary', slot: 'surface'},
            {owner: 'bridges', target: 'bridge.road', slot: 'surface'},
          ],
        },
      ],
    },
  } as unknown as Side;
  return {
    side,
    map,
    layer,
    custom,
    order,
    features,
    feature,
    setZoom: (value: number) => {
      zoom = value;
    },
    queries: () => queries,
  };
}

test('inventory uses renderer order, includes custom layers and keeps all semantic owners without prefix inference', () => {
  const {side, layer, custom} = fixture();
  const layers = layerInventory(side);
  assert.deepEqual(
    layers.map(({id, index}) => [id, index]),
    [
      [layer.id, 0],
      [custom.id, 1],
    ],
  );
  assert.equal(layers[1].runtime?.stats?.buildings, 123);
  assert.equal(layers[0].contributions.length, 2);
  assert.deepEqual(
    layerGroups(layers, 'module').map(([name]) => name),
    ['bridges + roads', 'Runtime'],
  );
  assert.deepEqual(
    layerGroups(layers, 'order')[0][1].map((entry) => entry.id),
    [custom.id, layer.id],
  );
  assert.ok(layerMatches(layers[0], 'BRIDGES transportation line'));
  assert.ok(!layerMatches(layers[0], 'land'));
  side.sidecar = undefined;
  assert.equal(
    layerGroups(layerInventory(side), 'module').find(([name]) => name === 'Unattributed')?.[1][0]
      .id,
    layer.id,
  );
});

test('zoom range is inclusive at minimum and exclusive at maximum; hidden rules override eligibility', () => {
  const {side, map, setZoom, queries} = fixture();
  const layer = layerInventory(side)[0];
  assert.equal(eligibility(layer, 10), 'Enabled');
  assert.equal(eligibility(layer, 18), 'Outside zoom');
  setZoom(18);
  const sample = queryLayer(map, layer);
  assert.equal(sample.status, 'unavailable');
  assert.equal(sample.total, undefined);
  assert.equal(queries(), 0);
  layer.layout.visibility = 'none';
  assert.equal(eligibility(layer, 12), 'Hidden');
});

test('unsupported, empty and bounded viewport observations remain distinct and never claim pixel visibility', () => {
  const {side, map, features, feature, queries} = fixture();
  const [layer, custom] = layerInventory(side);
  const unsupported = queryLayer(map, custom);
  assert.equal(unsupported.status, 'unavailable');
  assert.equal(unsupported.total, undefined);
  assert.equal(queries(), 0);
  features.length = 0;
  const empty = queryLayer(map, layer);
  assert.equal(empty.status, 'ready');
  assert.equal(empty.total, 0);
  assert.match(
    diagnoseLayer(map, layer, empty).find((entry) => entry.label === 'Interpretation')!.value,
    /does not identify/u,
  );
  features.push(...Array.from({length: 300}, () => feature));
  const full = queryLayer(map, layer);
  assert.equal(full.total, 300);
  assert.equal(full.features.length, sampleLimit);
  assert.equal(
    diagnoseLayer(map, layer, full).find((entry) => entry.label === 'Pixel visibility')?.state,
    'unknown',
  );
  assert.match(diagnoseLayer(map, undefined, full)[0].value, /Not present/u);
});

test('read-only snapshots retain property and order changes after renderer mutation', () => {
  const {side, layer, order} = fixture();
  const before = layerInventory(side);
  layer.paint['line-color'] = '#ffffff';
  order.reverse();
  const after = layerInventory(side);
  const changes = layerChanges(before, after, 4, '2026-10-16T12:00:00.000Z');
  assert.deepEqual(
    changes.find((entry) => entry.property === 'paint.line-color'),
    {
      at: '2026-10-16T12:00:00.000Z',
      generation: 4,
      layer: layer.id,
      property: 'paint.line-color',
      before: '#aa3355',
      after: '#ffffff',
    },
  );
  assert.equal(changes.filter((entry) => entry.property === 'index').length, 2);
  assert.equal(layerChanges(after, layerInventory(side), 4).length, 0);
  order.splice(order.indexOf(layer.id), 1);
  assert.equal(
    layerChanges(after, layerInventory(side), 5).find((entry) => entry.property === 'presence')
      ?.after,
    false,
  );
});

test('context packets include actual selection, neighbors, source evidence, temporary edits and bounded samples', () => {
  const {side, map, layer, feature, features} = fixture();
  features.push(...Array.from({length: 100}, () => feature));
  const layers = layerInventory(side);
  const packet = layerContext(
    side,
    layer.id,
    layers,
    queryLayer(map, layers[0]),
    [],
    {styleEdits: [{property: 'line-width', value: 3}]},
    'Why is this road thin?',
  ) as Record<string, any>;
  assert.equal(packet.kind, 'layer');
  assert.equal(packet.layer.id, layer.id);
  assert.equal(packet.identity.generation, 3);
  assert.equal(packet.neighbors.later, 'runtime-buildings');
  assert.equal(packet.samples.features.length, 8);
  assert.equal(packet.samples.features[0].id, 0);
  assert.equal(packet.samples.features[0].geometry, undefined);
  assert.equal(packet.source.data, undefined);
  assert.equal(packet.source.url, 'https://example.test/data.json');
  assert.equal(packet.temporary.styleEdits[0].value, 3);
  assert.match(contextMarkdown(packet), /Why is this road thin\?/u);
  assert.doesNotMatch(JSON.stringify(packet), /password|token=secret/u);
});

test('packet projection redacts secrets, preserves semantic token paths and reports bounded omissions', () => {
  assert.equal(safeContext('/tiles.json?token=secret#key').value, '/tiles.json');
  assert.equal(safeContext('mapbox://dataset?token=secret').value, 'mapbox:');
  const value = {
    accessToken: 'sensitive',
    themeTokens: ['colors.primary'],
    nested: {authorization: 'bearer secret'},
    url: 'pmtiles://https://user:pass@example.test/archive.pmtiles?key=abc#secret',
    rows: Array.from({length: 200}, (_, i) => ({i, x: 'a'.repeat(5000)})),
  };
  const packet = safeContext(value, 25);
  assert.equal(packet.value.accessToken, '[redacted]');
  assert.deepEqual(packet.value.themeTokens, ['colors.primary']);
  assert.equal(packet.value.url, 'https://example.test/archive.pmtiles');
  assert.ok(packet.omitted.length > 0);
  assert.doesNotMatch(JSON.stringify(packet.value), /sensitive|bearer secret|user:pass|key=abc/u);
});

test('a map pick evaluates rules for the picked feature rather than the first viewport sample', () => {
  const {side, map, layer, feature} = fixture();
  Object.assign(layer.paint, {'line-width': ['get', 'width']});
  feature.properties.width = 2;
  const picked = {...feature, id: 91, properties: {width: 8}} as MapGeoJSONFeature;
  const layers = layerInventory(side);
  const packet = layerContext(side, layer.id, layers, queryLayer(map, layers[0]), [], {}, '', 0, {
    feature: picked,
    coordinate: [1, 2],
    at: '2026-10-16T12:00:00.000Z',
  }) as Record<string, any>;
  assert.equal(packet.evaluated.featureContext, 'picked feature');
  assert.equal(packet.evaluated.values.paint['line-width'], 8);
  assert.equal(packet.samples.selected.id, 91);
  assert.deepEqual(packet.samples.selected.coordinate, [1, 2]);
  assert.equal(packet.samples.features[0].id, 0);
});

test('rule dependencies ignore literal arrays and zoom values evaluate without changing the camera', () => {
  const {map, layer} = fixture();
  assert.deepEqual(expressionDependencies(['literal', ['zoom']]), ['expression']);
  assert.deepEqual(
    expressionDependencies(['interpolate', ['linear'], ['zoom'], 0, ['get', 'width'], 20, 10]),
    ['zoom', 'feature'],
  );
  Object.assign(layer.paint, {'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1, 20, 11]});
  assert.equal(evaluatedValue(map, layer.id, 'paint', 'line-width', undefined, 10), 6);
  assert.equal(map.getZoom(), 12);
});

test('map highlight owns only bounded scratch overlays and removes them on disposal', () => {
  const {feature} = fixture();
  const layers = new Map<string, any>(),
    sources = new Map<string, any>();
  let data: any;
  const map = {
    getSource: (id: string) => sources.get(id),
    getLayer: (id: string) => layers.get(id),
    addSource: (id: string, source: any) => {
      data = source.data;
      sources.set(id, {
        setData: (next: any) => {
          data = next;
        },
      });
    },
    addLayer: (layer: any) => layers.set(layer.id, layer),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
  } as unknown as MapLibreMap;
  const overlay = new LayerHighlight();
  assert.equal(
    overlay.show(
      map,
      Array.from({length: 100}, () => feature),
    ),
    true,
  );
  assert.equal(data.features.length, 30);
  assert.equal(layers.size, 3);
  assert.ok([...layers.keys()].every((id) => id.startsWith('__tileflow-devtools-')));
  overlay.clear();
  assert.equal(layers.size, 0);
  assert.equal(sources.size, 0);
  assert.equal(overlay.show(map, []), false);
});

test('layer clicks persist through hover exit and camera refresh without an element picker', (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let shown: string | undefined;
  const preview = new LayerPreview(
    (id) => {
      shown = id;
    },
    () => {
      shown = undefined;
    },
  );
  t.after(() => preview.clear());
  preview.select('buildings');
  assert.equal(shown, 'buildings');
  preview.hover('roads');
  t.mock.timers.tick(80);
  assert.equal(shown, 'roads');
  preview.hover();
  assert.equal(shown, 'buildings');
  preview.pause();
  assert.equal(shown, undefined);
  preview.refresh();
  assert.equal(shown, 'buildings');
  preview.clear();
  preview.refresh();
  assert.equal(shown, undefined);
});

test('rapid hover, click and panel-close discard obsolete layer previews', (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const shown: string[] = [];
  const preview = new LayerPreview(
    (id) => shown.push(id),
    () => {},
  );
  t.after(() => preview.clear());
  preview.hover('buildings');
  preview.hover('roads');
  t.mock.timers.tick(79);
  assert.deepEqual(shown, []);
  t.mock.timers.tick(1);
  assert.deepEqual(shown, ['roads']);
  preview.hover('water');
  preview.select('land');
  t.mock.timers.tick(80);
  assert.deepEqual(shown, ['roads', 'land']);
  preview.hover('water');
  preview.clear();
  t.mock.timers.tick(80);
  assert.deepEqual(shown, ['roads', 'land']);
});

test('visible-only queries the whole viewport once and excludes empty, hidden and out-of-zoom layers', () => {
  const {map, side, layer, feature} = fixture();
  const base = layerInventory(side)[0];
  const layers = [
    base,
    {...base, id: 'empty'},
    {...base, id: 'hidden', layout: {visibility: 'none'}},
    {...base, id: 'too-far', minzoom: 15},
    {...base, id: 'zoom-end', maxzoom: 12},
    {...base, id: '__tileflow-devtools-preview'},
  ];
  let calls = 0;
  map.getLayer = ((id: string) => layers.find((entry) => entry.id === id)) as typeof map.getLayer;
  map.queryRenderedFeatures = ((_bounds: unknown, options: {layers: string[]}) => {
    calls++;
    assert.deepEqual(options.layers, [layer.id, 'empty']);
    return [feature, feature];
  }) as typeof map.queryRenderedFeatures;
  assert.deepEqual([...layersInView(map, layers)!], [layer.id]);
  assert.equal(calls, 1);
  map.queryRenderedFeatures = (() => []) as typeof map.queryRenderedFeatures;
  assert.equal(layersInView(map, layers)!.size, 0);
});

test('visible-only retains unknown runtime visibility, excludes explicit hidden state and retries failed queries', () => {
  const {map, side} = fixture();
  const [base, custom] = layerInventory(side);
  assert.ok(layersInView(map, [base, custom])!.has(custom.id));
  custom.runtime!.state.shown = false;
  assert.ok(!layersInView(map, [base, custom])!.has(custom.id));
  map.queryRenderedFeatures = (() => {
    throw new Error('Style changed');
  }) as typeof map.queryRenderedFeatures;
  assert.equal(layersInView(map, [base]), undefined);
  map.queryRenderedFeatures = (() => []) as typeof map.queryRenderedFeatures;
  assert.equal(layersInView(map, [base])!.size, 0);
});
