import {
  type TileflowBrowserThemeBlendSelection,
  type TileflowThemeTransitionOptions,
  validateTileflowBrowserThemeBlendSelection,
} from '@tileflow/core/browser';
import {
  type TileflowRuntimeSource,
  type TileflowThemeSelection,
  type TileflowTimeOfDay,
  isTileflowTimeOfDay,
  validateTileflowRuntimeSource,
  validateTileflowThemeSelection,
} from '@tileflow/core/runtime';

export type TileflowMapStyleSourceProps = {
  source: TileflowRuntimeSource;
  theme?: TileflowThemeSelection;
  /** Optional artistic preset; ignored by maps without this capability. */
  timeOfDay?: TileflowTimeOfDay;
  /**
   * Shows a continuous blend of the map's themes instead of `theme`. Moving `position` changes the
   * map at once; changing `themes` prepares a new blend. `hold` keeps labels, icons, and mixed
   * artwork back during a camera move; clearing it brings them in at once.
   */
  themeBlend?: TileflowBrowserThemeBlendSelection;
  /** Cross-fades theme changes, including entering and leaving a blend. */
  themeTransition?: TileflowThemeTransitionOptions;
};

export type TileflowMapStyleInput = {
  source?: unknown;
  theme?: unknown;
  timeOfDay?: unknown;
  themeBlend?: unknown;
  themeTransition?: unknown;
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
  if (input.timeOfDay !== undefined && !isTileflowTimeOfDay(input.timeOfDay)) {
    return {error: 'timeOfDay must be day, dawn, dusk, or night', ok: false};
  }
  if (
    input.themeBlend !== undefined &&
    !validateTileflowBrowserThemeBlendSelection(input.themeBlend)
  ) {
    return {
      error:
        'themeBlend must name two to eight concrete themes, a position from 0 to themes.length - 1, and an optional boolean hold',
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

function isThemeTransition(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const {duration} = value as {duration?: unknown};
  return (
    duration === undefined ||
    (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 && duration <= 5000)
  );
}

export function assertTileflowMapStyleInputs(input: TileflowMapStyleInput): void {
  const validation = validateTileflowMapStyleInputs(input);

  if (!validation.ok) {
    throw new TypeError(`Invalid TileflowMap source: ${validation.error}`);
  }
}
