import {resolveTileflowAppearance, type TileflowAppearanceSelection} from './appearance';
import {
  getTileflowSystemColorScheme,
  subscribeTileflowSystemColorScheme,
  type TileflowThemeController,
  type TileflowThemeTransitionResult,
} from './browser';
import type {TileflowRuntimeManifestMap, TileflowRuntimeStyle} from './runtime';

/** Optional application-owned automation. No controls, geolocation, or persistent preferences. */
export function createTileflowAppearanceController(options: {
  map: TileflowRuntimeManifestMap;
  controller: Pick<TileflowThemeController, 'setTheme' | 'setBlend'>;
  initial: TileflowAppearanceSelection;
  resolve(theme: string): TileflowRuntimeStyle;
  now?: () => Date;
  onResult?: (result: TileflowThemeTransitionResult) => void;
}) {
  let selection = options.initial;
  let disposed = false;
  let generation = 0;
  let last = '';
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const date = options.now ?? (() => new Date());
  async function update(force = false): Promise<TileflowThemeTransitionResult> {
    if (disposed) return {status: 'superseded'};
    const run = ++generation;
    try {
      const target = resolveTileflowAppearance(options.map, selection, {
        date: date(),
        colorScheme: getTileflowSystemColorScheme(),
      });
      const key = JSON.stringify(target);
      if (!force && key === last)
        return {status: 'applied', theme: target.themes[Math.round(target.position)]};
      const styles = target.themes.map(options.resolve);
      const result =
        styles.length === 1
          ? await options.controller.setTheme(styles[0]!)
          : await options.controller.setBlend({themes: styles, position: target.position});
      if (run !== generation || disposed) return {status: 'superseded'};
      if (result.status === 'applied') last = key;
      options.onResult?.(result);
      return result;
    } catch (error) {
      const result = {
        status: 'failed',
        error: error instanceof Error ? error : new Error(String(error)),
      } as const;
      if (!disposed && run === generation) options.onResult?.(result);
      return result;
    }
  }
  function subscribe() {
    unsubscribe?.();
    unsubscribe = undefined;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (selection.mode === 'system')
      unsubscribe = subscribeTileflowSystemColorScheme(() => {
        void update();
      });
    if (selection.mode === 'clock') {
      const tick = () => {
        if (disposed) return;
        void update();
        // Local wall time is read again after suspension, DST changes, or a clock adjustment.
        timer = setTimeout(tick, 60_000 - (date().getTime() % 60_000));
      };
      timer = setTimeout(tick, 60_000 - (date().getTime() % 60_000));
    }
  }
  // Validate before registering any listener or timer.
  resolveTileflowAppearance(options.map, selection, {
    date: date(),
    colorScheme: getTileflowSystemColorScheme(),
  });
  subscribe();
  const ready = update(true);
  return {
    ready,
    refresh: () => update(true),
    set(next: TileflowAppearanceSelection) {
      if (disposed) return Promise.resolve({status: 'superseded'} as const);
      try {
        resolveTileflowAppearance(options.map, next, {
          date: date(),
          colorScheme: getTileflowSystemColorScheme(),
        });
      } catch (error) {
        return Promise.resolve({
          status: 'failed',
          error: error instanceof Error ? error : new Error(String(error)),
        } as const);
      }
      selection = next;
      subscribe();
      return update(true);
    },
    dispose() {
      disposed = true;
      generation += 1;
      unsubscribe?.();
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
