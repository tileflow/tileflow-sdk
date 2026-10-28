import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachTileflowHorizonQueries,
  tileflowHorizonScaleFactor,
} from '../src/horizon-queries-browser';

// MapLibre's default 36.87° vertical field of view: the focal length is 1.5 times the height.
const view = (pitch: number, height = 500) => ({
  pitch,
  centerY: height / 2,
  cameraToCenterDistance: 1.5 * height,
});

test('below the horizon the factor matches MapLibre', () => {
  // MapLibre's own transform test expects this value at pitch 60 in a 500 × 500 view.
  assert.ok(Math.abs(tileflowHorizonScaleFactor(view(60)) - 2.366025418080343) < 1e-6);
  assert.equal(tileflowHorizonScaleFactor(view(0)), 1);
});

test('with the horizon in view the factor stays positive and finite', () => {
  for (const pitch of [72, 75, 80, 85]) {
    const factor = tileflowHorizonScaleFactor(view(pitch));
    assert.ok(factor > 1 && Number.isFinite(factor), `pitch ${pitch}: ${factor}`);
  }
  // Sampled at 85% of the way to the true horizon: 1 / (1 - 0.85).
  assert.ok(Math.abs(tileflowHorizonScaleFactor(view(80)) - 1 / 0.15) < 1e-9);
});

test('queries replace only factors that are not positive and restore the map', () => {
  class Transform {
    pitch = 80;
    centerPoint = {y: 250};
    cameraToCenterDistance = 750;
    reported = -1.12;
    maxPitchScaleFactor() {
      return this.reported;
    }
  }
  const transform = new Transform();
  const factors: number[] = [];
  class Map {
    _camera = {transform};
    queryRenderedFeatures() {
      factors.push(this._camera.transform.maxPitchScaleFactor());
      return [];
    }
  }
  const map = new Map();
  const detach = attachTileflowHorizonQueries(map);
  map.queryRenderedFeatures();
  transform.reported = 2.5;
  map.queryRenderedFeatures();
  assert.ok(Math.abs(factors[0] - 1 / 0.15) < 1e-9);
  assert.equal(factors[1], 2.5);
  detach();
  transform.reported = -1;
  map.queryRenderedFeatures();
  assert.equal(factors[2], -1);
  assert.equal(Object.hasOwn(map, 'queryRenderedFeatures'), false);
  assert.equal(Object.hasOwn(transform, 'maxPitchScaleFactor'), false);
  // A map without the internal transform is left as it is.
  const plain = {queryRenderedFeatures: () => []};
  attachTileflowHorizonQueries(plain)();
  assert.deepEqual(plain.queryRenderedFeatures(), []);
});
