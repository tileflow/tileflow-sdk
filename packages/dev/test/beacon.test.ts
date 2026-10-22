import type {Map as MapLibreMap, StyleSpecification} from 'maplibre-gl';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeAudit,
  type AuditInput,
  category,
  compositeColor,
  contrastRatio,
  metricScore,
} from '../src/inspector/beacon/audit';
import {runAudit, styleIssues} from '../src/inspector/beacon/runner';
import type {ResourceRecord, Side} from '../src/inspector/types';

const input = (): AuditInput => ({
  frames: Array(60).fill(16.7),
  settle: [{name: 'Start', duration: 50, loaded: true}],
  dropped: 0,
  labels: [],
  styleCost: {activeLayers: 100, sources: 1, geojson: [], expressions: []},
  scenarios: [],
  styleIssues: [],
  runtimeErrors: [],
  missingImages: [],
});
const check = (data: AuditInput, id: string) =>
  analyzeAudit(data)
    .flatMap((category) => category.checks)
    .find((check) => check.id === id)!;

test('contrast composites alpha in sRGB and preserves the unrounded threshold', () => {
  assert.equal(contrastRatio('#000', '#fff'), 21);
  assert.equal(contrastRatio('#fff', '#fff'), 1);
  assert.equal(contrastRatio('#000', 'transparent'), undefined);
  assert.equal(contrastRatio('invalid', '#fff'), undefined);
  assert.ok(contrastRatio('rgba(0,0,0,.5)', '#fff')! > 3.9);
  assert.ok(contrastRatio('rgba(0,0,0,.5)', '#fff')! < 4.1);
  assert.equal(compositeColor('#000', '#fff', 0), 'rgba(255,255,255,1)');
  assert.equal(compositeColor('#000', '#fff', 2), 'rgba(0,0,0,1)');
  assert.equal(
    check({...input(), labels: [{message: 'Label', background: 'halo', ratio: 4.4999}]}, 'contrast')
      .score,
    0,
  );
});

test('unknown measurements and manual review never create a passing score', () => {
  const data = input();
  assert.equal(analyzeAudit(data).find((c) => c.id === 'network')!.score, null);
  assert.equal(analyzeAudit(data).find((c) => c.id === 'legibility')!.score, null);
  assert.equal(check(data, 'contrast').status, 'unavailable');
  assert.equal(check(data, 'startup').score, undefined);
  assert.equal(
    category('performance', [
      {id: 'a', title: 'a', value: '', detail: '', score: 40, status: 'fail'},
      {id: 'b', title: 'b', value: '', detail: '', status: 'manual'},
    ]).score,
    40,
  );
  assert.equal(metricScore(10, 20, 100), 100);
  assert.equal(metricScore(200, 20, 100), 0);
});

test('frame stalls, readiness timeout and map defects produce actionable failures', () => {
  const data = {
    ...input(),
    frames: Array(60).fill(150),
    settle: [{name: 'Zoom in', duration: 5001, loaded: false}],
    runtimeErrors: ['Glyph request failed'],
    missingImages: ['poi'],
    styleIssues: [{layer: 'roads', message: 'Missing source world'}],
  };
  for (const id of ['frames', 'stalls', 'settle', 'runtime', 'images', 'style'])
    assert.equal(check(data, id).score, 0);
  assert.equal(check(data, 'style').findings?.[0].layer, 'roads');
  assert.equal(check({...data, frames: [16]}, 'frames').status, 'unavailable');
});

test('network excludes unknown status and archive ranges from tile payload scoring', () => {
  const resource = (overrides: Partial<ResourceRecord>): ResourceRecord => ({
    id: 1,
    url: 'https://host/file',
    name: 'file',
    kind: 'Tile',
    transport: 'resource',
    start: 1,
    status: '200',
    ...overrides,
  });
  const data = {
    ...input(),
    resources: [
      resource({status: '404'}),
      resource({status: '—'}),
      resource({kind: 'Archive', bytes: 10_000_000}),
      resource({status: 'Cached', bytes: 100, transferred: 0}),
      resource({bytes: 600_000}),
    ],
  };
  assert.equal(check(data, 'requests').score, 75);
  assert.equal(check(data, 'tile-budget').score, 50);
  assert.equal(check(data, 'cache').status, 'manual');
  assert.equal(check(data, 'requests').findings?.[0].message, '404 · Tile · https://host/file');
});

test('style integrity skips Inspector overlays and locates broken source and zoom references', () => {
  const style = {
    version: 8,
    sources: {},
    layers: [
      {id: 'roads', type: 'line', source: 'missing', minzoom: 12, maxzoom: 10},
      {id: 'roads', type: 'background'},
      {id: '__tileflow-inspector-tile', type: 'line', source: 'temporary'},
    ],
  } as StyleSpecification;
  const issues = styleIssues(style);
  assert.equal(issues.length, 3);
  assert.ok(issues.every((issue) => issue.layer === 'roads'));
});

function fixture() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  const emit = (type: string, event: unknown) =>
    listeners.get(type)?.forEach((listener) => listener(event));
  const document = {hidden: false, defaultView: {JSON}, getElementById: () => null};
  const canvas = {
    ownerDocument: document,
    clientWidth: 800,
    clientHeight: 600,
    tabIndex: 0,
    getContext: () => null,
    getAttribute: (key: string) => (key === 'aria-label' ? 'Madrid map' : null),
  };
  let camera = {center: [-3, 40] as [number, number], zoom: 12, bearing: 0, pitch: 0};
  const original = structuredClone(camera);
  const jumps: unknown[] = [];
  const style = {
    version: 8,
    sources: {},
    layers: [],
    metadata: {'tileflow:map': 'streets', 'tileflow:theme': 'light'},
  };
  const inline = new Map<string, string>();
  const frameStyle = {
    getPropertyValue: (key: string) => inline.get(key) || '',
    getPropertyPriority: () => '',
    setProperty: (key: string, value: string) => inline.set(key, value),
    removeProperty: (key: string) => inline.delete(key),
  };
  const map = {
    isStyleLoaded: () => true,
    getStyle: () => style,
    getLayersOrder: () => [],
    getPixelRatio: () => 2,
    setPixelRatio() {},
    project: () => ({x: 100, y: 100}),
    flyTo: (next: typeof camera, event: unknown) => {
      camera = {...next};
      jumps.push({camera, event});
    },
    triggerRepaint() {
      setTimeout(() => emit('render', {}), 16);
    },
    getCanvas: () => canvas,
    getContainer: () => ({ownerDocument: document, querySelectorAll: () => []}),
    getCenter: () => ({lng: camera.center[0], lat: camera.center[1]}),
    getZoom: () => camera.zoom,
    getBearing: () => camera.bearing,
    getPitch: () => camera.pitch,
    getMinZoom: () => 0,
    getMaxZoom: () => 22,
    getMaxPitch: () => 85,
    resize() {
      canvas.clientWidth = parseInt(inline.get('width') || '800');
      canvas.clientHeight = parseInt(inline.get('height') || '600');
      emit('resize', {});
    },
    keyboard: {isEnabled: () => true},
    queryRenderedFeatures: () => [],
    isMoving: () => false,
    loaded: () => true,
    areTilesLoaded: () => true,
    hasImage: () => true,
    stop() {},
    unproject: (point: number[] | {x: number}) => ({
      lng: -3 + ((Array.isArray(point) ? point[0] : point.x) - 400) / 100,
      lat: 40,
    }),
    jumpTo: (next: typeof camera, event: unknown) => {
      camera = {...next};
      jumps.push({camera, event});
    },
    easeTo: (next: typeof camera, event: unknown) => {
      camera = {...next};
      jumps.push({camera, event});
    },
    on(type: string, listener: (event: any) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    off(type: string, listener: (event: any) => void) {
      listeners.get(type)?.delete(listener);
    },
  } as unknown as MapLibreMap;
  const observer = {recording: false, records: [] as ResourceRecord[], dropped: 0};
  const side = {
    id: 'left',
    map,
    loadEpoch: 1,
    artifactGeneration: 1,
    runtimeErrors: [],
    definition: {label: 'Streets'},
    frame: {
      style: frameStyle,
      parentElement: {getBoundingClientRect: () => ({width: 800, height: 600})},
      contentWindow: {
        devicePixelRatio: 2,
        performance: {getEntriesByType: () => []},
        matchMedia: () => ({matches: false}),
        __tileflowInspectorObserver: observer,
        requestAnimationFrame: (callback: (time: number) => void) =>
          setTimeout(() => callback(performance.now()), 16),
        cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      },
    },
  } as unknown as Side;
  return {side, observer, original, jumps, emit, listeners, canvas, document, camera: () => camera};
}

test('navigation audit restores the camera and observer and removes all listeners', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 0});
  t.mock.method(performance, 'now', () => Date.now());
  const f = fixture();
  const result = runAudit({
    side: f.side,
    profile: 'navigation',
    signal: new AbortController().signal,
    isCurrent: () => true,
    progress() {},
  });
  for (let i = 0; i < 1300; i++) {
    t.mock.timers.tick(40);
    await Promise.resolve();
  }
  const report = await result;
  assert.equal(report.categories.length, 5);
  assert.equal(report.profile, 'navigation');
  assert.deepEqual(f.camera().center, f.original.center);
  assert.equal(f.camera().zoom, f.original.zoom);
  assert.equal(f.observer.recording, false);
  assert.ok([...f.listeners.values()].every((listeners) => listeners.size === 0));
  assert.equal(f.jumps.length, 11);
  assert.equal(report.scenarios.length, 10);
  assert.deepEqual(
    report.scenarios.filter((s) => s.viewport === 'Mobile').map((s) => [s.width, s.height]),
    Array(5).fill([390, 844]),
  );
  assert.ok(report.duration >= 40_000);
  assert.deepEqual([f.canvas.clientWidth, f.canvas.clientHeight], [800, 600]);
  assert.equal(f.side.frame.style.getPropertyValue('transform'), '');
  assert.ok(
    f.jumps.every(
      (item) => (item as {event: {tileflowInspector: boolean}}).event.tileflowInspector,
    ),
  );
});

test('cancel restores the view; user movement or replacement never overwrites the new map', async () => {
  for (const cause of ['cancel', 'move', 'replace'] as const) {
    const f = fixture(),
      controller = new AbortController();
    const promise = runAudit({
      side: f.side,
      profile: 'navigation',
      signal: controller.signal,
      isCurrent: () => true,
      progress() {},
    });
    if (cause === 'move') f.emit('movestart', {originalEvent: {type: 'pointerdown'}});
    if (cause === 'replace') f.side.loadEpoch++;
    controller.abort();
    await assert.rejects(promise, /cancelled/u);
    assert.equal(f.jumps.length, cause === 'cancel' ? 1 : 0);
    assert.equal(f.observer.recording, false);
    assert.ok([...f.listeners.values()].every((listeners) => listeners.size === 0));
  }
});

test('one slow mobile scenario is not hidden by a fast desktop average', () => {
  const base = {
    name: 'Detail',
    viewport: 'Desktop',
    width: 1280,
    height: 800,
    camera: {center: [0, 0] as [number, number], zoom: 12, pitch: 0, bearing: 0},
    readyMs: 1300,
    tileWaitMs: 100,
    loaded: true,
    sizedRequests: 1,
    requests: 1,
    labels: 5,
  };
  const data = {
    ...input(),
    scenarios: [
      {...base, frameP95: 16, longFrameRate: 0, tileP95: 100, transferred: 1000},
      {
        ...base,
        viewport: 'Mobile',
        frameP95: 120,
        longFrameRate: 0.3,
        tileP95: 1500,
        transferred: 5 * 1048576,
      },
    ],
  };
  for (const id of ['frames', 'stalls', 'tile-latency', 'transfer-budget'])
    assert.equal(check(data, id).score, 0);
  assert.equal(
    analyzeAudit(data).some((category) => category.id === 'style'),
    true,
  );
});

test('deep profile covers desktop, mobile and tablet and restores dimensions', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 0});
  t.mock.method(performance, 'now', () => Date.now());
  const f = fixture();
  const result = runAudit({
    side: f.side,
    profile: 'deep',
    signal: new AbortController().signal,
    isCurrent: () => true,
    progress() {},
  });
  for (let i = 0; i < 2500; i++) {
    t.mock.timers.tick(40);
    await Promise.resolve();
  }
  const report = await result;
  assert.equal(report.scenarios.length, 21);
  assert.equal(report.scenarios.filter((scenario) => scenario.viewport === 'Tablet').length, 7);
  assert.ok(report.duration >= 84_000);
  assert.deepEqual([f.canvas.clientWidth, f.canvas.clientHeight], [800, 600]);
  assert.equal(f.side.frame.style.getPropertyValue('transform'), '');
});

test('inspector cancellation restores viewport, DPR and overlays even when scene restoration fails', async (t) => {
  const {runInspectorAudit} = await import('../src/inspector/beacon/inspector-audit');
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'window', prior);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  for (const failRestore of [false, true]) {
    const f = fixture(),
      controller = new AbortController();
    let ratio = 2,
      quiet = 0;
    Object.assign(f.side.map!, {
      getPixelRatio: () => ratio,
      setPixelRatio: (value: number) => {
        ratio = value;
      },
      showOverdrawInspector: true,
      showCollisionBoxes: true,
      showTileBoundaries: true,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __tileflowScene: {
          snapshot: () => ({theme: 'light'}),
          variants: () => [],
          audit: (on: boolean) => {
            quiet += on ? 1 : -1;
          },
          restore: async () => {
            if (failRestore) throw new Error('Scene restore failed');
          },
        },
      },
    });
    const result = runInspectorAudit({
      side: f.side,
      device: 'mobile',
      scope: 'sweep',
      signal: controller.signal,
      isCurrent: () => true,
      progress() {},
    });
    controller.abort();
    await assert.rejects(result, failRestore ? /Scene restore failed/ : /cancelled/);
    assert.equal(quiet, 0);
    assert.equal(ratio, 2);
    assert.equal(f.side.map!.showOverdrawInspector, true);
    assert.equal(f.side.map!.showCollisionBoxes, true);
    assert.equal(f.side.map!.showTileBoundaries, true);
    assert.deepEqual([f.canvas.clientWidth, f.canvas.clientHeight], [800, 600]);
    assert.deepEqual(f.camera().center, f.original.center);
    assert.equal(f.camera().zoom, f.original.zoom);
    assert.equal(f.camera().pitch, f.original.pitch);
    assert.equal(f.camera().bearing, f.original.bearing);
    assert.equal(f.observer.recording, false);
    assert.ok([...f.listeners.values()].every((list) => list.size === 0));
  }
});

test('active tour measures motion and settled windows across countries within its budget', async (t) => {
  const {runInspectorAudit} = await import('../src/inspector/beacon/inspector-audit');
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 0});
  t.mock.method(performance, 'now', () => Date.now());
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {configurable: true, value: {}});
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'window', prior);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  for (const loaded of [true, false]) {
    const f = fixture();
    Object.assign(f.side.map!, {areTilesLoaded: () => loaded});
    const began = performance.now();
    const result = runInspectorAudit({
      side: f.side,
      device: 'desktop',
      scope: 'tour',
      signal: new AbortController().signal,
      isCurrent: () => true,
      progress() {},
    });
    for (let i = 0; i < 2300; i++) {
      t.mock.timers.tick(32);
      await Promise.resolve();
      await Promise.resolve();
    }
    const report = await result;
    assert.equal(report.version, 4);
    assert.equal(report.scoring, 'measured-evidence-v3');
    assert.equal(report.protocol, 'active-tour-v1');
    assert.equal(report.plannedViews, 12);
    assert.ok(report.duration <= 60_000, `duration ${report.duration}`);
    assert.ok(report.duration >= 40_000);
    assert.ok(new Set(report.scenarios.map((s) => s.location)).size >= 5);
    assert.ok(report.scenarios.every((s) => s.motion!.frames >= 30));
    assert.ok(report.scenarios.some((s) => s.settled.frames >= 60));
    assert.equal(report.budgetExhausted, !loaded);
    assert.equal(report.scenarios.length === 12, loaded);
    assert.ok(report.scenarios.every((s) => s.loaded === loaded));
    assert.ok(report.scenarios.every((s) => s.readyMs - s.tileWaitMs >= 1200));
    // The mock clock advances while the ready promise resumes; no tile wait can
    // include the 1.2-second navigation window on an already-loaded fixture.
    if (loaded) assert.ok(report.scenarios.every((s) => s.tileWaitMs <= 64));
    const loading = report.categories.flatMap((c) => c.checks).find((c) => c.id === 'loading-3')!;
    assert.equal(
      loading.score,
      loaded ? 100 : 0,
      'scripted motion is excluded, incomplete loading still fails',
    );
    assert.ok((f.jumps[0] as any).camera.duration > 0);
    assert.deepEqual((f.jumps[0] as any).event, {tileflowInspector: true});
    assert.deepEqual(f.camera().center, f.original.center);
    assert.equal(f.camera().zoom, f.original.zoom);
    assert.equal(f.observer.recording, false);
    assert.ok([...f.listeners.values()].every((list) => list.size === 0));
    assert.ok(performance.now() >= began);
  }
});

test('inspector scores current errors, preserves diagnostic evidence and excludes earlier session failures', async (t) => {
  const {runInspectorAudit} = await import('../src/inspector/beacon/inspector-audit');
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 0});
  t.mock.method(performance, 'now', () => Date.now());
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {configurable: true, value: {}});
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'window', prior);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  for (const failsNow of [false, true]) {
    const f = fixture();
    f.side.runtimeErrors.push('Repeated renderer failure', 'Earlier runtime failure');
    const oldResource: ResourceRecord = {
      id: 10,
      url: 'https://example.test/old.png',
      name: 'old.png',
      kind: 'Tile',
      transport: 'resource',
      status: '404',
      start: 0,
    };
    f.observer.records.push(oldResource);
    let recorded = false;
    const result = runInspectorAudit({
      side: f.side,
      device: 'desktop',
      scope: 'view',
      signal: new AbortController().signal,
      isCurrent: () => true,
      progress() {
        if (!failsNow || recorded) return;
        recorded = true;
        // The bridge may deduplicate this message from the earlier session; the map event
        // must still count its recurrence in this audit.
        f.emit('error', {error: new Error('Repeated renderer failure')});
        f.observer.records.push({
          ...oldResource,
          id: 11,
          name: 'new.png',
          url: 'https://example.test/new.png',
        });
      },
    });
    for (let i = 0; i < 250; i++) {
      t.mock.timers.tick(32);
      await Promise.resolve();
      await Promise.resolve();
    }
    const report = await result;
    const checks = report.categories.flatMap((category) => category.checks);
    const errors = checks.find((check) => check.id === 'integrity-7')!;
    assert.equal(errors.value, `${failsNow ? 2 : 0} errors`);
    assert.equal(errors.score, failsNow ? 0 : 100);
    assert.ok(errors.findings.every((finding) => !/old.png|Earlier runtime/.test(finding.message)));
    const coverage = checks.find((check) => check.id === 'carto-6')!;
    assert.equal(coverage.status, 'info');
    assert.equal(coverage.score, undefined);
    assert.notEqual(coverage.value, 'Not measurable in this sample');
    assert.equal(report.categories.find((category) => category.id === 'carto')!.score, null);
    assert.equal(checks.find((check) => check.id === 'render-0')!.assessment, 'measured');
    assert.ok([...f.listeners.values()].every((list) => list.size === 0));
  }
});

test('inspector scores legibility and cartography from ready samples and exports their coverage', async (t) => {
  const {runInspectorAudit} = await import('../src/inspector/beacon/inspector-audit');
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 0});
  t.mock.method(performance, 'now', () => Date.now());
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {configurable: true, value: {}});
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'window', prior);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  for (const ready of [true, false]) {
    const f = fixture();
    const layers = [
      {
        id: 'roads',
        type: 'line',
        source: 'data',
        paint: {'line-width': ['step', ['zoom'], 2, 11.5, 6]},
      },
      {
        id: 'places',
        type: 'symbol',
        source: 'data',
        layout: {'text-field': ['get', 'name'], 'text-size': ['get', 'size']},
        paint: {'text-halo-color': '#fff', 'text-halo-width': 1},
      },
    ];
    const features = [
      {
        id: 1,
        layer: layers[0],
        source: 'data',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [-3, 40],
            [-3.1, 40],
          ],
        },
      },
      ...[8, 12].map((size, id) => ({
        id: id + 2,
        source: 'data',
        layer: layers[1],
        properties: {size, name: `Place ${id}`},
        geometry: {type: 'Point', coordinates: [-3, 40]},
      })),
    ];
    Object.assign(f.side.map!.getStyle(), {
      layers,
      sources: {data: {type: 'geojson', data: {type: 'FeatureCollection', features: []}}},
    });
    Object.assign(f.side.map!, {
      areTilesLoaded: () => ready,
      queryRenderedFeatures: () => features,
      getLayer: (id: string) => layers.find((l) => l.id === id),
      getPaintProperty: (id: string, key: string) =>
        (layers.find((l) => l.id === id)?.paint as any)?.[key],
      getLayoutProperty: (id: string, key: string) =>
        (layers.find((l) => l.id === id)?.layout as any)?.[key],
      getFeatureState: () => ({}),
      listImages: () => [],
    });
    const result = runInspectorAudit({
      side: f.side,
      device: 'desktop',
      scope: 'view',
      signal: new AbortController().signal,
      isCurrent: () => true,
      progress() {},
    });
    for (let i = 0; i < 400; i++) {
      t.mock.timers.tick(32);
      await Promise.resolve();
      await Promise.resolve();
    }
    const report = await result;
    for (const id of ['legibility', 'carto']) {
      const category = report.categories.find((c) => c.id === id)!;
      assert.equal(category.score, ready ? 50 : null);
      assert.ok(category.scoreBasis);
      const check = category.checks.find((c) => c.sample)!;
      assert.equal(check.sample!.total, ready ? 2 : 0);
      assert.equal(check.sample!.passed, ready ? 1 : 0);
      assert.equal(check.status, ready ? 'warn' : 'unavailable');
      if (ready) assert.ok(check.findings[0].layer);
    }
    assert.equal(
      report.categories.find((c) => c.id === 'carto')!.checks.find((c) => c.id === 'carto-6')!
        .score,
      undefined,
    );
  }
});

test('cancelling an active tour restores the camera and stops renderer sampling', async (t) => {
  const {runInspectorAudit} = await import('../src/inspector/beacon/inspector-audit');
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 0});
  t.mock.method(performance, 'now', () => Date.now());
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {configurable: true, value: {}});
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'window', prior);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const f = fixture(),
    controller = new AbortController();
  const result = runInspectorAudit({
    side: f.side,
    device: 'mobile',
    scope: 'tour',
    signal: controller.signal,
    isCurrent: () => true,
    progress() {},
  });
  for (let i = 0; i < 20; i++) {
    t.mock.timers.tick(32);
    await Promise.resolve();
  }
  assert.ok(f.jumps.length > 0);
  controller.abort();
  t.mock.timers.tick(64);
  await assert.rejects(result, /cancelled/);
  assert.deepEqual(f.camera().center, f.original.center);
  assert.equal(f.camera().zoom, f.original.zoom);
  assert.deepEqual([f.canvas.clientWidth, f.canvas.clientHeight], [800, 600]);
  assert.equal(f.observer.recording, false);
  assert.ok([...f.listeners.values()].every((list) => list.size === 0));
});

test('camera input interrupts an active tour and preserves the user camera', async (t) => {
  const {runInspectorAudit} = await import('../src/inspector/beacon/inspector-audit');
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 0});
  t.mock.method(performance, 'now', () => Date.now());
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {configurable: true, value: {}});
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'window', prior);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const f = fixture();
  const result = runInspectorAudit({
    side: f.side,
    device: 'desktop',
    scope: 'tour',
    signal: new AbortController().signal,
    isCurrent: () => true,
    progress() {},
  });
  for (let i = 0; i < 20; i++) {
    t.mock.timers.tick(32);
    await Promise.resolve();
  }
  f.side.map!.jumpTo({center: [12, 42], zoom: 8, bearing: 10, pitch: 15});
  f.emit('movestart', {tileflowUserCamera: true});
  t.mock.timers.tick(64);
  await assert.rejects(result, /you moved the map/);
  assert.deepEqual(f.camera().center, [12, 42]);
  assert.equal(f.camera().zoom, 8);
  assert.equal(f.observer.recording, false);
  assert.ok([...f.listeners.values()].every((list) => list.size === 0));
});
