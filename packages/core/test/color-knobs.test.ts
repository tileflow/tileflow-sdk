import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTileflowColorKnobName,
  resolveTileflowColorKnobs,
  type TileflowColorKnobs,
  validateTileflowColorKnobs,
} from '../src/color-knobs';
import {parseTileflowCssColor, srgbaToOklab} from '../src/css-color';

const base = {
  'roads.casing': '#8DB0BC',
  'roads.major': '#A4BCC4',
  'roads.minor': '#B9CED5',
  'surface.land': '#F8F7F3',
  'surface.park': '#A5E9B9',
  'surface.tint': '#C4C4C0',
  'surface.water': 'rgba(145, 223, 247, 0.5)',
};

const knobs: TileflowColorKnobs = {
  land: {tokens: {'surface.land': 'replace'}},
  park: {tokens: {'surface.park': {amount: 0.5, op: 'mix'}}},
  roads: {
    reference: 'roads.minor',
    tokens: {
      'roads.casing': {lightness: -0.05, op: 'shift'},
      'roads.major': 'shift',
      'roads.minor': 'shift',
    },
  },
  tintedLand: {tokens: {'surface.tint': {chroma: 0.5, op: 'tint'}}},
  water: {tokens: {'surface.water': 'replace'}},
};
const lab = (color: string) => srgbaToOklab(parseTileflowCssColor(color)!);

test('replace gives the token the colour and keeps an authored see-through alpha', () => {
  const resolved = resolveTileflowColorKnobs({water: knobs.water!}, {water: '#2563eb'}, base);
  const rgba = parseTileflowCssColor(resolved['surface.water']!)!;
  assert.deepEqual(rgba.slice(0, 3).map(Math.round), [37, 99, 235]);
  assert.equal(rgba[3], 0.5);
  assert.deepEqual(Object.keys(resolveTileflowColorKnobs(knobs, {land: '#ffffff'}, base)), [
    'surface.land',
  ]);
});

test('shift moves every token as far as the reference moves, and keeps their order', () => {
  const resolved = resolveTileflowColorKnobs(knobs, {roads: 'oklch(0.7 0.02 80)'}, base);
  const [minorL, minorA, minorB] = lab(resolved['roads.minor']!);
  const [targetL, targetA, targetB] = lab('oklch(0.7 0.02 80)');
  // The reference lands on the colour (within sRGB rounding).
  assert.ok(Math.abs(minorL - targetL) < 0.01 && Math.abs(minorA - targetA) < 0.01);
  assert.ok(Math.abs(minorB - targetB) < 0.01);
  const major = lab(resolved['roads.major']!);
  const casing = lab(resolved['roads.casing']!);
  assert.ok(major[0] < minorL, 'major stays darker than minor');
  assert.ok(casing[0] < major[0], 'the casing stays darker than the road');
  // The lightness option darkens the casing further than a plain shift would.
  const plain = resolveTileflowColorKnobs(
    {roads: {...knobs.roads!, tokens: {...knobs.roads!.tokens, 'roads.casing': 'shift'}}},
    {roads: 'oklch(0.7 0.02 80)'},
    base,
  );
  assert.ok(casing[0] < lab(plain['roads.casing']!)[0] - 0.03);
});

test('mix moves part of the way and tint keeps lightness while adopting the hue', () => {
  const mixed = lab(resolveTileflowColorKnobs(knobs, {park: '#000000'}, base)['surface.park']!);
  assert.ok(Math.abs(mixed[0] - lab(base['surface.park']!)[0] / 2) < 0.02);
  const tinted = lab(
    resolveTileflowColorKnobs(knobs, {tintedLand: '#d4562f'}, base)['surface.tint']!,
  );
  assert.ok(Math.abs(tinted[0] - lab(base['surface.tint']!)[0]) < 0.01);
  const chromaOf = ([, a, b]: number[]) => Math.hypot(a!, b!);
  assert.ok(chromaOf(tinted) > chromaOf(lab(base['surface.tint']!)));
  assert.ok(tinted[1] > 0, 'the tint is warm: red-orange has positive a');
  // A grey colour tints towards grey and keeps the token's own hue.
  const grey = lab(
    resolveTileflowColorKnobs(knobs, {tintedLand: '#808080'}, base)['surface.tint']!,
  );
  assert.ok(chromaOf(grey) <= chromaOf(lab(base['surface.tint']!)));
});

test('an unknown knob lists the knobs the map has, and a token-looking key is not a knob', () => {
  assert.throws(
    () => resolveTileflowColorKnobs(knobs, {watr: '#2563eb'}, base),
    /Unknown colour knob "watr"\. This map has land, park, roads, tintedLand, water/u,
  );
  assert.throws(
    () => resolveTileflowColorKnobs(undefined, {water: '#2563eb'}, base),
    /declares no colour knobs/u,
  );
  assert.throws(
    () => resolveTileflowColorKnobs(knobs, {water: 'var(--x)'}, base),
    /colour for knob "water"/u,
  );
  assert.equal(isTileflowColorKnobName('water'), true);
  assert.equal(isTileflowColorKnobName('surface.water'), false);
});

test('a knob whose token has no colour in the theme says which', () => {
  assert.throws(
    () => resolveTileflowColorKnobs(knobs, {water: '#2563eb'}, {}),
    /Colour knob "water" governs "surface\.water", which has no colour in this theme/u,
  );
});

test('declared knobs are checked and every problem names its knob and token', () => {
  const tokens = new Set(Object.keys(base));
  validateTileflowColorKnobs(knobs, tokens);
  const bad = (value: unknown, pattern: RegExp, names: ReadonlySet<string> | undefined = tokens) =>
    assert.throws(() => validateTileflowColorKnobs(value, names), pattern);
  bad([], /must be an object of knobs/u);
  bad({'water.deep': {tokens: {'surface.water': 'replace'}}}, /no dot/u);
  bad({Water: {tokens: {'surface.water': 'replace'}}}, /starts with a lowercase letter/u);
  bad({water: {tokens: {}}}, /between 1 and 512 tokens/u);
  bad(
    {water: {tokens: {'surface.nope': 'replace'}}},
    /governs "surface\.nope", which is not a colour token/u,
  );
  bad({water: {tokens: {'surface.water': 'fade'}}}, /replace, shift, mix, tint/u);
  bad(
    {water: {tokens: {'surface.water': {amount: 2, op: 'mix'}}}},
    /amount must be a number from 0 to 1/u,
  );
  bad({water: {tokens: {'surface.water': {op: 'mix', speed: 1}}}}, /no "speed" option/u);
  bad({water: {tokens: {'surface.water': 'shift'}}}, /needs a reference token/u);
  bad(
    {water: {reference: 'surface.land', tokens: {'surface.water': 'shift'}}},
    /reference must be one of the knob's own tokens/u,
  );
  bad(
    {a: {tokens: {'surface.water': 'replace'}}, b: {tokens: {'surface.water': 'replace'}}},
    /"surface\.water" is governed by both "a" and "b"/u,
  );
  // Without the tokens of a theme, only the shape is checked.
  validateTileflowColorKnobs({water: {tokens: {'any.token': 'replace'}}}, undefined);
});
