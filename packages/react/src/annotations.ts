import {
  type TileflowAnnotation,
  type TileflowInteractionDiagnostic,
  validateTileflowAnnotations,
} from '@tileflow/interactions';

export type TileflowPreparedReactAnnotations<TAnnotation extends TileflowAnnotation> = Readonly<{
  annotations: readonly TAnnotation[];
  diagnostics: readonly TileflowInteractionDiagnostic[];
  ok: boolean;
  titles: ReadonlyMap<string, string>;
}>;

export function prepareTileflowReactAnnotations<TAnnotation extends TileflowAnnotation>(
  annotations: readonly TAnnotation[] | undefined,
): TileflowPreparedReactAnnotations<TAnnotation> {
  const candidates = annotations ?? [];
  const titles = new Map(candidates.map((annotation) => [annotation.id, annotation.ariaLabel]));
  const validation = validateTileflowAnnotations(candidates);

  if (!validation.ok) {
    return {
      annotations: [],
      diagnostics: validation.diagnostics,
      ok: false,
      titles,
    };
  }

  return {
    // Keep caller-owned identities after validation so generic data and portal reconciliation stay
    // stable instead of replacing application objects with a schema clone.
    annotations: candidates,
    diagnostics: [],
    ok: true,
    titles,
  };
}

export function imageModeAnnotationDiagnostic(
  annotationCount: number,
): TileflowInteractionDiagnostic | undefined {
  return annotationCount > 0
    ? {
        code: 'UNSUPPORTED_MODE',
        level: 'error',
        message:
          'Tileflow annotations require mode="interactive"; image mode cannot render interactive overlays.',
        path: '',
      }
    : undefined;
}

export function imageModeMapInteractionDiagnostic(
  annotationCount: number,
  bindingCount: number,
  hasAdditionalInteractionConfiguration = false,
): TileflowInteractionDiagnostic | undefined {
  if (bindingCount === 0 && !hasAdditionalInteractionConfiguration) {
    return imageModeAnnotationDiagnostic(annotationCount);
  }

  return {
    code: 'UNSUPPORTED_MODE',
    level: 'error',
    message:
      annotationCount > 0 && bindingCount > 0
        ? 'Tileflow annotations and interactions require mode="interactive"; image mode cannot render interactive overlays.'
        : annotationCount > 0
          ? 'Tileflow annotations require mode="interactive"; image mode cannot render interactive overlays.'
          : bindingCount > 0
            ? 'Tileflow interactions require mode="interactive"; image mode cannot render interactive overlays.'
            : 'Tileflow interaction state, callbacks, and renderers require mode="interactive"; image mode cannot render interactive overlays.',
    path: '',
  };
}
