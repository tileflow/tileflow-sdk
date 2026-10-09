import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTileflowMapStyleInputs,
  validateTileflowMapStyleInputs,
} from '../src/map-style-inputs';

test('accepts Tileflow map and manifest fields without a renderer selector', () => {
  for (const source of [{map: 'madrid'}, {manifestUrl: '/custom/manifest.json', map: 'madrid'}]) {
    for (const theme of [undefined, 'day', 'system']) {
      assert.deepEqual(validateTileflowMapStyleInputs({source, theme}), {ok: true});
    }
  }
});

test('rejects missing, malformed and obsolete renderer sources for JavaScript callers', () => {
  for (const source of [
    undefined,
    {},
    {kind: 'tileflow', map: 'madrid'},
    {kind: 'maplibre', style: '/style.json'},
    {map: 'madrid', style: '/style.json'},
    {map: 'madrid', kind: undefined},
    {map: 'con'},
    {map: 'madrid', manifestUrl: ''},
  ]) {
    assert.equal(validateTileflowMapStyleInputs({source}).ok, false);
    assert.throws(() => assertTileflowMapStyleInputs({source}), TypeError);
  }
});

test('preserves concrete and system theme validation', () => {
  for (const theme of ['', 'Dark', 'dark_mode', 'con']) {
    const validation = validateTileflowMapStyleInputs({source: {map: 'madrid'}, theme});
    assert.equal(validation.ok, false, theme);
  }
});

test('accepts theme blends of two to eight concrete themes with a position inside them', () => {
  const source = {map: 'madrid'};
  for (const themeBlend of [
    {position: 0, themes: ['night', 'day']},
    {position: 1.25, themes: ['night', 'sunset', 'day']},
  ]) {
    assert.deepEqual(validateTileflowMapStyleInputs({source, themeBlend}), {ok: true});
  }
  for (const themeBlend of [
    {position: 0, themes: ['day']},
    {position: 2, themes: ['night', 'day']},
    {position: -0.1, themes: ['night', 'day']},
    {position: Number.NaN, themes: ['night', 'day']},
    {position: 0, themes: ['night', 'system']},
    {position: 0, themes: ['night', 'Day']},
    {themes: ['night', 'day']},
    {position: 0, themes: Array.from({length: 9}, (_, index) => `theme-${index}`)},
  ]) {
    assert.equal(
      validateTileflowMapStyleInputs({source, themeBlend}).ok,
      false,
      JSON.stringify(themeBlend),
    );
  }
});

test('accepts theme transitions of zero to five seconds', () => {
  const source = {map: 'madrid'};
  for (const themeTransition of [{}, {duration: 0}, {duration: 450}, {duration: 5000}]) {
    assert.deepEqual(validateTileflowMapStyleInputs({source, themeTransition}), {ok: true});
  }
  for (const themeTransition of [450, {duration: -1}, {duration: 5001}, {duration: '450'}]) {
    assert.equal(validateTileflowMapStyleInputs({source, themeTransition}).ok, false);
  }
});
