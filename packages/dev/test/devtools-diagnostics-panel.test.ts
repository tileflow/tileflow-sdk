import assert from 'node:assert/strict';
import {test} from 'node:test';
import {diagnosticFinding} from '../src/devtools/diagnostics/model';
import {DiagnosticsPanel} from '../src/devtools/diagnostics/panel';

class Element {
  className = '';
  textContent = '';
  dataset: Record<string, string> = {};
  children: Element[] = [];
  open = false;
  scrollTop = 0;
  classList = {add() {}, remove() {}};
  append(...children: Element[]) {
    this.children.push(...children);
  }
  replaceChildren(...children: Element[]) {
    this.children = children;
  }
  setAttribute() {}
  addEventListener() {}
  contains() {
    return false;
  }
  querySelector() {
    return null;
  }
}

class MapMock {
  style: any = {
    version: 8,
    metadata: {'tileflow:map': 'test', 'tileflow:theme': 'light'},
    sources: {},
    layers: [
      {
        id: 'broken',
        type: 'background',
        minzoom: 12,
        maxzoom: 8,
        paint: {'background-color': '#ff0000'},
      },
    ],
  };
  handlers = new Map<string, Set<(event: any) => void>>();
  ready = true;
  tiles = true;
  moving = false;
  zoom = 10;
  ratio = 1.5;
  images: string[] = [];
  queries = 0;
  removed = false;
  container = {clientWidth: 800, clientHeight: 600, ownerDocument: {defaultView: {JSON}}};
  canvas = {width: 1200, height: 900, getContext: () => null, ownerDocument: {hidden: false}};
  on(type: string, handler: (event: any) => void) {
    const handlers = this.handlers.get(type) ?? new Set();
    handlers.add(handler);
    this.handlers.set(type, handlers);
  }
  off(type: string, handler: (event: any) => void) {
    this.handlers.get(type)?.delete(handler);
  }
  emit(type: string, event = {}) {
    for (const handler of [...(this.handlers.get(type) ?? [])]) handler(event);
  }
  getStyle() {
    return structuredClone(this.style);
  }
  getCenter() {
    return {lng: 0, lat: 0};
  }
  getZoom() {
    return this.zoom;
  }
  getBearing() {
    return 0;
  }
  getPitch() {
    return 0;
  }
  getPixelRatio() {
    return this.ratio;
  }
  getContainer() {
    return this.container;
  }
  getCanvas() {
    return this.canvas;
  }
  isMoving() {
    return this.moving;
  }
  isStyleLoaded() {
    return this.ready;
  }
  areTilesLoaded() {
    return this.tiles;
  }
  listImages() {
    return this.images;
  }
  getLayer(id: string) {
    return this.style.layers.find((layer: any) => layer.id === id);
  }
  getGlobalState() {
    return {};
  }
  queryRenderedFeatures() {
    this.queries++;
    return [];
  }
  triggerRepaint() {
    this.emit('render');
  }
}

function setup() {
  const originals = new Map(
    ['document', 'navigator'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  let copied = '';
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      activeElement: null,
      createElement: () => new Element(),
      querySelector: () => null,
    },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    },
  });
  const map = new MapMock();
  const side: any = {
    id: 'left',
    map,
    definition: {label: 'Test map'},
    loadEpoch: 1,
    artifactGeneration: 1,
    sidecar: {
      map: 'test',
      theme: 'light',
      layers: [{id: 'broken', contributions: [{owner: 'land', target: 'background'}]}],
    },
  };
  const panel = new DiagnosticsPanel(new Element() as any, {
    active: () => side,
    beforeRun() {},
    reveal() {},
    overlay() {},
    assets() {},
  }) as any;
  return {
    panel,
    map,
    side,
    copied: () => copied,
    cleanup() {
      panel.dispose();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('automatic checks remain passive, retain pending findings and dispose map listeners', () => {
  const env = setup();
  try {
    env.panel.checkStyle();
    assert.ok(env.panel.staticEntries.length > 0);
    const previous = env.panel.staticEntries;
    env.map.ready = false;
    env.map.style.layers = [];
    env.panel.checkStyle();
    assert.equal(env.panel.staticEntries, previous);
    assert.equal(env.panel.current(env.panel.styleSnapshot), false);
    assert.match(env.panel.styleLimitations.join(' '), /pending/);
    assert.equal(env.map.queries, 0);
    env.panel.dispose();
    assert.equal(
      [...env.map.handlers.values()].reduce((sum, handlers) => sum + handlers.size, 0),
      0,
    );
  } finally {
    env.cleanup();
  }
});

test('source content and renderer pixel ratio invalidate view findings without profiling again', () => {
  const env = setup();
  try {
    env.panel.checkStyle();
    const snapshot = env.panel.snapshot();
    assert.equal(snapshot.viewport.dpr, 1.5);
    assert.equal(env.panel.current(snapshot, true), true);
    env.map.emit('sourcedata', {sourceId: 'data'});
    env.panel.checkStyle();
    assert.equal(env.panel.current(snapshot, true), false);
    const current = env.panel.snapshot();
    env.map.ratio = 2;
    assert.equal(env.panel.current(current, true), false);
    assert.equal(env.map.queries, 0);
  } finally {
    env.cleanup();
  }
});

test('missing images require observed demand, settled loading and a fresh style revision', () => {
  const env = setup();
  try {
    env.map.style = {
      version: 8,
      sources: {points: {type: 'geojson', data: {type: 'FeatureCollection', features: []}}},
      layers: [{id: 'icons', type: 'symbol', source: 'points', layout: {'icon-image': 'hospital'}}],
    };
    env.panel.checkStyle();
    assert.equal(env.panel.missingImages.size, 0);
    env.map.emit('styleimagemissing', {id: 'hospital'});
    env.panel.missingImages.set('hospital', performance.now() - 3000);
    env.map.tiles = false;
    assert.equal(env.panel.collectInput(env.map.style).missingImages[0].settled, false);
    env.map.tiles = true;
    env.panel.checkStyle();
    assert.ok(
      env.panel.resourceEntries.some((entry: any) => entry.finding.check === 'missing-icon'),
    );
    env.map.images.push('hospital');
    env.panel.checkStyle();
    assert.equal(env.panel.resourceEntries.length, 0);
    env.map.emit('styleimagemissing', {id: 'hospital'});
    env.map.style.layers[0].layout['icon-image'] = 'clinic';
    env.panel.checkStyle();
    assert.equal(env.panel.missingImages.size, 0);
  } finally {
    env.cleanup();
  }
});

test('unavailable view detectors preserve previous findings instead of resolving them', async () => {
  const env = setup();
  try {
    env.panel.checkStyle();
    const finding = diagnosticFinding('current-view', {
      check: 'overlapping-paint',
      category: 'performance',
      kind: 'review',
      scope: 'view',
      title: 'Repeated painting',
      summary: 'Observed earlier',
      detail: '',
      layers: [],
      evidence: [],
      limitations: [],
    });
    env.panel.viewEntries = env.panel.captureEntries(
      [finding],
      env.panel.snapshot(),
      env.map.style,
    );
    await env.panel.checkView(); // This map deliberately has no WebGL context.
    assert.equal(env.panel.viewEntries.length, 1);
    assert.match(env.panel.viewEntries[0].pendingReason, /could not be repeated/);
    assert.equal(env.panel.entryCurrent(env.panel.viewEntries[0]), false);
    assert.equal(env.panel.viewComplete, false);
  } finally {
    env.cleanup();
  }
});

test('a different sampled label cannot resolve an earlier contrast finding in the same layer', () => {
  const env = setup();
  try {
    const entry = {
      finding: {
        layers: ['broken'],
        samples: [{layer: 'broken', featureId: 42, text: 'Hard to read'}],
      },
    };
    const other = [{layer: 'broken', featureId: 18, text: 'Clear label'}];
    assert.equal(env.panel.readabilityChecked(entry, other, env.map.style), false);
    assert.equal(
      env.panel.readabilityChecked(entry, [{layer: 'broken', featureId: 42}], env.map.style),
      true,
    );
    entry.finding.samples = [{layer: 'broken', text: 'No stable identity'}] as any;
    assert.equal(
      env.panel.readabilityChecked(
        entry,
        [{layer: 'broken', text: 'No stable identity'}],
        env.map.style,
      ),
      false,
    );
    assert.equal(env.panel.readabilityChecked(entry, [], {...env.map.style, layers: []}), true);
  } finally {
    env.cleanup();
  }
});

test('copy captures original rules and matching provenance, with explicit export omissions', async () => {
  const env = setup();
  try {
    env.map.style.layers[0].metadata = {secret: 'private', note: 'Bearer abcdef'};
    env.panel.checkStyle();
    env.map.style.layers[0].paint['background-color'] = '#00ff00';
    await env.panel.copyReport();
    const packet = JSON.parse(env.copied());
    assert.equal(packet.checkedStyle.theme, 'light');
    assert.equal(packet.checkedStyle.themeLabel, 'Light');
    assert.ok(
      packet.findings.some(
        (finding: any) => finding.affectedRules.layers[0].contributions[0].owner === 'land',
      ),
    );
    assert.match(env.copied(), /#ff0000/);
    assert.doesNotMatch(env.copied(), /#00ff00|private|Bearer abcdef/);
    assert.equal(packet.export.sanitized, true);
    assert.ok(Array.isArray(packet.export.omittedPaths));
    env.side.sidecar.theme = 'night';
    assert.equal(env.panel.collectInput(env.map.style).provenance, undefined);
  } finally {
    env.cleanup();
  }
});

test('provenance is loaded once per compiled style identity and late completion respects disposal', async () => {
  const env = setup();
  try {
    env.side.sidecar = undefined;
    env.panel.active = true;
    let calls = 0;
    let finish!: () => void;
    env.panel.options.loadProvenance = () => {
      calls++;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    };
    env.panel.checkStyle();
    env.map.style.layers[0].paint['background-color'] = '#00ff00';
    env.panel.checkStyle();
    assert.equal(calls, 1);
    env.panel.dispose();
    finish();
    await Promise.resolve();
    assert.equal(env.panel.timer, undefined);
  } finally {
    env.cleanup();
  }
});
