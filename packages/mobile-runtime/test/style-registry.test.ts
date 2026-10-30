import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowOverlayPlacements} from '@tileflow/core';
import type {DataReference} from '../src/data';
import {ProtocolError} from '../src/protocol';
import {
  addLayerSchema,
  addSourceSchema,
  layerSlots,
  queryRenderedFeaturesSchema,
  updateGeoJSONSourceSchema,
} from '../src/style-contract';
import {
  bands,
  clipBand,
  createStyleRegistry,
  featureStateId,
  type StyleMap,
} from '../src/style-registry';

const never = new AbortController().signal;
const reference = (name: string): DataReference => ({
  id: name.padEnd(22, 'A'),
  byteLength: 10,
  sha256: Buffer.from(name).toString('hex').padEnd(64, '0').slice(0, 64),
});
const point = (id: number | string, longitude = 0) => ({
  type: 'Feature',
  id,
  properties: {name: `point ${id}`},
  geometry: {type: 'Point', coordinates: [longitude, 0]},
});
const collection = (...features: unknown[]) => ({type: 'FeatureCollection', features});

type Layer = {id: string; type: string; source?: string; paint?: Record<string, unknown>};

/**
 * A map with MapLibre's behaviour where the registry relies on it: ordered layers, sources that
 * refuse duplicates, layers that need their source, `error` events for refused values, feature
 * state, and a style change that drops everything the style did not declare.
 */
function fakeMap(options: {anchors?: Record<string, string | null>} = {}) {
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  const authored: Layer[] = [
    {id: 'water', type: 'fill'},
    {id: 'roads', type: 'line'},
    {id: 'buildings', type: 'fill'},
    {id: 'labels', type: 'symbol'},
  ];
  let order: Layer[] = [...authored];
  let sources = new Map<string, Record<string, unknown>>();
  let state = new Map<string, Record<string, unknown>>();
  const calls: unknown[][] = [];
  const emit = (name: string, event?: unknown) => {
    for (const listener of [...(listeners.get(name) ?? [])]) listener(event);
  };
  const anchors = options.anchors ?? {
    'above-water': 'roads',
    'below-roads': 'roads',
    'above-roads': 'buildings',
    'above-buildings': 'labels',
    'below-labels': 'labels',
    'above-labels': null,
  };
  const map: StyleMap & {
    calls: unknown[][];
    ids(): string[];
    data(id: string): unknown;
    changeStyle(): void;
    add3D(id: string): void;
    emit: typeof emit;
  } = {
    calls,
    style: {_loaded: true},
    transform: {pitch: 0, cameraToCenterDistance: 1000, centerPoint: {y: 400}},
    ids: () => order.map((layer) => layer.id),
    data: (id) => sources.get(id)?.data,
    emit,
    addSource(id, source) {
      if (sources.has(id)) throw new Error(`Source "${id}" already exists.`);
      const spec = source as Record<string, unknown>;
      sources.set(id, {...spec});
      calls.push(['addSource', id]);
    },
    getSource(id) {
      const source = sources.get(id);
      if (!source) return undefined;
      return {
        setData: (data: unknown) => {
          source.data = data;
          calls.push(['setData', id]);
        },
        updateData: (diff: unknown) => calls.push(['updateData', id, diff]),
        getClusterChildren: async (cluster: number) => {
          if (cluster !== 7) throw new Error('No cluster.');
          return [point(1), point(2)];
        },
        getClusterLeaves: async (cluster: number, limit: number, offset: number) =>
          [point(1), point(2), point(3)].slice(offset, offset + limit),
        getClusterExpansionZoom: async () => 11,
      };
    },
    removeSource(id) {
      if (order.some((layer) => layer.source === id)) throw new Error('Source in use.');
      sources.delete(id);
    },
    addLayer(layer, beforeId) {
      const spec = layer as Layer;
      if (order.some((entry) => entry.id === spec.id)) {
        emit('error', {error: new Error(`Layer "${spec.id}" already exists on this map.`)});
        return;
      }
      if (spec.source && !sources.has(spec.source)) {
        emit('error', {error: new Error(`Source "${spec.source}" not found.`)});
        return;
      }
      if (spec.paint && typeof spec.paint['circle-radius'] === 'string') {
        emit('error', {
          error: new Error(`layers.${spec.id}.paint.circle-radius: number expected, string found`),
        });
        return;
      }
      const index = beforeId ? order.findIndex((entry) => entry.id === beforeId) : order.length;
      order.splice(index, 0, {...spec});
      calls.push(['addLayer', spec.id, beforeId]);
      emit('styledata');
    },
    getLayer: (id) => order.find((layer) => layer.id === id),
    removeLayer(id) {
      order = order.filter((layer) => layer.id !== id);
    },
    moveLayer(id, beforeId) {
      const layer = order.find((entry) => entry.id === id)!;
      order = order.filter((entry) => entry !== layer);
      const index = beforeId ? order.findIndex((entry) => entry.id === beforeId) : order.length;
      order.splice(index, 0, layer);
      calls.push(['moveLayer', id, beforeId]);
    },
    setPaintProperty(layer, name, value) {
      if (name === 'circle-radius' && typeof value === 'string')
        emit('error', {error: new Error(`layers.${layer}.paint.circle-radius: number expected`)});
      else calls.push(['setPaintProperty', layer, name, value]);
    },
    setLayoutProperty: (layer, name, value) =>
      calls.push(['setLayoutProperty', layer, name, value]),
    setFilter: (layer, filter) => calls.push(['setFilter', layer, filter]),
    setLayerZoomRange: (layer, minzoom, maxzoom) =>
      calls.push(['setLayerZoomRange', layer, minzoom, maxzoom]),
    getLayersOrder: () => order.map((layer) => layer.id),
    getStyle: () => ({
      layers: order,
      metadata: {'tileflow:overlay-placement-manifest': {schemaVersion: 1, anchors}},
    }),
    setFeatureState(target, value) {
      const key = `${target.source}/${target.sourceLayer ?? ''}/${String(target.id)}`;
      state.set(key, {...state.get(key), ...(value as Record<string, unknown>)});
      calls.push(['setFeatureState', target.source, target.id, value]);
    },
    removeFeatureState(target, key) {
      calls.push(['removeFeatureState', target.source, target.id, key]);
    },
    queryRenderedFeatures(geometry, query) {
      calls.push(['queryRenderedFeatures', geometry, query]);
      const layers = (query as {layers: string[]}).layers;
      return layers.map((layer) => ({
        id: 1,
        source: order.find((entry) => entry.id === layer)?.source ?? '',
        layer: {id: layer},
        geometry: {type: 'Point', coordinates: [0, 0]},
        properties: {name: 'point 1'},
        state: {},
      }));
    },
    querySourceFeatures(source, query) {
      calls.push(['querySourceFeatures', source, query]);
      // Tiles repeat a feature that crosses them.
      return [
        {id: 1, source, properties: {}},
        {id: 1, source, properties: {}},
        {id: 2, source, properties: {}},
      ];
    },
    getCanvas: () => ({clientWidth: 400, clientHeight: 800}),
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    off(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    /** A theme change: the new style holds only what it declares, then loads. */
    changeStyle() {
      order = [...authored];
      sources = new Map();
      state = new Map();
      emit('style.load');
    },
    /** A 3D layer that another part of the map adds under an anchor after the application. */
    add3D(id) {
      const index = order.findIndex((entry) => entry.id === 'labels');
      order.splice(index, 0, {id, type: 'fill-extrusion'});
      emit('styledata');
    },
  };
  return map;
}

function registry(
  map = fakeMap(),
  payloads: Record<string, unknown> = {},
  warnings: string[] = [],
) {
  return createStyleRegistry(map, {
    readJSON: async (data) => {
      if (!(data.id in payloads)) throw new Error('Unregistered data.');
      return structuredClone(payloads[data.id]);
    },
    warn: (message) => warnings.push(message),
  });
}

const layer = (id: string, source = 'points', extra: Record<string, unknown> = {}) => ({
  id,
  type: 'circle' as const,
  source,
  ...extra,
});
const app = (id: string) => `__tileflow_layer_${id}`;
const appSource = (id: string) => `__tileflow_source_${id}`;

test('slots are Core overlay placements', () => {
  assert.deepEqual([...layerSlots], [...tileflowOverlayPlacements]);
});

test('layers sit in their slots in the order the application arranges them', async () => {
  const map = fakeMap();
  const style = registry(map, {[reference('a').id]: collection(point(1))});
  await style.addSource({id: 'points', source: {type: 'geojson', data: reference('a')}}, never);
  await style.addLayer({layer: layer('top')}, never);
  await style.addLayer({layer: layer('under-labels'), slot: 'below-labels'}, never);
  await style.addLayer({layer: layer('water'), slot: 'above-water'}, never);
  await style.addLayer({layer: layer('over'), position: {above: 'under-labels'}}, never);
  await style.addLayer({layer: layer('under'), position: {below: 'under-labels'}}, never);
  assert.deepEqual(map.ids(), [
    'water',
    app('water'),
    'roads',
    'buildings',
    app('under'),
    app('under-labels'),
    app('over'),
    'labels',
    app('top'),
  ]);
  await style.moveLayer({id: 'top', slot: 'above-roads'}, never);
  assert.deepEqual(map.ids().slice(2, 5), ['roads', app('top'), 'buildings']);
  await style.moveLayer({id: 'water', position: {above: 'over'}}, never);
  assert.deepEqual(map.ids().slice(-3), [app('over'), app('water'), 'labels']);
  await style.removeLayer({id: 'over'}, never);
  assert.equal(map.getLayer(app('over')), undefined);
  await assert.rejects(style.removeLayer({id: 'over'}, never), (error: ProtocolError) => {
    assert.equal(error.toWire().context?.reason, 'unknownLayer');
    return true;
  });
});

test('layers above the buildings stay above 3D layers the map adds later', async () => {
  const map = fakeMap();
  const style = registry(map);
  await style.addSource({id: 'points', source: {type: 'geojson', data: {empty: true}}}, never);
  await style.addLayer({layer: layer('pins'), slot: 'above-buildings'}, never);
  await style.addLayer({layer: layer('ground'), slot: 'above-water'}, never);
  map.add3D('3d-buildings');
  assert.deepEqual(map.ids().slice(-3), [app('pins'), '3d-buildings', 'labels']);
  map.emit('idle');
  assert.deepEqual(map.ids().slice(-3), ['3d-buildings', app('pins'), 'labels']);
  // A settled map in order is left alone.
  const moves = map.calls.filter((call) => call[0] === 'moveLayer').length;
  map.emit('styledata');
  map.emit('idle');
  assert.equal(map.calls.filter((call) => call[0] === 'moveLayer').length, moves);
});

test('a style without placements puts slotted layers under its labels', async () => {
  const map = fakeMap({anchors: undefined});
  // An explicit empty manifest stands for a style that declares none.
  (map as {getStyle: () => unknown}).getStyle = () => ({
    layers: map.ids().map((id) => ({id, type: id === 'labels' ? 'symbol' : 'fill'})),
    metadata: {},
  });
  const style = registry(map);
  await style.addSource({id: 'points', source: {type: 'geojson', data: {empty: true}}}, never);
  await style.addLayer({layer: layer('a'), slot: 'above-water'}, never);
  await style.addLayer({layer: layer('b'), slot: 'above-labels'}, never);
  assert.deepEqual(map.ids().slice(-3), [app('a'), 'labels', app('b')]);
});

test('a refused layer, source or change leaves the style as it was', async () => {
  const map = fakeMap();
  const style = registry(map, {[reference('a').id]: collection(point(1))});
  await assert.rejects(
    style.addLayer({layer: layer('a', 'missing')}, never),
    (error: ProtocolError) => error.toWire().context?.reason === 'unknownSource',
  );
  await style.addSource({id: 'points', source: {type: 'geojson', data: reference('a')}}, never);
  await assert.rejects(
    style.addSource({id: 'points', source: {type: 'geojson', data: {empty: true}}}, never),
    ProtocolError,
  );
  await assert.rejects(
    style.addLayer({layer: layer('bad', 'points', {paint: {'circle-radius': 'large'}})}, never),
    (error: ProtocolError) => {
      // MapLibre's message names the application's layer, not its internal identifier.
      assert.match(error.message, /^layers\.bad\.paint\.circle-radius/u);
      return true;
    },
  );
  assert.equal(map.getLayer(app('bad')), undefined);
  await style.addLayer({layer: layer('good', 'points', {paint: {'circle-radius': 4}})}, never);
  await assert.rejects(
    style.updateLayer({layer: layer('good', 'points', {paint: {'circle-radius': 'large'}})}, never),
    ProtocolError,
  );
  assert.deepEqual((map.getLayer(app('good')) as Layer).paint, {'circle-radius': 4});
  await assert.rejects(style.removeSource({id: 'points'}, never), /used by good/u);
  // A later request still applies after refused ones.
  await style.updateLayer({layer: layer('good', 'points', {paint: {'circle-radius': 6}})}, never);
  assert.deepEqual(map.calls.at(-1), ['setPaintProperty', app('good'), 'circle-radius', 6]);
});

test('updating a layer sends only what changed', async () => {
  const map = fakeMap();
  const style = registry(map);
  await style.addSource({id: 'points', source: {type: 'geojson', data: {empty: true}}}, never);
  await style.addLayer(
    {layer: layer('a', 'points', {paint: {'circle-radius': 4, 'circle-color': '#000'}})},
    never,
  );
  const before = map.calls.length;
  await style.updateLayer(
    {
      layer: layer('a', 'points', {
        paint: {'circle-radius': 4},
        layout: {visibility: 'none'},
        filter: ['==', ['get', 'kind'], 'cafe'],
        minzoom: 5,
      }),
    },
    never,
  );
  assert.deepEqual(map.calls.slice(before), [
    ['setPaintProperty', app('a'), 'circle-color', null],
    ['setLayoutProperty', app('a'), 'visibility', 'none'],
    ['setFilter', app('a'), ['==', ['get', 'kind'], 'cafe']],
    ['setLayerZoomRange', app('a'), 5, 24],
  ]);
  // Another type is a new layer in the same place.
  await style.updateLayer({layer: {id: 'a', type: 'heatmap', source: 'points'}}, never);
  assert.equal((map.getLayer(app('a')) as Layer).type, 'heatmap');
});

test('a style change brings back sources, data, layers and feature state', async () => {
  const map = fakeMap();
  const warnings: string[] = [];
  const style = registry(
    map,
    {
      [reference('a').id]: collection(point(1), point(2)),
      [reference('b').id]: [point(3, 1), point(2, 5)],
    },
    warnings,
  );
  await style.addSource({id: 'points', source: {type: 'geojson', data: reference('a')}}, never);
  await style.addSource(
    {id: 'tiles', source: {type: 'vector', url: 'https://tiles.example/v.json'}},
    never,
  );
  await style.addLayer({layer: layer('a'), slot: 'below-labels'}, never);
  await style.addLayer({layer: layer('b')}, never);
  await style.updateGeoJSONSource({id: 'points', add: reference('b'), remove: ['1']}, never);
  await style.setFeatureState({source: 'points', id: '2', state: {selected: true}}, never);
  await style.setFeatureState(
    {source: 'tiles', sourceLayer: 'roads', id: 'a-road', state: {hover: 1}},
    never,
  );
  map.changeStyle();
  assert.deepEqual(warnings, []);
  assert.deepEqual(map.ids(), ['water', 'roads', 'buildings', app('a'), 'labels', app('b')]);
  // The source comes back with the data its updates left.
  assert.deepEqual(map.data(appSource('points')), collection(point(2, 5), point(3, 1)));
  const restored = map.calls.filter((call) => call[0] === 'setFeatureState').slice(-2);
  assert.deepEqual(restored, [
    ['setFeatureState', appSource('points'), 2, {selected: true}],
    ['setFeatureState', appSource('tiles'), 'a-road', {hover: 1}],
  ]);
  assert.deepEqual(await style.getFeatureState({source: 'points', id: '2'}, never), {
    selected: true,
  });
  await style.removeFeatureState({source: 'points', id: '2', key: 'selected'}, never);
  assert.deepEqual(await style.getFeatureState({source: 'points', id: '2'}, never), {});
});

test('requests wait for a loading style and apply in order', async () => {
  const map = fakeMap();
  const style = registry(map, {[reference('a').id]: collection(point(1))});
  map.style = {_loaded: false};
  const added = style.addSource(
    {id: 'points', source: {type: 'geojson', data: reference('a')}},
    never,
  );
  const layered = style.addLayer({layer: layer('a')}, never);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(map.getSource(appSource('points')), undefined);
  map.style = {_loaded: true};
  map.emit('style.load');
  await Promise.all([added, layered]);
  assert.ok(map.getLayer(app('a')));
});

test('features change one by one and need identifiers', async () => {
  const map = fakeMap();
  const style = registry(map, {
    [reference('a').id]: collection(point(1), {...point(2), id: undefined}),
    [reference('b').id]: [point(4)],
    [reference('c').id]: [{type: 'Feature'}],
  });
  await style.addSource({id: 'points', source: {type: 'geojson', data: reference('a')}}, never);
  await assert.rejects(
    style.updateGeoJSONSource({id: 'points', add: reference('b')}, never),
    /unique identifier/u,
  );
  await style.setGeoJSONSourceData({id: 'points', data: {empty: true}}, never);
  await style.updateGeoJSONSource({id: 'points', add: reference('b')}, never);
  assert.deepEqual(map.calls.at(-1), ['updateData', appSource('points'), {add: [point(4)]}]);
  // A removal by string finds a numeric identifier; unknown identifiers are ignored.
  await style.updateGeoJSONSource({id: 'points', remove: ['4', 'nobody']}, never);
  assert.deepEqual(map.calls.at(-1), ['updateData', appSource('points'), {remove: [4]}]);
  await assert.rejects(
    style.updateGeoJSONSource({id: 'points', add: reference('c')}, never),
    (error: ProtocolError) => error.toWire().context?.reason === 'invalidGeoJSON',
  );
  await style.addSource(
    {id: 'remote', source: {type: 'geojson', data: {url: 'https://data.example/a.json'}}},
    never,
  );
  await assert.rejects(
    style.updateGeoJSONSource({id: 'remote', remove: ['1']}, never),
    /from an address/u,
  );
});

test('clusters answer children, leaves and expansion zoom', async () => {
  const map = fakeMap();
  const style = registry(map);
  await style.addSource(
    {id: 'points', source: {type: 'geojson', data: {empty: true}, cluster: true}},
    never,
  );
  await style.addSource({id: 'plain', source: {type: 'geojson', data: {empty: true}}}, never);
  const ask = (query: 'children' | 'leaves' | 'expansionZoom', cluster = 7) =>
    style.queryCluster({source: 'points', cluster, query, limit: 2, offset: 1}, never);
  assert.equal(await ask('expansionZoom'), 11);
  assert.deepEqual(
    ((await ask('children')) as {id: number}[]).map((feature) => feature.id),
    [1, 2],
  );
  assert.deepEqual(
    ((await ask('leaves')) as {id: number; source: string}[]).map((feature) => [
      feature.id,
      feature.source,
    ]),
    [
      [2, 'points'],
      [3, 'points'],
    ],
  );
  await assert.rejects(ask('children', 8), /no cluster 8/u);
  await assert.rejects(
    style.queryCluster(
      {source: 'plain', cluster: 1, query: 'children', limit: 1, offset: 0},
      never,
    ),
    /does not cluster/u,
  );
});

test('queries read application layers and name them as the application does', async () => {
  const map = fakeMap();
  const style = registry(map);
  assert.deepEqual(await style.queryRenderedFeatures({limit: 10}, never), []);
  await style.addSource({id: 'points', source: {type: 'geojson', data: {empty: true}}}, never);
  await style.addLayer({layer: layer('a')}, never);
  await style.addLayer({layer: layer('b')}, never);
  const found = (await style.queryRenderedFeatures(
    {geometry: {point: {x: 5, y: 6}}, layers: ['b'], filter: ['has', 'name'], limit: 10},
    never,
  )) as {layer: string; source: string; id: number}[];
  assert.deepEqual(
    found.map((feature) => [feature.layer, feature.source, feature.id]),
    [['b', 'points', 1]],
  );
  assert.deepEqual(map.calls.at(-1), [
    'queryRenderedFeatures',
    {x: 5, y: 6},
    {layers: [app('b')], filter: ['has', 'name']},
  ]);
  // Without a polygon query in the map, a box queries its bounds.
  await style.queryRenderedFeatures(
    {
      geometry: {
        box: [
          {x: 30, y: 40},
          {x: 10, y: 20},
        ],
      },
      limit: 10,
    },
    never,
  );
  assert.deepEqual(map.calls.at(-1)?.[1], [
    [10, 20],
    [30, 40],
  ]);
  const sourceFeatures = (await style.querySourceFeatures(
    {source: 'points', limit: 10},
    never,
  )) as {id: number}[];
  assert.deepEqual(
    sourceFeatures.map((feature) => feature.id),
    [1, 2],
  );
  await assert.rejects(
    style.queryRenderedFeatures({layers: ['missing'], limit: 1}, never),
    ProtocolError,
  );
});

test('at a steep pitch a query runs in bands and finds each feature once', async () => {
  const map = fakeMap();
  const polygons: {x: number; y: number}[][] = [];
  map.transform = {pitch: 80, cameraToCenterDistance: 1000, centerPoint: {y: 400}};
  map.style = {
    _loaded: true,
    queryRenderedFeatures: (polygon) => {
      polygons.push(polygon);
      return [{id: 1, source: appSource('points'), layer: {id: app('a')}, properties: {}}];
    },
  };
  const style = registry(map);
  await style.addSource({id: 'points', source: {type: 'geojson', data: {empty: true}}}, never);
  await style.addLayer({layer: layer('a')}, never);
  const found = await style.queryRenderedFeatures({limit: 10}, never);
  assert.equal(found.length, 1);
  assert.equal(polygons.length, Math.ceil(800 / 64));
  assert.ok(
    polygons.every(
      (polygon) =>
        Math.max(...polygon.map((p) => p.y)) - Math.min(...polygon.map((p) => p.y)) <= 64,
    ),
  );
});

test('polygons clip to bands', () => {
  const square = [
    {x: 0, y: 0},
    {x: 10, y: 0},
    {x: 10, y: 10},
    {x: 0, y: 10},
    {x: 0, y: 0},
  ];
  assert.deepEqual(clipBand(square, 2, 4), [
    {x: 10, y: 2},
    {x: 10, y: 4},
    {x: 0, y: 4},
    {x: 0, y: 2},
    {x: 10, y: 2},
  ]);
  assert.equal(clipBand(square, 20, 30), undefined);
  const triangle = [
    {x: 0, y: 0},
    {x: 10, y: 20},
    {x: -10, y: 20},
    {x: 0, y: 0},
  ];
  assert.equal(bands(triangle, 5).length, 4);
});

test('feature identifiers follow MapLibre', () => {
  assert.equal(featureStateId('42'), 42);
  assert.equal(featureStateId('042'), '042');
  assert.equal(featureStateId('a-road'), 'a-road');
  assert.equal(featureStateId(7), 7);
});

test('requests keep MapLibre names and Tileflow limits', () => {
  assert.equal(
    addSourceSchema.safeParse({
      id: 'tiles',
      source: {type: 'vector', url: 'https://a/v.json', tiles: ['https://a/{z}/{x}/{y}.pbf']},
    }).success,
    false,
  );
  assert.equal(
    addSourceSchema.safeParse({
      id: 'dem',
      source: {type: 'raster-dem', tiles: ['https://a/{z}/{x}/{y}.png'], encoding: 'terrarium'},
    }).success,
    true,
  );
  assert.equal(
    addLayerSchema.safeParse({layer: {id: 'bg', type: 'background', source: 'points'}}).success,
    false,
  );
  assert.equal(
    addLayerSchema.safeParse({layer: {id: 'x', type: 'circle', source: 'p', paint: {Bad: 1}}})
      .success,
    false,
  );
  assert.equal(updateGeoJSONSourceSchema.safeParse({id: 'p'}).success, false);
  assert.equal(queryRenderedFeaturesSchema.parse({geometry: {point: {x: 1, y: 2}}}).limit, 1000);
});
