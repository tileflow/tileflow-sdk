import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveTileflowAtmosphere} from '../src/atmosphere-compile';
import {
  atmosphereRimEllipse,
  attachTileflowAtmosphereRim,
  tileflowAtmosphereRimLayerId,
} from '../src/atmosphere-rim-browser';

const matrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, -1, 0, 0, -1, 3];

test('the halo projects the sphere silhouette including perspective and viewport padding', () => {
  const ellipse = atmosphereRimEllipse(matrix, 800, 800)!;
  assert.ok(Math.abs(ellipse.centerX - 400) < 1e-8);
  assert.ok(Math.abs(ellipse.centerY - 400) < 1e-8);
  assert.ok(Math.abs(ellipse.radiusX - 800 / Math.sqrt(8)) < 1e-8);
  assert.ok(Math.abs(ellipse.radiusY - ellipse.radiusX) < 1e-8);
  const padded = [...matrix];
  padded[8] = -0.3;
  padded[12] = 0.9;
  const shifted = atmosphereRimEllipse(padded, 800, 800)!;
  assert.ok(Math.abs(shifted.centerX - 520) < 1e-8);
  assert.ok(Math.abs(shifted.centerY - 400) < 1e-8);
  assert.ok(Math.abs(shifted.radiusX - ellipse.radiusX) < 1e-8);
  assert.ok(Math.abs(shifted.radiusY - ellipse.radiusY) < 1e-8);
  assert.equal(atmosphereRimEllipse(Array(16).fill(0), 800, 800), undefined);
});

test('time-of-day style replacements retain the same halo canvas and release it on disable or disposal', () => {
  let paints = 0;
  const context = {
    setTransform() {},
    clearRect() {
      paints++;
    },
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    createRadialGradient() {
      return {addColorStop() {}};
    },
    fillRect() {},
  };
  const canvases: {style: Record<string, string>; removed: boolean}[] = [];
  const container = {
    clientWidth: 800,
    clientHeight: 800,
    firstChild: {},
    insertBefore() {},
    ownerDocument: {
      defaultView: {devicePixelRatio: 2},
      createElement() {
        const canvas = {
          style: {},
          width: 0,
          height: 0,
          removed: false,
          setAttribute() {},
          getContext: () => context,
          remove() {
            canvas.removed = true;
          },
        };
        canvases.push(canvas);
        return canvas;
      },
    },
  };
  const events = new Map<string, Set<() => void>>();
  type Layer = {id: string; render(gl: unknown, input: unknown): void};
  const layers = new Map<string, Layer>();
  let style: object | undefined;
  let loaded = false;
  const map = {
    getStyle: () => style,
    getZoom: () => 2,
    getContainer: () => container,
    getLayer: (id: string) => layers.get(id),
    isStyleLoaded: () => loaded,
    addLayer(layer: Layer) {
      layers.set(layer.id, layer);
    },
    removeLayer: (id: string) => layers.delete(id),
    on(event: string, listener: () => void) {
      if (!events.has(event)) events.set(event, new Set());
      events.get(event)!.add(listener);
    },
    off: (event: string, listener: () => void) => events.get(event)?.delete(listener),
  } as unknown as Parameters<typeof attachTileflowAtmosphereRim>[0];
  const emit = (event: string) => {
    for (const listener of events.get(event) ?? []) listener();
  };
  const render = () =>
    layers
      .get(tileflowAtmosphereRimLayerId)!
      .render(null, {defaultProjectionData: {mainMatrix: matrix, projectionTransition: 1}});
  const dispose = attachTileflowAtmosphereRim(map);
  assert.equal(canvases.length, 0);
  const globe = {
    projection: {type: 'globe'},
    metadata: {'tileflow:atmosphere': {version: 2, ...resolveTileflowAtmosphere(true)}},
  };
  style = globe;
  emit('style.load');
  assert.ok(
    layers.has(tileflowAtmosphereRimLayerId),
    'style.load reattaches before tiles finish loading',
  );
  render();
  assert.equal(paints, 1);
  const canvas = canvases[0]!;
  for (const colour of ['#123456', '#000000', '#ffffff']) {
    layers.clear(); // MapLibre removes runtime layers during a style diff.
    style = undefined;
    emit('styledata');
    assert.equal(canvas.removed, false);
    style = {...globe, sky: {'sky-color': colour}};
    emit('style.load');
    render();
    loaded = true;
    emit('idle');
    assert.equal(canvases.length, 1);
    assert.equal(
      paints,
      1,
      'unchanged atmosphere keeps its existing pixels throughout the transition',
    );
    assert.equal(canvas.style.opacity, '1');
  }
  style = {projection: {type: 'mercator'}};
  emit('style.load');
  assert.equal(canvas.removed, true);
  assert.equal(layers.size, 0);
  style = globe;
  emit('style.load');
  render();
  assert.equal(canvases.length, 2);
  dispose();
  dispose();
  emit('style.load');
  assert.equal(canvases[1]!.removed, true);
  assert.equal(layers.size, 0);
  assert.ok([...events.values()].every((listeners) => listeners.size === 0));
});
