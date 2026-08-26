import {
  initialTileflowInteractionState,
  type TileflowInteractionDiagnostic,
  type TileflowInteractionState,
  tileflowInteractionStateSchema,
} from '@tileflow/interactions';

export type TileflowPreparedReactInteractionState = Readonly<{
  controlled: boolean;
  diagnostics: readonly TileflowInteractionDiagnostic[];
  ok: boolean;
  state: TileflowInteractionState;
}>;

export function prepareTileflowReactInteractionState(
  interactionState: TileflowInteractionState | undefined,
  defaultInteractionState: TileflowInteractionState | undefined,
  controlledOwnership = interactionState !== undefined,
): TileflowPreparedReactInteractionState {
  const controlled = interactionState !== undefined;
  if (controlled && defaultInteractionState !== undefined) {
    return {
      controlled,
      diagnostics: [
        {
          code: 'INVALID_DOCUMENT',
          level: 'error',
          message: 'Tileflow Map accepts interactionState or defaultInteractionState, not both.',
          path: '',
        },
      ],
      ok: false,
      state: initialTileflowInteractionState,
    };
  }
  if (controlled !== controlledOwnership) {
    return {
      controlled,
      diagnostics: [
        {
          code: 'INVALID_DOCUMENT',
          level: 'error',
          message:
            'Tileflow interaction state ownership cannot switch between controlled and uncontrolled.',
          path: '',
        },
      ],
      ok: false,
      state: initialTileflowInteractionState,
    };
  }

  const statePath = controlled ? '/interactionState' : '/defaultInteractionState';
  const parsed = tileflowInteractionStateSchema.safeParse(
    interactionState ?? defaultInteractionState ?? initialTileflowInteractionState,
  );
  if (parsed.success) {
    return {controlled, diagnostics: [], ok: true, state: parsed.data};
  }

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
