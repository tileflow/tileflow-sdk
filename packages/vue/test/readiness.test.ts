import {renderToString} from '@vue/server-renderer';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createSSRApp, h} from 'vue';
import type {TileflowInteractionDiagnostic} from '@tileflow/interactions';
import {TileflowMap} from '../src/index';

test('renders bounded framework-neutral readiness attributes in the loading state', async () => {
  const app = createSSRApp({
    render: () =>
      h(TileflowMap, {
        captureId: 'proof-map',
        imageUrl: 'data:image/png;base64,iVBORw0KGgo=',
        mode: 'image',
        source: {kind: 'tileflow', map: 'main'},
        theme: 'dark',
      }),
  });
  const html = await renderToString(app);

  assert.match(html, /data-tileflow-capture-id="proof-map"/);
  assert.match(html, /data-tileflow-map="main"/);
  assert.match(html, /data-tileflow-theme="dark"/);
  assert.match(html, /data-tileflow-state="loading"/);
});

test('rejects an invalid capture ID before it reaches the DOM', async () => {
  const app = createSSRApp({
    render: () =>
      h(TileflowMap, {
        captureId: 'unsafe id',
        source: {kind: 'tileflow', map: 'main'},
      }),
  });
  app.config.warnHandler = () => undefined;

  await assert.rejects(() => renderToString(app), /letters, numbers, underscores, or hyphens/i);
});

test('diagnoses annotations in image mode without evaluating MapLibre', async () => {
  const diagnostics: TileflowInteractionDiagnostic[] = [];
  const app = createSSRApp({
    render: () =>
      h(TileflowMap, {
        annotations: [
          {
            ariaLabel: 'Madrid',
            coordinate: [-3.7, 40.4],
            id: 'madrid',
            kind: 'marker',
          },
        ],
        imageUrl: 'data:image/png;base64,iVBORw0KGgo=',
        mode: 'image',
        onInteractionDiagnostic: (diagnostic: TileflowInteractionDiagnostic) =>
          diagnostics.push(diagnostic),
        source: {kind: 'tileflow', map: 'main'},
      }),
  });
  const html = await renderToString(app);

  assert.match(html, /data-tileflow-state="error"/u);
  assert.deepEqual(
    diagnostics.map(({code}) => code),
    ['UNSUPPORTED_MODE'],
  );
});

test('diagnoses semantic interactions in image mode without evaluating MapLibre', async () => {
  const diagnostics: TileflowInteractionDiagnostic[] = [];
  const app = createSSRApp({
    render: () =>
      h(TileflowMap, {
        interactions: [
          {
            id: 'poi-details',
            popup: {content: {kind: 'view', name: 'poi-card'}},
            target: {domain: 'poi', kind: 'semantic-feature'},
          },
        ],
        imageUrl: 'data:image/png;base64,iVBORw0KGgo=',
        mode: 'image',
        onInteractionDiagnostic: (diagnostic: TileflowInteractionDiagnostic) =>
          diagnostics.push(diagnostic),
        source: {kind: 'tileflow', map: 'main'},
      }),
  });
  const html = await renderToString(app);

  assert.match(html, /data-tileflow-state="error"/u);
  assert.deepEqual(
    diagnostics.map(({code}) => code),
    ['UNSUPPORTED_MODE'],
  );
});

test('gates custom interaction views on Vue commit and two animation frames', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

  assert.match(source, /syncInteractionRenderTargetReadiness/u);
  assert.match(source, /void nextTick\(\)\.then/u);
  assert.match(source, /const firstFrame = view\.requestAnimationFrame/u);
  assert.match(source, /const secondFrame = view\.requestAnimationFrame/u);
  assert.match(source, /currentMapCaptureState\.value === 'error'/u);
  assert.match(source, /interactionCaptureState\.value === 'error'/u);
});
