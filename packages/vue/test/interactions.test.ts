import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  resolveTileflowVueAnnotations,
  resolveTileflowVueInteractionBindings,
  validateTileflowVueInteractionState,
} from '../src/interactions.js';

test('returns the original typed annotation identities after JSON-safe validation', () => {
  const annotation = {
    ariaLabel: 'Property',
    coordinate: [-3.7, 40.4],
    data: {price: 320_000},
    id: 'property-42',
    kind: 'marker',
    popup: {content: {kind: 'view', name: 'property-card'}},
  } as const;
  const result = resolveTileflowVueAnnotations({annotations: [annotation]});

  assert.equal(result.ok, true);
  assert.equal(result.annotations[0], annotation);
  assert.equal(result.annotations[0]?.data, annotation.data);
});

test('rejects mixed or malformed controlled interaction state', () => {
  assert.equal(
    validateTileflowVueInteractionState({popup: null}, {popup: null})[0]?.code,
    'INVALID_DOCUMENT',
  );
  assert.equal(
    validateTileflowVueInteractionState({popup: {id: 'property-42', kind: 'annotation'}}, undefined)
      .length,
    0,
  );
  assert.equal(
    validateTileflowVueInteractionState({popup: {kind: 'annotation'} as never}, undefined)[0]?.path,
    '/interactionState/popup/id',
  );
});

test('validates semantic interaction bindings without replacing caller identities', () => {
  const binding = {
    id: 'poi-details',
    popup: {content: {kind: 'view', name: 'poi-card'}},
    target: {categories: ['food-drink'], domain: 'poi', kind: 'semantic-feature'},
    tooltip: {content: {fallback: 'Point of interest', field: 'name', kind: 'field'}},
  } as const;
  const result = resolveTileflowVueInteractionBindings([binding]);

  assert.equal(result.ok, true);
  assert.equal(result.bindings[0], binding);

  const duplicate = resolveTileflowVueInteractionBindings([
    binding,
    {
      ...binding,
      popup: {content: {...binding.popup.content}},
      target: {...binding.target, categories: [...binding.target.categories]},
      tooltip: {content: {...binding.tooltip.content}},
    },
  ]);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.diagnostics[0]?.code, 'INVALID_DOCUMENT');
  assert.equal(duplicate.diagnostics[0]?.path, '/1/id');
});

test('bridges annotation and semantic scoped slots through stable MapLibre-DOM targets', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

  assert.match(source, /createTileflowMapLibreDomRuntime/u);
  assert.match(source, /createTileflowMapLibreSemanticDomRuntime/u);
  assert.match(source, /createTileflowMapLibreInteractionCoordinator/u);
  assert.match(source, /createTileflowVuePoiMap\(map\)/u);
  assert.match(source, /annotationRuntime\.reconcile/u);
  assert.match(source, /semanticRuntime\.reconcile/u);
  assert.match(source, /setCustomRenderers/u);
  assert.match(source, /subscribeDiagnostics/u);
  assert.match(source, /getDiagnostics/u);
  assert.match(source, /h\(\s*Teleport/u);
  assert.match(source, /\(\) => props\.annotations/u);
  assert.match(source, /\(\) => props\.interactions/u);
  assert.match(source, /semantic:\$\{target\.key\}/u);
  assert.match(source, /element\.title = annotation\.ariaLabel/u);
});
