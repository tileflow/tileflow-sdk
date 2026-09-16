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
