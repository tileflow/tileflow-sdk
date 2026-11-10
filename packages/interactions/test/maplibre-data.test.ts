import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowAnnotation, TileflowInteractionEvent} from '../src/contracts';
import {
  createTileflowMapLibreDataRuntime,
  type TileflowMapLibreDataFeature,
  type TileflowMapLibreDataMap,
  type TileflowMapLibreDataOverlay,
  type TileflowMapLibreDataSource,
} from '../src/maplibre-data';
import type {TileflowInteractionDiagnostic} from '../src/validation';

type Listener = (event: never) => void;
type FakeLayer = Record<string, unknown> & {id: string; metadata?: unknown};
type FakeSource = {
  data: unknown;
  definition: Record<string, unknown>;
  getClusterExpansionZoom: (id: number) => Promise<number>;
  serialize: () => {data: unknown};
  setData: (data: unknown) => void;
  setDataCalls: number;
};

class FakeElement {
  readonly attributes = new Map<string, string>();
  className = '';
  focused = 0;
  ownerDocument: {activeElement: FakeElement | null} = {activeElement: null};
  removed = false;
  readonly style: Record<string, string> = {};
  textContent = '';
  type = '';
  private readonly listeners = new Map<string, (event: {detail: number}) => void>();

  addEventListener(type: string, listener: (event: {detail: number}) => void) {
    this.listeners.set(type, listener);
  }
  click(detail = 1) {
    this.listeners.get('click')?.({detail});
  }
  remove() {
    this.removed = true;
  }
  removeEventListener(type: string) {
    this.listeners.delete(type);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

class FakeMarker {
  added = false;
  coordinate?: [number, number];
  removed = false;
  constructor(readonly element: FakeElement) {}
  addTo() {
    this.added = true;
  }
  remove() {
    this.removed = true;
  }
  setLngLat(coordinate: [number, number]) {
    this.coordinate = coordinate;
  }
}

function createMap(initial: {layers?: FakeLayer[]; metadata?: Record<string, unknown>} = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const layerListeners = new Set<string>();
  const sources = new Map<string, FakeSource>();
  let layers: FakeLayer[] = [...(initial.layers ?? [])];
  const eased: {center: [number, number]; zoom: number}[] = [];
  const canvas = {
    focusCalls: 0,
    style: {cursor: ''},
    focus() {
      this.focusCalls += 1;
    },
  };
  let zoom = 3;
  let features: TileflowMapLibreDataFeature[] = [];

  const createSource = (definition: Record<string, unknown>): FakeSource => {
    const source: FakeSource = {
      data: definition.data,
      definition,
      getClusterExpansionZoom: async (id) => id + 5,
      serialize: () => ({data: source.data}),
      setData(data) {
        source.data = data;
        source.setDataCalls += 1;
      },
      setDataCalls: 0,
    };
    return source;
  };

  const map = {
    addLayer(layer: FakeLayer, beforeId?: string) {
      const index = beforeId ? layers.findIndex(({id}) => id === beforeId) : layers.length;
      layers.splice(index, 0, layer);
    },
    addSource(id: string, definition: Record<string, unknown>) {
      sources.set(id, createSource(definition));
    },
    easeTo(options: {center: [number, number]; zoom: number}) {
      eased.push(options);
    },
    getCanvas: () => canvas,
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    getLayersOrder: () => layers.map(({id}) => id),
    getSource: (id: string) => sources.get(id),
    getStyle: () => ({layers, metadata: initial.metadata}),
    getZoom: () => zoom,
    isStyleLoaded: () => true,
    off(event: string, second: unknown, third?: unknown) {
      if (third) layerListeners.delete(event);
      else listeners.get(event)?.delete(second as Listener);
    },
    on(event: string, second: unknown, third?: unknown) {
      if (third) {
        layerListeners.add(event);
        return;
      }
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(second as Listener);
    },
    queryRenderedFeatures: () => features,
    removeLayer(id: string) {
      layers = layers.filter((layer) => layer.id !== id);
    },
    removeSource(id: string) {
      assert.ok(
        !layers.some((layer) => layer.source === id),
        `source ${id} is still used by a layer`,
      );
      sources.delete(id);
    },
  };

  return {
    canvas,
    eased,
    fire(event: string, value: unknown = {}) {
      for (const listener of listeners.get(event) ?? []) listener(value as never);
    },
    layerIds: () => layers.map(({id}) => id),
    layerListeners,
    layers: () => layers,
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    map: map as unknown as TileflowMapLibreDataMap,
    /** What a style change does: anything the next style does not declare is gone. */
    replaceStyle(next: FakeLayer[] = initial.layers ?? []) {
      layers = [...next];
      sources.clear();
      this.fire('styledata');
    },
    setFeatures(next: TileflowMapLibreDataFeature[]) {
      features = next;
    },
    setZoom(next: number) {
      zoom = next;
      this.fire('zoom');
    },
    sources,
  };
}

function attach(fake: ReturnType<typeof createMap>) {
  const diagnostics: TileflowInteractionDiagnostic[] = [];
  const events: TileflowInteractionEvent[] = [];
  const hidden: ReadonlySet<string>[] = [];
  const markers: FakeMarker[] = [];
  const runtime = createTileflowMapLibreDataRuntime<unknown, FakeMarker>({
    createMarker({element}) {
      const marker = new FakeMarker(element as unknown as FakeElement);
      markers.push(marker);
      return marker;
    },
    document: {createElement: () => new FakeElement()} as never,
    map: fake.map as never,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    onInteractionEvent: (event) => events.push(event),
    setHiddenAnnotations: (ids) => hidden.push(ids),
  });
  return {diagnostics, events, hidden, markers, runtime};
}

const stores: TileflowMapLibreDataSource = {
  cluster: true,
  clusterRadius: 40,
  data: {features: [], type: 'FeatureCollection'},
  kind: 'geojson',
};

const bubbles = (role: string, expandOnClick = true) => ({
  'tileflow:cluster': {expandOnClick, role},
});

const overlay: TileflowMapLibreDataOverlay = {
  kind: 'maplibre-overlay',
  layers: [
    {id: 'stores-clusters', metadata: bubbles('cluster'), type: 'circle'},
    {
      id: 'stores-cluster-count',
      layout: {'text-field': ['get', 'point_count_abbreviated']},
      metadata: bubbles('count'),
      type: 'symbol',
    },
    {id: 'stores-points', metadata: bubbles('point'), type: 'circle'},
  ],
  placement: 'below-labels',
  source: 'stores',
};

const labels: FakeLayer = {id: 'labels', layout: {'text-font': ['Noto Sans Regular']}};
const manifest = {
  'tileflow:overlay-placement-manifest': {
    anchors: {'above-labels': null, 'below-labels': 'labels'},
  },
};

test('adds runtime sources and overlays at the semantic placement with the map label font', () => {
  const fake = createMap({layers: [labels], metadata: manifest});
  const {diagnostics, runtime} = attach(fake);

  runtime.reconcile({dataOverlays: {stores: overlay}, dataSources: {stores}});

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(fake.layerIds(), [
    'stores-clusters',
    'stores-cluster-count',
    'stores-points',
    'labels',
  ]);
  const count = fake.layers()[1]!;
  assert.deepEqual((count.layout as Record<string, unknown>)['text-font'], ['Noto Sans Regular']);
  assert.equal(count.source, 'stores');
  assert.equal((count.metadata as Record<string, unknown>)['tileflow:overlay'], 'stores');
  assert.equal(fake.sources.get('stores')?.definition.clusterRadius, 40);
  assert.equal(fake.sources.get('stores')?.definition.type, 'geojson');
});

test('fills a compiled source and leaves its compiled layers alone', () => {
  const fake = createMap({layers: [{id: 'stores-clusters', metadata: bubbles('cluster')}]});
  fake.map.addSource('stores', {data: {features: [], type: 'FeatureCollection'}} as never);
  const {runtime} = attach(fake);
  const data = {features: [{type: 'Feature'}], type: 'FeatureCollection'};

  runtime.reconcile({
    dataOverlays: {
      stores: {...overlay, layers: [overlay.layers[0]!]},
    },
    dataSources: {stores: {...stores, data}},
  });

  assert.equal(fake.sources.get('stores')?.data, data);
  assert.equal(fake.sources.get('stores')?.setDataCalls, 1);
  assert.deepEqual(fake.layerIds(), ['stores-clusters']);

  runtime.reconcile({dataSources: {stores: {...stores, data}}});
  assert.equal(fake.sources.get('stores')?.setDataCalls, 1);
  assert.deepEqual(fake.layerIds(), ['stores-clusters']);
  assert.ok(fake.sources.has('stores'));
});

test('new data replaces source contents without rebuilding it', () => {
  const fake = createMap({layers: [labels]});
  const {runtime} = attach(fake);
  runtime.reconcile({dataOverlays: {stores: overlay}, dataSources: {stores}});
  const source = fake.sources.get('stores');
  const data = {features: [{type: 'Feature'}], type: 'FeatureCollection'};

  runtime.reconcile({dataOverlays: {stores: overlay}, dataSources: {stores: {...stores, data}}});

  assert.equal(fake.sources.get('stores'), source);
  assert.equal(source?.data, data);
});

test('changed cluster options rebuild the source and its layers in order', () => {
  const fake = createMap({layers: [labels], metadata: manifest});
  const {diagnostics, runtime} = attach(fake);
  runtime.reconcile({dataOverlays: {stores: overlay}, dataSources: {stores}});

  runtime.reconcile({
    dataOverlays: {stores: overlay},
    dataSources: {stores: {...stores, clusterRadius: 80}},
  });

  assert.deepEqual(diagnostics, []);
  assert.equal(fake.sources.get('stores')?.definition.clusterRadius, 80);
  assert.equal(fake.layerIds().length, 4);
});

test('runtime data returns after a style change and removed entries leave cleanly', () => {
  const fake = createMap({layers: [labels], metadata: manifest});
  const {diagnostics, runtime} = attach(fake);
  const data = {features: [{type: 'Feature'}], type: 'FeatureCollection'};
  const input = {dataOverlays: {stores: overlay}, dataSources: {stores: {...stores, data}}};
  runtime.reconcile(input);

  fake.replaceStyle();

  assert.equal(fake.sources.get('stores')?.data, data);
  assert.equal(fake.layerIds().length, 4);

  runtime.reconcile({});
  assert.deepEqual(fake.layerIds(), ['labels']);
  assert.equal(fake.sources.has('stores'), false);
  assert.deepEqual(diagnostics, []);
});

test('reports an overlay without a source and a source that is not GeoJSON', () => {
  const fake = createMap();
  fake.sources.set('world', {} as FakeSource);
  const {diagnostics, runtime} = attach(fake);

  runtime.reconcile({
    dataOverlays: {stores: overlay},
    dataSources: {world: {data: {}, kind: 'geojson'}},
  });

  assert.deepEqual(
    diagnostics.map(({code, path}) => [code, path]),
    [
      ['INVALID_DATA_LAYER', '/dataSources/world'],
      ['INVALID_DATA_LAYER', '/dataOverlays/stores/source'],
    ],
  );
  assert.deepEqual(fake.layerIds(), []);
});

test('reports a count layer on a style with no label font', () => {
  const fake = createMap();
  const {diagnostics, runtime} = attach(fake);

  runtime.reconcile({dataOverlays: {stores: overlay}, dataSources: {stores}});

  assert.equal(diagnostics[0]?.code, 'INVALID_DATA_LAYER');
  assert.deepEqual(fake.layerIds(), ['stores-clusters', 'stores-points']);
});

function clusterFeature(layer = 'stores-clusters'): TileflowMapLibreDataFeature {
  return {
    geometry: {coordinates: [-3.7, 40.4], type: 'Point'},
    layer: {id: layer},
    properties: {cluster: true, cluster_id: 7, point_count: 12, total: 90},
    source: 'stores',
  };
}

test('clicking a cluster zooms to where it splits and reports it first', async () => {
  const fake = createMap({layers: [labels]});
  const {events, runtime} = attach(fake);
  runtime.reconcile({dataOverlays: {stores: overlay}, dataSources: {stores}});
  fake.setFeatures([clusterFeature()]);
  let prevented = false;

  fake.fire('click', {
    point: {x: 1, y: 1},
    preventDefault() {
      prevented = true;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(prevented);
  assert.deepEqual(fake.eased, [{center: [-3.7, 40.4], zoom: 12}]);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'target:activate');
  assert.deepEqual(events[0]?.target, {
    clusterId: 7,
    coordinate: [-3.7, 40.4],
    kind: 'cluster',
    pointCount: 12,
    properties: {cluster: true, cluster_id: 7, point_count: 12, total: 90},
    source: 'stores',
  });
});

test('a compiled cluster overlay expands with no runtime props at all', async () => {
  const fake = createMap({layers: [{id: 'stores-clusters', metadata: bubbles('cluster')}]});
  fake.map.addSource('stores', {data: {}} as never);
  const {runtime} = attach(fake);
  runtime.reconcile({});
  fake.setFeatures([clusterFeature()]);

  fake.fire('click', {point: {x: 1, y: 1}});
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fake.eased.length, 1);
  assert.ok(fake.layerListeners.has('mouseenter'));
});

test('expandOnClick: false reports the cluster and leaves the camera alone', async () => {
  const fake = createMap({layers: [{id: 'stores-clusters', metadata: bubbles('cluster', false)}]});
  fake.map.addSource('stores', {data: {}} as never);
  const {events, runtime} = attach(fake);
  runtime.reconcile({});
  fake.setFeatures([clusterFeature()]);

  fake.fire('click', {point: {x: 1, y: 1}});
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fake.eased.length, 0);
  assert.equal(events[0]?.target.kind, 'cluster');
});

test('clicking a separate point reports its feature', () => {
  const fake = createMap({layers: [labels]});
  const {events, runtime} = attach(fake);
  runtime.reconcile({dataOverlays: {stores: overlay}, dataSources: {stores}});
  fake.setFeatures([
    {
      geometry: {coordinates: [2, 41], type: 'Point'},
      id: 'store-1',
      layer: {id: 'stores-points'},
      properties: {name: 'Gracia'},
      source: 'stores',
    },
  ]);

  fake.fire('click', {originalEvent: {pointerType: 'touch'}, point: {x: 1, y: 1}});

  assert.equal(events[0]?.inputModality, 'touch');
  assert.deepEqual(events[0]?.target, {
    coordinate: [2, 41],
    feature: {id: 'store-1', properties: {name: 'Gracia'}},
    kind: 'style-feature',
    layerId: 'stores-points',
  });
});

const annotation = (id: string, coordinate: [number, number]): TileflowAnnotation => ({
  ariaLabel: id,
  coordinate,
  id,
  kind: 'marker',
});

const nearby = [
  annotation('a', [-3.7, 40.4]),
  annotation('b', [-3.7001, 40.4001]),
  annotation('c', [-3.7002, 40.4002]),
  annotation('far', [2.17, 41.38]),
];

test('annotations collapse into a keyboard-reachable button that names its members', () => {
  const fake = createMap();
  fake.setZoom(4);
  const {events, hidden, markers, runtime} = attach(fake);

  runtime.reconcile({
    annotationClusters: {formatAriaLabel: (count) => `${count} tiendas`},
    annotations: nearby,
  });

  assert.deepEqual([...hidden.at(-1)!].sort(), ['a', 'b', 'c']);
  assert.equal(markers.length, 1);
  const element = markers[0]!.element;
  assert.equal(element.type, 'button');
  assert.equal(element.textContent, '3');
  assert.equal(element.attributes.get('aria-label'), '3 tiendas');
  assert.ok(markers[0]!.added);

  element.click();

  const target = events[0]?.target;
  assert.equal(target?.kind, 'cluster');
  assert.deepEqual(target?.kind === 'cluster' ? [...(target.annotationIds ?? [])].sort() : [], [
    'a',
    'b',
    'c',
  ]);
  assert.equal(fake.eased.length, 1);
  assert.ok(fake.eased[0]!.zoom > 4);
});

test('activating a cluster button from the keyboard reports the keyboard', () => {
  const fake = createMap();
  fake.setZoom(4);
  const {events, markers, runtime} = attach(fake);
  runtime.reconcile({annotationClusters: {}, annotations: nearby});

  markers[0]!.element.click(0);
  markers[0]!.element.click(1);

  assert.deepEqual(
    events.map((event) => event.inputModality),
    ['keyboard', 'pointer'],
  );
});

test('an equal annotation list and inline options keep the same buttons', () => {
  const fake = createMap();
  fake.setZoom(4);
  const {markers, runtime} = attach(fake);
  runtime.reconcile({annotationClusters: {clusterRadius: 60}, annotations: nearby});

  runtime.reconcile({
    annotationClusters: {clusterRadius: 60},
    annotations: nearby.map((item) => ({...item})),
  });

  assert.equal(markers.length, 1);
  assert.equal(markers[0]!.removed, false);
});

test('a moved annotation rebuilds its cluster and keeps keyboard focus on the map', () => {
  const fake = createMap();
  fake.setZoom(4);
  const {markers, runtime} = attach(fake);
  runtime.reconcile({annotationClusters: {}, annotations: nearby});
  const element = markers[0]!.element;
  element.ownerDocument.activeElement = element;

  runtime.reconcile({
    annotationClusters: {},
    annotations: [...nearby.slice(0, 2), annotation('c', [-3.7003, 40.4003])],
  });

  assert.ok(markers[0]!.removed);
  assert.equal(markers.length, 2);
  assert.equal(fake.canvas.focusCalls, 1);
});

test('a new accessible name reaches existing cluster buttons', () => {
  const fake = createMap();
  fake.setZoom(4);
  const {markers, runtime} = attach(fake);
  runtime.reconcile({annotationClusters: {}, annotations: nearby});

  runtime.reconcile({
    annotationClusters: {formatAriaLabel: (count) => `${count} tiendas`},
    annotations: nearby,
  });

  assert.equal(markers.length, 1);
  assert.equal(markers[0]!.element.attributes.get('aria-label'), '3 tiendas');
});

test('zooming past a cluster brings its annotations back and restores keyboard focus', () => {
  const fake = createMap();
  fake.setZoom(4);
  const {hidden, markers, runtime} = attach(fake);
  runtime.reconcile({annotationClusters: {clusterMaxZoom: 8}, annotations: nearby});
  const element = markers[0]!.element;
  element.ownerDocument.activeElement = element;

  fake.setZoom(9);

  assert.equal(hidden.at(-1)?.size, 0);
  assert.ok(markers[0]!.removed);
  assert.equal(fake.canvas.focusCalls, 1);
});

test('panning and zooming inside an integer zoom does not recompute clusters', () => {
  const fake = createMap();
  fake.setZoom(4);
  const {hidden, runtime} = attach(fake);
  runtime.reconcile({annotationClusters: {}, annotations: nearby});
  const renders = hidden.length;

  fake.setZoom(4.7);

  assert.equal(hidden.length, renders);
});

test('removing annotationClusters shows every annotation and removes the buttons', () => {
  const fake = createMap();
  fake.setZoom(4);
  const {hidden, markers, runtime} = attach(fake);
  runtime.reconcile({annotationClusters: {}, annotations: nearby});

  runtime.reconcile({annotations: nearby});

  assert.equal(hidden.at(-1)?.size, 0);
  assert.ok(markers[0]!.removed);
});

test('dispose removes listeners, buttons and pointer feedback', () => {
  const fake = createMap({layers: [labels]});
  fake.setZoom(4);
  const {hidden, markers, runtime} = attach(fake);
  runtime.reconcile({
    annotationClusters: {},
    annotations: nearby,
    dataOverlays: {stores: overlay},
    dataSources: {stores},
  });

  runtime.dispose();
  runtime.dispose();

  assert.equal(fake.listenerCount(), 0);
  assert.ok(markers[0]!.removed);
  assert.equal(fake.layerListeners.size, 0);
  assert.equal(fake.map.getLayer('stores-clusters'), undefined);
  assert.equal(fake.map.getSource('stores'), undefined);
  assert.equal(hidden.at(-1)?.size, 0);
});
