import assert from 'node:assert/strict';
import test from 'node:test';
import {render} from 'svelte/server';
import {validateTileflowMapStyleInputs} from '../src/style-source.js';
import {compileTileflowMap} from './component.js';

test('accepts Tileflow map and manifest fields without a renderer selector', () => {
  for (const source of [{map: 'main'}, {manifestUrl: '/custom/manifest.json', map: 'main'}]) {
    for (const theme of [undefined, 'day', 'system']) {
      assert.deepEqual(validateTileflowMapStyleInputs({source, theme}), {ok: true});
    }
  }
});

test('rejects missing, malformed and obsolete renderer sources', () => {
  for (const source of [
    undefined,
    {},
    {kind: 'tileflow', map: 'main'},
    {kind: 'maplibre', style: '/style.json'},
    {map: 'main', style: '/style.json'},
    {map: 'main', kind: undefined},
    {map: 'main', manifestUrl: ''},
  ]) {
    assert.equal(validateTileflowMapStyleInputs({source}).ok, false);
  }
});

test('accepts theme blends of two to eight concrete themes with a position inside them', () => {
  const source = {map: 'main'};
  assert.deepEqual(
    validateTileflowMapStyleInputs({
      source,
      themeBlend: {position: 1.25, themes: ['night', 'sunset', 'day']},
    }),
    {ok: true},
  );
  for (const themeBlend of [
    {position: 0, themes: ['day']},
    {position: 2, themes: ['night', 'day']},
    {position: 0, themes: ['night', 'system']},
    {themes: ['night', 'day']},
  ]) {
    assert.equal(validateTileflowMapStyleInputs({source, themeBlend}).ok, false);
  }
});

test('accepts theme transitions of zero to five seconds', () => {
  const source = {map: 'main'};
  assert.deepEqual(validateTileflowMapStyleInputs({source, themeTransition: {duration: 450}}), {
    ok: true,
  });
  for (const themeTransition of [450, {duration: -1}, {duration: 5001}]) {
    assert.equal(validateTileflowMapStyleInputs({source, themeTransition}).ok, false);
  }
});

test('preserves concrete and system theme validation', () => {
  for (const theme of ['', 'Dark', 'dark_mode', 'con']) {
    const validation = validateTileflowMapStyleInputs({source: {map: 'main'}, theme});
    assert.equal(validation.ok, false, theme);
  }
});

test('component rendering rejects renderer input before mounting', async () => {
  const compiled = await compileTileflowMap('style-source');
  try {
    for (const source of [
      {kind: 'tileflow', map: 'main'},
      {kind: 'maplibre', style: '/style.json'},
    ]) {
      assert.throws(
        () => render(compiled.component, {props: {source}}).body,
        /Invalid TileflowMap source/u,
      );
    }
  } finally {
    await compiled.cleanup();
  }
});
