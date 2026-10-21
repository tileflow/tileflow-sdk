import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tileflowSkyGroundDepth,
  tileflowSkyHaze,
  tileflowSkyHazeAt,
  tileflowSkyHazeStart,
  tileflowSkyHorizon,
} from '../src/sky-haze';
import {bindTileflowSkyHaze, tileflowSkyHazeOf} from '../src/sky-haze-browser';

const fov = (36.87 * Math.PI) / 180;
const view = (pitch: number, extra: Partial<Parameters<typeof tileflowSkyHaze>[0]> = {}) =>
  tileflowSkyHaze({horizonColor: '#dcebf7', pitch, fov, height: 720, ...extra});

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);

test('the horizon line follows MapLibre 6.13: 85 % of the true horizon, at most 89.25° down', () => {
  close(tileflowSkyHorizon(60), Math.tan((30 * Math.PI) / 180) * 0.85);
  close(tileflowSkyHorizon(84), Math.tan((6 * Math.PI) / 180) * 0.85);
  // Past about 84.5° the 89.25° limit is the nearer one.
  close(tileflowSkyHorizon(85), Math.tan((4.25 * Math.PI) / 180));
});

test('flat ground lies at the centre at rise 0, farther above it, and nowhere past the horizon', () => {
  close(tileflowSkyGroundDepth(60, 0), 1);
  // At 84° the view's top edge (rise tan 18.4°) is above the true horizon (rise tan 6°).
  assert.equal(tileflowSkyGroundDepth(84, Math.tan((10 * Math.PI) / 180)), Infinity);
  // Seen 5° above the centre at 60°, the ground is 65° from straight down.
  const rise = Math.tan((5 * Math.PI) / 180);
  const expected =
    (Math.cos(Math.PI / 3) * Math.cos((5 * Math.PI) / 180)) / Math.cos((65 * Math.PI) / 180);
  close(tileflowSkyGroundDepth(60, rise), expected);
});

test('the haze is complete where the ground meets the sky, about 6.7 camera distances away', () => {
  for (const pitch of [60, 70, 75, 80, 84, 85]) {
    const haze = view(pitch)!;
    close(haze.end, tileflowSkyGroundDepth(pitch, haze.horizon));
    assert.ok(haze.end > 6.4 && haze.end < 6.8, `${pitch}: ${haze.end}`);
    assert.equal(haze.start, tileflowSkyHazeStart);
    close(tileflowSkyHazeAt(haze, haze.end * haze.distance), 1);
    assert.equal(tileflowSkyHazeAt(haze, haze.start * haze.distance), 0);
    assert.equal(tileflowSkyHazeAt(haze, haze.distance), 0);
  }
});

test('the camera distance is MapLibre’s cameraToCenterDistance in CSS pixels', () => {
  // MapLibre's default 36.87° field of view puts the camera 1.5 view heights from the centre.
  close(view(70)!.distance, 1080, 1e-2);
});

test('the haze comes in between 45° and 60° of pitch and leaves globes alone', () => {
  assert.equal(view(0), undefined);
  assert.equal(view(45), undefined);
  close(view(52.5)!.strength, 0.5);
  assert.equal(view(60)!.strength, 1);
  assert.equal(view(85)!.strength, 1);
  assert.equal(view(70, {globe: 1}), undefined);
  close(view(70, {globe: 0.25})!.strength, 0.75);
});

test('the haze takes the sky’s opaque horizon colour, and none without one', () => {
  assert.deepEqual(view(70)!.colour, [220 / 255, 235 / 255, 247 / 255]);
  assert.equal(view(70, {horizonColor: undefined}), undefined);
  assert.equal(
    view(70, {horizonColor: ['interpolate', ['linear'], ['zoom'], 0, '#fff']}),
    undefined,
  );
  assert.equal(view(70, {horizonColor: 'rgba(255, 255, 255, 0.5)'}), undefined);
  assert.equal(view(70, {height: 0}), undefined);
});

test('the haze rises smoothly with depth between its start and end', () => {
  const haze = view(75)!;
  let previous = 0;
  for (let step = 1; step <= 20; step += 1) {
    const depth = (haze.start + ((haze.end - haze.start) * step) / 20) * haze.distance;
    const amount = tileflowSkyHazeAt(haze, depth);
    assert.ok(amount > previous);
    previous = amount;
  }
  close(tileflowSkyHazeAt(haze, ((haze.start + haze.end) / 2) * haze.distance), 0.5);
  close(tileflowSkyHazeAt(view(52.5)!, 100 * view(52.5)!.distance), 0.5);
  assert.equal(tileflowSkyHazeAt(undefined, 1e9), 0);
});

test('3D layers read the haze from the map’s sky and the render arguments', () => {
  const map = {
    getCanvas: () => ({clientHeight: 720}),
    getPitch: () => 75,
    getSky: () => ({'horizon-color': '#e7a3a4', 'sky-color': '#4a4784'}),
  };
  const haze = tileflowSkyHazeOf(map, {fov, defaultProjectionData: {projectionTransition: 0}})!;
  assert.deepEqual(haze, view(75, {horizonColor: '#e7a3a4'}));
  assert.equal(tileflowSkyHazeOf({...map, getSky: () => undefined}), undefined);
  assert.equal(
    tileflowSkyHazeOf(map, {fov, defaultProjectionData: {projectionTransition: 1}}),
    undefined,
  );

  // The uniforms carry depths in the camera's units, which clip space's w is in.
  const calls: unknown[][] = [];
  const context = {
    uniform3f: (...args: unknown[]) => calls.push(['3f', ...args]),
    uniform3fv: (...args: unknown[]) => calls.push(['3fv', ...args]),
  } as unknown as WebGL2RenderingContext;
  bindTileflowSkyHaze(context, {u_haze: 'haze', u_haze_colour: 'colour'} as never, haze);
  assert.deepEqual(calls, [
    ['3fv', 'colour', haze.colour],
    ['3f', 'haze', 1, haze.start * haze.distance, haze.end * haze.distance],
  ]);
  calls.length = 0;
  bindTileflowSkyHaze(context, {u_haze: 'haze'} as never, undefined);
  assert.deepEqual(calls, [['3f', 'haze', 0, 0, 1]]);
});
