import assert from 'node:assert/strict';
import test from 'node:test';
import {render} from 'svelte/server';
import {validateTileflowMapStyleInputs} from '../src/style-source.js';
import {compileTileflowMap} from './component.js';

const mapStyle = {layers: [], sources: {}, version: 8};

test('accepts both supported discriminated sources', () => {
  for (const source of [
    {kind: 'tileflow', map: 'main'},
    {kind: 'tileflow', manifestUrl: '/custom/manifest.json', map: 'main'},
    {kind: 'maplibre', style: mapStyle},
    {kind: 'maplibre', style: '/styles/main.json'},
  ]) {
    assert.deepEqual(validateTileflowMapStyleInputs({source}), {ok: true});
  }
});

test('rejects missing and malformed sources', () => {
  for (const source of [undefined, {}, {kind: 'tileflow'}, {kind: 'maplibre'}]) {
    assert.equal(validateTileflowMapStyleInputs({source}).ok, false);
  }
});

test('accepts themes only for logical Tileflow sources', () => {
  assert.deepEqual(
    validateTileflowMapStyleInputs({source: {kind: 'tileflow', map: 'main'}, theme: 'system'}),
    {ok: true},
  );
  assert.equal(
    validateTileflowMapStyleInputs({source: {kind: 'tileflow', map: 'main'}, theme: 'con'}).ok,
    false,
  );
  assert.equal(
    validateTileflowMapStyleInputs({source: {kind: 'maplibre', style: mapStyle}, theme: 'dark'}).ok,
    false,
  );
});

test('wires source validation into component rendering', async () => {
  const compiled = await compileTileflowMap('style-source');

  try {
    assert.throws(
      () => render(compiled.component, {props: {source: {kind: 'config'}}}).body,
      /Invalid TileflowMap source: source\.kind must be 'tileflow' or 'maplibre'/u,
    );
  } finally {
    await compiled.cleanup();
  }
});
