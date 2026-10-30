import assert from 'node:assert/strict';
import test from 'node:test';
import {attachTileflowLabelPlacement} from '../src/label-placement-browser';
import {attachTileflowSkyHaze, tileflowSkyHazeLayerId} from '../src/sky-haze-browser';

const base = ['==', ['get', 'eligible'], true];
const metadata = (_kind: 'poi' | 'road' | 'address') => ({});
class FakeMap {
  bearing = 0;
  center = {lng: 0, lat: 0};
  pitch = 60;
  zoom = 16;
  canvas = {clientWidth: 1000, clientHeight: 1000};
  layers: {
    id: string;
    type?: string;
    renderingMode?: string;
    filter?: unknown;
    metadata?: unknown;
  }[] = [
    {id: 'poi', filter: base as unknown, metadata: metadata('poi')},
    {id: 'road', filter: base as unknown, metadata: metadata('road')},
    {id: 'other', filter: base as unknown, metadata: {}},
  ];
  listeners = new Map<string, Set<() => void>>();
  styleMetadata: Record<string, unknown> = {};
  moves = 0;
  writes = 0;
  getBearing() {
    return this.bearing;
  }
  getCanvas() {
    return this.canvas;
  }
  getCenter() {
    return this.center;
  }
  getFilter(id: string) {
    return this.getLayer(id)?.filter;
  }
  getLayer(id: string) {
    return this.layers.find((layer) => layer.id === id);
  }
  getPitch() {
    return this.pitch;
  }
  getStyle() {
    return {
      layers: this.layers.filter((layer) => layer.type !== 'custom'),
      metadata: this.styleMetadata,
    };
  }
  getLayersOrder() {
    return this.layers.map((layer) => layer.id);
  }
  getZoom() {
    return this.zoom;
  }
  setFilter(id: string, filter: unknown) {
    this.getLayer(id)!.filter = filter;
    this.writes++;
  }
  moveLayer(id: string, beforeId?: string) {
    const layer = this.getLayer(id)!;
    this.layers = this.layers.filter((entry) => entry !== layer);
    const index =
      beforeId === undefined
        ? this.layers.length
        : this.layers.findIndex((entry) => entry.id === beforeId);
    this.layers.splice(index, 0, layer);
    this.moves++;
    this.fire('styledata');
  }
  on(event: string, listener: () => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  off(event: string, listener: () => void) {
    this.listeners.get(event)?.delete(listener);
  }
  fire(event: string) {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
}

function groundScene() {
  const map = new FakeMap();
  map.pitch = 0;
  map.zoom = 15.829734;
  const road = (id: string) => ({
    id,
    type: 'symbol',
    filter: base,
    metadata: {'tileflow:road-label-placement': {version: 1, mode: 'ground'}},
  });
  map.layers = [
    {id: 'flat-buildings', type: 'fill'},
    road('paths'),
    road('roads'),
    {id: 'extrusion', type: 'fill-extrusion'},
    {id: 'trees-2d', type: 'circle'},
    {id: 'shield', type: 'symbol'},
    {id: 'poi', type: 'symbol', filter: base, metadata: metadata('poi')},
    {id: 'app-overlay', type: 'custom', renderingMode: '3d'},
  ];
  map.styleMetadata = {
    'tileflow:overlay-placement-manifest': {anchors: {'above-buildings': 'trees-2d'}},
  };
  return map;
}

test('ground names stay complete in flat 3D views and regain occlusion when tilted', () => {
  const map = groundScene();
  const original = map.layers.map((layer) => layer.id);
  const detach = attachTileflowLabelPlacement(map);
  const flat = [
    'flat-buildings',
    'extrusion',
    'paths',
    'roads',
    'trees-2d',
    'shield',
    'poi',
    'app-overlay',
  ];
  assert.deepEqual(
    map.layers.map((layer) => layer.id),
    flat,
  );
  assert.deepEqual(map.getFilter('roads'), base);
  const moves = map.moves;
  for (const zoom of [15.5, 15.829734, 16, 17]) {
    map.zoom = zoom;
    map.fire('moveend');
  }
  assert.equal(map.moves, moves, 'zoom changes do not churn layer order');
  map.pitch = 55;
  map.fire('moveend');
  assert.deepEqual(
    map.layers.map((layer) => layer.id),
    original,
  );
  map.pitch = 0;
  map.fire('moveend');
  assert.deepEqual(
    map.layers.map((layer) => layer.id),
    flat,
  );
  detach();
  assert.deepEqual(
    map.layers.map((layer) => layer.id),
    original,
  );
});

test('late custom buildings and trees stay below flat names without duplicating symbols', () => {
  const map = groundScene();
  const detach = attachTileflowLabelPlacement(map);
  map.layers.splice(
    map.layers.findIndex((layer) => layer.id === 'trees-2d'),
    0,
    {id: 'buildings-3d', type: 'custom', renderingMode: '3d'},
    {id: 'trees-3d', type: 'custom', renderingMode: '3d'},
  );
  map.fire('styledata');
  assert.deepEqual(
    map.layers.map((layer) => layer.id),
    [
      'flat-buildings',
      'extrusion',
      'buildings-3d',
      'trees-3d',
      'paths',
      'roads',
      'trees-2d',
      'shield',
      'poi',
      'app-overlay',
    ],
  );
  const moves = map.moves;
  map.fire('styledata');
  assert.equal(map.moves, moves);
  map.fire('style.load');
  assert.equal(map.moves, moves);
  map.pitch = 30;
  map.fire('moveend');
  assert.deepEqual(
    map.layers.slice(0, 6).map((layer) => layer.id),
    ['flat-buildings', 'paths', 'roads', 'extrusion', 'buildings-3d', 'trees-3d'],
  );
  detach();
});

test('foreground and explicitly placed labels keep their authored order', () => {
  const map = groundScene();
  map.getLayer('roads')!.metadata = metadata('road');
  map.getLayer('paths')!.metadata = {};
  const original = map.layers.map((layer) => layer.id);
  const detach = attachTileflowLabelPlacement(map);
  assert.deepEqual(
    map.layers.map((layer) => layer.id),
    original,
  );
  assert.equal(map.moves, 0);
  detach();
});

test('foliage cannot cut ground names while solid buildings retain tilted occlusion', () => {
  const map = groundScene();
  map.pitch = 55;
  map.layers.splice(1, 0, {
    id: 'tileflow-trees-3d',
    type: 'custom',
    renderingMode: '3d',
    metadata: {'tileflow:scene-kind': 'vegetation'},
  });
  const detach = attachTileflowLabelPlacement(map);
  const index = (id: string) => map.getLayersOrder().indexOf(id);
  for (const pitch of [55, 0, 35, 60]) {
    map.pitch = pitch;
    map.fire('moveend');
    assert.ok(index('tileflow-trees-3d') < index('roads'), 'complete glyphs above foliage');
    assert.equal(index('roads') < index('extrusion'), pitch >= 30);
    assert.ok(index('roads') < index('poi'), 'destination collision priority stays intact');
    const moves = map.moves;
    map.fire('styledata');
    assert.equal(map.moves, moves, 'scene order settles without a styledata loop');
  }
  detach();
});

test('haze and ground placement settle together after deferred styledata events', () => {
  for (const hazeFirst of [true, false]) {
    const map = groundScene();
    let dirty = false;
    // MapLibre delivers styledata on a later style update, not inside moveLayer.
    const fire = map.fire.bind(map);
    map.fire = (event) => {
      if (event === 'styledata') dirty = true;
      else fire(event);
    };
    const hazeMap = Object.assign(map, {
      getSky: () => ({'horizon-color': '#aabbcc'}),
      addLayer(layer: FakeMap['layers'][number], beforeId?: string) {
        map.layers.push(layer);
        map.moveLayer(layer.id, beforeId);
      },
      removeLayer(id: string) {
        map.layers = map.layers.filter((layer) => layer.id !== id);
        dirty = true;
      },
    });
    const detach = hazeFirst
      ? [attachTileflowSkyHaze(hazeMap), attachTileflowLabelPlacement(map)]
      : [attachTileflowLabelPlacement(map), attachTileflowSkyHaze(hazeMap)];
    for (const pitch of [55, 0, 35, 60, 0]) {
      map.pitch = pitch;
      map.fire('moveend');
      for (let frame = 0; dirty && frame < 10; frame++) {
        dirty = false;
        fire('styledata');
      }
      assert.equal(dirty, false, 'controllers must reach idle instead of reordering forever');
      const order = map.getLayersOrder();
      assert.ok(order.indexOf(tileflowSkyHazeLayerId) < order.indexOf('extrusion'));
      assert.equal(order.indexOf('roads') < order.indexOf('extrusion'), pitch >= 30);
      const moves = map.moves;
      fire('styledata');
      assert.equal(map.moves, moves);
    }
    detach.reverse().forEach((release) => release());
  }
});

test('navigation never changes filters and settled cameras do not restart placement', () => {
  const map = groundScene();
  const before = map.layers.map(({id, filter}) => [id, filter]);
  const detach = attachTileflowLabelPlacement(map);
  for (let gesture = 0; gesture < 30; gesture++) {
    map.fire('movestart');
    map.bearing = gesture * 13;
    map.center.lng += 0.01;
    map.zoom = 10 + (gesture % 9);
    map.pitch = gesture % 2 ? 60 : 0;
    map.fire('pitch');
    map.fire('move');
    map.fire('resize');
    map.fire('moveend');
  }
  assert.equal(map.writes, 0);
  for (const [id, filter] of before) assert.deepEqual(map.getFilter(id as string), filter);
  const moves = map.moves;
  for (let i = 0; i < 20; i++) map.fire('moveend');
  assert.equal(map.moves, moves);
  detach();
  detach();
  assert.equal(map.writes, 0);
  assert.equal([...map.listeners.values()].flatMap((set) => [...set]).length, 0);
});

test('replacement styles discover ground names and removal releases without writes', () => {
  const map = new FakeMap();
  const detach = attachTileflowLabelPlacement(map);
  map.layers = groundScene().layers;
  map.styleMetadata = groundScene().styleMetadata;
  map.pitch = 0;
  map.fire('style.load');
  assert.ok(map.getLayersOrder().indexOf('roads') > map.getLayersOrder().indexOf('extrusion'));
  const moves = map.moves;
  map.fire('remove');
  detach();
  map.pitch = 60;
  map.fire('pitch');
  assert.equal(map.moves, moves);
  assert.equal(map.writes, 0);
  assert.equal([...map.listeners.values()].flatMap((set) => [...set]).length, 0);
});
