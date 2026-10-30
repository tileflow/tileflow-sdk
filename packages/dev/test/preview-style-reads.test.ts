import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {createPreviewStyleReads} from '../src/preview-style-reads';

function createMap() {
  const listeners = new Map<string, Set<() => void>>();
  const map = {
    reads: 0,
    loaded: true,
    style: {} as object,
    metadata: {'tileflow:atmosphere': {spaceColor: '#000000'}} as
      Record<string, unknown> | undefined,
    layers: new Map<string, {id: string; type: string; metadata?: unknown; sourceLayer?: string}>(),
    getStyle() {
      map.reads += 1;
      return map.loaded ? {metadata: map.metadata} : undefined;
    },
    getLayersOrder() {
      return [...map.layers.keys()];
    },
    getLayer(id: string) {
      return map.layers.get(id);
    },
    on(event: string, fn: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    emit(event: string) {
      listeners.get(event)?.forEach((fn) => fn());
    },
  };
  return map;
}

// Exercise the serialized function: the browser page cannot use module closures.
const create = vm.runInNewContext(
  `(${createPreviewStyleReads.toString()})`,
) as typeof createPreviewStyleReads;

test('the preview reads style metadata once per loaded style', () => {
  const map = createMap();
  const reads = create(map);
  for (let frame = 0; frame < 120; frame += 1) {
    assert.equal(reads.metadata(), map.metadata);
  }
  assert.equal(map.reads, 1);

  // A diff applied to the same style object fires 'style.load'.
  map.metadata = {'tileflow:buildings': {}};
  map.emit('style.load');
  assert.equal(reads.metadata(), map.metadata);
  assert.equal(map.reads, 2);

  // A new style loads into a new style object; until it has loaded there is nothing to keep.
  map.style = {};
  map.loaded = false;
  assert.equal(reads.metadata(), undefined);
  assert.equal(reads.metadata(), undefined);
  map.loaded = true;
  map.metadata = undefined;
  assert.equal(reads.metadata(), undefined);
  assert.equal(reads.metadata(), undefined);
  assert.equal(map.reads, 5);
});

test('the preview reads layers live, as the style declares them', () => {
  const map = createMap();
  const reads = create(map);
  map.layers.set('water', {id: 'water', type: 'fill', sourceLayer: 'water', metadata: {a: 1}});
  map.layers.set('tileflow-buildings-3d', {id: 'tileflow-buildings-3d', type: 'custom'});
  // Spread the layers into this realm to compare them.
  assert.deepEqual(
    [...reads.layers()].map((layer) => ({...layer})),
    [
      {
        id: 'water',
        type: 'fill',
        metadata: {a: 1},
        'source-layer': 'water',
        minzoom: undefined,
        maxzoom: undefined,
      },
    ],
  );
  map.layers.set('labels', {id: 'labels', type: 'symbol'});
  assert.deepEqual(
    [...reads.layers()].map((layer) => layer.id),
    ['water', 'labels'],
  );
  assert.equal(map.reads, 0);
});
