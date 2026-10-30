import type {Map as MapLibreMap} from 'maplibre-gl';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  performanceFindings,
  type PerformanceObservation,
  samplePerformance,
} from '../src/inspector/diagnostics/performance';

function fixture(
  options: {
    custom?: boolean;
    terrain?: boolean;
    sky?: boolean;
    render?: boolean;
    renderOverdraw?: boolean;
  } = {},
) {
  const listeners = new Map<string, Set<() => void>>();
  const onceListeners = new Map<() => void, () => void>();
  const document = Object.assign(new EventTarget(), {hidden: false});
  let overdraw = false;
  const debugChanges: boolean[] = [];
  const gl = {
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    drawArrays() {},
    drawElements() {},
    drawArraysInstanced() {},
    drawElementsInstanced() {},
    isContextLost: () => false,
    readPixels(
      _x: number,
      _y: number,
      _w: number,
      _h: number,
      _format: number,
      _type: number,
      target: Uint8Array,
    ) {
      target.fill(255);
    },
  };
  const canvas = Object.assign(new EventTarget(), {
    ownerDocument: document,
    width: 256,
    height: 256,
    getContext: () => gl,
  });
  const custom = {type: 'custom', implementation: {render() {}}};
  const style = {_updatePlacement() {}};
  const original = {
    draw: gl.drawArrays,
    placement: style._updatePlacement,
    render: custom.implementation.render,
  };
  let pending: ReturnType<typeof setTimeout> | undefined;
  const emit = (name: string) => [...(listeners.get(name) ?? [])].forEach((listener) => listener());
  const map = {
    style,
    version: '6.13.0',
    getCanvas: () => canvas,
    getStyle: () => ({
      version: 8,
      sources: {},
      layers: [{id: 'base', type: 'background'}],
      ...(options.sky ? {sky: {}} : {}),
    }),
    isStyleLoaded: () => true,
    areTilesLoaded: () => true,
    isMoving: () => false,
    getTerrain: () => (options.terrain ? {source: 'dem'} : null),
    getLayersOrder: () => (options.custom ? ['base', 'custom'] : ['base']),
    getLayer: (id: string) => (id === 'custom' ? custom : {type: 'background'}),
    get showOverdrawInspector() {
      return overdraw;
    },
    set showOverdrawInspector(value: boolean) {
      overdraw = value;
      debugChanges.push(value);
    },
    on(name: string, listener: () => void) {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return this;
    },
    off(name: string, listener: () => void) {
      listeners.get(name)?.delete(listener);
      const wrapper = onceListeners.get(listener);
      if (wrapper) {
        listeners.get(name)?.delete(wrapper);
        onceListeners.delete(listener);
      }
      return this;
    },
    once(name: string, listener: () => void) {
      const wrapper = () => {
        map.off(name, wrapper);
        onceListeners.delete(listener);
        listener();
      };
      onceListeners.set(listener, wrapper);
      map.on(name, wrapper);
      return this;
    },
    triggerRepaint() {
      if (pending || options.render === false) return;
      pending = setTimeout(() => {
        pending = undefined;
        if (overdraw && options.renderOverdraw === false) return;
        style._updatePlacement();
        gl.drawArrays();
        gl.drawElements();
        gl.drawArraysInstanced();
        if (options.custom) custom.implementation.render();
        emit('render');
      }, 2);
    },
  } as unknown as MapLibreMap;
  const clean = () => {
    clearTimeout(pending);
    assert.equal(gl.drawArrays, original.draw, 'draw hook restored');
    assert.equal(style._updatePlacement, original.placement, 'placement hook restored');
    assert.equal(custom.implementation.render, original.render, 'custom render hook restored');
    assert.equal(
      [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
      0,
      'listeners removed',
    );
    assert.equal(overdraw, false, 'native overdraw restored');
  };
  return {map, canvas, document, emit, clean, debugChanges};
}

test('explicit workload sampling is bounded and preserves native renderer methods and debug state', async () => {
  const {map, clean, debugChanges} = fixture();
  const result = await samplePerformance(map, new AbortController().signal, {durationMs: 200});
  assert.equal(result.status, 'measured');
  assert.ok(result.frames >= 10);
  assert.equal(result.drawCalls?.median, 3);
  assert.equal(result.overdraw?.saturationPasses, 8);
  assert.equal(result.overdraw?.saturatedFraction, 1);
  assert.ok(result.limitations.some((item) => item.includes('not layers or GPU time')));
  assert.deepEqual(debugChanges, [true, false]);
  clean();
});

test('custom layers, terrain and sky prevent native overdraw contamination', async () => {
  for (const options of [{custom: true}, {terrain: true}, {sky: true}]) {
    const {map, clean, debugChanges} = fixture(options);
    const result = await samplePerformance(map, new AbortController().signal, {durationMs: 200});
    assert.equal(result.status, 'measured');
    assert.equal(result.overdraw, undefined);
    assert.ok(result.limitations.some((item) => item.startsWith('Overdraw was skipped:')));
    assert.deepEqual(debugChanges, [], 'unsupported modes are never switched on');
    clean();
  }
});

test('style edits and user interactions cancel instead of publishing mixed-state evidence', async () => {
  for (const event of ['styledata', 'movestart', 'remove']) {
    const {map, emit, clean, debugChanges} = fixture();
    const pending = samplePerformance(map, new AbortController().signal, {durationMs: 200});
    emit(event);
    const result = await pending;
    assert.equal(result.status, 'cancelled');
    assert.deepEqual(performanceFindings(result), []);
    assert.deepEqual(debugChanges, []);
    clean();
  }
});

test('caller cancellation restores hooks promptly and duplicate observations cannot overlap', async () => {
  const {map, clean} = fixture();
  const controller = new AbortController();
  const first = samplePerformance(map, controller.signal, {durationMs: 200});
  const second = await samplePerformance(map, new AbortController().signal);
  assert.equal(second.status, 'unavailable');
  assert.ok(second.limitations[0].includes('already running'));
  controller.abort();
  assert.equal((await first).status, 'cancelled');
  clean();
});

test('cancellation while waiting for native overdraw restores visualization and removes the render listener', async () => {
  const {map, clean, debugChanges} = fixture({renderOverdraw: false});
  const controller = new AbortController();
  const pending = samplePerformance(map, controller.signal, {durationMs: 200});
  const timer = setTimeout(() => controller.abort(), 240);
  const result = await pending;
  clearTimeout(timer);
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(debugChanges, [true, false]);
  assert.deepEqual(performanceFindings(result), []);
  clean();
});

test('missing rendered samples never become a successful workload measurement', async () => {
  const {map, clean} = fixture({render: false});
  const result = await samplePerformance(map, new AbortController().signal, {
    durationMs: 200,
    includeOverdraw: false,
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.drawCalls, undefined);
  assert.deepEqual(performanceFindings(result), []);
  clean();
});

test('debug visualizations and unfinished loading are left untouched and remain unavailable', async () => {
  const {map, clean, debugChanges} = fixture();
  map.showCollisionBoxes = true;
  const debug = await samplePerformance(map, new AbortController().signal);
  assert.equal(debug.status, 'unavailable');
  assert.equal(map.showCollisionBoxes, true);
  map.showCollisionBoxes = false;
  map.areTilesLoaded = () => false;
  const loading = await samplePerformance(map, new AbortController().signal);
  assert.equal(loading.status, 'unavailable');
  assert.deepEqual(debugChanges, []);
  clean();
});

test('performance triggers produce review indications with disclosed scope, never grades or layer attribution', () => {
  const observation: PerformanceObservation = {
    status: 'measured',
    durationMs: 650,
    frames: 30,
    drawCalls: {median: 1200, p95: 1500, max: 1800},
    overdraw: {averagePasses: 5, saturatedFraction: 0.3, samples: 4096, saturationPasses: 8},
    limitations: ['Current view only.'],
  };
  const camera = {center: [-3, 40] as [number, number], zoom: 15, bearing: 0, pitch: 0};
  const findings = performanceFindings(observation, camera);
  assert.equal(findings.length, 2);
  assert.ok(
    findings.every((finding) => finding.kind === 'review' && finding.category === 'performance'),
  );
  assert.ok(findings.every((finding) => finding.layers.length === 0 && !('score' in finding)));
  assert.ok(
    findings.every((finding) =>
      finding.evidence.some((evidence) => evidence.label === 'Review trigger'),
    ),
  );
  assert.deepEqual(findings[0].samples?.[0].camera, camera);
  assert.deepEqual(performanceFindings({...observation, status: 'cancelled'}), []);
  assert.deepEqual(performanceFindings({...observation, frames: 1, overdraw: undefined}), []);
  assert.deepEqual(
    performanceFindings({
      ...observation,
      drawCalls: {median: 5, p95: 5, max: 5},
      overdraw: {...observation.overdraw!, saturatedFraction: 0},
    }),
    [],
  );
});
