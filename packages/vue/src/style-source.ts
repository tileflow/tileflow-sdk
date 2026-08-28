import {
  type TileflowRuntimeSource,
  type TileflowThemeSelection,
  validateTileflowRuntimeSource,
  validateTileflowThemeSelection,
} from '@tileflow/core/runtime';

export type TileflowMapStyleSourceProps = {
  source: TileflowRuntimeSource;
  theme?: TileflowThemeSelection;
};

export type TileflowMapStyleInput = {
  source?: unknown;
  theme?: unknown;
};

export type TileflowMapStyleInputValidation = {error: string; ok: false} | {ok: true};

export function validateTileflowMapStyleInputs(
  input: TileflowMapStyleInput,
): TileflowMapStyleInputValidation {
  const sourceValidation = validateTileflowRuntimeSource(input.source);
  if (!sourceValidation.ok) return sourceValidation;
  if (input.theme !== undefined && !validateTileflowThemeSelection(input.theme)) {
    return {error: 'theme must be a concrete portable theme name or "system"', ok: false};
  }
  if (input.theme !== undefined && (input.source as TileflowRuntimeSource).kind !== 'tileflow') {
    return {error: 'theme is only valid with a tileflow source', ok: false};
  }
  return {ok: true};
}

export function assertTileflowMapStyleInputs(input: TileflowMapStyleInput): void {
  const validation = validateTileflowMapStyleInputs(input);

  if (!validation.ok) {
    throw new TypeError(`Invalid TileflowMap source: ${validation.error}`);
  }
}
