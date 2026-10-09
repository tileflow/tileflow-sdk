import {
  validateTileflowRuntimeSource,
  validateTileflowThemeBlendSelection,
  validateTileflowThemeSelection,
} from '@tileflow/core/runtime';

/**
 * @typedef {{source?: unknown, theme?: unknown, themeBlend?: unknown, themeTransition?: unknown}}
 *   TileflowMapStyleInput
 */
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
  if (input.themeBlend !== undefined && !validateTileflowThemeBlendSelection(input.themeBlend)) {
    return {
      error:
        'themeBlend must name two to eight concrete themes and a position from 0 to themes.length - 1',
      ok: false,
    };
  }
  if (input.themeTransition !== undefined && !isThemeTransition(input.themeTransition)) {
    return {
      error: 'themeTransition.duration must be a number of milliseconds from 0 to 5000',
      ok: false,
    };
  }
  return {ok: true};
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isThemeTransition(value) {
  if (!value || typeof value !== 'object') return false;
  const {duration} = /** @type {{duration?: unknown}} */ (value);
  return (
    duration === undefined ||
    (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 && duration <= 5000)
  );
}

/** @param {TileflowMapStyleInput} input */
export function assertTileflowMapStyleInputs(input) {
  const validation = validateTileflowMapStyleInputs(input);

  if (!validation.ok) {
    throw new TypeError(`Invalid TileflowMap source: ${validation.error}`);
  }
}
