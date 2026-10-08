import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStyle,
  createTileflowLineBackgroundFontStack,
  deriveTileflowLineBackgroundGlyphs,
  fixed,
  labels,
  parseTileflowLineBackgroundFontStack,
  poi,
  scaleTileflowTextSizeForLineBackground,
  tileflowLineBackgroundDefaults,
  zoom,
} from '../src';
import {applySymbolStyle, applyTextStyle} from '../src/cartography/layer-style';
import {extendStreets} from './map-fixture';

type Glyph = {
  advance: number;
  bitmap: Uint8Array;
  height: number;
  id: number;
  left: number;
  top: number;
  width: number;
};

const BORDER = 3;

test('derived stack names are canonical, bounded and reversible', () => {
  const stack = createTileflowLineBackgroundFontStack('Noto Sans Bold', {
    letterSpacing: 0.08,
    lineHeight: 1.2,
    padding: 0.33,
  });

  assert.equal(stack, 'Noto Sans Bold lines-v1-t80-l1200-p330');
  assert.deepEqual(parseTileflowLineBackgroundFontStack(stack), {
    metrics: {letterSpacing: 0.08, lineHeight: 1.2, padding: 0.33},
    source: 'Noto Sans Bold',
  });
  assert.equal(
    createTileflowLineBackgroundFontStack('Noto Sans Bold', {letterSpacing: 0.1234}),
    'Noto Sans Bold lines-v1-t123-l1200-p330',
  );
  assert.equal(parseTileflowLineBackgroundFontStack('Noto Sans Bold'), undefined);
  assert.equal(
    parseTileflowLineBackgroundFontStack('Noto Sans Bold lines-v1-t080-l1200-p330'),
    undefined,
  );
  assert.equal(
    parseTileflowLineBackgroundFontStack('Noto Sans Bold lines-v1-t900-l1200-p330'),
    undefined,
  );
  assert.throws(
    () => createTileflowLineBackgroundFontStack('Noto Sans Bold,Fallback'),
    /one exact font stack/u,
  );
  assert.throws(() => createTileflowLineBackgroundFontStack(stack), /already a line-fitted/u);
  assert.throws(
    () => createTileflowLineBackgroundFontStack('Noto Sans Bold', {lineHeight: 0.5}),
    /lineHeight must be a constant number from 0.8 to 3/u,
  );
});

test('derived glyphs keep metrics and letter shapes and gain overlapping cells', () => {
  const source = encodeRange([letterGlyph(72), spaceGlyph()]);
  const metrics = {letterSpacing: 0.08, lineHeight: 1.2, padding: 0.33};
  const [stack] = decodeRange(deriveTileflowLineBackgroundGlyphs(source, metrics));
  const [letter, space] = stack!.glyphs;

  assert.equal(stack!.name, 'Fixture Sans');
  assert.equal(stack!.range, '0-255');
  assert.equal(letter!.advance, 18);
  assert.equal(space!.advance, 6);
  for (const glyph of stack!.glyphs) {
    assert.ok(glyph.width >= 0 && glyph.height >= 0);
    assert.equal(glyph.bitmap.length, (glyph.width + 2 * BORDER) * (glyph.height + 2 * BORDER));
  }

  // Letter bodies survive unchanged; the source edge is 192 and its interior rises above it.
  const original = letterGlyph(72);
  const sourceWidth = original.width + 2 * BORDER;
  for (let row = 0; row < original.height + 2 * BORDER; row++) {
    for (let column = 0; column < sourceWidth; column++) {
      const value = original.bitmap[row * sourceWidth + column]!;
      if (value < 176) continue;
      const x = original.left - BORDER + column + 0.5;
      const y = -20 - original.top + row + 0.5;
      assert.equal(sample(letter!, x, y), value);
    }
  }

  // Cells sit at 128 inside the strip and are empty well outside it.
  const ls = metrics.letterSpacing * 24;
  const pad = metrics.padding * 24;
  const halfHeight = (metrics.lineHeight * 24) / 2;
  assert.equal(sample(space!, 3, 0.5), 128);
  assert.equal(sample(space!, 3, 0.5 - halfHeight + 1.5), 128);
  assert.equal(sample(space!, 3, 0.5 + halfHeight + 3), 0);
  assert.equal(sample(letter!, 18 + ls / 2 + pad, 0.5), 128);
  assert.equal(sample(letter!, 18 + ls / 2 + pad + 4, 0.5), 0);

  // Neighbouring cells overlap: the next glyph's pen is advance + letter spacing away.
  const nextPen = 18 + ls;
  assert.ok(18 + ls / 2 + pad > nextPen - ls / 2 - pad);
});

test('derivation rejects malformed glyph bitmaps instead of drawing misplaced cells', () => {
  const broken = {...letterGlyph(65), bitmap: new Uint8Array(3)};
  assert.throws(() => deriveTileflowLineBackgroundGlyphs(encodeRange([broken])), /does not match/u);
});

test('halo width follows every text-size representation without moving zoom inputs', () => {
  assert.equal(scaleTileflowTextSizeForLineBackground(undefined), 16 / 6);
  assert.equal(scaleTileflowTextSizeForLineBackground(12), 2);
  assert.deepEqual(
    scaleTileflowTextSizeForLineBackground([
      'interpolate',
      ['linear'],
      ['zoom'],
      14,
      12,
      18,
      ['get', 's'],
    ]),
    ['interpolate', ['linear'], ['zoom'], 14, 2, 18, ['*', 1 / 6, ['get', 's']]],
  );
  assert.deepEqual(scaleTileflowTextSizeForLineBackground(['step', ['zoom'], 12, 16, 18]), [
    'step',
    ['zoom'],
    2,
    16,
    3,
  ]);
  assert.deepEqual(scaleTileflowTextSizeForLineBackground(['get', 's']), [
    '*',
    1 / 6,
    ['get', 's'],
  ]);
});

test('text.background lowers to a derived stack and a halo sized to the text', () => {
  const layer = applySymbolStyle(
    {id: 'backed', type: 'symbol'},
    {
      text: {
        background: {color: '#080E11', fit: 'lines', padding: 0.25},
        font: 'Noto Sans Bold',
        haloColor: '#FFFFFF',
        haloWidth: 1.2,
        letterSpacing: 0.08,
        size: zoom.linear([
          [14, 12],
          [18, 15],
        ]),
      },
    },
  );

  assert.deepEqual(layer.layout?.['text-font'], ['Noto Sans Bold lines-v1-t80-l1200-p250']);
  assert.equal(layer.layout?.['text-letter-spacing'], 0.08);
  assert.equal(layer.layout?.['text-line-height'], 1.2);
  assert.equal(layer.paint?.['text-halo-color'], '#080E11');
  assert.equal(layer.paint?.['text-halo-blur'], 0);
  assert.deepEqual(layer.paint?.['text-halo-width'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    2,
    18,
    2.5,
  ]);
});

test('later refinements keep a backed layer consistent', () => {
  const backed = applyTextStyle(
    {id: 'backed', type: 'symbol'},
    {background: {color: '#000000', fit: 'lines'}, font: 'Noto Sans Bold', size: 12},
  );
  const resized = applyTextStyle(backed, {letterSpacing: 0.1, size: 18});

  assert.deepEqual(resized.layout?.['text-font'], ['Noto Sans Bold lines-v1-t100-l1200-p330']);
  assert.equal(resized.paint?.['text-halo-width'], 3);
  assert.equal(resized.paint?.['text-halo-color'], '#000000');

  const refont = applyTextStyle(resized, {font: 'Noto Sans Regular', haloWidth: 9});
  assert.deepEqual(refont.layout?.['text-font'], ['Noto Sans Regular lines-v1-t100-l1200-p330']);
  assert.equal(refont.paint?.['text-halo-width'], 3);
});

test('text.background rejects inputs its derived cells cannot honour', () => {
  const style = {background: {color: '#000000', fit: 'lines'}, font: 'Noto Sans Bold'} as const;

  assert.throws(
    () =>
      applyTextStyle(
        {id: 'fallback', type: 'symbol'},
        {...style, fallbacks: ['Noto Sans Regular']},
      ),
    /exactly one text font without fallbacks/u,
  );
  assert.throws(
    () =>
      applyTextStyle(
        {id: 'zoomed', type: 'symbol'},
        {
          ...style,
          letterSpacing: zoom.linear([
            [10, 0],
            [16, 0.1],
          ]),
        },
      ),
    /letterSpacing must be a constant number/u,
  );
  assert.throws(
    () =>
      applyTextStyle(
        {id: 'translucent', type: 'symbol'},
        {...style, background: {color: 'rgba(0, 0, 0, 0.74)', fit: 'lines'}},
      ),
    /needs an opaque line-fitted background colour/u,
  );
  assert.throws(
    () =>
      applyTextStyle(
        {id: 'wide', type: 'symbol'},
        {...style, background: {color: '#000000', fit: 'lines', padding: 2}},
      ),
    /padding must be a constant number from 0 to 1/u,
  );
});

test('a map with a glyph provider compiles derived stacks from its declared source stack', () => {
  const style = createStyle(
    extendStreets({
      modules: {
        labels: labels({places: 'all', roads: 'none', water: 'none'}),
        poi: poi({
          categories: ['arts-entertainment'],
          icons: false,
          labels: true,
          styles: {
            'arts-entertainment': {
              text: {
                background: {color: fixed('#080E11', {reason: 'Caption strip'}), fit: 'lines'},
                font: fixed('Noto Sans Bold', {reason: 'Strip font'}),
                letterSpacing: fixed(0.08, {reason: 'Strip tracking'}),
              },
            },
          },
        }),
      },
    }),
  );
  const backed = style.layers.filter((layer) => {
    const font = (layer.layout as Record<string, unknown> | undefined)?.['text-font'];
    return (
      Array.isArray(font) && parseTileflowLineBackgroundFontStack(String(font[0])) !== undefined
    );
  });

  assert.ok(backed.length > 0);
  for (const layer of backed) {
    assert.deepEqual((layer.layout as Record<string, unknown>)['text-font'], [
      `Noto Sans Bold lines-v1-t80-l${tileflowLineBackgroundDefaults.lineHeight * 1000}-p330`,
    ]);
  }
  assert.equal(style.glyphs, 'https://fixtures.tileflow.test/fonts/{fontstack}/{range}.pbf');
});

test('browser-rendered fonts cannot carry line-fitted background cells', () => {
  assert.throws(
    () =>
      createStyle(
        extendStreets({
          fonts: ['./fonts'],
          glyphs: undefined,
          modules: {
            poi: poi({
              categories: ['arts-entertainment'],
              icons: false,
              labels: true,
              styles: {
                'arts-entertainment': {
                  text: {background: {color: fixed('#000000', {reason: 'Strip'}), fit: 'lines'}},
                },
              },
            }),
          },
        } as never),
      ),
    /needs a glyphs provider/u,
  );
});

function letterGlyph(id: number): Glyph {
  const width = 14;
  const height = 17;
  const w = width + 2 * BORDER;
  const h = height + 2 * BORDER;
  const bitmap = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    for (let column = 0; column < w; column++) {
      const x = column + 0.5 - BORDER;
      const y = row + 0.5 - BORDER;
      const distance = Math.min(x, width - x, y, height - y);
      bitmap[row * w + column] = Math.max(0, Math.min(255, Math.round(192 + 32 * distance)));
    }
  }
  return {advance: 18, bitmap, height, id, left: 2, top: -9, width};
}

function spaceGlyph(): Glyph {
  return {advance: 6, bitmap: new Uint8Array(0), height: 0, id: 32, left: 0, top: -26, width: 0};
}

function sample(glyph: Glyph, x: number, y: number): number {
  const w = glyph.width + 2 * BORDER;
  const h = glyph.height + 2 * BORDER;
  const column = Math.floor(x - (glyph.left - BORDER));
  const row = Math.floor(y - (-20 - glyph.top));
  if (column < 0 || column >= w || row < 0 || row >= h) return 0;
  return glyph.bitmap[row * w + column]!;
}

// An independent minimal glyphs.proto codec, so the tests do not trust the implementation's own.
function encodeRange(glyphs: Glyph[]): Uint8Array {
  const glyphMessages = glyphs.map((glyph) =>
    bytes(
      field(1, varint(glyph.id)),
      glyph.bitmap.length ? lengthDelimited(2, glyph.bitmap) : new Uint8Array(0),
      field(3, varint(glyph.width)),
      field(4, varint(glyph.height)),
      field(5, varint(zigzag(glyph.left))),
      field(6, varint(zigzag(glyph.top))),
      field(7, varint(glyph.advance)),
    ),
  );
  const stack = bytes(
    lengthDelimited(1, new TextEncoder().encode('Fixture Sans')),
    lengthDelimited(2, new TextEncoder().encode('0-255')),
    ...glyphMessages.map((message) => lengthDelimited(3, message)),
  );
  return lengthDelimited(1, stack);
}

function decodeRange(data: Uint8Array): Array<{glyphs: Glyph[]; name: string; range: string}> {
  const stacks: Array<{glyphs: Glyph[]; name: string; range: string}> = [];
  for (const [tag, value] of fields(data)) {
    if (tag !== 1 || !(value instanceof Uint8Array)) continue;
    const stack = {glyphs: [] as Glyph[], name: '', range: ''};
    for (const [stackTag, stackValue] of fields(value)) {
      if (stackTag === 1) stack.name = new TextDecoder().decode(stackValue as Uint8Array);
      if (stackTag === 2) stack.range = new TextDecoder().decode(stackValue as Uint8Array);
      if (stackTag === 3) {
        const glyph: Glyph = {
          advance: 0,
          bitmap: new Uint8Array(0),
          height: 0,
          id: 0,
          left: 0,
          top: 0,
          width: 0,
        };
        for (const [glyphTag, glyphValue] of fields(stackValue as Uint8Array)) {
          if (glyphTag === 1) glyph.id = glyphValue as number;
          if (glyphTag === 2) glyph.bitmap = glyphValue as Uint8Array;
          if (glyphTag === 3) glyph.width = glyphValue as number;
          if (glyphTag === 4) glyph.height = glyphValue as number;
          if (glyphTag === 5) glyph.left = unzigzag(glyphValue as number);
          if (glyphTag === 6) glyph.top = unzigzag(glyphValue as number);
          if (glyphTag === 7) glyph.advance = glyphValue as number;
        }
        stack.glyphs.push(glyph);
      }
    }
    stacks.push(stack);
  }
  return stacks;
}

function* fields(data: Uint8Array): Generator<[number, number | Uint8Array]> {
  let position = 0;
  const read = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = data[position++]!;
      result += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return result;
  };
  while (position < data.length) {
    const key = read();
    if (key % 8 === 0) yield [Math.floor(key / 8), read()];
    else {
      const length = read();
      yield [Math.floor(key / 8), data.subarray(position, position + length)];
      position += length;
    }
  }
}

function varint(value: number): Uint8Array {
  const out: number[] = [];
  while (value >= 0x80) {
    out.push((value % 0x80) | 0x80);
    value = Math.floor(value / 0x80);
  }
  out.push(value);
  return Uint8Array.from(out);
}

function zigzag(value: number): number {
  return value < 0 ? -2 * value - 1 : 2 * value;
}

function unzigzag(value: number): number {
  return value % 2 === 1 ? (value + 1) / -2 : value / 2;
}

function field(tag: number, value: Uint8Array): Uint8Array {
  return bytes(varint(tag * 8), value);
}

function lengthDelimited(tag: number, value: Uint8Array): Uint8Array {
  return bytes(varint(tag * 8 + 2), varint(value.length), value);
}

function bytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
