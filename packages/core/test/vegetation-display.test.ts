import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowVegetation} from '../src/vegetation-browser';
import {tileflowTrees3DLayerId} from '../src/trees-3d-browser';
import {
  readTileflowVegetationDisplay,
  resolveTileflowVegetationRepresentation,
  tileflowVegetationDisplayMetadataKey,
  type TileflowVegetationDisplay,
} from '../src/vegetation-display';

const policy = (
  mode: TileflowVegetationDisplay['mode'] = '3d',
  fallback: 'flat' | 'none' = 'none',
): TileflowVegetationDisplay => ({
  version: 1,
  mode,
  fallback,
  visible: true,
  flatLayers: [
    {id: 'trees', visible: true},
    {id: 'crowns', visible: true},
    {id: 'hidden', visible: false},
  ],
});
const models = {
  version: 1,
  source: 'world',
  layers: {tree: 'tree'},
  fields: {},
  colors: {bark: '#554433', broadleaf: ['#335533'], conifer: ['#224422']},
  flatLayers: ['trees', 'crowns'],
};

test('representation is independent of visibility, with explicit auto view modes and fallback', () => {
  for (const mode of ['3d', 'flat', 'auto'] as const) {
    for (const viewMode of ['2d', '3d'] as const) {
      for (const supports3D of [true, false]) {
        for (const fallback of ['flat', 'none'] as const) {
          const display = policy(mode, fallback);
          const expected =
            mode === 'flat' || (mode === 'auto' && viewMode === '2d')
              ? 'flat'
              : supports3D
                ? '3d'
                : fallback;
          assert.equal(
            resolveTileflowVegetationRepresentation(display, {viewMode, supports3D}),
            expected,
          );
          assert.equal(
            resolveTileflowVegetationRepresentation(display, {
              viewMode,
              supports3D,
              visible: false,
            }),
            'none',
          );
          assert.equal(
            resolveTileflowVegetationRepresentation(
              {...display, visible: false},
              {viewMode, supports3D},
            ),
            'none',
          );
          assert.equal(
            resolveTileflowVegetationRepresentation(
              {...display, visible: false},
              {viewMode, supports3D, visible: true},
            ),
            expected,
          );
        }
      }
    }
  }
  assert.equal(
    resolveTileflowVegetationRepresentation(undefined, {visible: true, supports3D: true}),
    'none',
  );
});

test('display metadata validates its shape and supports older compiled models', () => {
  assert.deepEqual(
    readTileflowVegetationDisplay({[tileflowVegetationDisplayMetadataKey]: policy()}),
    policy(),
  );
  for (const value of [
    {...policy(), version: 2},
    {...policy(), mode: 'camera'},
    {...policy(), flatLayers: [null]},
  ]) {
    assert.equal(
      readTileflowVegetationDisplay({[tileflowVegetationDisplayMetadataKey]: value}),
      undefined,
    );
  }
  const legacy = readTileflowVegetationDisplay({'tileflow:vegetation': models});
  assert.equal(legacy?.mode, '3d');
  assert.equal(legacy?.fallback, 'flat');
});

function fixture(initial = policy(), supported = true) {
  let display: TileflowVegetationDisplay | undefined = initial;
  let pitch = 0;
  let disposedLayers = 0;
  const listeners = new Map<string, Set<() => void>>();
  const layers = new Map<string, {id: string}>(
    ['trees', 'trees::night', 'crowns', 'hidden', 'labels'].map((id) => [id, {id}]),
  );
  const visibility = new Map<string, unknown>();
  const fire = (event: string) => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener();
  };
  const map = {
    addLayer(layer: object) {
      const named = layer as {id: string};
      layers.set(named.id, named);
      fire('styledata');
    },
    getCanvas: () => ({getContext: () => (supported ? {} : null)}) as unknown as HTMLCanvasElement,
    getBearing: () => 0,
    getCenter: () => ({lat: 40, lng: -3}),
    getLayer: (id: string) => layers.get(id),
    getLayoutProperty: (id: string) => visibility.get(id),
    getPitch: () => pitch,
    getSource: () => undefined,
    getStyle: () => ({
      layers: [...layers.values()],
      metadata: display
        ? {
            [tileflowVegetationDisplayMetadataKey]: display,
            'tileflow:vegetation': models,
          }
        : {},
    }),
    getZoom: () => 16,
    isStyleLoaded: () => true,
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
    on(event: string, listener: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    removeLayer(id: string) {
      disposedLayers++;
      layers.delete(id);
      fire('styledata');
    },
    setLayoutProperty(id: string, _name: string, value: unknown) {
      visibility.set(id, value);
      fire('styledata');
    },
    triggerRepaint() {},
  };
  return {
    map,
    layers,
    visibility,
    listeners,
    fire,
    pitch(value: number) {
      pitch = value;
      fire('moveend');
    },
    style(value: TileflowVegetationDisplay | undefined) {
      display = value;
      layers.delete(tileflowTrees3DLayerId);
      fire('styledata');
      fire('idle');
    },
    get disposedLayers() {
      return disposedLayers;
    },
  };
}

test('model-only trees stay 3D overhead, tilt, toggle, reload styles and leave no flat ghosts', () => {
  const f = fixture();
  const vegetation = createTileflowVegetation({map: f.map});
  assert.equal(vegetation.representation, '3d');
  assert.ok(f.layers.has(tileflowTrees3DLayerId));
  f.pitch(60);
  vegetation.setViewMode('3d');
  vegetation.setViewMode('2d');
  assert.equal(vegetation.representation, '3d');
  assert.equal(f.disposedLayers, 0);
  for (const id of ['trees', 'trees::night', 'crowns', 'hidden'])
    assert.equal(f.visibility.get(id), 'none');
  assert.equal(f.visibility.get('labels'), undefined);
  vegetation.setVisible(false);
  assert.equal(vegetation.representation, 'none');
  assert.equal(f.layers.has(tileflowTrees3DLayerId), false);
  assert.equal(f.disposedLayers, 1);
  for (const id of ['trees', 'trees::night', 'crowns']) assert.equal(f.visibility.get(id), 'none');
  vegetation.setVisible(true);
  f.style(policy());
  assert.equal(vegetation.representation, '3d');
  assert.ok(f.layers.has(tileflowTrees3DLayerId));
  f.style(undefined);
  assert.equal(vegetation.representation, 'none');
  assert.equal(f.layers.has(tileflowTrees3DLayerId), false);
  vegetation.dispose();
  vegetation.dispose();
  for (const set of f.listeners.values()) assert.equal(set.size, 0);
});

test('auto switches only with viewMode, preserves hidden passes and respects authored visibility', () => {
  const f = fixture({...policy('auto'), visible: false});
  const vegetation = createTileflowVegetation({map: f.map});
  assert.equal(vegetation.representation, 'none');
  vegetation.setVisible(true);
  assert.equal(vegetation.representation, 'flat');
  assert.equal(f.visibility.get('crowns'), 'visible');
  assert.equal(f.visibility.get('hidden'), 'none');
  f.pitch(75);
  assert.equal(vegetation.representation, 'flat');
  vegetation.setViewMode('3d');
  assert.equal(vegetation.representation, '3d');
  assert.equal(f.visibility.get('crowns'), 'none');
  vegetation.setViewMode('2d');
  assert.equal(vegetation.representation, 'flat');
  assert.equal(f.layers.has(tileflowTrees3DLayerId), false);
  vegetation.setVisible(undefined);
  assert.equal(vegetation.representation, 'none');
  f.fire('remove');
  for (const set of f.listeners.values()) assert.equal(set.size, 0);
});

test('unsupported model rendering uses the declared fallback and OFF also hides that fallback', () => {
  for (const fallback of ['flat', 'none'] as const) {
    const f = fixture(policy('3d', fallback), false);
    const vegetation = createTileflowVegetation({map: f.map});
    assert.equal(vegetation.representation, fallback);
    assert.equal(f.layers.has(tileflowTrees3DLayerId), false);
    vegetation.setVisible(false);
    assert.equal(f.visibility.get('trees'), 'none');
    vegetation.dispose();
    assert.equal(f.visibility.get('trees'), fallback === 'flat' ? 'visible' : 'none');
  }
});
