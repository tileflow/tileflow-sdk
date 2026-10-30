import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import {createTileflowAdaptiveCamera, tileflowAdaptiveFieldOfView} from '../src/camera-browser';

const normal = (Math.atan(1 / 3) * 360) / Math.PI;

test('inclined and overview cameras retain their original field of view', () => {
  for (const height of [390, 900, 2000]) {
    for (const pitch of [15, 30, 45, 60, 85]) {
      assert.equal(tileflowAdaptiveFieldOfView(pitch, 18, height, normal), normal);
    }
    for (const zoom of [0, 5, 10, 13]) {
      assert.equal(tileflowAdaptiveFieldOfView(0, zoom, height, normal), normal);
    }
  }
});

test('a roof near the screen edge stays within three pixels of its footprint at the audited city scale', () => {
  const height = 1923;
  const metresPerPixel = 1172.06 / (height * 1.5);
  const fov = tileflowAdaptiveFieldOfView(0, 17.088, height, normal);
  const altitude = (height * metresPerPixel) / (2 * Math.tan((fov * Math.PI) / 360));
  const roofOffset = (800 * 20) / (altitude - 20);
  assert.ok(roofOffset < 3, `20 m roof moves ${roofOffset} pixels`);
});

test('field of view is continuous and nondecreasing with pitch and overview zoom', () => {
  for (const height of [390, 900, 2000]) {
    let previous = tileflowAdaptiveFieldOfView(0, 17, height, normal);
    for (let pitch = 0.01; pitch <= 15.01; pitch += 0.01) {
      const next = tileflowAdaptiveFieldOfView(pitch, 17, height, normal);
      assert.ok(next >= previous - 1e-10 && next - previous < 0.2);
      previous = next;
    }
    previous = tileflowAdaptiveFieldOfView(0, 15, height, normal);
    for (let zoom = 14.99; zoom >= 12.99; zoom -= 0.01) {
      const next = tileflowAdaptiveFieldOfView(0, zoom, height, normal);
      assert.ok(next >= previous - 1e-10 && next - previous < 0.3);
      previous = next;
    }
  }
});

function fixture() {
  const events = new EventEmitter();
  const state = {pitch: 0, zoom: 17, height: 900, fov: normal, writes: 0};
  const map = {
    on: events.on.bind(events),
    off: events.off.bind(events),
    getPitch: () => state.pitch,
    getZoom: () => state.zoom,
    getCanvas: () => ({clientHeight: state.height}),
    getVerticalFieldOfView: () => state.fov,
    setVerticalFieldOfView: (fov: number) => {
      state.fov = fov;
      state.writes++;
      events.emit('move');
    },
  } as unknown as Parameters<typeof createTileflowAdaptiveCamera>[0];
  return {map, state, events};
}

test('camera events cannot recurse and detachment restores the lens and removes listeners', () => {
  const {map, state, events} = fixture();
  events.on('move', () => events.emit('pitch'));
  const camera = createTileflowAdaptiveCamera(map);
  camera.setEnabled(true);
  assert.equal(state.writes, 1);
  assert.ok(state.fov < normal);
  state.pitch = 5;
  events.emit('pitch');
  assert.equal(state.writes, 2);
  state.height = 1200;
  events.emit('resize');
  assert.equal(state.writes, 3);
  state.zoom = 10;
  events.emit('zoom');
  assert.equal(state.fov, normal);
  camera.dispose();
  assert.equal(state.fov, normal);
  for (const event of ['pitch', 'zoom', 'resize', 'remove'])
    assert.equal(events.listenerCount(event), 0);
});

test('detachment after map removal does not update the destroyed renderer', () => {
  const {map, state, events} = fixture();
  const camera = createTileflowAdaptiveCamera(map);
  camera.setEnabled(true);
  events.emit('remove');
  camera.dispose();
  assert.equal(state.writes, 1);
  assert.deepEqual(events.eventNames(), []);
});

test('disabling and re-enabling captures the current caller lens, with unsupported engines unchanged', () => {
  const {map, state} = fixture();
  const camera = createTileflowAdaptiveCamera(map);
  assert.equal(state.writes, 0);
  camera.setEnabled(true);
  camera.setEnabled(false);
  assert.equal(state.fov, normal);
  state.fov = 50;
  camera.setEnabled(true);
  camera.dispose();
  assert.equal(state.fov, 50);
  const {getVerticalFieldOfView: _get, setVerticalFieldOfView: _set, ...unsupported} = map;
  const untouched = createTileflowAdaptiveCamera(unsupported);
  untouched.setEnabled(true);
  untouched.dispose();
});

test('the low-pitch lens retains sub-metre depth resolution at a city zoom', () => {
  // MapLibre's near plane is viewportHeight / 50. At 2°, one depth24 step spans over 4 m
  // in this view; neighbouring roofs can quantize to the same depth while scrolling.
  const height = 1923;
  const metresPerPixel = (40075016.686 * Math.cos((40.41 * Math.PI) / 180)) / (512 * 2 ** 16);
  const fov = tileflowAdaptiveFieldOfView(0, 16, height, normal);
  const distance = height / (2 * Math.tan((fov * Math.PI) / 360));
  const near = height / 50;
  const far = distance * 1.01;
  const derivative = (far * near) / ((far - near) * distance * distance);
  const metresPerDepthStep = metresPerPixel / (derivative * (2 ** 24 - 1));
  assert.ok(metresPerDepthStep < 0.5, `${metresPerDepthStep} metres per depth step`);
});
