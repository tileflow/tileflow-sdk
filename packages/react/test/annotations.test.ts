import assert from 'node:assert/strict';
import test from 'node:test';
import {
  imageModeAnnotationDiagnostic,
  imageModeMapInteractionDiagnostic,
  prepareTileflowReactAnnotations,
} from '../src/annotations';

test('validates replacements atomically while preserving valid caller identities', () => {
  const annotation = {
    ariaLabel: 'Madrid',
    coordinate: [-3.7, 40.4] as const,
    data: {price: 320_000},
    id: 'madrid',
    kind: 'marker' as const,
  };
  const valid = prepareTileflowReactAnnotations([annotation]);
  const invalid = prepareTileflowReactAnnotations([
    {...annotation, coordinate: [999, 40.4] as const},
  ]);

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
