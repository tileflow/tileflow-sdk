import assert from 'node:assert/strict';
import test from 'node:test';
import {
  imageModeAnnotationDiagnostic,
  imageModeMapInteractionDiagnostic,
  prepareTileflowReactAnnotations,
} from '../src/annotations';

test('normalizes legacy markers without losing their title or color', () => {
  const prepared = prepareTileflowReactAnnotations(undefined, [
    {
      color: '#123456',
      coordinates: [-3.7, 40.4],
      id: 'property-42',
      label: 'Apartment in Madrid',
    },
  ]);

  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.annotations, [
    {
      ariaLabel: 'Apartment in Madrid',
      coordinate: [-3.7, 40.4],
      id: 'property-42',
      kind: 'marker',
      marker: {color: '#123456'},
    },
  ]);
  assert.equal(prepared.titles.get('property-42'), 'Apartment in Madrid');
});

test('keeps the exact legacy empty title while supplying a usable aria label', () => {
  const prepared = prepareTileflowReactAnnotations(undefined, [
    {coordinates: [0, 0], id: 'origin', label: ''},
  ]);

  assert.equal(prepared.ok, true);
  assert.equal(prepared.annotations[0]?.ariaLabel, 'origin');
  assert.equal(prepared.titles.get('origin'), '');
});

test('rejects mixing annotations with legacy markers without mutating annotations', () => {
  const annotation = {
    ariaLabel: 'Madrid',
    coordinate: [-3.7, 40.4] as const,
    id: 'madrid',
    kind: 'marker' as const,
  };
  const prepared = prepareTileflowReactAnnotations(
    [annotation],
    [{coordinates: [0, 0], id: 'legacy'}],
  );

  assert.equal(prepared.ok, false);
  assert.deepEqual(prepared.annotations, []);
  assert.equal(prepared.diagnostics[0]?.code, 'INVALID_DOCUMENT');
});

test('validates replacements atomically while preserving valid caller identities', () => {
  const annotation = {
    ariaLabel: 'Madrid',
    coordinate: [-3.7, 40.4] as const,
    data: {price: 320_000},
    id: 'madrid',
    kind: 'marker' as const,
  };
  const valid = prepareTileflowReactAnnotations([annotation], undefined);
  const invalid = prepareTileflowReactAnnotations(
    [{...annotation, coordinate: [999, 40.4] as const}],
    undefined,
  );

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
