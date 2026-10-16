import {createPropertyExpression} from '@maplibre/maplibre-gl-style-spec';
import type {MapGeoJSONFeature, Map as MapLibreMap} from 'maplibre-gl';
import assert from 'node:assert/strict';
import test from 'node:test';
import {geometryVertices, validateGeometry} from '../src/devtools/geometry';
import {bindLiveColorInput, colorPreviewInterval} from '../src/devtools/live-color';
import {createPreviewObserver, resourceAddress, resourceKind} from '../src/devtools/observer';
import {evaluatedValue, propertySpec, StyleEdits} from '../src/devtools/style-edits';
import {tilePolygon, visibleTiles} from '../src/devtools/tiles';

function fixture(paint: Record<string, unknown> = {}) {
  const layer = {
    id: 'roads',
    type: 'line',
    paint: structuredClone(paint),
    layout: {} as Record<string, unknown>,
  };
  const map = {
    getStyle: () => ({layers: [layer]}),
    getLayer: () => layer,
    getPaintProperty: (_: string, key: string) => layer.paint[key],
    getLayoutProperty: (_: string, key: string) => layer.layout[key],
    setPaintProperty: (_: string, key: string, value: unknown) => {
      if (value === null) delete layer.paint[key];
      else layer.paint[key] = value;
    },
    setLayoutProperty: (_: string, key: string, value: unknown) => {
      if (value === null) delete layer.layout[key];
      else layer.layout[key] = value;
    },
    getZoom: () => 12,
    getFeatureState: () => ({}),
    listImages: () => [],
  } as unknown as MapLibreMap;
  return {map, layer, edits: new StyleEdits(map)};
}
const target = {layer: 'roads', section: 'paint' as const, property: 'line-width'};
function value(expression: unknown, zoom: number, id: number) {
  const compiled = createPropertyExpression(
    expression,
    'line-width',
    propertySpec('line', 'paint', 'line-width')!,
  );
  assert.equal(compiled.result, 'success');
  if (compiled.result !== 'success') throw new Error('Invalid expression');
  return compiled.value.evaluate({zoom}, {id, type: 'LineString', properties: {}});
}

test('feature overrides preserve camera interpolation and unaffected features, including ID zero', () => {
  for (const expression of [
    ['interpolate', ['linear'], ['zoom'], 0, 1, 20, 11],
    ['step', ['zoom'], 1, 10, 5, 20, 11],
    ['let', 'width', 3, ['interpolate', ['linear'], ['zoom'], 0, ['var', 'width'], 20, 11]],
  ]) {
    const {edits, layer} = fixture({'line-width': expression});
    edits.set({...target, featureId: 0}, 8);
    for (const zoom of [0, 9, 12, 20]) {
      assert.equal(value(layer.paint['line-width'], zoom, 0), 8);
      assert.equal(value(layer.paint['line-width'], zoom, 7), value(expression, zoom, 7));
    }
    edits.undo();
    assert.deepEqual(layer.paint['line-width'], expression);
    edits.redo();
    assert.equal(value(layer.paint['line-width'], 12, 0), 8);
    edits.reset();
    assert.deepEqual(layer.paint['line-width'], expression);
  }
});

test('layer and feature edits compose, undo independently, and restore absent properties', () => {
  const {edits, layer} = fixture();
  edits.set(target, 4);
  edits.set({...target, featureId: 5}, 12);
  assert.equal(value(layer.paint['line-width'], 12, 5), 12);
  assert.equal(value(layer.paint['line-width'], 12, 6), 4);
  edits.remove(edits.key(target));
  assert.equal(value(layer.paint['line-width'], 12, 6), 1);
  edits.undo();
  assert.equal(value(layer.paint['line-width'], 12, 6), 4);
  edits.reset();
  assert.equal(Object.hasOwn(layer.paint, 'line-width'), false);
  assert.equal(edits.canUndo, false);
  assert.equal(edits.entries.size, 0);
});

test('invalid or unsupported edits are atomic and literal arrays remain valid', () => {
  const {edits, layer} = fixture({'line-width': 3});
  assert.throws(() => edits.set(target, -1), /number/u);
  assert.throws(
    () => edits.set({...target, featureId: 3}, ['interpolate', ['linear'], ['zoom'], 0, 1, 20, 3]),
    /Entire layer/u,
  );
  assert.equal(layer.paint['line-width'], 3);
  assert.equal(edits.entries.size, 0);
  assert.throws(
    () =>
      edits.set({layer: 'roads', section: 'layout', property: 'visibility', featureId: 3}, 'none'),
    /entire layer/u,
  );
  const dash = {layer: 'roads', section: 'paint' as const, property: 'line-dasharray'};
  edits.set(dash, [2, 4]);
  assert.deepEqual(layer.paint['line-dasharray'], [2, 4]);
});

test('computed properties evaluate the selected feature at current zoom', () => {
  const {map} = fixture({'line-width': ['case', ['==', ['id'], 7], 8, 2]});
  assert.equal(evaluatedValue(map, 'roads', 'paint', 'line-width'), undefined);
  const feature = {
    id: 7,
    source: 'world',
    geometry: {type: 'LineString'},
    properties: {},
  } as MapGeoJSONFeature;
  assert.equal(evaluatedValue(map, 'roads', 'paint', 'line-width', feature), 8);
});

test('disabling a rule applies the renderer default and preserves its expression across history', () => {
  const expression = ['interpolate', ['linear'], ['zoom'], 0, 1, 20, 11];
  const {map, edits, layer} = fixture({'line-width': expression});
  edits.setEnabled(target, false);
  assert.equal(Object.hasOwn(layer.paint, 'line-width'), false);
  assert.equal(evaluatedValue(map, 'roads', 'paint', 'line-width'), 1);
  const suspended = edits.entries.get(edits.key(target))!;
  assert.equal(suspended.disabled, true);
  assert.deepEqual(suspended.original, expression);
  // The disabled row can still display its saved value at the current zoom without applying it.
  assert.equal(
    evaluatedValue(map, 'roads', 'paint', 'line-width', undefined, 12, suspended.original),
    7,
  );
  edits.setEnabled(target, true);
  assert.deepEqual(layer.paint['line-width'], expression);
  assert.equal(edits.entries.size, 0);
  edits.undo();
  assert.equal(Object.hasOwn(layer.paint, 'line-width'), false);
  edits.undo();
  assert.deepEqual(layer.paint['line-width'], expression);
  assert.equal(edits.canUndo, false);
  edits.redo();
  assert.equal(edits.entries.get(edits.key(target))?.disabled, true);
  edits.reset();
  assert.deepEqual(layer.paint['line-width'], expression);
  assert.equal(edits.entries.size, 0);
  assert.equal(edits.canRedo, false);
});

test('rule toggles preserve whole-layer and feature overrides and reset restores an absent declaration', () => {
  const {map, edits, layer} = fixture();
  edits.setEnabled(target, false);
  assert.equal(edits.canUndo, false);
  edits.set(target, 4);
  edits.set({...target, featureId: 0}, 9);
  edits.setEnabled(target, false);
  assert.equal(Object.hasOwn(layer.paint, 'line-width'), false);
  assert.equal(evaluatedValue(map, 'roads', 'paint', 'line-width'), 1);
  assert.equal(edits.entries.get(edits.key(target))?.value, 4);
  edits.setEnabled(target, true);
  assert.equal(value(layer.paint['line-width'], 12, 0), 9);
  assert.equal(value(layer.paint['line-width'], 12, 2), 4);
  edits.setEnabled(target, false);
  edits.set(target, 4);
  assert.equal(edits.entries.get(edits.key(target))?.disabled, undefined);
  assert.equal(value(layer.paint['line-width'], 12, 0), 9);
  edits.undo();
  assert.equal(Object.hasOwn(layer.paint, 'line-width'), false);
  edits.remove(edits.key(target));
  assert.equal(value(layer.paint['line-width'], 12, 0), 9);
  assert.equal(value(layer.paint['line-width'], 12, 2), 1);
  edits.reset();
  assert.equal(Object.hasOwn(layer.paint, 'line-width'), false);
});

test('a disabled declaration restores feature overrides even without a whole-layer override', () => {
  const {edits, layer} = fixture({'line-width': 3});
  edits.set({...target, featureId: 0}, 9);
  edits.setEnabled(target, false);
  assert.equal(Object.hasOwn(layer.paint, 'line-width'), false);
  edits.setEnabled(target, true);
  assert.equal(edits.entries.has(edits.key(target)), false);
  assert.equal(value(layer.paint['line-width'], 12, 0), 9);
  assert.equal(value(layer.paint['line-width'], 12, 2), 3);
});

test('failed rule toggles preserve entries and history, and unsupported targets are rejected', () => {
  const {map, edits, layer} = fixture({'line-width': 3});
  edits.set(target, 5);
  const setter = map.setPaintProperty;
  map.setPaintProperty = () => {
    throw new Error('Renderer unavailable');
  };
  assert.throws(() => edits.setEnabled(target, false), /Renderer unavailable/);
  assert.equal(edits.entries.get(edits.key(target))?.disabled, undefined);
  assert.equal(layer.paint['line-width'], 5);
  map.setPaintProperty = setter;
  edits.undo();
  assert.equal(layer.paint['line-width'], 3);
  assert.equal(edits.canUndo, false);
  assert.throws(() => edits.setEnabled({...target, property: 'invalid'}, false), /not editable/);
  assert.throws(() => edits.setEnabled({...target, featureId: 0}, false), /entire rules/);
});

function colorInput() {
  return Object.assign(new EventTarget(), {value: '#000000'}) as HTMLInputElement;
}

test('color previews update during input, bound rapid events and flush the final color as one undo', (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {edits, layer} = fixture({'line-color': '#000000'});
  const color = {...target, property: 'line-color'};
  const input = colorInput();
  let applications = 0;
  const cleanup = bindLiveColorInput(
    input,
    (value, gesture) => {
      applications++;
      edits.set(color, value, gesture);
    },
    () => true,
  );
  t.after(cleanup);
  for (let i = 0; i < 1000; i++) {
    input.value = '#' + i.toString(16).padStart(6, '0');
    input.dispatchEvent(new Event('input'));
  }
  assert.equal(applications, 0);
  t.mock.timers.tick(colorPreviewInterval);
  assert.equal(applications, 1);
  assert.equal(layer.paint['line-color'], '#0003e7');
  // Continuous movement updates without a change/blur event or closing the picker.
  input.value = '#ff0000';
  input.dispatchEvent(new Event('input'));
  t.mock.timers.tick(colorPreviewInterval);
  assert.equal(applications, 2);
  assert.equal(layer.paint['line-color'], '#ff0000');
  input.value = '#00ff00';
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('change'));
  assert.equal(layer.paint['line-color'], '#00ff00');
  t.mock.timers.tick(colorPreviewInterval);
  assert.equal(applications, 3);
  edits.undo();
  assert.equal(layer.paint['line-color'], '#000000');
  assert.equal(edits.canUndo, false);
  edits.redo();
  assert.equal(layer.paint['line-color'], '#00ff00');
  input.value = '#0000ff';
  input.dispatchEvent(new Event('change'));
  edits.undo();
  assert.equal(layer.paint['line-color'], '#00ff00');
});

test('color previews flush on blur and discard pending work after replacement or disposal', (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const input = colorInput();
  const colors: string[] = [];
  let current = true;
  const cleanup = bindLiveColorInput(
    input,
    (value) => colors.push(value),
    () => current,
  );
  t.after(cleanup);
  input.value = '#ff0000';
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
  assert.deepEqual(colors, ['#ff0000']);
  input.value = '#00ff00';
  input.dispatchEvent(new Event('input'));
  current = false;
  t.mock.timers.tick(colorPreviewInterval);
  assert.deepEqual(colors, ['#ff0000']);
  current = true;
  input.dispatchEvent(new Event('input'));
  cleanup();
  t.mock.timers.tick(colorPreviewInterval);
  input.dispatchEvent(new Event('change'));
  assert.deepEqual(colors, ['#ff0000']);
});

test('color gestures preserve earlier overrides and do not merge across other edits or undo', () => {
  const {edits, layer} = fixture({'line-color': '#000000', 'line-width': 2});
  const color = {...target, property: 'line-color'};
  edits.set(color, '#ff0000');
  const gesture = Symbol('drag');
  edits.set(color, '#00ff00', gesture);
  edits.set(color, '#0000ff', gesture);
  assert.throws(() => edits.set(color, 'invalid', gesture), /valid CSS color/);
  edits.undo();
  assert.equal(layer.paint['line-color'], '#ff0000');
  edits.redo();
  assert.equal(layer.paint['line-color'], '#0000ff');
  edits.set(target, 4);
  edits.set(color, '#ffffff', gesture);
  edits.undo();
  assert.equal(layer.paint['line-color'], '#0000ff');
  edits.undo();
  assert.equal(layer.paint['line-width'], 2);
  edits.set(color, '#aaaaaa', gesture);
  edits.undo();
  assert.equal(layer.paint['line-color'], '#0000ff');
});

test('geometry validation catches invalid nesting, open rings, short lines and excessive vertices', () => {
  const polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  };
  validateGeometry(polygon);
  assert.equal(geometryVertices(polygon).length, 4);
  for (const invalid of [
    null,
    {type: 'LineString', coordinates: [[0, 0]]},
    {type: 'Point', coordinates: [Infinity, 0]},
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [2, 2],
        ],
      ],
    },
    {type: 'MultiPoint', coordinates: Array.from({length: 2001}, () => [0, 0])},
  ])
    assert.throws(() => validateGeometry(invalid));
});

test('network observations redact credentials, normalize durations, bound buffers and clean up listeners', () => {
  let callback: (list: {getEntries: () => unknown[]}) => void = () => {};
  let disconnected = false,
    detached = false;
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  Object.defineProperties(globalThis, {
    location: {configurable: true, value: {href: 'http://localhost/map/'}},
    addEventListener: {configurable: true, value: () => {}},
    PerformanceObserver: {
      configurable: true,
      value: class {
        constructor(fn: typeof callback) {
          callback = fn;
        }
        observe() {}
        disconnect() {
          disconnected = true;
        }
      },
    },
  });
  try {
    const observer = createPreviewObserver();
    observer.attach({
      loaded: () => true,
      on() {},
      off() {
        detached = true;
      },
    } as unknown as MapLibreMap);
    const sample = {
      name: 'https://user:secret@tiles.example/12/3/4.pbf?token=secret#hash',
      startTime: 12,
      duration: 5,
      decodedBodySize: 40,
      encodedBodySize: 20,
      transferSize: 0,
      responseStatus: 200,
      initiatorType: 'fetch',
    };
    callback({getEntries: () => [sample, sample]});
    assert.equal(observer.records.length, 1);
    assert.equal(observer.records[0].url, 'https://tiles.example/12/3/4.pbf');
    assert.equal(observer.records[0].name, '12/3/4.pbf');
    assert.equal(observer.records[0].status, 'Cached');
    observer.recording = false;
    callback({getEntries: () => [{...sample, startTime: 20}]});
    assert.equal(observer.records.length, 1);
    observer.recording = true;
    callback({
      getEntries: () =>
        Array.from({length: 2100}, (_, i) => ({
          ...sample,
          startTime: i + 30,
          duration: -5,
          decodedBodySize: 0,
          encodedBodySize: 0,
          transferSize: 0,
          responseStatus: 0,
        })),
    });
    assert.equal(observer.records.length, 2000);
    assert.equal(observer.dropped, 101);
    assert.equal(observer.records[0].duration, undefined);
    assert.equal(observer.records[0].bytes, undefined);
    assert.equal(observer.records[0].status, '—');
    observer.clear();
    assert.equal(observer.records.length, 0);
    observer.dispose();
    assert.ok(disconnected && detached);
  } finally {
    for (const key of ['location', 'addEventListener', 'PerformanceObserver']) {
      if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('request classification and renderer adapter distinguish HTTP resources from resident tiles', () => {
  assert.equal(
    resourceAddress('pmtiles://https://u:p@host/data.pmtiles?key=1'),
    'https://host/data.pmtiles',
  );
  assert.equal(resourceAddress('data:image/png,secret'), 'data:');
  assert.equal(resourceKind('https://host/fonts/Open/0-255.pbf'), 'Font');
  assert.equal(resourceKind('https://host/world.pmtiles'), 'Archive');
  assert.deepEqual(visibleTiles({} as MapLibreMap), {supported: false, tiles: []});
  const data = visibleTiles({
    style: {
      tileManagers: {
        world: {
          _inViewTiles: {
            getAllTiles: () => [
              {
                tileID: {key: 'x', canonical: {z: 1, x: 0, y: 0}, overscaledZ: 3},
                state: 'loaded',
                latestRawTileData: new ArrayBuffer(8),
              },
            ],
          },
        },
      },
    },
  } as unknown as MapLibreMap);
  assert.equal(data.tiles[0].overscaledZ, 3);
  assert.equal(data.tiles[0].bytes, 8);
  const polygon = tilePolygon(data.tiles[0]);
  assert.deepEqual(polygon.coordinates[0][0], polygon.coordinates[0].at(-1));
  assert.equal(polygon.coordinates[0][0][0], -180);
});

test('the shell and embedded observer serve bundled browser assets under reserved routes', async () => {
  const {createTileflowComparisonRequestHandler} = await import('../src/comparison');
  const {getTileflowPreviewRuntimeResponse} = await import('../src/preview-assets');
  const handler = createTileflowComparisonRequestHandler({
    basePath: '/tools',
    left: {
      basePath: '/tools/map',
      label: 'Map',
      previewUrl: '/tools/map/',
      handler: () => new Response('map'),
    },
  });
  const asset = await handler(
    new Request('http://localhost/tools/__workbench-runtime/devtools.js'),
  );
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type') || '', /javascript/u);
  const script = await asset.text();
  assert.match(script, /__tileflowDevtoolsHost/u);
  assert.doesNotMatch(script, /from ['"]@maplibre/u);
  const head = await handler(
    new Request('http://localhost/tools/__workbench-runtime/devtools.js', {method: 'HEAD'}),
  );
  assert.equal(await head.text(), '');
  assert.equal(
    (
      await handler(
        new Request('http://localhost/tools/__workbench-runtime/devtools.js', {method: 'POST'}),
      )
    ).status,
    405,
  );
  const observer = getTileflowPreviewRuntimeResponse('/__runtime/devtools-observer.js');
  assert.ok(observer);
  assert.match(await observer.text(), /createPreviewObserver/u);
  assert.throws(
    () =>
      createTileflowComparisonRequestHandler({
        left: {
          basePath: '/__workbench-runtime',
          label: 'Map',
          previewUrl: '/__workbench-runtime/',
          handler: () => new Response(),
        },
      }),
    /disjoint/u,
  );
});

test('worker-bound objects are created in the map iframe realm', async () => {
  const {runInNewContext} = await import('node:vm');
  const {mapValue} = await import('../src/devtools/map-value');
  const realm = runInNewContext('({JSON, Object})');
  const map = {
    getContainer: () => ({ownerDocument: {defaultView: realm}}),
  } as unknown as MapLibreMap;
  const source = {
    type: 'geojson',
    data: {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [0, 0]}},
  };
  const transferred = mapValue(map, source);
  assert.equal(Object.getPrototypeOf(transferred), realm.Object.prototype);
  assert.equal(Object.getPrototypeOf(transferred.data.properties), realm.Object.prototype);
  assert.equal(JSON.stringify(transferred), JSON.stringify(source));
});
