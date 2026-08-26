import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowAnnotation, TileflowInteractionState} from '../src/contracts';
import {
  createTileflowMapLibreDomRuntime,
  normalizeTileflowLegacyMarkers,
  type TileflowMapLibreDomRuntimeOptions,
} from '../src/maplibre-dom';

class FakeStyle {
  alignItems = '';
  background = '';
  border = '';
  borderColor = '';
  borderRadius = '';
  borderStyle = '';
  borderWidth = '';
  boxShadow = '';
  color = '';
  cursor = '';
  display = '';
  justifyContent = '';
  maxWidth = '';
  minHeight = '';
  minWidth = '';
  padding = '';
  pointerEvents = '';
  readonly properties = new Map<string, string>();

  removeProperty(name: string): string {
    const previous = this.properties.get(name) ?? '';
    this.properties.delete(name);
    return previous;
  }

  setProperty(name: string, value: string): void {
    this.properties.set(name, value);
  }
}

type FakeEventInit = Readonly<{
  code?: string;
  key?: string;
}>;

type FakeEvent = {
  code: string;
  defaultPrevented: boolean;
  key: string;
  propagationStopped: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
  type: string;
};

class FakeDocument {
  activeElement: FakeElement | null = null;
  readonly elements: FakeElement[] = [];

  createElement(tagName: string): FakeElement {
    const element = new FakeElement(this, tagName);
    this.elements.push(element);
    return element;
  }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  className = '';
  focusCalls = 0;
  id = '';
  parent: FakeElement | null = null;
  removed = false;
  readonly style = new FakeStyle();
  tabIndex = -1;
  text = '';
  title = '';
  type = '';
  private readonly listeners = new Map<string, Set<(event: FakeEvent) => void>>();

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly tagName: string,
  ) {}

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  append(...elements: FakeElement[]): void {
    for (const element of elements) {
      element.parent?.removeChild(element);
      element.parent = this;
      this.children.push(element);
    }
  }

  dispatch(type: string, init: FakeEventInit = {}): FakeEvent {
    const event: FakeEvent = {
      code: init.code ?? '',
      defaultPrevented: false,
      key: init.key ?? '',
      preventDefault() {
        event.defaultPrevented = true;
      },
      propagationStopped: false,
      stopPropagation() {
        event.propagationStopped = true;
      },
      type,
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    return event;
  }

  focus(): void {
    this.focusCalls += 1;
    this.ownerDocument.activeElement = this;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  remove(): void {
    this.parent?.removeChild(this);
    this.removed = true;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  removeChild(element: FakeElement): void {
    const index = this.children.indexOf(element);
    if (index >= 0) this.children.splice(index, 1);
    element.parent = null;
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  get textContent(): string {
    return this.text;
  }

  set textContent(value: string | null) {
    this.text = value ?? '';
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
  }

  set innerHTML(_value: string) {
    throw new Error('innerHTML must never be used');
  }
}

type FakeMap = {attached: FakePositioned[]};

class FakePositioned {
  addCalls = 0;
  coordinate: [number, number] | null = null;
  failAdd = false;
  removeCalls = 0;

  constructor(
    readonly kind: 'marker' | 'popup' | 'tooltip',
    readonly element: FakeElement,
  ) {}

  addTo(map: FakeMap): this {
    this.addCalls += 1;
    if (this.failAdd) throw new Error('attach failed');
    map.attached.push(this);
    return this;
  }

  remove(): this {
    this.removeCalls += 1;
    return this;
  }

  setLngLat(coordinate: [number, number]): this {
    this.coordinate = [...coordinate];
    return this;
  }
}

type HarnessOptions = Partial<
  Pick<
    TileflowMapLibreDomRuntimeOptions<FakeMap, FakePositioned, FakePositioned, TileflowAnnotation>,
    | 'customMarker'
    | 'customPopup'
    | 'customTooltip'
    | 'defaultInteractionState'
    | 'interactionState'
    | 'onDiagnostic'
    | 'onInteractionStateChange'
  >
> & {
  failMarkerId?: string;
  failOverlayKind?: 'popup' | 'tooltip';
};

function createHarness(options: HarnessOptions = {}) {
  const document = new FakeDocument();
  const map: FakeMap = {attached: []};
  const markers: Array<{
    annotation: TileflowAnnotation;
    element: FakeElement;
    positioned: FakePositioned;
  }> = [];
  const overlays: Array<{
    annotation: TileflowAnnotation;
    container: FakeElement;
    kind: 'popup' | 'tooltip';
    positioned: FakePositioned;
  }> = [];
  const overlayUpdates: string[] = [];

  const runtime = createTileflowMapLibreDomRuntime<
    FakeMap,
    FakePositioned,
    FakePositioned,
    TileflowAnnotation
  >({
    createMarker({annotation, element}) {
      const positioned = new FakePositioned('marker', element as unknown as FakeElement);
      positioned.failAdd = annotation.id === options.failMarkerId;
      markers.push({annotation, element: element as unknown as FakeElement, positioned});
      return positioned;
    },
    createOverlay({annotation, container, kind}) {
      const positioned = new FakePositioned(kind, container as unknown as FakeElement);
      positioned.failAdd = kind === options.failOverlayKind;
      overlays.push({
        annotation,
        container: container as unknown as FakeElement,
        kind,
        positioned,
      });
      return positioned;
    },
    document: document as unknown as Document,
    map,
    updateOverlay(_overlay, {annotation, kind}) {
      overlayUpdates.push(`${kind}:${annotation.id}`);
    },
    ...options,
  });

  return {document, map, markers, overlayUpdates, overlays, runtime};
}

function annotation(id: string, overrides: Partial<TileflowAnnotation> = {}): TileflowAnnotation {
  return {
    ariaLabel: `Annotation ${id}`,
    coordinate: [0, 0],
    id,
    kind: 'marker',
    ...overrides,
  };
}

function markerElement(harness: ReturnType<typeof createHarness>, index = 0): FakeElement {
  return harness.markers[index]!.element;
}

function contentOf(element: FakeElement): FakeElement {
  return element.children[0]!;
}

test('module evaluation is SSR-safe and does not read browser globals', async () => {
  const globals = ['document', 'navigator', 'requestAnimationFrame', 'window'] as const;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const name of globals) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        throw new Error(`${name} was read during module evaluation`);
      },
    });
  }

  try {
    const specifier = new URL(`../src/maplibre-dom.ts?ssr=${Date.now()}`, import.meta.url).href;
    const imported = await import(specifier);
    assert.equal(typeof imported.createTileflowMapLibreDomRuntime, 'function');
  } finally {
    for (const name of globals) {
      const descriptor = descriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  }
});

test('normalizes legacy markers once while preserving their exact legacy titles', () => {
  const normalized = normalizeTileflowLegacyMarkers([
    {color: '#123456', coordinates: [-3.7, 40.4], id: 'madrid', label: 'Madrid'},
    {coordinates: [0, 0], id: 'empty', label: ''},
    {coordinates: [1, 2], id: 'fallback'},
  ]);

  assert.deepEqual(
    normalized.annotations.map(({ariaLabel, coordinate, id, marker}) => ({
      ariaLabel,
      coordinate,
      id,
      marker,
    })),
    [
      {
        ariaLabel: 'Madrid',
        coordinate: [-3.7, 40.4],
        id: 'madrid',
        marker: {color: '#123456'},
      },
      {ariaLabel: 'empty', coordinate: [0, 0], id: 'empty', marker: undefined},
      {ariaLabel: 'fallback', coordinate: [1, 2], id: 'fallback', marker: undefined},
    ],
  );
  assert.equal(normalized.titles.get('madrid'), 'Madrid');
  assert.equal(normalized.titles.get('empty'), '');
  assert.equal(normalized.titles.get('fallback'), 'fallback');
});

test('renders secure accessible defaults through textContent and stable DOM surfaces', () => {
  const harness = createHarness();
  const unsafe = '<img src=x onerror=alert(1)>';
  harness.runtime.reconcile([
    annotation('safe', {
      data: {name: unsafe},
      marker: {color: '#c6a15b', content: {field: 'name', kind: 'field'}},
      popup: {content: {kind: 'text', text: unsafe}},
      tooltip: {content: {field: 'name', kind: 'field'}},
    }),
  ]);

  const marker = markerElement(harness);
  assert.equal(marker.className, 'tileflow-interaction-marker');
  assert.equal(marker.getAttribute('data-tileflow-interaction'), 'marker');
  assert.equal(marker.getAttribute('data-tileflow-target-kind'), 'annotation');
  assert.equal(marker.getAttribute('data-tileflow-annotation-id'), null);
  assert.equal(marker.getAttribute('role'), 'button');
  assert.equal(marker.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(marker.getAttribute('aria-expanded'), 'false');
  assert.equal(marker.tabIndex, 0);
  assert.equal(contentOf(marker).className, 'tileflow-interaction-marker-content');
  assert.equal(contentOf(marker).textContent, unsafe);
  assert.equal(marker.style.properties.get('--tileflow-interaction-marker-color'), '#c6a15b');

  marker.dispatch('pointerenter');
  const tooltip = harness.overlays.at(-1)!;
  assert.equal(tooltip.kind, 'tooltip');
  assert.equal(tooltip.container.className, 'tileflow-interaction-tooltip');
  assert.equal(tooltip.container.getAttribute('role'), 'tooltip');
  assert.equal(tooltip.container.getAttribute('inert'), null);
  assert.equal(tooltip.container.style.pointerEvents, 'none');
  assert.equal(contentOf(tooltip.container).textContent, unsafe);
  assert.match(marker.getAttribute('aria-describedby') ?? '', /^tileflow-interactions-/u);

  marker.dispatch('click');
  const popup = harness.overlays.at(-1)!;
  assert.equal(popup.kind, 'popup');
  assert.equal(tooltip.positioned.removeCalls, 1);
  assert.equal(popup.container.className, 'tileflow-interaction-popup');
  assert.equal(popup.container.getAttribute('role'), 'dialog');
  assert.equal(contentOf(popup.container).textContent, unsafe);
  assert.equal(popup.container.children[1]!.textContent, 'Close');
  assert.equal(harness.document.activeElement, popup.container.children[1]);
  assert.equal(marker.getAttribute('aria-expanded'), 'true');
  assert.equal(marker.getAttribute('aria-controls'), popup.container.id);
  assert.equal(popup.container.id.includes('safe'), false);
});

test('reports missing fields and active missing views once per surface', () => {
  const diagnostics: Array<{code: string; id?: string}> = [];
  const snapshots: string[][] = [];
  const harness = createHarness({
    onDiagnostic(diagnostic) {
      diagnostics.push({
        code: diagnostic.code,
        id: diagnostic.target?.kind === 'annotation' ? diagnostic.target.id : undefined,
      });
    },
  });
  harness.runtime.subscribeDiagnostics((next) => {
    snapshots.push(next.map(({code}) => code));
  });
  const input = annotation('diagnostic', {
    data: {},
    marker: {content: {field: 'missing', kind: 'field'}},
    popup: {content: {kind: 'view', name: 'popup-view'}},
    tooltip: {content: {kind: 'view', name: 'tooltip-view'}},
  });

  harness.runtime.reconcile([input]);
  harness.runtime.reconcile([input]);
  assert.deepEqual(
    harness.runtime.getDiagnostics().map(({code}) => code),
    ['INVALID_FIELD'],
  );
  markerElement(harness).dispatch('pointerenter');
  markerElement(harness).dispatch('click');

  assert.deepEqual(diagnostics, [
    {code: 'INVALID_FIELD', id: 'diagnostic'},
    {code: 'MISSING_VIEW', id: 'diagnostic'},
    {code: 'MISSING_VIEW', id: 'diagnostic'},
  ]);
  harness.runtime.setCustomRenderers({marker: true, popup: true, tooltip: true});
  assert.deepEqual(
    harness.runtime.getDiagnostics().map(({code}) => code),
    ['INVALID_FIELD'],
  );
  harness.runtime.reconcile([
    annotation('diagnostic', {
      marker: {content: {kind: 'text', text: 'Resolved'}},
      popup: {content: {kind: 'view', name: 'popup-view'}},
      tooltip: {content: {kind: 'view', name: 'tooltip-view'}},
    }),
  ]);
  assert.deepEqual(harness.runtime.getDiagnostics(), []);
  harness.runtime.setCustomRenderers({marker: false, popup: false, tooltip: false});
  assert.deepEqual(diagnostics.at(-1), {code: 'MISSING_VIEW', id: 'diagnostic'});
  assert.deepEqual(
    harness.runtime.getDiagnostics().map(({code}) => code),
    ['MISSING_VIEW'],
  );
  harness.runtime.reconcile([
    annotation('diagnostic', {
      marker: {content: {kind: 'text', text: 'Resolved'}},
      popup: {content: {kind: 'text', text: 'Resolved'}},
    }),
  ]);
  assert.deepEqual(harness.runtime.getDiagnostics(), []);
  assert.deepEqual(snapshots.at(-1), []);
});

test('fails an annotation overlay closed with a structured diagnostic', () => {
  const harness = createHarness({failOverlayKind: 'tooltip'});
  harness.runtime.reconcile([
    annotation('failure', {tooltip: {content: {kind: 'text', text: 'Tooltip'}}}),
  ]);

  assert.doesNotThrow(() => markerElement(harness).dispatch('pointerenter'));
  assert.equal(harness.overlays[0]?.positioned.removeCalls, 1);
  assert.deepEqual(
    harness.runtime.getDiagnostics().map(({code}) => code),
    ['OVERLAY_FAILURE'],
  );
  harness.runtime.dispose();
});

test('tooltip hover and focus rules keep exactly one transient overlay', () => {
  const harness = createHarness();
  harness.runtime.reconcile([
    annotation('a', {tooltip: {content: {kind: 'text', text: 'A'}}}),
    annotation('b', {tooltip: {content: {kind: 'text', text: 'B'}}}),
  ]);
  const a = markerElement(harness, 0);
  const b = markerElement(harness, 1);

  a.dispatch('pointerenter');
  a.dispatch('focus');
  a.dispatch('pointerleave');
  assert.equal(harness.overlays[0]!.positioned.removeCalls, 0);

  b.dispatch('pointerenter');
  assert.equal(harness.overlays[0]!.positioned.removeCalls, 1);
  assert.equal(harness.overlays[1]!.kind, 'tooltip');
  b.dispatch('pointerleave');
  assert.equal(harness.overlays[1]!.positioned.removeCalls, 1);

  a.dispatch('blur');
  assert.equal(a.getAttribute('aria-describedby'), null);
});

test('popup supports keyboard activation, Escape, focus return, and one active popup', () => {
  const harness = createHarness();
  const events: string[] = [];
  harness.runtime.subscribeEvents((event) =>
    events.push(`${event.type}:${event.target.annotation.id}`),
  );
  harness.runtime.reconcile([
    annotation('a', {popup: {content: {kind: 'text', text: 'A'}}}),
    annotation('b', {popup: {content: {kind: 'text', text: 'B'}}}),
  ]);
  const a = markerElement(harness, 0);
  const b = markerElement(harness, 1);

  const enter = a.dispatch('keydown', {key: 'Enter'});
  assert.equal(enter.defaultPrevented, true);
  const popupA = harness.overlays.at(-1)!;
  assert.equal(popupA.kind, 'popup');

  const space = b.dispatch('keydown', {code: 'Space', key: ' '});
  assert.equal(space.defaultPrevented, true);
  const popupB = harness.overlays.at(-1)!;
  assert.equal(popupA.positioned.removeCalls, 1);
  assert.equal(popupB.kind, 'popup');

  const escape = popupB.container.dispatch('keydown', {key: 'Escape'});
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.propagationStopped, true);
  assert.equal(popupB.positioned.removeCalls, 1);
  assert.equal(harness.document.activeElement, b);
  assert.equal(b.getAttribute('aria-expanded'), 'false');
  assert.equal(harness.runtime.getInteractionState().popup, null);
  assert.deepEqual(events, [
    'target:activate:a',
    'popup:open:a',
    'target:activate:b',
    'popup:close:a',
    'popup:open:b',
    'popup:close:b',
  ]);
});

test('custom outlets stay keyed, update without recreating Marker, and can change dynamically', () => {
  const harness = createHarness({customMarker: true, customPopup: true, customTooltip: true});
  const snapshots: string[][] = [];
  harness.runtime.subscribeRenderTargets((targets) =>
    snapshots.push(targets.map((target) => target.key)),
  );
  const first = annotation('a', {
    coordinate: [1, 2],
    data: {name: 'first'},
    marker: {content: {kind: 'view', name: 'marker-view'}},
    popup: {content: {kind: 'view', name: 'popup-view'}},
    tooltip: {content: {kind: 'view', name: 'tooltip-view'}},
  });
  harness.runtime.reconcile([first]);

  const markerTarget = harness.runtime.getRenderTargets()[0]!;
  assert.equal(markerTarget.key, 'marker:a');
  assert.equal(markerTarget.kind, 'marker');
  assert.equal(markerTarget.container.getAttribute('data-tileflow-view'), 'marker-view');
  const customNode = harness.document.createElement('span');
  (markerTarget.container as unknown as FakeElement).append(customNode);

  markerElement(harness).dispatch('pointerenter');
  assert.deepEqual(
    harness.runtime.getRenderTargets().map(({key}) => key),
    ['marker:a', 'tooltip:a'],
  );
  markerElement(harness).dispatch('click');
  assert.deepEqual(
    harness.runtime.getRenderTargets().map(({key}) => key),
    ['marker:a', 'popup:a'],
  );

  const markerInstance = harness.markers[0]!.positioned;
  const popupInstance = harness.overlays.at(-1)!.positioned;
  const next = annotation('a', {
    coordinate: [3, 4],
    data: {name: 'next'},
    marker: {content: {kind: 'view', name: 'marker-view'}},
    popup: {content: {kind: 'view', name: 'popup-view'}},
    tooltip: {content: {kind: 'view', name: 'tooltip-view'}},
  });
  harness.runtime.reconcile([next]);

  assert.equal(harness.markers.length, 1);
  assert.equal(harness.markers[0]!.positioned, markerInstance);
  assert.deepEqual(markerInstance.coordinate, [3, 4]);
  assert.equal(harness.overlays.at(-1)!.positioned, popupInstance);
  assert.deepEqual(popupInstance.coordinate, [3, 4]);
  assert.equal(harness.overlayUpdates.filter((value) => value === 'popup:a').length, 1);
  assert.equal(harness.runtime.getRenderTargets().at(-1)!.annotation, next);
  assert.equal((markerTarget.container as unknown as FakeElement).children[0], customNode);

  harness.runtime.setCustomRenderers({marker: false, popup: false, tooltip: false});
  assert.deepEqual(harness.runtime.getRenderTargets(), []);
  assert.equal((markerTarget.container as unknown as FakeElement).children.length, 0);
  harness.runtime.setCustomRenderers({marker: true, popup: true, tooltip: true});
  assert.deepEqual(
    harness.runtime.getRenderTargets().map(({key}) => key),
    ['marker:a', 'popup:a'],
  );
  harness.runtime.getRenderTargets().at(-1)!.close();
  assert.deepEqual(
    harness.runtime.getRenderTargets().map(({key}) => key),
    ['marker:a'],
  );
  assert.ok(snapshots.length >= 5);
});

test('controlled state reports requests and commits overlays only after synchronization', () => {
  const requests: Array<{
    popup: TileflowInteractionState['popup'];
    reason: string;
  }> = [];
  const harness = createHarness({
    interactionState: {popup: null},
    onInteractionStateChange(state, _previous, reason) {
      requests.push({popup: state.popup, reason});
    },
  });
  harness.runtime.reconcile([annotation('a', {popup: {content: {kind: 'text', text: 'Popup'}}})]);

  markerElement(harness).dispatch('click');
  assert.equal(harness.overlays.length, 0);
  assert.deepEqual(requests, [{popup: {id: 'a', kind: 'annotation'}, reason: 'popup:open'}]);

  harness.runtime.setInteractionState({popup: {id: 'a', kind: 'annotation'}});
  const popup = harness.overlays[0]!;
  popup.container.children[1]!.dispatch('click');
  assert.equal(popup.positioned.removeCalls, 0);
  assert.deepEqual(requests.at(-1), {popup: null, reason: 'popup:close'});

  harness.runtime.setInteractionState({popup: null});
  assert.equal(popup.positioned.removeCalls, 1);
  assert.equal(harness.document.activeElement, markerElement(harness));

  harness.runtime.setInteractionState({popup: {id: 'a', kind: 'annotation'}});
  harness.runtime.reconcile([]);
  assert.deepEqual(requests.at(-1), {popup: null, reason: 'target:remove'});
  const requestCount = requests.length;
  harness.runtime.reconcile([]);
  assert.equal(requests.length, requestCount);
});

test('failed attachment rolls back created markers and a later reconcile can recover', () => {
  const harness = createHarness({customMarker: true, failMarkerId: 'bad'});

  assert.throws(
    () => harness.runtime.reconcile([annotation('good'), annotation('bad')]),
    /attach failed/u,
  );
  assert.equal(harness.markers.length, 2);
  assert.equal(harness.markers[0]!.positioned.removeCalls, 1);
  assert.equal(harness.markers[1]!.positioned.removeCalls, 1);
  assert.deepEqual(harness.runtime.getRenderTargets(), []);

  harness.runtime.reconcile([annotation('recovered')]);
  assert.deepEqual(
    harness.runtime.getRenderTargets().map(({key}) => key),
    ['marker:recovered'],
  );
});

test('target removal closes overlays and dispose is idempotent', () => {
  const harness = createHarness({customMarker: true, customPopup: true});
  harness.runtime.reconcile([annotation('a', {popup: {content: {kind: 'text', text: 'Popup'}}})]);
  markerElement(harness).dispatch('click');
  const marker = harness.markers[0]!.positioned;
  const popup = harness.overlays[0]!.positioned;

  harness.runtime.reconcile([]);
  assert.equal(popup.removeCalls, 1);
  assert.equal(marker.removeCalls, 1);
  assert.equal(harness.runtime.getInteractionState().popup, null);
  assert.deepEqual(harness.runtime.getRenderTargets(), []);

  harness.runtime.dispose();
  harness.runtime.dispose();
  assert.equal(marker.removeCalls, 1);
  assert.throws(() => harness.runtime.reconcile([]), /disposed/u);
});
