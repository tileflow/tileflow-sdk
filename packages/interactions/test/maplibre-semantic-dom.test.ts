import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  TileflowInteractionBinding,
  TileflowInteractionEvent,
  TileflowInteractionState,
} from '../src/contracts';
import type {TileflowMapLibrePoiFeature} from '../src/maplibre-poi';
import {createTileflowMapLibreSemanticDomRuntime} from '../src/maplibre-semantic-dom';

class FakeStyle {
  background = '';
  borderColor = '';
  borderRadius = '';
  borderStyle = '';
  borderWidth = '';
  boxShadow = '';
  color = '';
  cursor = '';
  maxWidth = '';
  padding = '';
  pointerEvents = '';
}

type FakeEvent = {
  key: string;
  preventDefault: () => void;
  stopPropagation: () => void;
};

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  className = '';
  focusCalls = 0;
  id = '';
  removed = false;
  readonly style = new FakeStyle();
  text = '';
  type = '';
  private readonly listeners = new Map<string, Set<(event: FakeEvent) => void>>();

  addEventListener(type: string, listener: (event: FakeEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  append(...elements: FakeElement[]) {
    this.children.push(...elements);
  }

  focus() {
    this.focusCalls += 1;
  }

  remove() {
    this.removed = true;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  get textContent() {
    return this.text;
  }

  set textContent(value: string | null) {
    this.text = value ?? '';
    this.children.length = 0;
  }
}

class FakeDocument {
  readonly elements: FakeElement[] = [];

  createElement() {
    const element = new FakeElement();
    this.elements.push(element);
    return element;
  }
}

type FakeMap = {attached: FakePositioned[]};

class FakePositioned {
  coordinate: [number, number] | null = null;
  removeFailures = 0;
  removeCalls = 0;

  constructor(readonly shell: FakeElement) {}

  addTo(map: FakeMap) {
    map.attached.push(this);
    return this;
  }

  remove() {
    this.removeCalls += 1;
    if (this.removeFailures > 0) {
      this.removeFailures -= 1;
      throw new Error('remove failed');
    }
    return this;
  }

  setLngLat(coordinate: [number, number]) {
    this.coordinate = coordinate;
    return this;
  }
}

const textBinding: TileflowInteractionBinding = {
  id: 'poi-card',
  popup: {content: {kind: 'text', text: 'Details'}},
  target: {categories: ['food-drink'], domain: 'poi', kind: 'semantic-feature'},
  tooltip: {content: {field: 'name', kind: 'field'}},
};

function createHarness(binding: TileflowInteractionBinding = textBinding) {
  const document = new FakeDocument();
  const map: FakeMap = {attached: []};
  const frames: Array<() => void> = [];
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const events: TileflowInteractionEvent[] = [];
  const states: TileflowInteractionState[] = [];
  let failOverlay = false;
  let failQuery = false;
  const style = {
    layers: [
      {
        id: 'streets-poi-food-drink-icon',
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
                layerId: 'streets-poi-food-drink-icon',
                priority: 10,
                representation: 'icon',
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
  let feature: TileflowMapLibrePoiFeature = {
    id: 'poi-42',
    layer: {id: 'streets-poi-food-drink-icon'},
    properties: {
      category: 'food-drink',
      filter_rank: 2,
      icon: 'restaurant',
      name: 'Café',
      size_rank: 16,
      type: 'restaurant',
    },
    source: 'tileflow',
    sourceLayer: 'poi',
  };
  const poiMap = {
    getStyle: () => style,
    on(event: string, listener: (event: unknown) => void) {
      const values = listeners.get(event) ?? new Set();
      values.add(listener);
      listeners.set(event, values);
      return {unsubscribe: () => values.delete(listener)};
    },
    queryRenderedFeatures: () => {
      if (failQuery) {
        failQuery = false;
        throw new Error('query failed');
      }
      return [feature];
    },
  };
  const runtime = createTileflowMapLibreSemanticDomRuntime({
    cancelFrame: () => undefined,
    createOverlay({container}) {
      if (failOverlay) throw new Error('overlay failed');
      return new FakePositioned(container as unknown as FakeElement);
    },
    document: document as unknown as Document,
    map,
    onInteractionStateChange(state) {
      states.push(state);
    },
    poiMap,
    requestFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
  });
  runtime.subscribeEvents((event) => events.push(event));
  runtime.reconcile([binding]);

  const fire = (type: string) => {
    const event = {lngLat: {lat: 40.4, lng: -3.7}, point: {x: 1, y: 2}};
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  return {
    document,
    events,
    failNextOverlay() {
      failOverlay = true;
    },
    failNextQuery() {
      failQuery = true;
    },
    fire,
    frames,
    map,
    runtime,
    setFeature(nextFeature: TileflowMapLibrePoiFeature) {
      feature = nextFeature;
    },
    states,
  };
}

test('mounts semantic tooltip and popup shells with normalized lifecycle state', () => {
  const harness = createHarness();
  harness.fire('mousemove');
  harness.frames.shift()?.();

  assert.equal(harness.map.attached.length, 1);
  const tooltip = harness.map.attached[0]!;
  assert.equal(tooltip.coordinate?.[0], -3.7);
  assert.equal(tooltip.shell.attributes.get('data-tileflow-target-kind'), 'semantic-feature');
  assert.equal(tooltip.shell.attributes.has('inert'), false);
  assert.equal(tooltip.shell.children[0]?.textContent, 'Café');

  harness.fire('click');
  assert.deepEqual(harness.runtime.getInteractionState(), {
    popup: {domain: 'poi', featureId: 'poi-42', kind: 'semantic-feature'},
  });
  assert.equal(harness.map.attached.length, 2);
  assert.equal(harness.map.attached[1]?.shell.children[0]?.textContent, 'Details');
  assert.deepEqual(
    harness.events.map(({type}) => type),
    ['target:enter', 'target:activate', 'popup:open'],
  );

  assert.equal(harness.runtime.closePopup(), true);
  assert.equal(harness.runtime.getInteractionState().popup, null);
  assert.deepEqual(
    harness.events.map(({type}) => type),
    ['target:enter', 'target:activate', 'popup:open', 'popup:close'],
  );
  harness.runtime.dispose();
});

test('publishes keyed custom view targets and resolves diagnostic snapshots', () => {
  const binding: TileflowInteractionBinding = {
    id: 'poi-view',
    target: {domain: 'poi', kind: 'semantic-feature'},
    tooltip: {content: {kind: 'view', name: 'poi-preview'}},
  };
  const harness = createHarness(binding);
  const snapshots: readonly string[][] = [];
  harness.runtime.subscribeDiagnostics((next) =>
    (snapshots as string[][]).push(next.map(({code}) => code)),
  );
  harness.fire('mousemove');
  harness.frames.shift()?.();

  assert.deepEqual(
    harness.runtime.getDiagnostics().map(({code}) => code),
    ['MISSING_VIEW'],
  );
  harness.runtime.setCustomRenderers({popup: false, tooltip: true});
  assert.deepEqual(harness.runtime.getDiagnostics(), []);
  const target = harness.runtime.getRenderTargets()[0];
  assert.equal(target?.viewName, 'poi-preview');
  assert.equal(target?.target.kind, 'semantic-feature');
  assert.match(target?.key ?? '', /^tooltip:poi-view:/u);
  assert.deepEqual(snapshots, [['MISSING_VIEW'], []]);
  harness.runtime.dispose();
});

test('controlled semantic popup waits for committed state', () => {
  const document = new FakeDocument();
  const map: FakeMap = {attached: []};
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const requests: TileflowInteractionState[] = [];
  const style = {
    layers: [{id: 'poi', source: 'tileflow', 'source-layer': 'poi'}],
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
                layerId: 'poi',
                priority: 1,
                representation: 'icon',
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
  const runtime = createTileflowMapLibreSemanticDomRuntime({
    cancelFrame: () => undefined,
    createOverlay: ({container}) => new FakePositioned(container as unknown as FakeElement),
    document: document as unknown as Document,
    interactionState: {popup: null},
    map,
    onInteractionStateChange: (state) => requests.push(state),
    poiMap: {
      getStyle: () => style,
      on(event, listener) {
        const values = listeners.get(event) ?? new Set();
        values.add(listener);
        listeners.set(event, values);
        return {unsubscribe: () => values.delete(listener)};
      },
      queryRenderedFeatures: () => [
        {
          id: 7,
          layer: {id: 'poi'},
          properties: {name: 'POI'},
          source: 'tileflow',
          sourceLayer: 'poi',
        },
      ],
    },
    requestFrame: () => 1,
  });
  runtime.reconcile([textBinding]);
  for (const listener of listeners.get('click') ?? []) {
    listener({lngLat: {lat: 1, lng: 2}, point: {x: 0, y: 0}});
  }
  assert.equal(map.attached.length, 0);
  assert.equal(requests.length, 1);
  runtime.setInteractionState(requests[0]!);
  assert.equal(map.attached.length, 1);
  runtime.dispose();
});

test('updates an active semantic outlet by binding ID without recreating its overlay', () => {
  const harness = createHarness();
  harness.fire('mousemove');
  harness.frames.shift()?.();
  const tooltip = harness.map.attached[0]!;

  harness.runtime.reconcile([
    {
      ...textBinding,
      tooltip: {content: {kind: 'text', text: 'Updated tooltip'}},
    },
  ]);
  assert.equal(harness.map.attached.length, 1);
  assert.equal(tooltip.shell.children[0]?.textContent, 'Updated tooltip');

  harness.runtime.reconcile([
    {id: textBinding.id, popup: textBinding.popup, target: textBinding.target},
  ]);
  assert.equal(tooltip.removeCalls, 1);
  harness.runtime.dispose();
});

test('fails a semantic overlay closed with a structured diagnostic', () => {
  const harness = createHarness();
  harness.failNextOverlay();
  harness.fire('mousemove');
  assert.doesNotThrow(() => harness.frames.shift()?.());
  assert.equal(harness.map.attached.length, 0);
  assert.deepEqual(
    harness.runtime.getDiagnostics().map(({code}) => code),
    ['OVERLAY_FAILURE'],
  );
  harness.runtime.dispose();
});

test('drops historical POI matches after hover leaves instead of reopening stale state', () => {
  const harness = createHarness();
  harness.fire('mousemove');
  harness.frames.shift()?.();
  const tooltip = harness.map.attached[0]!;
  harness.fire('mouseout');
  assert.equal(tooltip.removeCalls, 1);

  harness.runtime.setInteractionState({
    popup: {domain: 'poi', featureId: 'poi-42', kind: 'semantic-feature'},
  });
  assert.equal(harness.map.attached.length, 1);
  assert.deepEqual(
    harness.runtime.getDiagnostics().map(({code}) => code),
    ['STALE_TARGET'],
  );
  harness.runtime.dispose();
});

test('invalidates active semantic matches on style refresh and re-resolves from a current hit', async () => {
  const harness = createHarness();
  harness.fire('mousemove');
  harness.frames.shift()?.();
  harness.fire('click');
  const popup = harness.map.attached[1]!;
  const openState = harness.runtime.getInteractionState();

  harness.fire('styledata');
  await Promise.resolve();
  assert.equal(popup.removeCalls, 1);
  assert.deepEqual(harness.runtime.getInteractionState(), openState);
  assert.deepEqual(
    harness.runtime.getDiagnostics().map(({code}) => code),
    ['STALE_TARGET'],
  );

  harness.fire('mousemove');
  harness.frames.shift()?.();
  assert.equal(harness.map.attached.length, 3);
  assert.deepEqual(harness.runtime.getDiagnostics(), []);
  harness.runtime.dispose();
});

test('closes active outlets when a same-ID selector no longer matches the POI category', () => {
  const harness = createHarness();
  harness.fire('mousemove');
  harness.frames.shift()?.();
  harness.fire('click');
  const popup = harness.map.attached[1]!;

  harness.runtime.reconcile([
    {
      ...textBinding,
      target: {categories: ['retail'], domain: 'poi', kind: 'semantic-feature'},
    },
  ]);
  assert.equal(popup.removeCalls, 1);
  assert.equal(harness.runtime.getInteractionState().popup, null);
  assert.deepEqual(harness.runtime.getRenderTargets(), []);
  harness.runtime.dispose();
});

test('resolves transient query and unstable-identity diagnostics after success or reconcile', () => {
  const harness = createHarness();
  harness.failNextQuery();
  harness.fire('mousemove');
  harness.frames.shift()?.();
  assert.deepEqual(
    harness.runtime.getDiagnostics().map(({code}) => code),
    ['SEMANTIC_MANIFEST_MISMATCH'],
  );

  harness.fire('mousemove');
  harness.frames.shift()?.();
  assert.deepEqual(harness.runtime.getDiagnostics(), []);

  harness.setFeature({
    layer: {id: 'streets-poi-food-drink-icon'},
    properties: {name: 'No stable ID'},
    source: 'tileflow',
    sourceLayer: 'poi',
  });
  harness.fire('click');
  assert.deepEqual(
    harness.runtime.getDiagnostics().map(({code}) => code),
    ['UNSTABLE_FEATURE_IDENTITY'],
  );
  harness.runtime.reconcile([textBinding]);
  assert.deepEqual(harness.runtime.getDiagnostics(), []);
  harness.runtime.dispose();
});

test('removes every semantic shell and retries failed overlay cleanup during disposal', () => {
  const harness = createHarness();
  harness.fire('mousemove');
  harness.frames.shift()?.();
  const tooltip = harness.map.attached[0]!;
  tooltip.removeFailures = 1;

  assert.throws(() => harness.runtime.dispose(), /remove failed/u);
  assert.equal(tooltip.shell.removed, true);
  assert.equal(tooltip.removeCalls, 2);
  harness.runtime.dispose();
  harness.runtime.dispose();
  assert.equal(tooltip.removeCalls, 2);
});
