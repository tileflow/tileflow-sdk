import {validateTileflowRuntimeStyleInputs} from '@tileflow/core';

/**
 * @typedef {{
 *   config?: import('./index.js').TileflowMapProps['config'];
 *   map?: import('./index.js').TileflowMapProps['map'];
 *   mapStyle?: import('./index.js').TileflowMapProps['mapStyle'];
 *   styleBaseUrl?: import('./index.js').TileflowMapProps['styleBaseUrl'];
 *   styleUrl?: import('./index.js').TileflowMapProps['styleUrl'];
 *   themes?: import('./index.js').TileflowMapProps['themes'];
 * }} TileflowMapStyleInput
 */

/** @typedef {{ok: true} | {error: string; ok: false}} TileflowMapStyleInputValidation */

/**
 * @param {TileflowMapStyleInput} input
 * @returns {TileflowMapStyleInputValidation}
 */
export function validateTileflowMapStyleInputs(input) {
  const validation = validateTileflowRuntimeStyleInputs({...input, style: input.mapStyle});
  if (validation.ok) return validation;

  const error = {
    'config-conflict':
      '`config` cannot be combined with `map`, `mapStyle`, `styleBaseUrl`, or `styleUrl`.',
    'missing-config': '`themes` requires `config`.',
    'missing-map': '`styleBaseUrl` requires `map`.',
    'multiple-style-sources': 'Use only one of `mapStyle`, `styleBaseUrl`, or `styleUrl`.',
  }[validation.code];
  return {error, ok: false};
}

/** @param {TileflowMapStyleInput} input */
export function assertTileflowMapStyleInputs(input) {
  const validation = validateTileflowMapStyleInputs(input);

  if (!validation.ok) {
    throw new TypeError(`Invalid TileflowMap style inputs: ${validation.error}`);
  }
}
