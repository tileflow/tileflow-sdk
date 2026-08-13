import {renderToString} from '@vue/server-renderer';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createSSRApp, h} from 'vue';
import {TileflowMap} from '../src/index';

test('renders bounded framework-neutral readiness attributes in the loading state', async () => {
  const app = createSSRApp({
    render: () =>
      h(TileflowMap, {
        captureId: 'proof-map',
        imageUrl: 'data:image/png;base64,iVBORw0KGgo=',
        map: 'main',
        mode: 'image',
      }),
  });
  const html = await renderToString(app);

  assert.match(html, /data-tileflow-capture-id="proof-map"/);
  assert.match(html, /data-tileflow-map="main"/);
  assert.match(html, /data-tileflow-state="loading"/);
});

test('rejects an invalid capture ID before it reaches the DOM', async () => {
  const app = createSSRApp({
    render: () => h(TileflowMap, {captureId: 'unsafe id', map: 'main'}),
  });
  app.config.warnHandler = () => undefined;

  await assert.rejects(() => renderToString(app), /letters, numbers, underscores, or hyphens/i);
});
