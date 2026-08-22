import {renderToString} from '@vue/server-renderer';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createSSRApp, h} from 'vue';
import type {MapLibreStyle, TileflowConfig} from '@tileflow/core';
import {TileflowMap} from '../src/index.js';
import {validateTileflowMapStyleInputs} from '../src/style-source.js';

const config = {} as TileflowConfig;
const mapStyle = {layers: [], sources: {}, version: 8} as MapLibreStyle;

test('accepts every supported style-source shape', () => {
  const inputs = [
    {},
    {config},
    {config, themes: {}},
    {map: 'main'},
    {map: 'main', mapStyle},
    {map: 'main', styleBaseUrl: '/generated'},
    {map: 'main', styleUrl: '/styles/main.json'},
    {mapStyle},
    {styleUrl: '/styles/main.json'},
  ];

  for (const input of inputs) {
    assert.deepEqual(validateTileflowMapStyleInputs(input), {ok: true});
  }
});

test('rejects ambiguous or ineffective style-source shapes', () => {
  const cases = [
    [{config, map: 'main'}, /config.*map/u],
    [{config, mapStyle}, /config.*mapStyle/u],
    [{mapStyle, styleUrl: '/styles/main.json'}, /only one/u],
    [{mapStyle, styleBaseUrl: '/generated'}, /only one/u],
    [{styleBaseUrl: '/generated'}, /requires `map`/u],
    [{themes: {}}, /requires `config`/u],
  ] as const;

  for (const [input, message] of cases) {
    const result = validateTileflowMapStyleInputs(input);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.error, message);
  }
});

test('wires style-source validation into component rendering', async () => {
  const app = createSSRApp({
    render: () => h(TileflowMap, {config, map: 'main'} as never),
  });
  app.config.warnHandler = () => undefined;

  await assert.rejects(
    () => renderToString(app),
    /Invalid TileflowMap style inputs: `config` cannot be combined with `map`/u,
  );
});
