import assert from 'node:assert/strict';
import test from 'node:test';
import {
  imageModeAnnotationDiagnostic,
  imageModeMapInteractionDiagnostic,
  prepareTileflowAnnotations,
  prepareTileflowInteractionBindings,
  prepareTileflowInteractionState,
} from '../src/inputs';

test('validates replacements atomically while preserving valid caller identities', () => {
  const annotation = {
    ariaLabel: 'Madrid',
    coordinate: [-3.7, 40.4] as const,
    data: {price: 320_000},
    id: 'madrid',
    kind: 'marker' as const,
  };
  const valid = prepareTileflowAnnotations([annotation]);
  const invalid = prepareTileflowAnnotations([{...annotation, coordinate: [999, 40.4] as const}]);

  assert.equal(valid.ok, true);
  assert.equal(valid.annotations[0], annotation);
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.annotations, []);
  assert.equal(invalid.diagnostics[0]?.code, 'INVALID_ANNOTATION');
});

test('reports image-mode annotations as an explicit error', () => {
  assert.equal(imageModeAnnotationDiagnostic(0), undefined);
  assert.deepEqual(imageModeAnnotationDiagnostic(1), {
    code: 'UNSUPPORTED_MODE',
    level: 'error',
    message:
      'Tileflow annotations require mode="interactive"; image mode cannot render interactive overlays.',
    path: '',
  });
});

test('reports semantic bindings in image mode, including mixed interactive input', () => {
  assert.deepEqual(imageModeMapInteractionDiagnostic(0, 1), {
    code: 'UNSUPPORTED_MODE',
    level: 'error',
    message:
      'Tileflow interactions require mode="interactive"; image mode cannot render interactive overlays.',
    path: '',
  });
  assert.match(
    imageModeMapInteractionDiagnostic(1, 1)?.message ?? '',
    /annotations and interactions/u,
  );
  assert.match(
    imageModeMapInteractionDiagnostic(0, 0, true)?.message ?? '',
    /state, callbacks, and renderers/u,
  );
});

test('validates and normalizes semantic POI bindings before runtime reconciliation', () => {
  const prepared = prepareTileflowInteractionBindings([
    {
      id: 'poi-card',
      popup: {content: {kind: 'view', name: 'poi-card'}},
      target: {domain: 'poi', kind: 'semantic-feature'},
      tooltip: {content: {field: 'name', kind: 'field'}},
    },
  ]);

  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.diagnostics, []);
  if (prepared.ok) {
    assert.equal(prepared.bindings[0]?.target.kind, 'semantic-feature');
  }
});

test('fails validation atomically instead of exposing partial bindings', () => {
  const prepared = prepareTileflowInteractionBindings([
    {
      id: 'duplicate',
      popup: {content: {kind: 'text', text: 'First'}},
      target: {domain: 'poi', kind: 'semantic-feature'},
    },
    {
      id: 'duplicate',
      popup: {content: {kind: 'text', text: 'Second'}},
      target: {domain: 'poi', kind: 'semantic-feature'},
    },
  ]);

  assert.equal(prepared.ok, false);
  assert.equal('bindings' in prepared, false);
  assert.equal(prepared.diagnostics[0]?.code, 'INVALID_DOCUMENT');
});

test('normalizes valid controlled and uncontrolled interaction state', () => {
  const controlled = prepareTileflowInteractionState({popup: null}, undefined);
  const uncontrolled = prepareTileflowInteractionState(undefined, {popup: null});

  assert.equal(controlled.ok, true);
  assert.equal(controlled.controlled, true);
  assert.equal(uncontrolled.ok, true);
  assert.equal(uncontrolled.controlled, false);
});

test('rejects combined state ownership and malformed state without forwarding it', () => {
  const combined = prepareTileflowInteractionState({popup: null}, {popup: null});
  const malformed = prepareTileflowInteractionState(
    {popup: {id: '', kind: 'annotation'}},
    undefined,
  );

  assert.equal(combined.ok, false);
  assert.equal(combined.diagnostics[0]?.code, 'INVALID_DOCUMENT');
  assert.deepEqual(combined.state, {popup: null});
  assert.equal(malformed.ok, false);
  assert.equal(malformed.diagnostics[0]?.path, '/interactionState/popup/id');
  assert.deepEqual(malformed.state, {popup: null});
});

test('rejects switching between controlled and uncontrolled ownership', () => {
  const switchedToControlled = prepareTileflowInteractionState({popup: null}, undefined, false);
  const switchedToUncontrolled = prepareTileflowInteractionState(undefined, {popup: null}, true);

  assert.equal(switchedToControlled.ok, false);
  assert.match(switchedToControlled.diagnostics[0]?.message ?? '', /cannot switch/u);
  assert.equal(switchedToUncontrolled.ok, false);
  assert.match(switchedToUncontrolled.diagnostics[0]?.message ?? '', /cannot switch/u);
});
