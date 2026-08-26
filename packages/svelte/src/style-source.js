import {validateTileflowRuntimeSource} from '@tileflow/core/runtime';

/** @typedef {{source?: unknown}} TileflowMapStyleInput */
/** @typedef {{ok: true} | {error: string; ok: false}} TileflowMapStyleInputValidation */

/**
 * @param {TileflowMapStyleInput} input
 * @returns {TileflowMapStyleInputValidation}
 */
export function validateTileflowMapStyleInputs(input) {
  return validateTileflowRuntimeSource(input.source);
}

/** @param {TileflowMapStyleInput} input */
export function assertTileflowMapStyleInputs(input) {
  const validation = validateTileflowMapStyleInputs(input);

  if (!validation.ok) {
    throw new TypeError(`Invalid TileflowMap source: ${validation.error}`);
  }
}
