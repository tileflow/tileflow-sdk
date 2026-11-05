import assert from 'node:assert/strict';
import test from 'node:test';
import {render} from 'svelte/server';
import {compileTileflowMap} from './component.js';

test('the compiled Svelte component exports the reference API without loading a renderer in image mode', async () => {
  const compiled = await compileTileflowMap('reference');
  const methods = {};
  const props = {source: {map: 'main'}, mode: 'image', imageUrl: 'data:image/png;base64,AA=='};
  for (const name of ['addSource', 'removeSource', 'addLayer', 'moveLayer', 'removeLayer']) {
    Object.defineProperty(props, name, {
      get: () => undefined,
      set: (value) => {
        methods[name] = value;
      },
    });
  }
  try {
    const rendered = render(compiled.component, {props});
    void rendered.body;
    for (const method of Object.values(methods)) assert.equal(typeof method, 'function');
    assert.equal(Object.keys(methods).length, 5);
    await assert.rejects(methods.addSource('points', {type: 'geojson'}), (error) => {
      assert.equal(error.code, 'invalidRequest');
      assert.equal(error.context.reason, 'unsupportedMode');
      return true;
    });
  } finally {
    await compiled.cleanup();
  }
});
