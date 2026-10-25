import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {encodeGreyJpeg} from '../src/grey-jpeg';

// Soft shade with hard steps, on a size that is no multiple of eight.
const width = 301,
  height = 117;
const pixels = Uint8Array.from({length: width * height}, (_, i) => {
  const x = i % width,
    y = Math.floor(i / width);
  return Math.round(255 * (0.35 + 0.65 * Math.min(1, x / 60) * (y % 40 < 20 ? 1 : 0.8)));
});

test('a greyscale JPEG decodes to its pixels within the loss its quality allows', async () => {
  for (const [quality, mean] of [
    [35, 1.5],
    [90, 0.5],
  ] as const) {
    const bytes = encodeGreyJpeg(pixels, width, height, quality);
    const image = sharp(Buffer.from(bytes));
    const {channels} = await image.metadata();
    const {data, info} = await image.greyscale().raw().toBuffer({resolveWithObject: true});
    assert.deepEqual([info.width, info.height, channels], [width, height, 1]);
    let error = 0;
    for (let i = 0; i < pixels.length; i++) error += Math.abs(data[i]! - pixels[i]!);
    assert.ok(error / pixels.length < mean, `quality ${quality}: ${error / pixels.length}`);
  }
  assert.ok(
    encodeGreyJpeg(pixels, width, height, 35).length <
      encodeGreyJpeg(pixels, width, height, 90).length,
  );
  assert.deepEqual(
    encodeGreyJpeg(pixels, width, height, 35),
    encodeGreyJpeg(pixels, width, height, 35),
  );
});

test('a JPEG needs one byte for each pixel of a sized image', () => {
  assert.throws(() => encodeGreyJpeg(new Uint8Array(3), 2, 2, 50), RangeError);
  assert.throws(() => encodeGreyJpeg(new Uint8Array(0), 0, 0, 50), RangeError);
});
