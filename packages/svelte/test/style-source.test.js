import assert from 'node:assert/strict';
import test from 'node:test';
import {render} from 'svelte/server';
import {validateTileflowMapStyleInputs} from '../src/style-source.js';
import {compileTileflowMap} from './component.js';

const config = {};
const mapStyle = {layers: [], sources: {}, version: 8};

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
  ];

  for (const [input, message] of cases) {
    const result = validateTileflowMapStyleInputs(input);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.error, message);
  }
});

test('wires style-source validation into component rendering', async () => {
  const compiled = await compileTileflowMap('style-source');

  try {
    assert.throws(
      () => render(compiled.component, {props: {config, map: 'main'}}).body,
      /Invalid TileflowMap style inputs: `config` cannot be combined with `map`/u,
    );
  } finally {
    await compiled.cleanup();
  }
});
