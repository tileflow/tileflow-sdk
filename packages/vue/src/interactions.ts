import type {TileflowMapMarker} from '@tileflow/core/runtime';
import {
  type TileflowAnnotation,
  type TileflowInteractionBinding,
  type TileflowInteractionDiagnostic,
  type TileflowInteractionDiagnosticCode,
  type TileflowInteractionJsonValue,
  type TileflowInteractionState,
  tileflowInteractionStateSchema,
  validateTileflowAnnotations,
  validateTileflowInteractionBindings,
} from '@tileflow/interactions';
import {normalizeTileflowLegacyMarkers} from '@tileflow/interactions/maplibre';

export type TileflowVueAnnotationInput<
  TData extends TileflowInteractionJsonValue = TileflowInteractionJsonValue,
> = Readonly<{
  annotations?: readonly TileflowAnnotation<TData>[];
  markers?: readonly TileflowMapMarker[];
}>;

export type TileflowVueAnnotationResolution<
  TData extends TileflowInteractionJsonValue = TileflowInteractionJsonValue,
> = Readonly<{
  annotations: readonly TileflowAnnotation<TData>[];
  diagnostics: readonly TileflowInteractionDiagnostic[];
  legacyTitles: ReadonlyMap<string, string>;
  ok: boolean;
}>;

export type TileflowVueInteractionBindingResolution = Readonly<{
  bindings: readonly TileflowInteractionBinding[];
  diagnostics: readonly TileflowInteractionDiagnostic[];
  ok: boolean;
}>;

export function resolveTileflowVueAnnotations<
  TData extends TileflowInteractionJsonValue = TileflowInteractionJsonValue,
>({
  annotations,
  markers,
}: TileflowVueAnnotationInput<TData>): TileflowVueAnnotationResolution<TData> {
  if (annotations !== undefined && markers !== undefined) {
    return {
      annotations: [],
      diagnostics: [
        createTileflowVueInteractionDiagnostic(
          'INVALID_DOCUMENT',
          'The annotations and legacy markers props are mutually exclusive.',
        ),
      ],
      legacyTitles: new Map(),
      ok: false,
    };
  }

  const normalizedLegacyMarkers = normalizeTileflowLegacyMarkers(markers ?? []);
  const legacyTitles =
    markers === undefined ? new Map<string, string>() : normalizedLegacyMarkers.titles;
  const candidates =
    annotations ?? (normalizedLegacyMarkers.annotations as readonly TileflowAnnotation<TData>[]);
  const validation = validateTileflowAnnotations(candidates);

  if (!validation.ok) {
    return {
      annotations: [],
      diagnostics: validation.diagnostics,
      legacyTitles,
      ok: false,
    };
  }

  return {
    // Validation deliberately does not replace application data with a schema clone. Slot
    // contexts keep the caller's typed annotation and data identities.
    annotations: candidates,
    diagnostics: [],
    legacyTitles,
    ok: true,
  };
}

export function resolveTileflowVueInteractionBindings(
  interactions: readonly TileflowInteractionBinding[] | undefined,
): TileflowVueInteractionBindingResolution {
  const candidates = interactions ?? [];
  const validation = validateTileflowInteractionBindings(candidates);

  if (!validation.ok) {
    return {bindings: [], diagnostics: validation.diagnostics, ok: false};
  }

  return {
    // As with annotations, validation must not replace caller-owned objects: bindings can be
    // compared by identity by framework consumers even though their runtime shape is JSON-safe.
    bindings: candidates,
    diagnostics: [],
    ok: true,
  };
}

export function validateTileflowVueInteractionState(
  interactionState: TileflowInteractionState | undefined,
  defaultInteractionState: TileflowInteractionState | undefined,
): readonly TileflowInteractionDiagnostic[] {
  if (interactionState !== undefined && defaultInteractionState !== undefined) {
    return [
      createTileflowVueInteractionDiagnostic(
        'INVALID_DOCUMENT',
        'interactionState and defaultInteractionState are mutually exclusive.',
      ),
    ];
  }

  const candidate = interactionState ?? defaultInteractionState;
  if (candidate === undefined) return [];
  const statePath =
    interactionState === undefined ? '/defaultInteractionState' : '/interactionState';

  const parsed = tileflowInteractionStateSchema.safeParse(candidate);
  if (parsed.success) return [];

  return parsed.error.issues.map((issue) =>
    createTileflowVueInteractionDiagnostic(
      'INVALID_DOCUMENT',
      issue.message,
      `${statePath}${jsonPointer(issue.path)}`,
    ),
  );
}

export function createTileflowVueInteractionDiagnostic(
  code: TileflowInteractionDiagnosticCode,
  message: string,
  path?: string,
): TileflowInteractionDiagnostic {
  return {
    code,
    level: 'error',
    message,
    ...(path === undefined ? {} : {path}),
  };
}

function jsonPointer(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1'))
    .map((segment) => `/${segment}`)
    .join('');
}
