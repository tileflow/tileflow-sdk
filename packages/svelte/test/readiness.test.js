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
        source: {kind: 'tileflow', map: 'main'},
      },
    });

    assert.match(result.body, /data-tileflow-capture-id="proof-map"/);
    assert.match(result.body, /data-tileflow-map="main"/);
    assert.match(result.body, /data-tileflow-state="loading"/);
    assert.match(compiled.code, /mapCaptureState = 'idle'/);
    assert.match(compiled.code, /mapCaptureState = 'error'/);
    assert.match(
      compiled.code,
      /hasInteractionErrors = interactionDiagnostics\.some\(\(\{ level \}\) => level === 'error'\)/,
    );
    assert.match(
      compiled.code,
      /effectiveInteractionCaptureState = hasInteractionErrors \? 'error' : interactionCaptureState/,
    );
    assert.match(
      compiled.code,
      /await nextAnimationFrame\(\);[\s\S]*await nextAnimationFrame\(\);/,
    );
    assert.match(compiled.code, /registerTileflowWorldRequestBridge/);
    assert.match(compiled.code, /attachTileflowFairUseNotice/);
  } finally {
    await compiled.cleanup();
  }
});
