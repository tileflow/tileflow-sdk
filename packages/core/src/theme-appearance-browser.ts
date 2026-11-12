import type {
  TileflowThemeChangeOptions,
  TileflowThemeController,
  TileflowThemeTransitionResult,
} from './browser';
import type {TileflowColorOverrides} from './color-program-runtime';
import {
  hasTileflowCssVariable,
  resolveTileflowCssVariables,
  TileflowCssVariableError,
} from './css-variables';
import type {TileflowEmphasis} from './theme-emphasis';

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
 *
 * Given an `element`, a colour may use CSS variables: `var(--primary)`, `var(--primary, #123456)`,
 * or a variable inside `color-mix()`, with variables nested to any sensible depth. They are read
 * from the element's computed style, so the value an ancestor of the element sets is the one used.
 * The binding reads them again, and shows the colours again only if the result changed, when the
 * application's appearance changes: the `class`, `style` or `data-theme` attribute of `<html>` or
 * `<body>`, or the `prefers-color-scheme` setting. A variable with no value and no fallback is
 * reported to `onError` with the `colors` part, and leaves the colours as they were.
 */
export function createTileflowAppearanceBinding(options: {
  controller: Pick<TileflowThemeController, 'setColors' | 'setEmphasis'>;
  /** Where CSS variables in `colors` are read; usually the map's container. */
  element?: Element | undefined;
  map: TileflowAppearanceMap;
  onError?: (error: Error, part: 'colors' | 'emphasis') => void;
}): TileflowAppearanceBinding {
  const {controller, element, map} = options;
  const report = options.onError ?? (() => undefined);
  let colorsKey = '';
  let emphasisKey = '';
  let disposed = false;
  let stopWaiting: (() => void) | undefined;
  let stopWatching: (() => void) | undefined;
  /** The last variable failure reported, so an unchanged page does not report it again. */
  let reportedResolution = '';
  let latest: {
    changeOptions: TileflowThemeChangeOptions | undefined;
    input: TileflowAppearanceInput;
  } = {changeOptions: undefined, input: {}};

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

  /** Both parts write paint values, which MapLibre allows only once the style has loaded. */
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

  /** Reads every variable of `colors` from the element; a missing one is an error naming it. */
  const resolveColors = (colors: TileflowColorOverrides): TileflowColorOverrides => {
    const view = element?.ownerDocument.defaultView;
    if (!element || !view) return colors;
    const style = view.getComputedStyle(element);
    const resolved: Record<string, string> = {};
    for (const [token, value] of Object.entries(colors)) {
      try {
        resolved[token] = hasTileflowCssVariable(value)
          ? resolveTileflowCssVariables(value, (name) => style.getPropertyValue(name))
          : value;
      } catch (error) {
        if (!(error instanceof TileflowCssVariableError)) throw error;
        throw new Error(`The colour for "${token}" cannot be resolved: ${error.message}`, {
          cause: error,
        });
      }
    }
    return resolved;
  };

  /** Shows whatever was asked for last, colours first, and only the parts that changed. */
  const flush = () => {
    if (disposed) return;
    const {changeOptions, input} = latest;
    const declared =
      input.colors && Object.keys(input.colors).length > 0 ? input.colors : undefined;
    watchAppearance(declared !== undefined && Object.values(declared).some(hasTileflowCssVariable));
    let colors = declared;
    let unresolved = false;
    if (declared) {
      try {
        colors = resolveColors(declared);
        reportedResolution = '';
      } catch (error) {
        unresolved = true;
        const failure = error instanceof Error ? error : new Error(String(error));
        const signature = `${serialize(declared)}\n${failure.message}`;
        if (signature !== reportedResolution) {
          reportedResolution = signature;
          report(failure, 'colors');
        }
      }
    } else {
      reportedResolution = '';
    }
    const nextColorsKey = colors ? serialize(colors) : '';
    if (!unresolved && nextColorsKey !== colorsKey) {
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
      settle(controller.setEmphasis(input.emphasis, changeOptions), 'emphasis', () => {
        if (emphasisKey === nextEmphasisKey) emphasisKey = previous;
      });
    }
  };

  /**
   * Looks at the page's appearance while some colour uses a variable: a change of the attributes
   * that switch a theme on `<html>` and `<body>`, or of the colour scheme the system prefers, may
   * give the variables other values.
   */
  const watchAppearance = (needed: boolean) => {
    if (!needed) {
      stopWatching?.();
      stopWatching = undefined;
      return;
    }
    if (stopWatching || !element) return;
    const document = element.ownerDocument;
    const view = document.defaultView;
    if (!view) return;
    const refresh = () => {
      if (!disposed) whenStyleLoaded(flush);
    };
    const stops: (() => void)[] = [];
    if (typeof view.MutationObserver === 'function') {
      const observer = new view.MutationObserver(refresh);
      for (const target of [document.documentElement, document.body]) {
        if (target) {
          observer.observe(target, {
            attributeFilter: ['class', 'style', 'data-theme'],
            attributes: true,
          });
        }
      }
      stops.push(() => observer.disconnect());
    }
    const scheme = view.matchMedia?.('(prefers-color-scheme: dark)');
    if (scheme) {
      scheme.addEventListener('change', refresh);
      stops.push(() => scheme.removeEventListener('change', refresh));
    }
    stopWatching = () => {
      for (const stop of stops) stop();
    };
  };

  return {
    dispose() {
      disposed = true;
      stopWaiting?.();
      stopWatching?.();
      stopWatching = undefined;
    },
    update(input, changeOptions) {
      if (disposed) return;
      latest = {changeOptions, input};
      whenStyleLoaded(flush);
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
