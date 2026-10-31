import assert from 'node:assert/strict';
import test from 'node:test';
import {buildingBoxDepth} from '../src/buildings-3d-view';
import {cameraTileRing} from '../src/camera-tiles-browser';
import {tileflowScene3D} from '../src/scene-3d-browser';
import {
  tileflowSkyGroundDepth,
  tileflowSkyHaze,
  tileflowSkyHazeAt,
  tileflowSkyHazeStart,
  tileflowSkyHorizon,
} from '../src/sky-haze';
import {tileflowSkyHazeReachFloor, tileflowSkyReachDepth} from '../src/sky-haze';
import {bindTileflowSkyHaze, tileflowSkyHazeOf} from '../src/sky-haze-browser';

const fov = (36.87 * Math.PI) / 180;
const view = (pitch: number, extra: Partial<Parameters<typeof tileflowSkyHaze>[0]> = {}) =>
  tileflowSkyHaze({horizonColor: '#dcebf7', pitch, fov, height: 720, ...extra});

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);

test('a view-aligned far boundary fits haze at the same depth across the viewport', () => {
  for (const aspect of [0.5, 1, 2, 4])
    close(
      tileflowSkyReachDepth(
        {pitch: 60, fov, aspect},
        {
          ahead: 0,
          across: 0,
          radius: 0,
          forward: 3,
        },
      )!,
      1 + 3 * Math.sin(Math.PI / 3),
    );
});

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

test('the camera ring covers its reach whole, or as far as the tile limit lets it', () => {
  const camera = {lng: -3.6904, lat: 40.4493, pitch: 84, bearing: 8};
  // Zoom 17: every tile within reach fits under the limit.
  const open = cameraTileRing({...camera, zoom: 17}, 15, 25);
  assert.equal(open.tiles.length, 22);
  close(open.radius * open.tileMetres, 1920, 1e-6);
  // Zoom 16 wants 3840 m; 25 tiles cover about 2.1 km whole, which is what the ring reports.
  const capped = cameraTileRing({...camera, zoom: 16}, 15, 25);
  assert.equal(capped.tiles.length, 25);
  assert.ok(capped.radius * capped.tileMetres > 2000 && capped.radius * capped.tileMetres < 2300);
  // Every tile that reaches inside the ring is chosen.
  for (const tile of capped.tiles) assert.ok(tile.distance <= capped.radius);
  assert.ok(cameraTileRing({...camera, zoom: 16}, 15, 9).radius < capped.radius);
});

test('the city’s edge shows where rays across the view leave its disc', () => {
  const view = {pitch: 84, fov, aspect: 16 / 9};
  // A disc round the centre: straight ahead its edge lies r + sin p along the ground from the camera.
  const ahead = tileflowSkyReachDepth({...view, aspect: 1e-9}, {ahead: 0, across: 0, radius: 3})!;
  const sin = Math.sin((84 * Math.PI) / 180);
  const cos = Math.cos((84 * Math.PI) / 180);
  close(ahead, (3 + sin) * sin + cos * cos);
  // Across the view's width the edge comes nearer.
  assert.ok(tileflowSkyReachDepth(view, {ahead: 0, across: 0, radius: 3})! < ahead);
  // A disc wholly behind the camera shows no edge ahead.
  assert.equal(tileflowSkyReachDepth(view, {ahead: -10, across: 0, radius: 2}), undefined);
});

test('the haze is nine-tenths complete where the city ends, never nearer than its floor', () => {
  const reach = {ahead: 1.37, across: 0.2, radius: 2.17};
  const fitted = view(84, {aspect: 16 / 9, reach})!;
  const edge = tileflowSkyReachDepth({pitch: 84, fov, aspect: 16 / 9}, reach)!;
  close(tileflowSkyHazeAt(fitted, edge * fitted.distance), 0.9, 1e-4);
  assert.ok(fitted.end < view(84)!.end);
  // A ring held to a few tiles ends close by; the haze stops at its floor.
  const near = view(84, {aspect: 16 / 9, reach: {ahead: 0.2, across: 0, radius: 0.8}})!;
  close(tileflowSkyHazeAt(near, tileflowSkyHazeReachFloor * near.distance), 0.9, 1e-4);
  // A city reaching past the horizon line leaves the haze complete at the horizon.
  assert.equal(
    view(84, {aspect: 16 / 9, reach: {ahead: 0, across: 0, radius: 40}})!.end,
    view(84)!.end,
  );
});

test('3D layers fit the haze to the reach the 3D buildings publish on the map', () => {
  const map = {
    getBearing: () => 0,
    getCanvas: () => ({clientHeight: 720}),
    getCenter: () => ({lng: 0, lat: 0}),
    getPitch: () => 84,
    getSky: () => ({'horizon-color': '#dcebf7'}),
    getZoom: () => 17,
  };
  const context = {drawingBufferWidth: 1280, drawingBufferHeight: 720} as WebGL2RenderingContext;
  const plain = tileflowSkyHazeOf(map, {fov}, context)!;
  // 1080 CSS pixels from the centre at zoom 17 on the equator.
  const metres = (1080 * 40_075_016.686) / (512 * 2 ** 17);
  tileflowScene3D(map).setReach({lng: 0, lat: metres / 111_320, radius: 2 * metres});
  const fitted = tileflowSkyHazeOf(map, {fov}, context)!;
  assert.ok(fitted.end < plain.end);
  close(fitted.end, view(84, {aspect: 16 / 9, reach: {ahead: 1, across: 0, radius: 2}})!.end, 1e-6);
  tileflowScene3D(map).setReach(undefined);
  assert.equal(tileflowSkyHazeOf(map, {fov}, context)!.end, plain.end);
});

test('a box’s nearest view depth is the least w of its corners', () => {
  // w = 2x - y + 0.5z + 10, column-major.
  const matrix = [0, 0, 0, 2, 0, 0, 0, -1, 0, 0, 0, 0.5, 0, 0, 0, 10];
  assert.equal(buildingBoxDepth(matrix, [1, 2, 0, 3, 4, 6]), 2 - 4 + 0 + 10);
});
