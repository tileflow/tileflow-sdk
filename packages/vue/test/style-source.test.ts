import {renderToString} from '@vue/server-renderer';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createSSRApp, h} from 'vue';
import {TileflowMap} from '../src/index.js';
import {validateTileflowMapStyleInputs} from '../src/style-source.js';

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

test('preserves concrete and system theme validation', () => {
  for (const theme of ['', 'Dark', 'dark_mode', 'con']) {
    const validation = validateTileflowMapStyleInputs({source: {map: 'main'}, theme});
    assert.equal(validation.ok, false, theme);
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
    assert.equal(
      validateTileflowMapStyleInputs({source, themeBlend}).ok,
      false,
      JSON.stringify(themeBlend),
    );
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

test('component rendering rejects renderer input before mounting', async () => {
  for (const source of [
    {kind: 'tileflow', map: 'main'},
    {kind: 'maplibre', style: '/style.json'},
  ]) {
    const app = createSSRApp({render: () => h(TileflowMap, {source} as never)});
    app.config.warnHandler = () => undefined;
    await assert.rejects(() => renderToString(app), /Invalid TileflowMap source/u);
  }
});
