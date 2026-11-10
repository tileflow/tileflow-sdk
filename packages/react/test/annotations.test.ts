import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowAnnotation} from '@tileflow/interactions';
import {
  imageModeAnnotationDiagnostic,
  imageModeMapInteractionDiagnostic,
  prepareTileflowReactAnnotations,
  unusedRendererDiagnostics,
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

test('reports a renderer when nothing could open it', () => {
  const marker = {
    ariaLabel: 'Madrid',
    coordinate: [-3.7, 40.4],
    id: 'madrid',
    kind: 'marker',
  } satisfies TileflowAnnotation;
  const popup = {content: {kind: 'view', name: 'card'}} as const;
  const input = {
    annotations: [marker],
    bindings: [],
    hasPopupRenderer: true,
    hasTooltipRenderer: false,
  };

  const [diagnostic, ...rest] = unusedRendererDiagnostics(input);
  assert.equal(rest.length, 0);
  assert.equal(diagnostic?.code, 'UNUSED_RENDERER');
  assert.equal(diagnostic?.level, 'warning');
  assert.match(diagnostic?.message ?? '', /renderPopup has nothing to render/u);

  assert.deepEqual(unusedRendererDiagnostics({...input, annotations: [{...marker, popup}]}), []);
  assert.deepEqual(
    unusedRendererDiagnostics({
      ...input,
      annotations: [marker],
      bindings: [{id: 'poi', popup, target: {domain: 'poi', kind: 'semantic-feature'}}],
    }),
    [],
  );
  // Nothing to attach a renderer to yet, for example while data loads.
  assert.deepEqual(unusedRendererDiagnostics({...input, annotations: []}), []);
  assert.deepEqual(unusedRendererDiagnostics({...input, hasPopupRenderer: false}), []);
  assert.equal(
    unusedRendererDiagnostics({
      ...input,
      hasPopupRenderer: false,
      hasTooltipRenderer: true,
    })[0]?.message.startsWith('renderTooltip'),
    true,
  );
});
