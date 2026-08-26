import {
  type TileflowInteractionBinding,
  type TileflowInteractionDiagnostic,
  validateTileflowInteractionBindings,
} from '@tileflow/interactions';

export type TileflowPreparedReactInteractionBindings =
  | Readonly<{
      bindings: readonly TileflowInteractionBinding[];
      diagnostics: readonly [];
      ok: true;
    }>
  | Readonly<{
      diagnostics: readonly TileflowInteractionDiagnostic[];
      ok: false;
    }>;

export function prepareTileflowReactInteractionBindings(
  interactions: readonly TileflowInteractionBinding[] | undefined,
): TileflowPreparedReactInteractionBindings {
  const validation = validateTileflowInteractionBindings(interactions ?? []);

  return validation.ok
    ? {
        bindings: validation.bindings,
        diagnostics: [],
        ok: true,
      }
    : {
        diagnostics: validation.diagnostics,
        ok: false,
      };
}
