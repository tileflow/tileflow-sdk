import assert from 'node:assert/strict';
import test from 'node:test';
import {renderTileflowIconAtlasPixels} from '../src/icon-preview';

test('SDF preview applies fill, halo and transparency while preserving fixed-color neighbors', () => {
  const pixels = new Uint8Array([
    255, 255, 255, 255, 255, 255, 255, 150, 255, 255, 255, 0, 20, 80, 240, 255,
  ]);
  const index = {
    health: {
      width: 3,
      height: 1,
      x: 0,
      y: 0,
      pixelRatio: 1 as const,
      sdf: true as const,
      tileflow: {
        representation: 'sdf' as const,
        defaults: {color: '#e04020', haloColor: '#ffffff', haloWidth: 2, haloBlur: 0},
      },
    },
    brand: {width: 1, height: 1, x: 3, y: 0, pixelRatio: 1 as const},
  };
  const rendered = renderTileflowIconAtlasPixels(pixels, 4, 1, index);
  assert.deepEqual([...rendered.slice(0, 4)], [224, 64, 32, 255]);
  assert.deepEqual([...rendered.slice(4, 8)], [255, 255, 255, 255]);
  assert.equal(rendered[11], 0);
  assert.deepEqual([...rendered.slice(12)], [...pixels.slice(12)]);
  assert.equal(pixels[0], 255, 'the immutable atlas is not edited');
});
