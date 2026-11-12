import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  composeTileflowRuntimeStyle,
  createTileflowMapController,
  TileflowRuntimeStyleError,
} from '../src/map-controller-browser';
import type {MapLibreStyle} from '../src/types';

const fixture = JSON.parse(
  readFileSync(new URL('../../../platforms/style-position-fixtures.json', import.meta.url), 'utf8'),
);
const clone = <T>(value: T): T => structuredClone(value);
const base = (): MapLibreStyle => ({
  version: 8,
  name: 'base',
  sources: {base: {type: 'geojson', data: {type: 'FeatureCollection', features: []}}},
  layers: [
    {id: 'ground', type: 'background'},
    {id: 'base-labels', type: 'circle', source: 'base'},
  ],
  metadata: {
    'tileflow:overlay-placement-manifest': {
      schemaVersion: 1,
      anchors: {
        'above-water': 'base-labels',
        'below-roads': 'base-labels',
        'above-roads': 'base-labels',
        'above-buildings': 'base-labels',
        'below-labels': 'base-labels',
        'above-labels': null,
      },
    },
  },
});
const source = {type: 'geojson', data: {type: 'FeatureCollection', features: []}};
function mock() {
  let style = base();
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  return {
    loaded: true,
    getStyle: () => clone(style),
    isStyleLoaded() {
      return this.loaded;
    },
    getSource: (id: string) => style.sources[id],
    getLayer: (id: string) => style.layers.find((layer) => layer.id === id),
    addSource(id: string, value: Record<string, unknown>) {
      assert.equal(style.sources[id], undefined);
      style.sources[id] = clone(value);
    },
    removeSource(id: string) {
      assert.ok(!style.layers.some((layer) => layer.source === id));
      delete style.sources[id];
    },
    addLayer(layer: Record<string, unknown>, before?: string) {
      const index = before
        ? style.layers.findIndex((item) => item.id === before)
        : style.layers.length;
      assert.ok(index >= 0);
      style.layers.splice(index, 0, clone(layer));
    },
    moveLayer(id: string, before?: string) {
      const index = style.layers.findIndex((item) => item.id === id);
      assert.ok(index >= 0);
      const [layer] = style.layers.splice(index, 1);
      this.addLayer(layer!, before);
    },
    removeLayer(id: string) {
      const index = style.layers.findIndex((item) => item.id === id);
      assert.ok(index >= 0);
      style.layers.splice(index, 1);
    },
    on(event: string, listener: (event?: unknown) => void) {
      const callbacks = listeners.get(event) ?? new Set();
      callbacks.add(listener);
      listeners.set(event, callbacks);
    },
    off(event: string, listener: (event?: unknown) => void) {
      listeners.get(event)?.delete(listener);
    },
    emit(event: string, value?: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(value);
    },
    replace(next: MapLibreStyle, notify = true) {
      style = clone(next);
      if (notify) for (const listener of listeners.get('style.load') ?? []) listener();
    },
  };
}

for (const sample of fixture.rejections)
  test(`canonical runtime placement: ${sample.name}`, async () => {
    const map = mock();
    const controller = createTileflowMapController({map});
    await controller.addSource('points', source);
    const layer = (value: {id: string; slot: string | null}) => ({
      ...value,
      type: 'circle',
      source: 'points',
    });
    await controller.addLayer(layer(sample.reference));
    if (sample.operation === 'moveLayer') await controller.addLayer(layer(sample.layer));
    const previous = map.getStyle();
    await assert.rejects(
      sample.operation === 'moveLayer'
        ? controller.moveLayer(sample.layer.id, sample.position)
        : controller.addLayer(layer(sample.layer), sample.position),
      (error: unknown) => {
        assert.ok(error instanceof TileflowRuntimeStyleError);
        assert.equal(error.code, 'invalidRequest');
        assert.equal(error.context.reason, 'layerPositionConflict');
        assert.equal(error.context.path, sample.error.path);
        assert.equal(error.context.rule, 'sameSlot');
        assert.deepEqual(
          error.context.corrections.map((entry: {code: string}) => entry.code),
          fixture.correctionCodes,
        );
        return true;
      },
    );
    assert.deepEqual(map.getStyle(), previous);
    controller.dispose();
  });

for (const sample of fixture.slotIndices)
  test(`canonical runtime index: ${sample.name}`, async () => {
    const map = mock();
    const controller = createTileflowMapController({map});
    await controller.addSource('points', source);
    for (const value of sample.layers)
      await controller.addLayer({...value, type: 'circle', source: 'points'});
    const change =
      sample.operation === 'moveLayer'
        ? controller.moveLayer(sample.layer.id, sample.position)
        : controller.addLayer({...sample.layer, type: 'circle', source: 'points'}, sample.position);
    if (sample.error)
      await assert.rejects(
        change,
        (error: unknown) =>
          error instanceof TileflowRuntimeStyleError &&
          error.context.reason === 'invalidLayerPosition',
      );
    else await change;
    const ids = new Set(
      [...sample.layers, sample.layer]
        .filter((value) => value.slot === sample.layer.slot)
        .map((value) => value.id),
    );
    assert.deepEqual(
      map
        .getStyle()
        .layers.filter((layer) => ids.has(layer.id))
        .map((layer) => layer.id),
      sample.expectedOrder,
    );
    controller.dispose();
  });

test('owns only registered resources and composes before style replacement', async () => {
  const map = mock();
  const controller = createTileflowMapController({map});
  const previous = map.getStyle();
  await assert.rejects(controller.removeSource('base'));
  await assert.rejects(controller.removeLayer('ground'));
  await assert.rejects(controller.addSource('base', source));
  assert.deepEqual(map.getStyle(), previous);
  await controller.addSource('points', source);
  await controller.addLayer({id: 'route', type: 'circle', source: 'points', slot: 'above-roads'});
  await assert.rejects(controller.removeSource('points'));
  const destination = base();
  destination.name = 'dark';
  const composed = composeTileflowRuntimeStyle(map, destination);
  assert.deepEqual(destination, {...base(), name: 'dark'});
  assert.ok(composed.sources.points);
  assert.deepEqual(
    composed.layers.map((layer) => layer.id),
    ['ground', 'route', 'base-labels'],
  );
  const {prepareTileflowRuntimeStyleApplication} = await import('../src/map-controller-browser');
  const application = prepareTileflowRuntimeStyleApplication(map, destination);
  map.replace(application.style);
  application.finish();
  await controller.moveLayer('route', {slot: null});
  assert.deepEqual(
    map.getStyle().layers.map((layer) => layer.id),
    ['ground', 'base-labels', 'route'],
  );
  await controller.removeLayer('route');
  await controller.removeSource('points');
  controller.dispose();
  await assert.rejects(
    controller.addSource('later', source),
    (error: unknown) => error instanceof TileflowRuntimeStyleError && error.code === 'disposed',
  );
});

test('queues before attachment, during style loading and across style switches', async () => {
  const {createTileflowMapControllerBinding, beginTileflowRuntimeStyleChange} =
    await import('../src/map-controller-browser');
  const binding = createTileflowMapControllerBinding();
  let completed = false;
  const adding = binding.controller.addSource('points', source).then(() => {
    completed = true;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  const map = mock();
  map.loaded = false;
  binding.attach(map);
  await Promise.resolve();
  assert.equal(completed, false);
  map.loaded = true;
  map.replace(base());
  await adding;
  const release = beginTileflowRuntimeStyleChange(map);
  const layer = binding.controller.addLayer({id: 'route', type: 'circle', source: 'points'});
  await Promise.resolve();
  assert.equal(map.getLayer('route'), undefined);
  release();
  await layer;
  assert.ok(map.getLayer('route'));
  binding.dispose();
});

test('terminal failure and disposal reject pending calls without reaching a new map', async () => {
  const {createTileflowMapControllerBinding} = await import('../src/map-controller-browser');
  const binding = createTileflowMapControllerBinding();
  const pending = binding.controller.addSource('points', source);
  binding.dispose();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof TileflowRuntimeStyleError && error.code === 'disposed',
  );
  assert.throws(() => binding.attach(mock()));
  const failed = createTileflowMapControllerBinding();
  const waiting = failed.controller.addSource('points', source);
  failed.fail(new Error('Interactive map required.'));
  await assert.rejects(waiting, /Interactive map required/);
  await assert.rejects(failed.controller.removeLayer('a'), /Interactive map required/);
});

test('restores only owned resources after an external style reload', async () => {
  const map = mock();
  const controller = createTileflowMapController({map});
  await controller.addSource('points', source);
  await controller.addLayer({id: 'route', type: 'circle', source: 'points', slot: 'above-roads'});
  const destination = base();
  destination.sources.external = clone(source);
  destination.layers.push({id: 'external', type: 'circle', source: 'external'});
  map.replace(destination);
  assert.ok(map.getSource('external'));
  assert.ok(map.getSource('points'));
  assert.deepEqual(
    map.getStyle().layers.map((layer) => layer.id),
    ['ground', 'route', 'base-labels', 'external'],
  );
  controller.dispose();
  assert.ok(map.getSource('external'));
  assert.ok(map.getLayer('external'));
  assert.equal(map.getSource('points'), undefined);
});

test('theme application includes app resources before setStyle and rollback retains them', async () => {
  const {createTileflowThemeController} = await import('../src/browser');
  const map = Object.assign(mock(), {
    submitted: [] as MapLibreStyle[],
    setStyle(style: MapLibreStyle) {
      this.submitted.push(clone(style));
      this.loaded = false;
      queueMicrotask(() => {
        if (style.name === 'broken') this.emit('error', {error: new Error('Rejected destination')});
        else {
          this.loaded = true;
          this.replace(style);
        }
      });
    },
  });
  const controller = createTileflowMapController({map});
  await controller.addSource('points', source);
  await controller.addLayer({id: 'route', type: 'circle', source: 'points', slot: 'above-roads'});
  const themes = createTileflowThemeController({
    map: map as never,
    initial: {theme: 'light', style: base()},
    loadFonts: async () => {},
  });
  const dark = {...base(), name: 'dark'};
  assert.equal(
    (await themes.setTheme({theme: 'dark', style: dark}, {transition: {duration: 0}})).status,
    'applied',
  );
  assert.ok(
    map.submitted.every(
      (style) => style.sources.points && style.layers.some((layer) => layer.id === 'route'),
    ),
  );
  assert.equal(
    (
      await themes.setTheme(
        {theme: 'broken', style: {...base(), name: 'broken'}},
        {transition: {duration: 0}},
      )
    ).status,
    'failed',
  );
  assert.equal(map.getStyle().name, 'dark');
  assert.ok(map.getSource('points'));
  assert.ok(map.getLayer('route'));
  assert.ok(
    map.submitted.every(
      (style) => style.sources.points && style.layers.some((layer) => layer.id === 'route'),
    ),
  );
  themes.dispose();
  controller.dispose();
});

test('disposal never removes a conflicting replacement owned by an external style', async () => {
  const map = mock();
  const errors: Error[] = [];
  const controller = createTileflowMapController({map, onError: (error) => errors.push(error)});
  await controller.addSource('points', source);
  await controller.addLayer({id: 'route', type: 'circle', source: 'points'});
  const replacement = base();
  replacement.sources.points = {type: 'geojson', data: {type: 'Point', coordinates: [1, 2]}};
  replacement.layers.push({
    id: 'route',
    type: 'circle',
    source: 'points',
    paint: {'circle-radius': 30},
  });
  map.replace(replacement);
  assert.equal(errors.length, 1);
  controller.dispose();
  assert.deepEqual(map.getStyle(), replacement);
});

test('source removal refuses external consumers without adopting their layers', async () => {
  const map = mock();
  const controller = createTileflowMapController({map});
  await controller.addSource('points', source);
  map.addLayer({id: 'external', type: 'circle', source: 'points'});
  await assert.rejects(
    controller.removeSource('points'),
    (error: unknown) =>
      error instanceof TileflowRuntimeStyleError && error.context.reason === 'sourceInUse',
  );
  assert.ok(map.getSource('points'));
  await assert.rejects(controller.removeLayer('external'));
  map.removeLayer('external');
  await controller.removeSource('points');
  controller.dispose();
});

test('renderer rejection does not commit ownership of an uninstalled source', async () => {
  const map = mock();
  const add = map.addSource.bind(map);
  map.addSource = () => {};
  const controller = createTileflowMapController({map});
  await assert.rejects(controller.addSource('points', source));
  map.addSource = add;
  await controller.addSource('points', source);
  assert.ok(map.getSource('points'));
  controller.dispose();
});

test('keeps the renderer-normalized definition across theme replacement', async () => {
  const map = mock();
  const add = map.addLayer.bind(map);
  map.addLayer = (layer, before) => {
    const value = clone(layer);
    if (value.paint && Object.keys(value.paint).length === 0) delete value.paint;
    add(value, before);
  };
  const errors: Error[] = [];
  const controller = createTileflowMapController({map, onError: (error) => errors.push(error)});
  await controller.addSource('points', source);
  await controller.addLayer({id: 'route', type: 'circle', source: 'points', paint: {}});
  map.emit('style.load');
  await controller.moveLayer('route', {slot: null});
  assert.deepEqual(errors, []);
  controller.dispose();
});

test('identical external replacement remains external on dispose', async () => {
  const map = mock();
  const errors: Error[] = [];
  const controller = createTileflowMapController({map, onError: (error) => errors.push(error)});
  await controller.addSource('points', source);
  await controller.addLayer({id: 'route', type: 'circle', source: 'points'});
  const ownSource = map.getSource('points');
  const ownLayer = map.getLayer('route');
  const replacement = map.getStyle();
  map.replace(replacement);
  assert.notEqual(map.getSource('points'), ownSource);
  assert.notEqual(map.getLayer('route'), ownLayer);
  controller.dispose();
  assert.deepEqual(
    map.getStyle(),
    replacement,
    'dispose must preserve externally replaced resources',
  );
});

test('theme composition rejects externally replaced resources', async () => {
  const map = mock();
  const controller = createTileflowMapController({map});
  await controller.addSource('points', source);
  await controller.addLayer({id: 'route', type: 'circle', source: 'points'});
  map.removeLayer('route');
  map.removeSource('points');
  map.addSource('points', {type: 'geojson', data: {type: 'Point', coordinates: [1, 2]}});
  map.addLayer({id: 'route', type: 'circle', source: 'points', paint: {'circle-radius': 30}});
  assert.throws(
    () => composeTileflowRuntimeStyle(map, base()),
    (error: unknown) =>
      error instanceof TileflowRuntimeStyleError &&
      error.context.reason === 'sourceOwnershipChanged',
  );
  controller.dispose();
});

test('applying a theme preserves externally replaced resources', async () => {
  const {createTileflowThemeController} = await import('../src/browser');
  const map = Object.assign(mock(), {
    setStyle(style: MapLibreStyle) {
      this.loaded = false;
      queueMicrotask(() => {
        this.loaded = true;
        this.replace(style);
      });
    },
  });
  const controller = createTileflowMapController({map});
  await controller.addSource('points', source);
  await controller.addLayer({id: 'route', type: 'circle', source: 'points'});
  const themes = createTileflowThemeController({
    map: map as never,
    initial: {theme: 'light', style: base()},
    loadFonts: async () => {},
  });
  map.removeLayer('route');
  map.removeSource('points');
  const foreignSource = {type: 'geojson', data: {type: 'Point', coordinates: [1, 2]}};
  map.addSource('points', foreignSource);
  map.addLayer({id: 'route', type: 'circle', source: 'points', paint: {'circle-radius': 30}});
  const result = await themes.setTheme(
    {theme: 'dark', style: {...base(), name: 'dark'}},
    {transition: {duration: 0}},
  );
  assert.equal(result.status, 'failed', 'foreign resource ownership must stop setStyle');
  assert.deepEqual(map.getStyle().sources.points, foreignSource);
  themes.dispose();
  controller.dispose();
});

test('transition preparation does not strip foreign replacements from a live snapshot', async () => {
  const {stripTileflowRuntimeStyle} = await import('../src/map-controller-browser');
  const map = mock();
  const controller = createTileflowMapController({map});
  await controller.addSource('points', source);
  await controller.addLayer({id: 'route', type: 'circle', source: 'points'});
  map.removeLayer('route');
  map.addLayer({id: 'route', type: 'circle', source: 'points'});
  const snapshot = map.getStyle();
  assert.throws(
    () => stripTileflowRuntimeStyle(map, snapshot),
    (error: unknown) =>
      error instanceof TileflowRuntimeStyleError &&
      error.context.reason === 'layerOwnershipChanged',
  );
  assert.deepEqual(map.getStyle(), snapshot);
  map.removeLayer('route');
  controller.dispose();
});

test('a failed own style application may restore its newly created resource identities', async () => {
  const {createTileflowThemeController} = await import('../src/browser');
  const map = Object.assign(mock(), {
    setStyle(style: MapLibreStyle) {
      this.loaded = false;
      queueMicrotask(() => {
        this.loaded = true;
        this.replace(style, style.name !== 'broken');
        if (style.name === 'broken')
          this.emit('error', {error: new Error('Rejected after resource installation')});
      });
    },
  });
  const errors: Error[] = [];
  const controller = createTileflowMapController({map, onError: (error) => errors.push(error)});
  await controller.addSource('points', source);
  await controller.addLayer({id: 'route', type: 'circle', source: 'points'});
  const firstSource = map.getSource('points');
  const firstLayer = map.getLayer('route');
  const themes = createTileflowThemeController({
    map: map as never,
    initial: {theme: 'light', style: base()},
    loadFonts: async () => {},
  });
  const result = await themes.setTheme(
    {theme: 'broken', style: {...base(), name: 'broken'}},
    {transition: {duration: 0}},
  );
  assert.equal(result.status, 'failed');
  assert.equal(map.getStyle().name, 'base');
  assert.notEqual(map.getSource('points'), firstSource);
  assert.notEqual(map.getLayer('route'), firstLayer);
  await controller.moveLayer('route', {slot: null});
  assert.deepEqual(errors, []);
  themes.dispose();
  controller.dispose();
});

test('a completed application token cannot claim a later identical external reload', async () => {
  const {prepareTileflowRuntimeStyleApplication} = await import('../src/map-controller-browser');
  const map = mock();
  const errors: Error[] = [];
  const controller = createTileflowMapController({map, onError: (error) => errors.push(error)});
  await controller.addSource('points', source);
  await controller.addLayer({id: 'route', type: 'circle', source: 'points'});
  const application = prepareTileflowRuntimeStyleApplication(map, {...base(), name: 'dark'});
  map.replace(application.style);
  application.finish();
  const ownSource = map.getSource('points');
  const replacement = map.getStyle();
  map.replace(replacement);
  assert.notEqual(map.getSource('points'), ownSource);
  assert.equal((errors[0] as TileflowRuntimeStyleError).context.reason, 'sourceOwnershipChanged');
  controller.dispose();
  assert.deepEqual(map.getStyle(), replacement);
});
