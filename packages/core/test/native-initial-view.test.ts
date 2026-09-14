import assert from 'node:assert/strict';
import test from 'node:test';
import {parseTileflowRuntimeManifest} from '../src/manifest';
import {
  createTileflowNativeSourceController,
  resolveTileflowNativeInitialView,
  type TileflowNativeInitialViewOptions,
  TileflowNativeSourceError,
} from '../src/native';
import {defaultTileflowRuntimeView} from '../src/runtime';
import type {TileflowViewConfig} from '../src/types';

function invalid(input: unknown): void {
  assert.throws(
    () => resolveTileflowNativeInitialView(input as TileflowNativeInitialViewOptions),
    (error: unknown) => {
      assert.ok(error instanceof TileflowNativeSourceError);
      assert.equal(error.code, 'NATIVE_SOURCE_INVALID');
      assert.equal(error.field, 'view');
      assert.equal(error.kind, 'terminal');
      assert.equal(error.cause, undefined);
      assert.equal(error.message.includes('private'), false);
      return true;
    },
  );
}

test('returns canonical shared defaults with an independently frozen coordinate tuple', () => {
  const first = resolveTileflowNativeInitialView();
  const second = resolveTileflowNativeInitialView({});
  assert.deepEqual(first, {center: [0, 20], zoom: 2, bearing: 0, pitch: 0});
  assert.deepEqual(first, defaultTileflowRuntimeView);
  assert.deepEqual(Object.keys(first).sort(), ['bearing', 'center', 'pitch', 'zoom']);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.center));
  assert.notEqual(first.center, defaultTileflowRuntimeView.center);
  assert.notEqual(first.center, second.center);
});

test('resolves explicit view > map-options view > manifest view > shared defaults per field', () => {
  const manifestView = {center: [1, 2] as const, zoom: 5, bearing: 10, pitch: 15};
  const mapOptionsView = {center: [3, 4] as const, zoom: 7, bearing: 20, pitch: 25};
  const view = {center: [5, 6] as const, zoom: 9, bearing: 30, pitch: 35};
  const expected = {...view};
  assert.deepEqual(
    resolveTileflowNativeInitialView({manifestView, mapOptionsView, view}),
    expected,
  );
  for (const key of ['center', 'zoom', 'bearing', 'pitch'] as const) {
    const explicit = {...view};
    Reflect.deleteProperty(explicit, key);
    assert.deepEqual(
      resolveTileflowNativeInitialView({manifestView, mapOptionsView, view: explicit}),
      {...view, [key]: mapOptionsView[key]},
    );
    const options = {...mapOptionsView};
    Reflect.deleteProperty(options, key);
    assert.deepEqual(
      resolveTileflowNativeInitialView({manifestView, mapOptionsView: options, view: explicit}),
      {...view, [key]: manifestView[key]},
    );
    const manifest = {...manifestView};
    Reflect.deleteProperty(manifest, key);
    assert.deepEqual(
      resolveTileflowNativeInitialView({
        manifestView: manifest,
        mapOptionsView: options,
        view: explicit,
      }),
      {...view, [key]: defaultTileflowRuntimeView[key]},
    );
  }
  assert.deepEqual(
    resolveTileflowNativeInitialView({
      manifestView: {zoom: 4},
      mapOptionsView: {zoom: undefined, pitch: 20},
      view: {zoom: undefined},
    }),
    {center: [0, 20], zoom: 4, pitch: 20, bearing: 0},
  );
});

test('uses the canonical manifest view bounds and preserves longitude/latitude order', () => {
  const valid = [
    {center: [-180, -90], zoom: 0, bearing: -180, pitch: 0},
    {center: [180, 90], zoom: 24, bearing: 180, pitch: 85},
    {center: [-3.7, 40.4], zoom: 12.5, bearing: 31.5, pitch: 43.5},
  ] as const;
  for (const view of valid) {
    const manifest = parseTileflowRuntimeManifest({
      version: 1,
      maps: {
        main: {
          defaultTheme: 'light',
          themes: {light: {colorScheme: 'light', styleUrl: './s.json'}},
          view,
        },
      },
    });
    assert.deepEqual(
      resolveTileflowNativeInitialView({manifestView: manifest.maps.main!.view}),
      view,
    );
  }
  assert.deepEqual(
    resolveTileflowNativeInitialView({view: {center: [40.4, -3.7]}}).center,
    [40.4, -3.7],
  );
});

test('invalid explicitly supplied values never disappear behind higher precedence or defaults', () => {
  const inputs = [
    {zoom: -0.01},
    {zoom: 24.01},
    {bearing: -180.01},
    {bearing: 180.01},
    {pitch: -0.01},
    {pitch: 85.01},
    {center: [-180.01, 0]},
    {center: [180.01, 0]},
    {center: [0, -90.01]},
    {center: [0, 90.01]},
    {center: [0]},
    {center: [0, 0, 0]},
    {center: {lng: 0, lat: 0}},
    {zoom: 'private'},
    {pitch: null},
    {unknown: 'private'},
  ];
  for (const value of [NaN, Infinity, -Infinity]) {
    inputs.push(
      {zoom: value},
      {bearing: value},
      {pitch: value},
      {center: [value, 0]},
      {center: [0, value]},
    );
  }
  for (const input of inputs) {
    for (const layer of ['view', 'mapOptionsView', 'manifestView']) {
      invalid({view: {center: [1, 2], zoom: 3, bearing: 4, pitch: 5}, [layer]: input});
    }
  }
  for (const input of [null, [], 0, 'private', {extra: true}, {view: null}, {mapOptionsView: []}])
    invalid(input);
});

test('does not evaluate view/tuple accessors or accept unsafe prototypes and hidden fields', () => {
  let reads = 0;
  const get = () => {
    reads++;
    throw new Error('private');
  };
  invalid(Object.defineProperty({}, 'view', {enumerable: true, get}));
  invalid({view: Object.defineProperty({}, 'zoom', {enumerable: true, get})});
  invalid({manifestView: Object.create({zoom: 3})});
  invalid({view: Object.defineProperty({}, 'zoom', {value: 1})});
  invalid({view: {[Symbol('private')]: 1}});
  const center = [1, 2];
  Object.defineProperty(center, '0', {get});
  invalid({view: {center}});
  invalid({view: {center: new Float64Array([1, 2])}});
  invalid({view: {center: Array(2)}});
  invalid({view: {center: Object.assign([1, 2], {extra: true})}});
  assert.equal(reads, 0);
});

test('clones all view inputs and leaves caller-owned tuples and defaults untouched', () => {
  const center: [number, number] = [-3.7, 40.4];
  const view: TileflowViewConfig = {center, zoom: 12};
  const before = structuredClone(view);
  const result = resolveTileflowNativeInitialView({view});
  assert.deepEqual(view, before);
  assert.equal(Object.isFrozen(view), false);
  assert.equal(Object.isFrozen(center), false);
  center[0] = 0;
  view.zoom = 2;
  assert.deepEqual(result, {center: [-3.7, 40.4], zoom: 12, bearing: 0, pitch: 0});
  assert.throws(() => {
    (result.center as [number, number])[0] = 10;
  }, TypeError);
});

test('view resolution is independent of acquisition and does not advance source generation', async () => {
  let calls = 0;
  const controller = createTileflowNativeSourceController({
    acquire: () => {
      calls++;
      throw new Error('No acquisition for direct styles.');
    },
  });
  await controller.replace({kind: 'maplibre', style: 'https://maps.example.test/style.json'});
  const snapshot = controller.state;
  for (const zoom of [1, 2, 12, 24]) resolveTileflowNativeInitialView({view: {zoom}});
  invalid({view: {pitch: 86}});
  assert.equal(controller.state, snapshot);
  assert.equal(controller.state?.generation, 1);
  assert.equal(calls, 0);
});
