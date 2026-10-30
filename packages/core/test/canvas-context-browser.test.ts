import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowCanvasContextAttributes} from '../src/canvas-context-browser';

test('browser maps are multisampled unless the caller opts out', () => {
  assert.deepEqual(tileflowCanvasContextAttributes(), {antialias: true});
  assert.deepEqual(tileflowCanvasContextAttributes({preserveDrawingBuffer: true}), {
    antialias: true,
    preserveDrawingBuffer: true,
  });
  assert.deepEqual(tileflowCanvasContextAttributes({antialias: false}), {antialias: false});
});
