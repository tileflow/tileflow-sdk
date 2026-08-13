import assert from 'node:assert/strict';
import test from 'node:test';
import {compileStaticOverlays, validateStaticScene} from '../src/index';

const baseScene = {
  camera: {center: [0, 0] as [number, number], type: 'center' as const, zoom: 2},
  map: 'main',
  size: {height: 480, width: 640},
};

test('rejects open polygon rings', () => {
  const result = validateStaticScene({
    ...baseScene,
    overlays: [
      {
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
        type: 'polygon',
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /must end at their starting coordinate/);
});

test('compiles closed polygon rings', () => {
  const result = validateStaticScene({
    ...baseScene,
    overlays: [
      {
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
        type: 'polygon',
      },
    ],
  });

  assert.equal(result.ok, true);

  if (!result.ok) {
    return;
  }

  const compiled = compileStaticOverlays(result.scene.overlays);
  assert.equal(compiled.layers[0]?.type, 'fill');
});
