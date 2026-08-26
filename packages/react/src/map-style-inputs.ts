import {type TileflowRuntimeSource, validateTileflowRuntimeSource} from '@tileflow/core/runtime';

export type TileflowMapStyleSourceProps = {
  source: TileflowRuntimeSource;
};

export type TileflowMapStyleInputs = {
  source?: unknown;
};

export type TileflowMapStyleInputsValidation = {error: string; ok: false} | {ok: true};

export function validateTileflowMapStyleInputs(
  input: TileflowMapStyleInputs,
): TileflowMapStyleInputsValidation {
  return validateTileflowRuntimeSource(input.source);
}

export function assertTileflowMapStyleInputs(input: TileflowMapStyleInputs): void {
  const validation = validateTileflowMapStyleInputs(input);

  if (!validation.ok) {
    throw new TypeError(`Invalid Tileflow <Map> source: ${validation.error}`);
  }
}
