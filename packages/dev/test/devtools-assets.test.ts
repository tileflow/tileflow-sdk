import assert from 'node:assert/strict';
import test from 'node:test';
import {PbfWriter} from 'pbf';
import {spriteNames, spritePreviewPixels} from '../src/devtools/assets';
import {
  fontPreviewLines,
  previewGlyphBaseline,
  readPreviewGlyphs,
} from '../src/devtools/font-preview';

test('sprite catalog includes every atlas and runtime image beyond the old 256-entry limit', () => {
  const ids = [
    ...Array.from({length: 700}, (_, i) => `atlas:icon-${i}`),
    'runtime-marker',
    'second:airport',
  ];
  const before = [...ids];
  const map = {listImages: () => ids};
  assert.equal(spriteNames(map).length, 702);
  assert.ok(spriteNames(map).includes('runtime-marker'));
  assert.ok(spriteNames(map).includes('second:airport'));
  assert.deepEqual(spriteNames(map, ' AIRPORT '), ['second:airport']);
  assert.deepEqual(spriteNames(map, 'missing'), []);
  assert.deepEqual(ids, before);
  ids.push('new-icon');
  assert.ok(spriteNames(map).includes('new-icon'));
});

test('RGBA sprite previews preserve colors and leave map-owned pixels untouched', () => {
  const data = new Uint8Array([20, 40, 90, 128, 255, 160, 0, 255]);
  const preview = spritePreviewPixels(data, false, 2);
  assert.deepEqual([...preview], [...data]);
  preview[0] = 0;
  assert.equal(data[0], 20);
});

test('SDF sprite previews decode distance alpha into coverage without altering the source', () => {
  const data = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 191, 0, 0, 0, 255]);
  const before = [...data];
  for (const ratio of [1, 2]) {
    const preview = spritePreviewPixels(data, true, ratio);
    assert.equal(preview[3], 0);
    assert.equal(preview[7], 0);
    assert.ok(preview[11] > 120 && preview[11] < 135);
    assert.equal(preview[15], 255);
    assert.deepEqual([...preview.slice(12, 15)], [45, 55, 72]);
  }
  assert.deepEqual([...data], before);
});

function glyphRange(width = 2, bitmap = new Uint8Array(64).fill(220)) {
  const pbf = new PbfWriter();
  pbf.writeMessage(
    1,
    (_, stack) => {
      stack.writeStringField(1, 'Sample Regular');
      stack.writeStringField(2, '0-255');
      stack.writeMessage(
        3,
        (_, glyph) => {
          glyph.writeVarintField(1, 65);
          glyph.writeBytesField(2, bitmap);
          glyph.writeVarintField(3, width);
          glyph.writeVarintField(4, 2);
          glyph.writeSVarintField(5, -1);
          glyph.writeSVarintField(6, 18);
          glyph.writeVarintField(7, 12);
        },
        undefined,
      );
    },
    undefined,
  );
  return pbf.finish();
}

test('font previews preserve glyph bearings, advances and the SDF border', () => {
  const glyph = readPreviewGlyphs(glyphRange()).get(65)!;
  assert.equal(glyph.left, -1);
  assert.equal(glyph.top, 18);
  assert.equal(glyph.advance, 12);
  assert.equal(glyph.bitmap.length, (glyph.width + 6) * (glyph.height + 6));
  assert.ok([...fontPreviewLines.join('')].every((char) => char.codePointAt(0)! <= 255));
});

test('font previews reject malformed or excessive glyph dimensions before allocating pixels', () => {
  assert.throws(() => readPreviewGlyphs(glyphRange(257)), /metrics/u);
  assert.throws(() => readPreviewGlyphs(glyphRange(2, new Uint8Array(3))), /metrics/u);
});

test('font specimens align negative server bearings without clipping the second line', () => {
  const glyphs = readPreviewGlyphs(glyphRange());
  const glyph = glyphs.get(65)!;
  glyph.top = -9;
  assert.equal(previewGlyphBaseline(glyphs) - glyph.top, 14);
  assert.ok(previewGlyphBaseline(glyphs) + 38 - glyph.top + glyph.height < 92);
});

test('icon variants follow expression outputs without mistaking class names for images', async () => {
  const {iconVariant} = await import('../src/devtools/assets');
  const style = (output: string) =>
    ({
      version: 8,
      sources: {},
      layers: [
        {
          id: 'poi',
          type: 'symbol',
          layout: {
            'icon-image': [
              'match',
              ['get', 'class'],
              ['aerialway'],
              'aerialway' + output,
              'other' + output,
            ],
          },
        },
      ],
    }) as any;
  assert.equal(iconVariant('aerialway', style(''), style('-night')), 'aerialway-night');
  assert.equal(iconVariant('unused', style(''), style('-night')), undefined);
  assert.equal(iconVariant('other', style(''), style('-mono')), 'other-mono');
});
