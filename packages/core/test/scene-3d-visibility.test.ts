import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowSceneEntrance, tileflowSceneOpacity} from '../src/scene-3d-visibility';

test('all scene renderers share a reversible opacity ramp from zoom 15 to 15.25', () => {
  const samples = [
    [0, 0],
    [14.999, 0],
    [15, 0],
    [15.0625, 0.25],
    [15.125, 0.5],
    [15.1875, 0.75],
    [15.25, 1],
    [16, 1],
    [24, 1],
  ] as const;
  for (const [zoom, expected] of [...samples, ...samples.toReversed()])
    assert.equal(tileflowSceneOpacity(zoom), expected);
});

test('explicit renderer minzoom overrides retain the same quarter-zoom entrance', () => {
  assert.equal(tileflowSceneOpacity(16.9, 17), 0);
  assert.equal(tileflowSceneOpacity(17, 17), 0);
  assert.equal(tileflowSceneOpacity(17.125, 17), 0.5);
  assert.equal(tileflowSceneOpacity(17.25, 17), 1);
});

test('disabled building entrances never partially grow or fade while zooming in or out', () => {
  for (const band of [
    [15, 15.3],
    [14.2, 14.6],
  ] as const) {
    const [from, to] = band;
    const samples = [from - 0.01, from, (from + to) / 2, to, to + 1];
    for (const zoom of [...samples, ...samples.toReversed()]) {
      assert.equal(tileflowSceneEntrance(zoom, band, false), zoom < from ? 0 : 1);
    }
    assert.equal(tileflowSceneEntrance(from, band, true), 0);
    assert.ok(Math.abs(tileflowSceneEntrance((from + to) / 2, band, true) - 0.5) < 1e-12);
    assert.equal(tileflowSceneEntrance(to, band, true), 1);
  }
});

test('an instant entrance appears exactly at zoom 14.25 without dividing by zero', () => {
  for (const zoom of [14, 14.2499, 14.25, 14.26, 15, 14.25, 14.2499]) {
    assert.equal(tileflowSceneEntrance(zoom, [14.25, 14.25], true), zoom >= 14.25 ? 1 : 0);
  }
});
