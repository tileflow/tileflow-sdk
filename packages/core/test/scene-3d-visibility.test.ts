import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowSceneOpacity} from '../src/scene-3d-visibility';

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
