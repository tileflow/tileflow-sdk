import {type TileflowRuntimeSource, validateTileflowRuntimeSource} from '@tileflow/core/runtime';

export type TileflowMapStyleSourceProps = {
  source: TileflowRuntimeSource;
};

export type TileflowMapStyleInput = {
  source?: unknown;
};

export type TileflowMapStyleInputValidation = {error: string; ok: false} | {ok: true};

export function validateTileflowMapStyleInputs(
  input: TileflowMapStyleInput,
): TileflowMapStyleInputValidation {
  return validateTileflowRuntimeSource(input.source);
}

export function assertTileflowMapStyleInputs(input: TileflowMapStyleInput): void {
  const validation = validateTileflowMapStyleInputs(input);

  if (!validation.ok) {
    throw new TypeError(`Invalid TileflowMap source: ${validation.error}`);
  }
}
