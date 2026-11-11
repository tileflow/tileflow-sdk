import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSrgba,
  normalizeTileflowCssColor,
  parseTileflowCssColor,
  type TileflowSrgbaColor,
} from '../src/css-color';

// Reference values: the sRGB bytes Chromium paints for each colour on a canvas.
const references: readonly (readonly [
  string,
  readonly [number, number, number, number],
  number?,
])[] = [
  ['oklch(1 0 0)', [255, 255, 255, 255]],
  ['oklch(0 0 0)', [0, 0, 0, 255]],
  ['oklch(0.985 0 0)', [250, 250, 250, 255]],
  ['oklch(0.145 0 0)', [10, 10, 10, 255]],
  ['oklch(0.205 0 0)', [23, 23, 23, 255]],
  ['oklch(0.623 0.214 259.815)', [43, 127, 255, 255]],
  ['oklch(0.577 0.245 27.325)', [231, 0, 11, 255]],
  ['oklch(0.5 0.12 155)', [11, 119, 67, 255]],
  ['oklch(0.7 0.1 150)', [111, 176, 125, 255]],
  ['oklch(0.97 0.01 90)', [248, 245, 238, 255]],
  ['oklch(70% 0.1 150deg)', [111, 176, 125, 255]],
  ['oklab(0.6 0.1 -0.05)', [168, 102, 156, 255]],
  ['oklab(50% 0.1 0.1)', [161, 66, 3, 255]],
  ['color-mix(in oklab, #ff0000 40%, #0000ff)', [117, 81, 182, 255]],
  ['color-mix(in srgb, #ff0000, #0000ff)', [128, 0, 128, 255]],
  ['color-mix(in oklch, oklch(0.5 0.12 155) 30%, #fff)', [188, 213, 196, 255]],
  ['color-mix(in oklab, oklch(0.6 0.2 30), oklch(0.4 0.1 250) 25%)', [178, 77, 76, 255]],
  ['color-mix(in srgb-linear, #ff0000, #0000ff)', [188, 0, 188, 255]],
  ['rgb(255 0 0 / 50%)', [255, 0, 0, 128]],
  ['rgb(10% 20% 30%)', [26, 51, 77, 255]],
  ['hsl(210 50% 40%)', [51, 102, 153, 255]],
  ['hsl(210deg 50% 40% / 0.3)', [51, 102, 153, 77]],
  ['hsl(0.5turn, 50%, 50%)', [64, 191, 191, 255]],
  // What a bundler's CSS minifier writes for a neutral oklch(): shadcn's tokens in a production build.
  ['lab(2.75381% 0 0)', [10, 10, 10, 255]],
  ['lab(48.496% 0 0)', [115, 115, 115, 255]],
  ['lab(90.952% 0 -.0000119209)', [229, 229, 229, 255]],
  ['lab(100% 0 0)', [255, 255, 255, 255]],
  ['lab(0% 0 0)', [0, 0, 0, 255]],
  ['lab(54.29% 80.8 69.89)', [255, 0, 0, 255]],
  ['lab(29.2345% 39.3825 20.0664)', [125, 35, 41, 255]],
  ['lab(50% 40 -60 / 0.5)', [139, 94, 223, 128], 2],
  ['lch(50% 60 270)', [0, 123, 222, 255], 2],
  ['lch(70% 45 120deg)', [148, 182, 97, 255]],
  ['lch(29.2345% 44.2 27)', [125, 35, 41, 255]],
  ['color-mix(in oklab, lab(40% 30 20) 30%, #ffffff)', [224, 198, 194, 255]],
  ['#abcd', [170, 187, 204, 221]],
  ['#aabbcc80', [170, 187, 204, 128]],
  ['transparent', [0, 0, 0, 0]],
];

test('reads the colours browsers paint, within a channel of rounding', () => {
  for (const [input, [red, green, blue, alpha], tolerance = 1] of references) {
    const rgba = parseTileflowCssColor(input);
    assert.ok(rgba, `${input} should parse`);
    const [r, g, b, a] = rgba;
    for (const [name, got, want] of [
      ['red', r, red],
      ['green', g, green],
      ['blue', b, blue],
    ] as const) {
      assert.ok(
        Math.abs(got - want) <= tolerance,
        `${input}: ${name} ${got.toFixed(2)}, expected ${want} ± ${tolerance}`,
      );
    }
    assert.ok(Math.abs(a * 255 - alpha) <= 1.01, `${input}: alpha ${a}, expected ${alpha / 255}`);
  }
});

/** OKLab lightness of an sRGB colour, to check what gamut mapping keeps. */
function lightnessOf([red, green, blue]: TileflowSrgbaColor): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

test('maps a colour outside sRGB into it and keeps its lightness and hue family', () => {
  const vividGreen = parseTileflowCssColor('oklch(0.9 0.4 150)')!;
  assert.ok(Math.abs(lightnessOf(vividGreen) - 0.9) < 0.03, `${lightnessOf(vividGreen)}`);
  assert.ok(vividGreen[1] > vividGreen[0] && vividGreen[1] > vividGreen[2]);
  const deepViolet = parseTileflowCssColor('oklch(0.3 0.3 300)')!;
  assert.ok(Math.abs(lightnessOf(deepViolet) - 0.3) < 0.03, `${lightnessOf(deepViolet)}`);
  assert.ok(deepViolet[2] > deepViolet[1]);
});

test('reads alpha in oklch, oklab and the slash syntax', () => {
  assert.equal(parseTileflowCssColor('oklch(1 0 0 / 10%)')![3], 0.1);
  assert.equal(parseTileflowCssColor('oklab(0.6 0.1 -0.05 / 0.4)')![3], 0.4);
  assert.equal(parseTileflowCssColor('rgb(1 2 3 / none)')![3], 0);
  assert.equal(
    formatSrgba(parseTileflowCssColor('oklch(1 0 0 / 10%)')!),
    'rgba(255, 255, 255, 0.1)',
  );
});

test('normalizes to hex when opaque and to rgba otherwise', () => {
  assert.equal(normalizeTileflowCssColor('OKLCH(0.145 0 0)'), '#0a0a0a');
  assert.equal(normalizeTileflowCssColor('  #FFF '), '#ffffff');
  assert.equal(normalizeTileflowCssColor('hsl(120, 100%, 50%)'), '#00ff00');
  assert.equal(normalizeTileflowCssColor('rgba(0, 0, 0, 0.25)'), 'rgba(0, 0, 0, 0.25)');
});

test('mixes with percentages that do not add to 100', () => {
  const half = parseTileflowCssColor('color-mix(in srgb, #ff0000 20%, #0000ff 20%)')!;
  assert.deepEqual(
    half.map((entry, index) => (index < 3 ? Math.round(entry) : Number(entry.toFixed(2)))),
    [128, 0, 128, 0.4],
  );
  const premultiplied = parseTileflowCssColor(
    'color-mix(in srgb, rgb(255 0 0 / 0), rgb(0 0 255))',
  )!;
  assert.deepEqual(
    premultiplied.map((entry) => Math.round(entry * 10) / 10),
    [0, 0, 255, 0.5],
  );
});

test('mixes colours nested in colours', () => {
  const nested = parseTileflowCssColor(
    'color-mix(in oklab, color-mix(in srgb, #fff, #000), oklch(0.5 0 0))',
  )!;
  assert.ok(nested[0] > 100 && nested[0] < 130, `${nested[0]}`);
});

test('rejects what it cannot read with an error that names the value', () => {
  for (const value of [
    '',
    'red',
    'white',
    'var(--primary)',
    'rgb(1 2)',
    'oklch(0.5 0.1)',
    'oklch(0.5 0.1 abc)',
    'color-mix(in lab, #fff, #000)',
    'color-mix(in srgb, #fff)',
    'color-mix(in srgb longer hue, #fff, #000)',
    'color-mix(in srgb, #fff 0%, #000 0%)',
    'color(display-p3 1 0 0)',
    '#12',
    '#12345',
    'rgb(1 2 3',
    `color-mix(in srgb, ${'color-mix(in srgb, '.repeat(8)}#fff, #000${', #000)'.repeat(8)}, #000)`,
    'x'.repeat(600),
  ]) {
    assert.equal(parseTileflowCssColor(value), null, value.slice(0, 40));
  }
  assert.throws(
    () => normalizeTileflowCssColor('var(--primary)', 'colour for "surface.land"'),
    /colour for "surface.land" "var\(--primary\)" depends on the page.*getComputedStyle/su,
  );
  assert.throws(() => normalizeTileflowCssColor('papayawhip'), /not a colour Tileflow reads/u);
  assert.throws(() => normalizeTileflowCssColor(12 as never), /must be a string/u);
});

test('keeps every channel in range for any lightness, chroma and hue', () => {
  for (let lightness = 0; lightness <= 1.001; lightness += 0.125) {
    for (let chroma = 0; chroma <= 0.5; chroma += 0.1) {
      for (let angle = 0; angle < 360; angle += 45) {
        const rgba: TileflowSrgbaColor | null = parseTileflowCssColor(
          `oklch(${lightness} ${chroma} ${angle})`,
        );
        assert.ok(rgba);
        assert.ok(rgba.every((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 255.0001));
      }
    }
  }
});
