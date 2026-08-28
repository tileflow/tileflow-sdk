import {
  validateTileflowRuntimeSource,
  validateTileflowThemeSelection,
} from '@tileflow/core/runtime';

/** @typedef {{source?: unknown, theme?: unknown}} TileflowMapStyleInput */
/** @typedef {{ok: true} | {error: string; ok: false}} TileflowMapStyleInputValidation */

/**
 * @param {TileflowMapStyleInput} input
 * @returns {TileflowMapStyleInputValidation}
 */
export function validateTileflowMapStyleInputs(input) {
  const sourceValidation = validateTileflowRuntimeSource(input.source);
  if (!sourceValidation.ok) return sourceValidation;
  if (input.theme !== undefined && !validateTileflowThemeSelection(input.theme)) {
    return {error: 'theme must be a concrete portable theme name or "system"', ok: false};
  }
  if (
    input.theme !== undefined &&
    /** @type {{kind?: unknown}} */ (input.source).kind !== 'tileflow'
  ) {
    return {error: 'theme is only valid with a tileflow source', ok: false};
  }
  return {ok: true};
}

/** @param {TileflowMapStyleInput} input */
export function assertTileflowMapStyleInputs(input) {
  const validation = validateTileflowMapStyleInputs(input);

  if (!validation.ok) {
    throw new TypeError(`Invalid TileflowMap source: ${validation.error}`);
  }
}
