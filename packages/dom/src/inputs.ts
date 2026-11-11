import {validateTileflowBrowserThemeBlendSelection} from '@tileflow/core/browser';
import {
  isTileflowTimeOfDay,
  validateTileflowRuntimeSource,
  validateTileflowThemeSelection,
} from '@tileflow/core/runtime';
import {
  initialTileflowInteractionState,
  type TileflowAnnotation,
  type TileflowInteractionBinding,
  type TileflowInteractionDiagnostic,
  type TileflowInteractionState,
  tileflowInteractionStateSchema,
  validateTileflowAnnotations,
  validateTileflowInteractionBindings,
} from '@tileflow/interactions';

export type TileflowPreparedAnnotations<TAnnotation extends TileflowAnnotation> = Readonly<{
  annotations: readonly TAnnotation[];
  diagnostics: readonly TileflowInteractionDiagnostic[];
  ok: boolean;
  titles: ReadonlyMap<string, string>;
}>;

export function prepareTileflowAnnotations<TAnnotation extends TileflowAnnotation>(
  annotations: readonly TAnnotation[] | undefined,
): TileflowPreparedAnnotations<TAnnotation> {
  const candidates = annotations ?? [];
  const titles = new Map(candidates.map((annotation) => [annotation.id, annotation.ariaLabel]));
  const validation = validateTileflowAnnotations(candidates);

  if (!validation.ok) {
    return {annotations: [], diagnostics: validation.diagnostics, ok: false, titles};
  }

  // Caller-owned identities stay after validation, so data and view reconciliation stay stable
  // instead of replacing application objects with a schema clone.
  return {annotations: candidates, diagnostics: [], ok: true, titles};
}

export type TileflowPreparedInteractionBindings =
  | Readonly<{bindings: readonly TileflowInteractionBinding[]; diagnostics: readonly []; ok: true}>
  | Readonly<{diagnostics: readonly TileflowInteractionDiagnostic[]; ok: false}>;

export function prepareTileflowInteractionBindings(
  interactions: readonly TileflowInteractionBinding[] | undefined,
): TileflowPreparedInteractionBindings {
  const validation = validateTileflowInteractionBindings(interactions ?? []);
  return validation.ok
    ? {bindings: validation.bindings, diagnostics: [], ok: true}
    : {diagnostics: validation.diagnostics, ok: false};
}

export type TileflowPreparedInteractionState = Readonly<{
  controlled: boolean;
  diagnostics: readonly TileflowInteractionDiagnostic[];
  ok: boolean;
  state: TileflowInteractionState;
}>;

export function prepareTileflowInteractionState(
  interactionState: TileflowInteractionState | undefined,
  defaultInteractionState: TileflowInteractionState | undefined,
  controlledOwnership = interactionState !== undefined,
): TileflowPreparedInteractionState {
  const controlled = interactionState !== undefined;
  if (controlled && defaultInteractionState !== undefined) {
    return invalidState(
      controlled,
      'Tileflow Map accepts interactionState or defaultInteractionState, not both.',
    );
  }
  if (controlled !== controlledOwnership) {
    return invalidState(
      controlled,
      'Tileflow interaction state ownership cannot switch between controlled and uncontrolled.',
    );
  }

  const statePath = controlled ? '/interactionState' : '/defaultInteractionState';
  const parsed = tileflowInteractionStateSchema.safeParse(
    interactionState ?? defaultInteractionState ?? initialTileflowInteractionState,
  );
  if (parsed.success) return {controlled, diagnostics: [], ok: true, state: parsed.data};

  return {
    controlled,
    diagnostics: parsed.error.issues.map((issue) => ({
      code: 'INVALID_DOCUMENT' as const,
      level: 'error' as const,
      message: issue.message,
      path: `${statePath}${issue.path
        .map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1'))
        .map((segment) => `/${segment}`)
        .join('')}`,
    })),
    ok: false,
    state: initialTileflowInteractionState,
  };
}

function invalidState(controlled: boolean, message: string): TileflowPreparedInteractionState {
  return {
    controlled,
    diagnostics: [{code: 'INVALID_DOCUMENT', level: 'error', message, path: ''}],
    ok: false,
    state: initialTileflowInteractionState,
  };
}

/** Rejects a source, theme, time of day, blend or transition the map cannot use. */
export function assertTileflowMapStyleOptions(input: {
  source?: unknown;
  theme?: unknown;
  themeBlend?: unknown;
  themeTransition?: unknown;
  timeOfDay?: unknown;
}): void {
  const error = styleOptionsError(input);
  if (error) throw new TypeError(`Invalid Tileflow map options: ${error}`);
}

function styleOptionsError(input: {
  source?: unknown;
  theme?: unknown;
  themeBlend?: unknown;
  themeTransition?: unknown;
  timeOfDay?: unknown;
}): string | undefined {
  const sourceValidation = validateTileflowRuntimeSource(input.source);
  if (!sourceValidation.ok) return sourceValidation.error;
  if (input.theme !== undefined && !validateTileflowThemeSelection(input.theme)) {
    return 'theme must be a concrete portable theme name or "system"';
  }
  if (input.timeOfDay !== undefined && !isTileflowTimeOfDay(input.timeOfDay)) {
    return 'timeOfDay must be day, dawn, dusk, or night';
  }
  if (
    input.themeBlend !== undefined &&
    !validateTileflowBrowserThemeBlendSelection(input.themeBlend)
  ) {
    return 'themeBlend must name two to eight concrete themes, a position from 0 to themes.length - 1, and an optional boolean hold';
  }
  if (input.themeTransition !== undefined && !isThemeTransition(input.themeTransition)) {
    return 'themeTransition.duration must be a number of milliseconds from 0 to 5000';
  }
  return undefined;
}

function isThemeTransition(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const {duration} = value as {duration?: unknown};
  return (
    duration === undefined ||
    (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 && duration <= 5000)
  );
}

export function createOverlayFailureDiagnostic(message: string): TileflowInteractionDiagnostic {
  return {code: 'OVERLAY_FAILURE', level: 'error', message, path: ''};
}

export function tileflowInteractionDiagnosticKey(
  diagnostic: TileflowInteractionDiagnostic,
): string {
  return [
    diagnostic.code,
    diagnostic.level,
    diagnostic.path ?? '',
    diagnostic.target ? JSON.stringify(diagnostic.target) : '',
    diagnostic.message,
  ].join('\u0000');
}
