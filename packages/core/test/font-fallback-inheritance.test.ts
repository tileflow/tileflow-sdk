import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowWorld} from '../src/data';
import {defineMap, resolveMap} from '../src/maps';
import {officialFontFallback} from '../src/official-fonts';
import {parseResolvedTileflowMap} from '../src/resolved-map-schema';
import {testLightTheme} from './map-fixture';

const glyphs = {
  kind: 'url' as const,
  url: 'https://api.tileflow.dev/base/fe873949787f8f1e2ff72853d13c1e6e3c1de83474e4c1de60dae6ac33fe3081/glyphs/{fontstack}/{range}.pbf',
  fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
};
const fontFallback = officialFontFallback;
const base = defineMap({
  id: 'base',
  version: 1,
  data: tileflowWorld(),
  glyphs,
  themes: {light: testLightTheme},
  defaultTheme: 'light',
});
const child = (parent: typeof base, fields: Record<string, unknown>) =>
  defineMap({id: 'child', version: 1, extends: parent, ...fields} as never);

test('fonts alone retain the existing replacement of inherited glyphs', () => {
  const map = resolveMap(child(base, {fonts: ['./fonts']}));
  assert.deepEqual(map.fonts, ['./fonts']);
  assert.equal(map.glyphs, undefined);
  assert.equal('fontFallback' in map, false);
});

test('explicit fallback is inherited with its fonts and can be removed', () => {
  const own = child(base, {fonts: ['./fonts'], fontFallback});
  const inherited = parseResolvedTileflowMap(resolveMap(child(own, {})));
  assert.deepEqual(inherited.fontFallback, fontFallback);
  const removed = resolveMap(child(own, {fontFallback: false}));
  assert.equal('fontFallback' in removed, false);
  assert.deepEqual(removed.fonts, ['./fonts']);
});

test('replacing either text provider clears an inherited fallback unless explicitly retained', () => {
  const own = child(base, {fonts: ['./fonts'], fontFallback});
  for (const fields of [{fonts: ['./replacement']}, {glyphs}]) {
    assert.equal('fontFallback' in resolveMap(child(own, fields)), false);
  }
  for (const fields of [
    {fonts: ['./replacement'], fontFallback},
    {fontFallback, fonts: ['./replacement']},
  ]) {
    assert.deepEqual(resolveMap(child(own, fields)).fontFallback, fontFallback);
  }
});

test('fallback requires local fonts and a declared official fallback stack', () => {
  for (const fields of [
    {fontFallback},
    {fonts: [], fontFallback},
    {fonts: ['./fonts'], fontFallback: {...fontFallback, fontStack: ['Missing']}},
    {
      fonts: ['./fonts'],
      fontFallback: {
        ...fontFallback,
        assetSetSha256: 'a'.repeat(64),
      },
    },
  ]) {
    assert.throws(() => parseResolvedTileflowMap(resolveMap(child(base, fields))));
  }
});
