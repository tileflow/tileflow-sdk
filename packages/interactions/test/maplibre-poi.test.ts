import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowInteractionBinding, TileflowInteractionEvent} from '../src';
import {
  createTileflowMapLibrePoiController,
  type TileflowMapLibrePoiFeature,
} from '../src/maplibre-poi';

const binding: TileflowInteractionBinding = {
  id: 'poi-card',
  popup: {content: {kind: 'view', name: 'poi-card'}},
  target: {categories: ['food-drink'], domain: 'poi', kind: 'semantic-feature'},
  tooltip: {content: {field: 'name', kind: 'field'}},
};

function createFixture() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const frames: Array<() => void> = [];
  let queries = 0;
  let features: readonly TileflowMapLibrePoiFeature[] = [
    {
      id: 'poi-42',
      layer: {id: 'tileflow-poi-food-drink-label'},
      properties: {
        category: 'food-drink',
        filter_rank: 3,
        icon: 'restaurant',
        name: 'Café',
        size_rank: 16,
        type: 'restaurant',
        unsafe: {nested: true},
      },
      source: 'tileflow',
      sourceLayer: 'poi',
    },
  ];
  const style = {
    layers: [
      {
        id: 'tileflow-poi-food-drink-icon',
        source: 'tileflow',
        'source-layer': 'poi',
        type: 'symbol',
      },
      {
        id: 'tileflow-poi-food-drink-label',
        source: 'tileflow',
        'source-layer': 'poi',
        type: 'symbol',
      },
    ],
    metadata: {
      'tileflow:interaction-manifest': {
        domains: {
          poi: {
            deduplication: {
              identity: ['source', 'source-layer', 'feature-id'],
              representationPriority: ['marker', 'icon', 'combined', 'label'],
            },
            fields: {
              category: 'category',
              filterRank: 'filter_rank',
              icon: 'icon',
              name: 'name',
              sizeRank: 'size_rank',
              type: 'type',
            },
            hitTesting: {frequency: 'animation-frame', order: 'rendered-topmost'},
            identity: 'maplibre-feature-id-if-present',
            layers: [
              {
                anchor: 'pointer-coordinate',
                category: 'food-drink',
                layerId: 'tileflow-poi-food-drink-icon',
                priority: 20,
                representation: 'icon',
                source: 'tileflow',
                sourceLayer: 'poi',
              },
              {
                anchor: 'pointer-coordinate',
                category: 'food-drink',
                layerId: 'tileflow-poi-food-drink-label',
                priority: 10,
                representation: 'label',
                source: 'tileflow',
                sourceLayer: 'poi',
              },
            ],
          },
        },
        version: 2,
      },
    },
  };
  const map = {
    getStyle: () => style,
    on(event: string, listener: (event: unknown) => void) {
      const entries = listeners.get(event) ?? new Set();
      entries.add(listener);
      listeners.set(event, entries);
      return {unsubscribe: () => entries.delete(listener)};
    },
    queryRenderedFeatures(_point: unknown, options: {layers: readonly string[]}) {
      queries += 1;
      assert.deepEqual(options.layers, [
        'tileflow-poi-food-drink-icon',
        'tileflow-poi-food-drink-label',
      ]);
      return features;
    },
  };
  const fire = (event: string, value: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(value);
  };
  return {
    fire,
    frames,
    map,
    queries: () => queries,
    setFeatures(value: readonly TileflowMapLibrePoiFeature[]) {
      features = value;
    },
    style,
  };
}

test('coalesces POI hit testing and emits normalized semantic targets without physical IDs', () => {
  const fixture = createFixture();
  const events: TileflowInteractionEvent[] = [];
  const hover: unknown[] = [];
  const controller = createTileflowMapLibrePoiController({
    bindings: [binding],
    cancelFrame: () => undefined,
    map: fixture.map,
    onHoverChange: (match) => hover.push(match),
    onInteractionEvent: (event) => events.push(event),
    requestFrame(callback) {
      fixture.frames.push(callback);
      return fixture.frames.length;
    },
  });
  const pointer = {lngLat: {lat: 40.4, lng: -3.7}, point: {x: 1, y: 2}};
  fixture.fire('mousemove', pointer);
  fixture.fire('mousemove', pointer);
  assert.equal(fixture.queries(), 0);
  fixture.frames.shift()?.();

  assert.equal(fixture.queries(), 1);
  const match = hover[0] as NonNullable<ReturnType<typeof controller.getHovered>>;
  assert.equal(match.target.kind, 'semantic-feature');
  assert.equal(match.target.feature.id, 'poi-42');
  assert.deepEqual(match.target.feature.properties, {
    category: 'food-drink',
    filter_rank: 3,
    icon: 'restaurant',
    name: 'Café',
    size_rank: 16,
    type: 'restaurant',
  });
  assert.equal('layerId' in match.target, false);
  assert.deepEqual(
    events.map(({type}) => type),
    ['target:enter'],
  );

  fixture.fire('mouseout', {});
  assert.deepEqual(
    events.map(({type}) => type),
    ['target:enter', 'target:leave'],
  );

  controller.dispose();
});

test('activates stable POIs and fails closed for popup targets without identity', () => {
  const fixture = createFixture();
  const activations: string[] = [];
  const diagnostics: string[] = [];
  const controller = createTileflowMapLibrePoiController({
    bindings: [binding],
    cancelFrame: () => undefined,
    map: fixture.map,
    onActivate: (match) => activations.push(String(match.target.feature.id)),
    onDiagnostic: ({code}) => diagnostics.push(code),
    requestFrame: () => 1,
  });
  const pointer = {lngLat: {lat: 40.4, lng: -3.7}, point: {x: 1, y: 2}};

  fixture.fire('click', pointer);
  assert.deepEqual(activations, ['poi-42']);
  fixture.setFeatures([
    {
      layer: {id: 'tileflow-poi-food-drink-label'},
      properties: {name: 'No ID'},
      source: 'tileflow',
      sourceLayer: 'poi',
    },
  ]);
  fixture.fire('click', pointer);
  assert.deepEqual(activations, ['poi-42']);
  assert.deepEqual(diagnostics, ['UNSTABLE_FEATURE_IDENTITY']);

  controller.dispose();
});

test('deduplicates repeated POI representations using manifest priority', () => {
  const fixture = createFixture();
  fixture.setFeatures([
    {
      id: 'poi-42',
      layer: {id: 'tileflow-poi-food-drink-label'},
      properties: {name: 'Label representation'},
      source: 'tileflow',
      sourceLayer: 'poi',
    },
    {
      id: 'poi-42',
      layer: {id: 'tileflow-poi-food-drink-icon'},
      properties: {name: 'Icon representation'},
      source: 'tileflow',
      sourceLayer: 'poi',
    },
  ]);
  const controller = createTileflowMapLibrePoiController({
    bindings: [binding],
    cancelFrame: () => undefined,
    map: fixture.map,
    requestFrame(callback) {
      fixture.frames.push(callback);
      return fixture.frames.length;
    },
  });

  fixture.fire('mousemove', {lngLat: {lat: 40.4, lng: -3.7}, point: {x: 1, y: 2}});
  fixture.frames.shift()?.();

  assert.equal(controller.getHovered()?.target.feature.properties.name, 'Icon representation');
  controller.dispose();
});

test('does not require semantic metadata until a POI binding is attached', () => {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const diagnostics: string[] = [];
  const controller = createTileflowMapLibrePoiController({
    cancelFrame: () => undefined,
    map: {
      getStyle: () => ({layers: [], metadata: {}}),
      on(event, listener) {
        const values = listeners.get(event) ?? new Set();
        values.add(listener);
        listeners.set(event, values);
        return {unsubscribe: () => values.delete(listener)};
      },
      queryRenderedFeatures: () => [],
    },
    onDiagnostic: ({code}) => diagnostics.push(code),
    requestFrame: () => 1,
  });

  assert.deepEqual(diagnostics, []);
  controller.reconcile([binding]);
  assert.deepEqual(diagnostics, ['SEMANTIC_MANIFEST_MISMATCH']);
  controller.dispose();
});

test('waits for style.load before diagnosing an unavailable bootstrap style', () => {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const diagnostics: string[] = [];
  const style = {current: undefined as unknown};
  const controller = createTileflowMapLibrePoiController({
    bindings: [binding],
    cancelFrame: () => undefined,
    map: {
      getStyle: () => style.current,
      on(event, listener) {
        const values = listeners.get(event) ?? new Set();
        values.add(listener);
        listeners.set(event, values);
        return {unsubscribe: () => values.delete(listener)};
      },
      queryRenderedFeatures: () => [],
    },
    onDiagnostic: ({code}) => diagnostics.push(code),
    requestFrame: () => 1,
  });

  assert.deepEqual(diagnostics, []);
  style.current = {layers: [], metadata: {}};
  for (const listener of listeners.get('style.load') ?? []) listener({});
  assert.deepEqual(diagnostics, ['SEMANTIC_MANIFEST_MISMATCH']);
  controller.dispose();
});

test('reports unsupported binding targets once per reconciliation', () => {
  const diagnostics: string[] = [];
  const controller = createTileflowMapLibrePoiController({
    bindings: [
      {id: 'annotation', target: {id: 'marker', kind: 'annotation'}},
      {id: 'map', target: {kind: 'map'}},
      {id: 'style', target: {kind: 'style-layer', layerId: 'custom'}},
    ],
    cancelFrame: () => undefined,
    map: {
      getStyle: () => ({layers: [], metadata: {}}),
      on: () => ({unsubscribe: () => undefined}),
      queryRenderedFeatures: () => [],
    },
    onDiagnostic: ({code}) => diagnostics.push(code),
    requestFrame: () => 1,
  });

  assert.deepEqual(diagnostics, ['UNSUPPORTED_TARGET']);
  controller.reconcile([
    {id: 'annotation', target: {id: 'marker', kind: 'annotation'}},
    {id: 'map', target: {kind: 'map'}},
  ]);
  assert.deepEqual(diagnostics, ['UNSUPPORTED_TARGET', 'UNSUPPORTED_TARGET']);
  controller.dispose();
});

test('rolls back earlier subscriptions when controller construction fails', () => {
  const subscribed: string[] = [];
  const unsubscribed: string[] = [];
  let subscriptions = 0;

  assert.throws(
    () =>
      createTileflowMapLibrePoiController({
        cancelFrame: () => undefined,
        map: {
          getStyle: () => ({layers: [], metadata: {}}),
          on(event) {
            subscriptions += 1;
            if (subscriptions === 3) throw new Error('subscribe failed');
            subscribed.push(event);
            return {unsubscribe: () => unsubscribed.push(event)};
          },
          queryRenderedFeatures: () => [],
        },
        requestFrame: () => 1,
      }),
    /subscribe failed/u,
  );
  assert.deepEqual(subscribed, ['mousemove', 'mouseout']);
  assert.deepEqual(unsubscribed, ['mouseout', 'mousemove']);
});

test('rolls back every earlier subscription when the style.load subscription fails', () => {
  const subscribed: string[] = [];
  const unsubscribed: string[] = [];

  assert.throws(
    () =>
      createTileflowMapLibrePoiController({
        bindings: [binding],
        cancelFrame: () => undefined,
        map: {
          getStyle: () => undefined,
          on(event) {
            if (event === 'style.load') throw new Error('style.load subscribe failed');
            subscribed.push(event);
            return {unsubscribe: () => unsubscribed.push(event)};
          },
          queryRenderedFeatures: () => [],
        },
        requestFrame: () => 1,
      }),
    /style\.load subscribe failed/u,
  );
  assert.deepEqual(subscribed, ['mousemove', 'mouseout', 'click', 'styledata']);
  assert.deepEqual(unsubscribed, ['styledata', 'click', 'mouseout', 'mousemove']);
});

test('retries failed frame cancellation and unsubscription while completing every teardown step', () => {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const unsubscribeAttempts = new Map<string, number>();
  let cancelAttempts = 0;
  const controller = createTileflowMapLibrePoiController({
    cancelFrame: () => {
      cancelAttempts += 1;
      if (cancelAttempts === 1) throw new Error('cancel failed');
    },
    map: {
      getStyle: () => ({layers: [], metadata: {}}),
      on(event, listener) {
        const values = listeners.get(event) ?? new Set();
        values.add(listener);
        listeners.set(event, values);
        return {
          unsubscribe() {
            const attempts = (unsubscribeAttempts.get(event) ?? 0) + 1;
            unsubscribeAttempts.set(event, attempts);
            if (event === 'mousemove' && attempts === 1) throw new Error('unsubscribe failed');
            values.delete(listener);
          },
        };
      },
      queryRenderedFeatures: () => [],
    },
    requestFrame: () => 99,
  });
  for (const listener of listeners.get('mousemove') ?? []) {
    listener({lngLat: {lat: 1, lng: 2}, point: {x: 0, y: 0}});
  }

  assert.throws(() => controller.dispose(), /dispose|cancel failed|unsubscribe failed/u);
  assert.equal(unsubscribeAttempts.get('style.load'), 1);
  assert.equal(unsubscribeAttempts.get('styledata'), 1);
  assert.equal(unsubscribeAttempts.get('click'), 1);
  assert.equal(unsubscribeAttempts.get('mouseout'), 1);
  assert.equal(unsubscribeAttempts.get('mousemove'), 1);

  controller.dispose();
  controller.dispose();
  assert.equal(cancelAttempts, 2);
  assert.equal(unsubscribeAttempts.get('mousemove'), 2);
  assert.equal(unsubscribeAttempts.get('styledata'), 1);
});

test('rejects a POI manifest spanning multiple feature-ID namespaces', () => {
  const fixture = createFixture();
  fixture.style.layers.push({
    id: 'other-poi',
    source: 'other-source',
    'source-layer': 'other-poi',
    type: 'symbol',
  });
  fixture.style.metadata['tileflow:interaction-manifest'].domains.poi.layers.push({
    anchor: 'pointer-coordinate',
    category: 'food-drink',
    layerId: 'other-poi',
    priority: 1,
    representation: 'icon',
    source: 'other-source',
    sourceLayer: 'other-poi',
  });
  const diagnostics: string[] = [];
  const controller = createTileflowMapLibrePoiController({
    bindings: [binding],
    cancelFrame: () => undefined,
    map: fixture.map,
    onDiagnostic: ({code}) => diagnostics.push(code),
    requestFrame: () => 1,
  });

  assert.deepEqual(diagnostics, ['SEMANTIC_MANIFEST_MISMATCH']);
  controller.dispose();
});

test('accepts and deduplicates GeoJSON POI layers without source-layer', () => {
  const fixture = createFixture();
  for (const layer of fixture.style.layers) Reflect.deleteProperty(layer, 'source-layer');
  for (const layer of fixture.style.metadata['tileflow:interaction-manifest'].domains.poi.layers) {
    Reflect.deleteProperty(layer, 'sourceLayer');
  }
  fixture.setFeatures([
    {
      id: 'poi-42',
      layer: {id: 'tileflow-poi-food-drink-label'},
      properties: {name: 'Label representation'},
      source: 'tileflow',
    },
    {
      id: 'poi-42',
      layer: {id: 'tileflow-poi-food-drink-icon'},
      properties: {name: 'Icon representation'},
      source: 'tileflow',
    },
  ]);
  const diagnostics: string[] = [];
  const controller = createTileflowMapLibrePoiController({
    bindings: [binding],
    cancelFrame: () => undefined,
    map: fixture.map,
    onDiagnostic: ({code}) => diagnostics.push(code),
    requestFrame(callback) {
      fixture.frames.push(callback);
      return fixture.frames.length;
    },
  });

  fixture.fire('mousemove', {lngLat: {lat: 40.4, lng: -3.7}, point: {x: 1, y: 2}});
  fixture.frames.shift()?.();

  assert.equal(controller.getHovered()?.target.feature.properties.name, 'Icon representation');
  assert.deepEqual(diagnostics, []);
  controller.dispose();
});

test('coalesces transient styledata while still reporting a settled manifest mismatch', async () => {
  const fixture = createFixture();
  const diagnostics: string[] = [];
  const controller = createTileflowMapLibrePoiController({
    bindings: [binding],
    cancelFrame: () => undefined,
    map: fixture.map,
    onDiagnostic: ({code}) => diagnostics.push(code),
    requestFrame: () => 1,
  });
  const layers = [...fixture.style.layers];

  fixture.style.layers.splice(0);
  fixture.fire('styledata', {});
  fixture.style.layers.push(...layers);
  fixture.fire('styledata', {});
  assert.deepEqual(diagnostics, []);
  await Promise.resolve();
  assert.deepEqual(diagnostics, []);

  fixture.style.layers.splice(0);
  fixture.fire('styledata', {});
  await Promise.resolve();
  assert.deepEqual(diagnostics, ['SEMANTIC_MANIFEST_MISMATCH']);

  controller.dispose();
});
