import {renderToString} from '@vue/server-renderer';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createSSRApp, h} from 'vue';
import {TileflowMap} from '../src/index.js';
import {validateTileflowMapStyleInputs} from '../src/style-source.js';

const mapStyle = {layers: [], sources: {}, version: 8 as const};

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

test('wires source validation into component rendering', async () => {
  const app = createSSRApp({
    render: () => h(TileflowMap, {source: {kind: 'config'}} as never),
  });
  app.config.warnHandler = () => undefined;

  await assert.rejects(
    () => renderToString(app),
    /Invalid TileflowMap source: source\.kind must be 'tileflow' or 'maplibre'/u,
  );
});
