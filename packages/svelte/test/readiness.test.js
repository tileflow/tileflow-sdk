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
        map: 'main',
        mode: 'image',
      },
    });

    assert.match(result.body, /data-tileflow-capture-id="proof-map"/);
    assert.match(result.body, /data-tileflow-map="main"/);
    assert.match(result.body, /data-tileflow-state="loading"/);
    assert.match(compiled.code, /captureState = 'idle'/);
    assert.match(compiled.code, /captureState = 'error'/);
  } finally {
    await compiled.cleanup();
  }
});
