import assert from 'node:assert/strict';
import test from 'node:test';
import {render} from 'svelte/server';
import {compileTileflowMap} from './component.js';

test('compiles and renders the bounded framework-neutral loading contract', async () => {
  const compiled = await compileTileflowMap('readiness');

  try {
    const result = render(compiled.component, {
      props: {
        captureId: 'proof-map',
        imageUrl: 'data:image/png;base64,iVBORw0KGgo=',
        mode: 'image',
        source: {map: 'main'},
        theme: 'dark',
      },
    });

    assert.match(result.body, /data-tileflow-capture-id="proof-map"/);
    assert.match(result.body, /data-tileflow-map="main"/);
    assert.match(result.body, /data-tileflow-theme="dark"/);
    assert.match(result.body, /data-tileflow-state="loading"/);
  } finally {
    await compiled.cleanup();
  }
});
