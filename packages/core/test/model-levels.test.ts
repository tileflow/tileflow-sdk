import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tileflowModelCameraDistance,
  tileflowModelLevel,
  tileflowModelLevelDistancesOf,
  tileflowModelLevelHysteresis,
  tileflowModelShadowLevel,
} from '../src/models-3d-levels';

const latitude = 40.4;
const focal = 720 / (2 * Math.tan((36.87 * Math.PI) / 360));

/**
 * Where a map's camera stands, in metres east, north and up of a model `at` metres east and north
 * of the map's centre, as a map 720 CSS pixels high at `zoom` and `pitch` (bearing north) has it.
 */
function view(zoom: number, pitch: number, at: readonly [number, number] = [0, 0]) {
  const metresPerPixel = (40_075_016.686 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom / 512;
  const distance = focal * metresPerPixel;
  const tilt = (pitch * Math.PI) / 180;
  return {
    camera: [-at[0], -at[1] - distance * Math.sin(tilt), distance * Math.cos(tilt)] as const,
  };
}

// About the size of the library's Torre Picasso, Atocha and Puerta de Alcalá, each with three levels.
const tower = {bounds: [-25, -25, 0, 25, 25, 157] as const, heading: 0, levels: 3};
const hall = {bounds: [-115, -35, 0, 115, 35, 29] as const, heading: 0, levels: 3};
const gate = {bounds: [-22, -6, 0, 22, 6, 20] as const, heading: 0, levels: 3};

test('tall, wide and small models lighten at their own distances', () => {
  assert.deepEqual(tileflowModelLevelDistancesOf(tower.bounds), [2_000, 5_000]);
  assert.deepEqual(tileflowModelLevelDistancesOf(hall.bounds), [1_500, 3_500]);
  assert.deepEqual(tileflowModelLevelDistancesOf(gate.bounds), [1_000, 2_500]);
  // A camera straight above the centre of the bounds, this far from it.
  const levels = (model: typeof tower) =>
    [900, 1_400, 1_900, 2_400, 3_400, 4_900, 5_100].map((distance) =>
      tileflowModelLevel(model, {camera: [0, 0, model.bounds[5] / 2 + distance]}),
    );
  assert.deepEqual(levels(tower), [0, 0, 0, 1, 1, 1, 2]);
  assert.deepEqual(levels(hall), [0, 0, 1, 1, 1, 2, 2]);
  assert.deepEqual(levels(gate), [0, 1, 1, 1, 2, 2, 2]);
});

test('a model at the map centre lightens as the camera rises', () => {
  const levels = (model: typeof tower) =>
    [14.2, 15, 16].map((zoom) => tileflowModelLevel(model, view(zoom, 0)));
  assert.deepEqual(levels(tower), [1, 0, 0]);
  assert.deepEqual(levels(hall), [1, 1, 0]);
  assert.deepEqual(levels(gate), [2, 1, 0]);
});

test('at a steep pitch the level follows the camera, not the map centre', () => {
  // At pitch 85 and zoom 16 the camera stands about a kilometre behind the centre, 86 m up.
  const steep = (at: readonly [number, number]) => tileflowModelLevel(hall, view(16, 85, at));
  assert.equal(steep([0, -900]), 0);
  assert.equal(steep([0, 0]), 0);
  assert.equal(steep([0, 1_000]), 1);
  assert.equal(steep([0, 3_000]), 2);
});

test('the heading turns the bounds round the origin before their distance is measured', () => {
  const offset = {bounds: [100, -10, 0, 120, 10, 20] as const, levels: 3};
  // Turned 90 degrees clockwise, its east becomes south.
  const beside = {camera: [0, -110, 10] as const};
  assert.ok(tileflowModelCameraDistance({...offset, heading: 90}, beside) < 1e-9);
  assert.ok(
    Math.abs(tileflowModelCameraDistance({...offset, heading: 0}, beside) - Math.hypot(110, 110)) <
      1e-9,
  );
});

test('a model near a threshold keeps its level until it has clearly crossed it', () => {
  const at = (distance: number) => ({camera: [0, 0, 14.5 + distance] as const});
  const root = Math.sqrt(tileflowModelLevelHysteresis);
  assert.equal(tileflowModelLevel(hall, at(1_500 * root)), 1);
  assert.equal(tileflowModelLevel(hall, at(1_500 * root), 0), 0);
  assert.equal(tileflowModelLevel(hall, at(1_500 / root), 1), 1);
  assert.equal(tileflowModelLevel(hall, at(1_500 / root)), 0);
  assert.equal(tileflowModelLevel(hall, at(1_500 * tileflowModelLevelHysteresis * 1.01), 0), 1);
  assert.equal(tileflowModelLevel(hall, at(1_500 / tileflowModelLevelHysteresis / 1.01), 1), 0);
  // A jump far past both thresholds goes straight to the level it reaches.
  assert.equal(tileflowModelLevel(hall, at(10_000), 0), 2);
  assert.equal(tileflowModelLevel(hall, at(100), 2), 0);
});

test('a model with fewer levels draws at the lightest it has', () => {
  const far = view(12, 0);
  assert.equal(tileflowModelLevel({...hall, levels: 1}, far), 0);
  assert.equal(tileflowModelLevel({...hall, levels: 2}, far), 1);
  assert.equal(tileflowModelLevel({...hall, levels: 2}, far, 2), 1);
});

test('a model casts its shadow with its next lighter level', () => {
  assert.deepEqual(
    [0, 1, 2].map((level) => tileflowModelShadowLevel(level, 3)),
    [1, 2, 2],
  );
  assert.equal(tileflowModelShadowLevel(0, 2), 1);
  assert.equal(tileflowModelShadowLevel(0, 1), 0);
});

test('a narrow field of view preserves detail when the camera retreats at the same apparent size', () => {
  for (const model of [tower, hall, gate]) {
    const centre = (model.bounds[2] + model.bounds[5]) / 2;
    for (const distance of [500, 1_400, 2_400, 4_000, 6_000]) {
      const expected = tileflowModelLevel(model, {camera: [0, 0, centre + distance]});
      for (const fov of [2, 5, 15, (Math.atan(1 / 3) * 360) / Math.PI]) {
        const scale = Math.tan((fov * Math.PI) / 360) * 3;
        assert.equal(
          tileflowModelLevel(model, {
            camera: [0, 0, centre + distance / scale],
            verticalFieldOfView: fov,
          }),
          expected,
        );
      }
    }
  }
});
