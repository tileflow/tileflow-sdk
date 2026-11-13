import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {render} from 'svelte/server';
import {compileTileflowMap} from './component.js';

const annotation = {
  ariaLabel: 'Madrid',
  coordinate: [-3.7038, 40.4168],
  id: 'madrid',
  kind: 'marker',
  popup: {content: {kind: 'text', text: 'Madrid'}},
};

const poiInteraction = {
  id: 'poi-details',
  popup: {content: {kind: 'view', name: 'poi-card'}},
  target: {domain: 'poi', kind: 'semantic-feature'},
  tooltip: {content: {field: 'name', kind: 'field'}},
};

test('renders interaction configurations as loading on the server and declares snippet props', async () => {
  const declaration = await readFile(new URL('../src/index.d.ts', import.meta.url), 'utf8');
  const compiled = await compileTileflowMap('interactions-runtime');

  try {
    const result = render(compiled.component, {
      props: {
        annotations: [annotation],
        interactions: [poiInteraction],
        source: {map: 'main'},
      },
    });

    assert.match(result.body, /data-tileflow-state="loading"/);
    assert.match(declaration, /marker\?: TileflowMapAnnotationSnippet<TAnnotation>/);
    assert.match(declaration, /popup\?: TileflowMapInteractionSnippet<TAnnotation>/);
    assert.match(declaration, /tooltip\?: TileflowMapInteractionSnippet<TAnnotation>/);
  } finally {
    await compiled.cleanup();
  }
});

test('marks image-mode interaction configurations unsupported without loading MapLibre', async () => {
  const compiled = await compileTileflowMap('interactions-image');

  try {
    const result = render(compiled.component, {
      props: {
        interactions: [poiInteraction],
        imageUrl: 'data:image/png;base64,iVBORw0KGgo=',
        mode: 'image',
        source: {map: 'main'},
      },
    });

    assert.match(result.body, /data-tileflow-state="error"/);
  } finally {
    await compiled.cleanup();
  }
});

test('invalid semantic bindings participate in capture readiness', async () => {
  const compiled = await compileTileflowMap('interactions-invalid-semantic');

  try {
    const result = render(compiled.component, {
      props: {
        interactions: [poiInteraction, poiInteraction],
        source: {map: 'main'},
      },
    });

    assert.match(result.body, /data-tileflow-state="error"/);
  } finally {
    await compiled.cleanup();
  }
});
