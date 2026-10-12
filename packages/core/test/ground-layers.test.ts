import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowGroundLayers, tileflowGroundBeforeId} from '../src/ground-layers-browser';
import {createTileflowLineProgress} from '../src/line-progress-browser';

type Layer = Record<string, unknown> & {id: string; type: string};

/** A compiled style's layers, bottom to top, with its overlay placement anchors. */
const compiled: Layer[] = [
  {id: 'land', type: 'fill'},
  {id: 'road-area', type: 'fill'},
  {id: 'road', type: 'line'},
  {id: 'admin', type: 'line'},
  {id: 'building', type: 'fill'},
  {id: 'building-3d', type: 'fill-extrusion'},
  {id: 'trees', type: 'circle'},
  {id: 'poi', type: 'symbol'},
  {id: 'road-label', type: 'symbol'},
];
const anchors = {
  'above-water': 'road-area',
  'below-roads': 'road-area',
  'above-roads': 'admin',
  'above-buildings': 'trees',
  'below-labels': 'road-label',
  'above-labels': null,
};

/** A map with a layer order, sources, style events, and MapLibre's errors as exceptions. */
class GroundMap {
  order: string[] = [];
  layers = new Map<string, Layer>();
  sources = new Set<string>();
  listeners = new Set<() => void>();
  moves = 0;

  constructor(
    layers: readonly Layer[] = compiled,
    readonly metadata: Record<string, unknown> | null = {
      'tileflow:overlay-placement-manifest': {anchors, schemaVersion: 1},
    },
  ) {
    for (const layer of layers) this.addLayer(layer);
  }

  getLayersOrder() {
    return [...this.order];
  }
  getLayer(id: string) {
    return this.layers.get(id);
  }
  getStyle() {
    return {version: 8, ...(this.metadata ? {metadata: this.metadata} : {})};
  }
  getSource(id: string) {
    return this.sources.has(id) ? {} : undefined;
  }
  addLayer(layer: unknown, before?: string) {
    const spec = layer as Layer;
    if (this.layers.has(spec.id)) throw new Error(`Layer "${spec.id}" already exists.`);
    if (typeof spec.source === 'string' && !this.sources.has(spec.source))
      throw new Error(`Source "${spec.source}" not found.`);
    // Like MapLibre, the map keeps its own layer: a custom layer behind its implementation.
    this.layers.set(
      spec.id,
      spec.type === 'custom'
        ? {id: spec.id, type: 'custom', implementation: spec}
        : {...spec, paint: {...(spec.paint as object)}, layout: {...(spec.layout as object)}},
    );
    this.insert(spec.id, before);
  }
  moveLayer(id: string, before?: string) {
    this.moves += 1;
    if (id === before) return;
    this.order.splice(this.order.indexOf(id), 1);
    this.insert(id, before);
  }
  removeLayer(id: string) {
    this.layers.delete(id);
    this.order.splice(this.order.indexOf(id), 1);
  }
  setPaintProperty(id: string, name: string, value: unknown) {
    this.write(id, 'paint', name, value);
  }
  setLayoutProperty(id: string, name: string, value: unknown) {
    this.write(id, 'layout', name, value);
  }
  on(_event: 'styledata', listener: () => void) {
    this.listeners.add(listener);
  }
  off(_event: 'styledata', listener: () => void) {
    this.listeners.delete(listener);
  }
  /** A style event, as MapLibre fires after every change to the style. */
  restyle() {
    for (const listener of [...this.listeners]) listener();
  }
  /** A new style: the compiled layers come back, runtime layers and sources are dropped. */
  setStyle() {
    this.order = [];
    this.layers.clear();
    this.sources.clear();
    for (const layer of compiled) this.addLayer(layer);
    this.restyle();
  }
  paintOf(id: string) {
    return this.layers.get(id)?.paint as Record<string, unknown> | undefined;
  }
  private insert(id: string, before?: string) {
    const index = before === undefined ? this.order.length : this.order.indexOf(before);
    if (index < 0) throw new Error(`Cannot insert before missing layer "${before}".`);
    this.order.splice(index, 0, id);
  }
  private write(id: string, kind: 'paint' | 'layout', name: string, value: unknown) {
    const layer = this.layers.get(id);
    if (!layer) throw new Error(`Layer "${id}" does not exist.`);
    layer[kind] = {...(layer[kind] as object), [name]: value};
  }
}

const route = (part: string, paint: Record<string, unknown> = {}): Layer => ({
  id: `route-${part}`,
  type: 'line',
  source: 'route',
  paint: {'line-width': 4, 'line-opacity': 1, ...paint},
});
const routeLayers = [route('casing'), route('line'), route('core')];
const custom = (id: string, renderingMode: '2d' | '3d'): Layer => ({
  id,
  type: 'custom',
  renderingMode,
  render: () => undefined,
});

test('ground layers go before the first 3D layer above the roads', () => {
  assert.equal(tileflowGroundBeforeId(new GroundMap()), 'building-3d');

  // With flat buildings, they go over the buildings, before the vegetation.
  const flat = new GroundMap(compiled.filter(({id}) => id !== 'building-3d'));
  assert.equal(tileflowGroundBeforeId(flat), 'trees');

  // A custom layer drawn in 3D counts; one drawn in 2D does not.
  flat.addLayer(custom('city-2d', '2d'), 'trees');
  flat.addLayer(custom('city-3d', '3d'), 'trees');
  assert.equal(tileflowGroundBeforeId(flat), 'city-3d');

  // A 3D layer under the roads does not pull ground layers under the roads.
  const low = new GroundMap();
  low.addLayer({id: 'raised-land', type: 'fill-extrusion'}, 'road');
  assert.equal(tileflowGroundBeforeId(low), 'building-3d');
});

test('a style without placements uses its first 3D layer or its first symbol layer', () => {
  const bare = new GroundMap(compiled, null);
  assert.equal(tileflowGroundBeforeId(bare), 'building-3d');
  const flat = new GroundMap(
    compiled.filter(({id}) => id !== 'building-3d'),
    null,
  );
  assert.equal(tileflowGroundBeforeId(flat), 'poi');
  const plain = new GroundMap([{id: 'land', type: 'fill'}], null);
  assert.equal(tileflowGroundBeforeId(plain), undefined);
});

test('a group lies on the ground and its see-through copy over the 3D content', () => {
  const map = new GroundMap();
  map.sources.add('route');
  map.addLayer(custom('city', '3d'), 'trees');
  const ground = createTileflowGroundLayers(map, {
    layers: routeLayers,
    occludedOpacity: {'route-line': 0.35},
  });
  assert.deepEqual(ground.ids, ['route-casing', 'route-line', 'route-core']);
  assert.deepEqual(map.order, [
    'land',
    'road-area',
    'road',
    'admin',
    'building',
    'route-casing',
    'route-line',
    'route-core',
    'building-3d',
    'city',
    'route-line:occluded',
    'trees',
    'poi',
    'road-label',
  ]);
  assert.deepEqual(map.paintOf('route-line:occluded'), {'line-width': 4, 'line-opacity': 0.35});
});

test('a group moves when a 3D layer lands above it, and its copies stay over every 3D layer', () => {
  const map = new GroundMap(compiled.filter(({id}) => id !== 'building-3d'));
  map.sources.add('route');
  createTileflowGroundLayers(map, {layers: routeLayers, occludedOpacity: {'route-line': 0.5}});
  // Without 3D content, the copy lies over the group.
  assert.deepEqual(map.order.slice(5, 10), [
    'route-casing',
    'route-line',
    'route-core',
    'route-line:occluded',
    'trees',
  ]);

  // A city rising under the route would draw over it; the group moves under the city.
  map.addLayer(custom('city', '3d'), 'route-casing');
  map.restyle();
  assert.deepEqual(map.order.slice(5, 11), [
    'route-casing',
    'route-line',
    'route-core',
    'city',
    'route-line:occluded',
    'trees',
  ]);

  // A 3D layer added at the top would hide the copy; the copy moves over it.
  map.addLayer(custom('blimps', '3d'));
  map.restyle();
  assert.deepEqual(map.order.slice(-2), ['blimps', 'route-line:occluded']);
});

test('groups sharing the ground do not move each other', () => {
  const map = new GroundMap();
  map.sources.add('route');
  createTileflowGroundLayers(map, {layers: [custom('traffic', '2d')]});
  createTileflowGroundLayers(map, {layers: routeLayers, occludedOpacity: {'route-line': 0.35}});
  const moves = map.moves;
  map.restyle();
  map.restyle();
  assert.equal(map.moves, moves);
  assert.deepEqual(map.order.slice(5, 10), [
    'traffic',
    'route-casing',
    'route-line',
    'route-core',
    'building-3d',
  ]);
});

test('paint passes through the group to the layer and its copy, and outside the group to the map', () => {
  const map = new GroundMap();
  map.sources.add('route');
  map.addLayer({id: 'other', type: 'line'}, 'poi');
  const ground = createTileflowGroundLayers(map, {
    layers: routeLayers,
    occludedOpacity: {'route-line': 0.4},
  });
  ground.setPaintProperty('route-line', 'line-opacity', 0.5);
  ground.setPaintProperty('route-line', 'line-color', '#ff4fae');
  ground.setLayoutProperty('route-line', 'visibility', 'none');
  assert.equal(map.paintOf('route-line')!['line-opacity'], 0.5);
  assert.equal(map.paintOf('route-line:occluded')!['line-opacity'], 0.2);
  assert.equal(map.paintOf('route-line:occluded')!['line-color'], '#ff4fae');
  assert.deepEqual(map.getLayer('route-line:occluded')!.layout, {visibility: 'none'});
  // A layer without an occluded opacity has no copy.
  ground.setPaintProperty('route-core', 'line-color', '#fff');
  assert.equal(map.getLayer('route-core:occluded'), undefined);
  ground.setPaintProperty('other', 'line-color', '#000');
  assert.equal(map.paintOf('other')!['line-color'], '#000');
  assert.throws(
    () => ground.setPaintProperty('route-line', 'line-opacity', ['get', 'opacity']),
    /line-opacity must be a number/u,
  );
});

test('line progress paints through the group, copies included', () => {
  const map = new GroundMap();
  map.sources.add('route');
  const ground = createTileflowGroundLayers(map, {
    layers: routeLayers,
    occludedOpacity: {'route-line': 0.35},
  });
  const progress = createTileflowLineProgress(ground, {
    layers: [{id: 'route-line', color: '#ff4fae', opacity: 0.8}],
    initial: {end: 0.5},
  });
  const gradient = map.paintOf('route-line')!['line-gradient'];
  assert.ok(Array.isArray(gradient));
  assert.deepEqual(map.paintOf('route-line:occluded')!['line-gradient'], gradient);
  assert.equal(map.paintOf('route-line:occluded')!['line-opacity'], 0.8 * 0.35);
  progress.set({opacity: 0.5});
  assert.equal(map.paintOf('route-line:occluded')!['line-opacity'], 0.4 * 0.35);
  progress.dispose();
});

test('a group comes back after a style change once its source does, as it was last painted', () => {
  const map = new GroundMap();
  map.sources.add('route');
  const ground = createTileflowGroundLayers(map, {
    layers: [...routeLayers, custom('traffic', '2d')],
    occludedOpacity: {'route-line': 0.35},
  });
  ground.setPaintProperty('route-line', 'line-opacity', 0.6);
  const traffic = map.getLayer('traffic')!.implementation;

  map.setStyle();
  // The traffic needs no source and comes back at once; the route waits for its source.
  assert.equal(map.getLayer('route-line'), undefined);
  assert.equal(map.getLayer('traffic')!.implementation, traffic);
  map.sources.add('route');
  map.restyle();
  assert.deepEqual(map.order.slice(5, 11), [
    'route-casing',
    'route-line',
    'route-core',
    'traffic',
    'building-3d',
    'route-line:occluded',
  ]);
  assert.equal(map.paintOf('route-line')!['line-opacity'], 0.6);
  assert.equal(map.paintOf('route-line:occluded')!['line-opacity'], 0.6 * 0.35);
});

test('layers already on the map are moved into place, and dispose takes the group off', () => {
  const map = new GroundMap();
  map.sources.add('route');
  map.addLayer(route('line'), 'road-label');
  const ground = createTileflowGroundLayers(map, {
    layers: [route('line')],
    occludedOpacity: {'route-line': 0.35},
  });
  assert.ok(map.order.indexOf('route-line') < map.order.indexOf('building-3d'));
  ground.dispose();
  assert.equal(map.getLayer('route-line'), undefined);
  assert.equal(map.getLayer('route-line:occluded'), undefined);
  assert.equal(map.listeners.size, 0);
});

test('a group waits for a style to load before placing its layers', () => {
  const map = new GroundMap();
  map.sources.add('route');
  const order = map.getLayersOrder;
  map.getLayersOrder = () => {
    throw new Error('Style is not done loading.');
  };
  createTileflowGroundLayers(map, {layers: routeLayers});
  assert.equal(map.getLayer('route-line'), undefined);
  map.getLayersOrder = order;
  map.restyle();
  assert.ok(map.order.indexOf('route-core') < map.order.indexOf('building-3d'));
});

test('ground layers are checked when the group is created', () => {
  const map = new GroundMap();
  const make = (options: Parameters<typeof createTileflowGroundLayers>[1]) => () =>
    createTileflowGroundLayers(map, options);
  assert.throws(make({layers: []}), /at least one layer/u);
  assert.throws(make({layers: [route('line'), route('line')]}), /listed twice/u);
  assert.throws(make({layers: [{id: 'walls', type: 'fill-extrusion'}]}), /drawn in 3D/u);
  assert.throws(make({layers: [custom('city', '3d')]}), /drawn in 3D/u);
  assert.throws(
    make({layers: [{id: 'area', type: 'fill'}], occludedOpacity: {area: 0.3}}),
    /only lines show through/u,
  );
  assert.throws(
    make({layers: [route('line')], occludedOpacity: {'route-casing': 0.3}}),
    /not a ground layer/u,
  );
  assert.throws(make({layers: [route('line')], occludedOpacity: {'route-line': 2}}), /0 to 1/u);
  assert.throws(
    make({
      layers: [
        route('line', {'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 14, 1]}),
      ],
      occludedOpacity: {'route-line': 0.3},
    }),
    /line-opacity must be a number/u,
  );
});
