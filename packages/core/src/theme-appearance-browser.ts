import type {TileflowColorOverrides} from './color-program-runtime';
import type {TileflowEmphasis} from './theme-emphasis';
import type {
  TileflowThemeChangeOptions,
  TileflowThemeController,
  TileflowThemeTransitionResult,
} from './browser';

/** What an application wants the map to look like beyond its theme. */
export type TileflowAppearanceInput = Readonly<{
  /** Colour token overrides; leave out, or pass an empty record, for the theme's own colours. */
  colors?: TileflowColorOverrides | undefined;
  /** How the map steps back so the application's content reads first; leave out for none. */
  emphasis?: TileflowEmphasis | undefined;
}>;

/** The map methods the binding reads. A MapLibre map satisfies them. */
export type TileflowAppearanceMap = {
  isStyleLoaded?(): boolean | void;
  off(event: string, listener: () => void): unknown;
  on(event: string, listener: () => void): unknown;
};

export type TileflowAppearanceBinding = {
  /** Stop waiting for the style; later calls do nothing. */
  dispose(): void;
  /**
   * Shows the colours and the emphasis. A part whose content is unchanged since the last call is
   * left alone, so an inline object that a framework re-creates on every render costs nothing.
   */
  update(input: TileflowAppearanceInput, options?: TileflowThemeChangeOptions): void;
};

/**
 * Connects the `colors` and `emphasis` an application declares to a theme controller. Frameworks
 * call `update` whenever those inputs may have changed. A failed change is reported to `onError`
 * and tried again by the next `update` with the same content.
 */
export function createTileflowAppearanceBinding(options: {
  controller: Pick<TileflowThemeController, 'setColors' | 'setEmphasis'>;
  map: TileflowAppearanceMap;
  onError?: (error: Error, part: 'colors' | 'emphasis') => void;
}): TileflowAppearanceBinding {
  const {controller, map} = options;
  const report = options.onError ?? (() => undefined);
  let colorsKey = '';
  let emphasisKey = '';
  let disposed = false;
  let stopWaiting: (() => void) | undefined;

  const settle = (
    pending: Promise<TileflowThemeTransitionResult>,
    part: 'colors' | 'emphasis',
    forget: () => void,
  ) => {
    void pending.then(
      (result) => {
        if (result.status !== 'failed') return;
        forget();
        report(result.error ?? new Error(`The map ${part} could not be applied.`), part);
      },
      (error: unknown) => {
        forget();
        report(error instanceof Error ? error : new Error(String(error)), part);
      },
    );
  };

  /** Emphasis writes paint values, which MapLibre allows only once the style has loaded. */
  const whenStyleLoaded = (run: () => void) => {
    stopWaiting?.();
    stopWaiting = undefined;
    if (map.isStyleLoaded?.() !== false) {
      run();
      return;
    }
    const onIdle = () => {
      if (map.isStyleLoaded?.() === false) return;
      stop();
      run();
    };
    const stop = () => {
      map.off('idle', onIdle);
      if (stopWaiting === stop) stopWaiting = undefined;
    };
    stopWaiting = stop;
    map.on('idle', onIdle);
  };

  return {
    dispose() {
      disposed = true;
      stopWaiting?.();
    },
    update(input, changeOptions) {
      if (disposed) return;
      const colors =
        input.colors && Object.keys(input.colors).length > 0 ? input.colors : undefined;
      const nextColorsKey = colors ? serialize(colors) : '';
      if (nextColorsKey !== colorsKey) {
        const previous = colorsKey;
        colorsKey = nextColorsKey;
        settle(controller.setColors(colors ?? {}, changeOptions), 'colors', () => {
          if (colorsKey === nextColorsKey) colorsKey = previous;
        });
      }
      const nextEmphasisKey = input.emphasis ? serialize(input.emphasis) : '';
      if (nextEmphasisKey !== emphasisKey) {
        const previous = emphasisKey;
        emphasisKey = nextEmphasisKey;
        const emphasis = input.emphasis;
        whenStyleLoaded(() => {
          if (disposed) return;
          settle(controller.setEmphasis(emphasis, changeOptions), 'emphasis', () => {
            if (emphasisKey === nextEmphasisKey) emphasisKey = previous;
          });
        });
      }
    },
  };
}

/** JSON with sorted keys, so equal content gives an equal key whatever order it was written in. */
function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : entry,
  );
}
