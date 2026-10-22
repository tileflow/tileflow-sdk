import type {Map as MapLibreMap} from 'maplibre-gl';
import assert from 'node:assert/strict';
import test from 'node:test';
import {inspectModelTriangles} from '../../core/src/model-inspection';
import {auditCategories} from '../src/inspector/beacon/catalog';
import {type InspectorCheck, summarizeChecks} from '../src/inspector/beacon/inspector-audit';
import {rendererProbe} from '../src/inspector/beacon/probes';
import {inspectionSample, inspectorAssessment} from '../src/inspector/beacon/scoring';
import {StyleEdits} from '../src/inspector/style-edits';

test('inspector reports all 48 checks and excludes unknown observations from scores', () => {
  assert.deepEqual(
    auditCategories.map((c) => c.checks.length),
    [9, 8, 8, 8, 7, 8],
  );
  assert.equal(new Set(auditCategories.flatMap((c) => c.checks.map((c) => c.id))).size, 48);
  assert.equal(
    summarizeChecks([{status: 'unavailable'}, {status: 'info'}] as InspectorCheck[]),
    null,
  );
  assert.equal(
    summarizeChecks([{score: 60}, {status: 'unavailable'}, {score: 100}] as InspectorCheck[]),
    80,
  );
});

test('renderer probes exclude inspection work and restore methods and listeners', () => {
  const events = new Map<string, () => void>();
  let renders = 0;
  const gl = {
      drawArrays() {
        renders++;
      },
    },
    style = {_updatePlacement() {}},
    custom = {render() {}};
  const draw = gl.drawArrays,
    placement = style._updatePlacement,
    render = custom.render;
  const map = {
    style,
    getCanvas: () => ({getContext: () => gl}),
    getLayersOrder: () => ['custom'],
    getLayer: () => ({type: 'custom', implementation: custom}),
    on: (event: string, fn: () => void) => events.set(event, fn),
    off: (event: string) => events.delete(event),
    triggerRepaint() {},
  } as unknown as MapLibreMap;
  const probe = rendererProbe(map);
  gl.drawArrays();
  events.get('render')!();
  assert.equal(probe.frames.length, 0);
  probe.start();
  gl.drawArrays();
  events.get('render')!();
  gl.drawArrays();
  gl.drawArrays();
  events.get('render')!();
  assert.deepEqual(probe.drawCalls, [2]);
  probe.stop();
  gl.drawArrays();
  events.get('render')!();
  assert.deepEqual(probe.drawCalls, [2]);
  probe.dispose();
  assert.equal(gl.drawArrays, draw);
  assert.equal(style._updatePlacement, placement);
  assert.equal(custom.render, render);
  assert.equal(events.size, 0);
  assert.equal(renders, 5);
});

test('whole module visibility is one history operation even past the history limit', () => {
  const layers = Array.from({length: 220}, (_, i) => ({
    id: String(i),
    type: 'line',
    layout: {} as Record<string, unknown>,
  }));
  const map = {
    getStyle: () => ({layers}),
    getLayer: (id: string) => layers[Number(id)],
    getLayoutProperty: (id: string, key: string) => layers[Number(id)].layout[key],
    setLayoutProperty: (id: string, key: string, value: unknown) => {
      if (value === null) delete layers[Number(id)].layout[key];
      else layers[Number(id)].layout[key] = value;
    },
  } as unknown as MapLibreMap;
  const edits = new StyleEdits(map);
  edits.batch(() => {
    for (const layer of layers)
      edits.set({layer: layer.id, section: 'layout', property: 'visibility'}, 'none');
  });
  assert.ok(layers.every((l) => l.layout.visibility === 'none'));
  assert.ok(edits.undoTime > 0);
  edits.undo();
  assert.ok(layers.every((l) => l.layout.visibility === undefined));
  assert.equal(edits.canUndo, false);
  edits.redo();
  assert.ok(layers.every((l) => l.layout.visibility === 'none'));
  edits.reset();
  assert.ok(layers.every((l) => l.layout.visibility === undefined));
});

test('disabled filters and layout expressions survive undo, redo and reset', () => {
  const filter = ['==', ['get', 'class'], 'primary'];
  const layout = {'line-cap': 'round'} as Record<string, unknown>;
  const layer = {id: 'roads', type: 'line', filter: filter as unknown, layout};
  const map = {
    getStyle: () => ({layers: [layer]}),
    getLayer: () => layer,
    getFilter: () => layer.filter,
    setFilter: (_: string, value: unknown) => {
      layer.filter = value ?? undefined;
    },
    getLayoutProperty: (_: string, key: string) => layout[key],
    setLayoutProperty: (_: string, key: string, value: unknown) => {
      if (value === null) delete layout[key];
      else layout[key] = value;
    },
  } as unknown as MapLibreMap;
  const edits = new StyleEdits(map),
    target = {layer: 'roads', section: 'filter' as const, property: 'filter'};
  edits.setEnabled(target, false);
  assert.equal(layer.filter, undefined);
  edits.undo();
  assert.deepEqual(layer.filter, filter);
  edits.redo();
  assert.equal(layer.filter, undefined);
  edits.setEnabled(target, true);
  assert.deepEqual(layer.filter, filter);
  edits.setEnabled({layer: 'roads', section: 'layout', property: 'line-cap'}, false);
  assert.equal(layout['line-cap'], undefined);
  edits.reset();
  assert.equal(layout['line-cap'], 'round');
  assert.deepEqual(layer.filter, filter);
});

test('model previews bound work and retain only actual triangles', () => {
  const triangles = Uint32Array.from({length: 90000}, (_, i) => i);
  const mesh = inspectModelTriangles(triangles, (i) => [i, i * 2, i * 3]);
  assert.ok(mesh.indices.length <= 9000);
  assert.ok(mesh.positions.length <= 27000);
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.positions[mesh.indices[i] * 3];
    assert.equal(mesh.positions[mesh.indices[i + 1] * 3], a + 1);
    assert.equal(mesh.positions[mesh.indices[i + 2] * 3], a + 2);
  }
  assert.deepEqual(
    inspectModelTriangles([], () => [0, 0, 0]),
    {positions: [], indices: []},
  );
});

test('tour protocol is deterministic, respects bounds and zoom limits, and preserves long stalls', async () => {
  const {activeTour, frameSample} = await import('../src/inspector/beacon/tour');
  const initial = {center: [-3, 40] as [number, number], zoom: 16, bearing: 0, pitch: 0};
  const limits = {minZoom: 6, maxZoom: 17, maxPitch: 30};
  const route = activeTour(initial, limits);
  assert.deepEqual(route, activeTour(initial, limits));
  assert.equal(route.stops.length, 12);
  assert.equal(new Set(route.stops.map((s) => s.location)).size, 6);
  assert.ok(
    route.stops.every((s) => s.camera.zoom >= 6 && s.camera.zoom <= 17 && s.camera.pitch <= 30),
  );
  assert.equal(initial.pitch, 0);
  const local = activeTour(initial, {...limits, bounds: [-10, 30, 5, 45]});
  assert.equal(local.stops.length, 2);
  assert.equal(local.skipped.length, 5);
  assert.equal(frameSample(Array(29).fill(16)).p95Ms, undefined);
  const slow = frameSample([...Array(90).fill(16), ...Array(10).fill(2500)]);
  assert.equal(slow.p95Ms, 2500);
  assert.equal(slow.maxMs, 2500);
  assert.equal(slow.longFrameRate, 0.1);
});

test('diagnostic proxies never establish a measured defect and feature sampling covers the input', () => {
  for (const id of ['render-6', 'legibility-0', 'legibility-7', 'a11y-4', 'carto-6', 'integrity-5'])
    assert.equal(inspectorAssessment(id), 'diagnostic');
  for (const id of ['render-0', 'render-7', 'a11y-0', 'integrity-6', 'integrity-7'])
    assert.equal(inspectorAssessment(id), 'measured');
  const candidates = Array.from({length: 200}, (_, i) => i);
  const sampled = inspectionSample(candidates);
  assert.equal(sampled.length, 24);
  assert.equal(new Set(sampled).size, 24);
  assert.equal(sampled[0], 0);
  assert.equal(sampled.at(-1), 199);
  assert.deepEqual(inspectionSample([1, 2]), [1, 2]);
});
