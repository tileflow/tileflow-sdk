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

test('keeps the shared interaction runtime behind the browser lifecycle boundary', async () => {
  const source = await readFile(new URL('../src/TileflowMap.svelte', import.meta.url), 'utf8');
  const declaration = await readFile(new URL('../src/index.d.ts', import.meta.url), 'utf8');
  const compiled = await compileTileflowMap('interactions-runtime');

  try {
    const result = render(compiled.component, {
      props: {
        annotations: [annotation],
        interactions: [poiInteraction],
        source: {kind: 'tileflow', map: 'main'},
      },
    });

    assert.match(result.body, /data-tileflow-state="loading"/);
    assert.match(source, /createTileflowMapLibreDomRuntime/);
    assert.match(source, /createTileflowMapLibreSemanticDomRuntime/);
    assert.match(source, /createTileflowMapLibreInteractionCoordinator/);
    assert.match(source, /normalizeTileflowLegacyMarkers/);
    assert.match(source, /validateTileflowInteractionBindings/);
    assert.match(source, /subscribeDiagnostics/);
    assert.match(source, /subscribeRenderTargets/);
    assert.match(source, /setCustomRenderers/);
    assert.match(source, /createTileflowMapLibrePoiMap/);
    assert.match(source, /use:portal=\{renderTarget\.container\}/);
    assert.match(source, /\{@render marker\(/);
    assert.match(source, /\{@render popup\(createSemanticViewContext\(renderTarget\)\)\}/);
    assert.match(source, /interactionCoordinator\.attach\(\s*'annotation'/);
    assert.match(source, /interactionCoordinator\.attach\(\s*'semantic'/);
    assert.equal(
      source.match(/onInteractionStateChange: interactionCoordinator\.requestInteractionState/g)
        ?.length,
      2,
    );
    assert.doesNotMatch(source, /import \* as maplibregl/);
    assert.match(declaration, /marker\?: TileflowMapMarkerSnippet<TAnnotation>/);
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
        source: {kind: 'tileflow', map: 'main'},
      },
    });

    assert.match(result.body, /data-tileflow-state="error"/);
    assert.match(compiled.code, /UNSUPPORTED_MODE/);
  } finally {
    await compiled.cleanup();
  }
});

test('invalid mutually exclusive interaction props participate in capture readiness', async () => {
  const compiled = await compileTileflowMap('interactions-invalid');

  try {
    const result = render(compiled.component, {
      props: {
        annotations: [annotation],
        markers: [{coordinates: [-3.7038, 40.4168], id: 'legacy'}],
        source: {kind: 'tileflow', map: 'main'},
      },
    });

    assert.match(result.body, /data-tileflow-state="error"/);
    assert.match(compiled.code, /annotations and legacy markers props are mutually exclusive/);
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
        source: {kind: 'tileflow', map: 'main'},
      },
    });

    assert.match(result.body, /data-tileflow-state="error"/);
    assert.match(compiled.code, /validateTileflowInteractionBindings/);
  } finally {
    await compiled.cleanup();
  }
});
