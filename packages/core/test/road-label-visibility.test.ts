import assert from 'node:assert/strict';
import test from 'node:test';
import {roadLabelWithinView} from '../src/road-label-visibility-browser';

test('road names yield the distant view as pitch increases, including exact boundaries', () => {
  assert.equal(roadLabelWithinView(0, 4), true);
  assert.equal(roadLabelWithinView(40, 1), true);
  assert.equal(roadLabelWithinView(40.01, 1), false);
  assert.equal(roadLabelWithinView(54.99, 0.1), true);
  assert.equal(roadLabelWithinView(55, 0), false);
  assert.equal(roadLabelWithinView(55, -0.001), true);
  assert.equal(roadLabelWithinView(59.99, -0.1), true);
  assert.equal(roadLabelWithinView(60, -0.1), false);
  assert.equal(roadLabelWithinView(70, -0.2), true);
  assert.equal(roadLabelWithinView(85, -0.4), true);
  assert.equal(roadLabelWithinView(0, NaN), false);
});
