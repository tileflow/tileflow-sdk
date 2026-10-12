import {
  tileflowLineProgressGradient,
  type TileflowLineProgressGradientOptions,
  type TileflowLineProgressState,
} from './line-progress';
import {prefersReducedMotion, tileflowThemeMotionView} from './theme-motion-browser';

/** Structural MapLibre capabilities; importing this module never loads a renderer. */
export type TileflowLineProgressMap = {
  getCanvas?: unknown;
  getLayer(id: string): unknown;
  setPaintProperty(layer: string, name: string, value: unknown): unknown;
  on(event: 'styledata', listener: () => void): unknown;
  off(event: 'styledata', listener: () => void): unknown;
};

/** One line layer of the group, over a GeoJSON source with `lineMetrics: true`. */
export type TileflowLineProgressLayer = Readonly<{
  id: string;
  /** The layer's colour along the drawn line. */
  color: string;
  /** The colour at the head and in the light; defaults to `color`. */
  highlight?: string;
  /** The layer's own opacity, from 0 to 1 (the default). */
  opacity?: number;
}>;

export type TileflowLineProgressOptions = Readonly<{
  /** The layers drawn together, such as a route's glow, casing, line and core. */
  layers: readonly TileflowLineProgressLayer[];
  /** Length of the head's highlight, as a share of the line; defaults to 0.04. */
  headLength?: number;
  /** Length of the light, as a share of the line; defaults to `headLength`. */
  lightLength?: number;
  /** What the layers show at first; defaults to the whole line, without a light. */
  initial?: TileflowLineProgressState;
}>;

export type TileflowLineProgressAnimation = Readonly<{
  /** The values to reach; values left out keep what they show. */
  to: TileflowLineProgressState;
  /** Milliseconds, from 0 to 60000. */
  duration: number;
  /** Maps elapsed time (0 to 1) to progress (0 to 1); defaults to an ease in and out. */
  easing?: (t: number) => number;
}>;

/** What the layers show: `light` is absent when no light shows. */
export type TileflowLineProgressShown = Readonly<{
  start: number;
  end: number;
  light?: number;
  opacity: number;
}>;

export type TileflowLineProgressController = {
  /** What the layers show now, mid-animation included. */
  get(): TileflowLineProgressShown;
  /**
   * Shows new values at once and stops a running animation. Values left out keep what they show;
   * `light: undefined` takes the light off.
   */
  set(state: TileflowLineProgressState): void;
  /**
   * Moves to new values over a duration and resolves `true` when it gets there, or `false` when
   * `set`, another animation, or `dispose` stops it first. A light that is not showing starts from
   * the start of the drawn stretch. With reduced motion requested, it shows the values at once.
   */
  animate(animation: TileflowLineProgressAnimation): Promise<boolean>;
  /** Changes the layers' colours or the highlight lengths, for example when the theme changes. */
  configure(options: Partial<Omit<TileflowLineProgressOptions, 'initial'>>): void;
  /** Stops writing to the map. The layers keep what they show. */
  dispose(): void;
};

const maximumDurationMs = 60_000;
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Draws a line on, a share of its length at a time, over a group of MapLibre line layers: their
 * `line-gradient` shows the drawn stretch, a bright head where it is being drawn, and a light that
 * can run along it. The controller owns each layer's `line-gradient` and `line-opacity`, writes
 * only what changed, and paints a layer again when a style change re-creates it. Layers that are
 * not on the map are skipped until they are.
 */
export function createTileflowLineProgress(
  map: TileflowLineProgressMap,
  options: TileflowLineProgressOptions,
): TileflowLineProgressController {
  let settings = validated(options);
  let shown: Mutable<TileflowLineProgressShown> = merge(
    {start: 0, end: 1, opacity: 1},
    options.initial ?? {},
  );
  const written = new Map<string, {layer: unknown; gradient: string; opacity: number}>();
  let run = 0;
  let stop: (() => void) | undefined;
  let settle: ((finished: boolean) => void) | undefined;
  let disposed = false;

  const onStyle = () => paint();
  map.on('styledata', onStyle);
  paint();

  function paint() {
    if (disposed) return;
    for (const layer of settings.layers) {
      const instance = map.getLayer(layer.id);
      if (!instance) {
        written.delete(layer.id);
        continue;
      }
      const gradient = tileflowLineProgressGradient(shown, {
        color: layer.color,
        highlight: layer.highlight,
        headLength: settings.headLength,
        lightLength: settings.lightLength,
      });
      const key = JSON.stringify(gradient);
      const opacity = (layer.opacity ?? 1) * shown.opacity;
      // A layer the style re-created starts from its own paint, so it is painted in full.
      const previous = written.get(layer.id);
      const kept = previous?.layer === instance ? previous : undefined;
      if (kept?.gradient !== key) map.setPaintProperty(layer.id, 'line-gradient', gradient);
      if (kept?.opacity !== opacity) map.setPaintProperty(layer.id, 'line-opacity', opacity);
      written.set(layer.id, {layer: instance, gradient: key, opacity});
    }
  }

  function halt(finished: boolean) {
    run += 1;
    stop?.();
    stop = undefined;
    const resolve = settle;
    settle = undefined;
    resolve?.(finished);
  }

  return {
    get() {
      return Object.freeze({...shown});
    },
    set(state) {
      if (disposed) return;
      halt(false);
      shown = merge(shown, state);
      paint();
    },
    animate({to, duration, easing = smooth}) {
      if (!(Number.isFinite(duration) && duration >= 0 && duration <= maximumDurationMs))
        throw new RangeError(`Line progress durations run from 0 to ${maximumDurationMs} ms.`);
      if (disposed) return Promise.resolve(false);
      halt(false);
      const goal = merge(shown, to);
      const view = tileflowThemeMotionView(map as Parameters<typeof tileflowThemeMotionView>[0]);
      if (duration === 0 || !view || prefersReducedMotion(view)) {
        shown = goal;
        paint();
        return Promise.resolve(true);
      }
      // A light that is not showing sets off from the start of the drawn stretch.
      const fromLight = shown.light ?? (goal.light === undefined ? undefined : shown.start);
      const from = {...shown};
      const current = ++run;
      return new Promise<boolean>((resolve) => {
        settle = resolve;
        const now = () => view.performance?.now?.() ?? Date.now();
        const began = now();
        let frame: number | undefined;
        const step = () => {
          frame = undefined;
          if (disposed || current !== run) return;
          const t = Math.min(1, (now() - began) / duration);
          const k = t >= 1 ? 1 : easing(t);
          shown = {
            start: from.start + (goal.start - from.start) * k,
            end: from.end + (goal.end - from.end) * k,
            opacity: from.opacity + (goal.opacity - from.opacity) * k,
            // A light being taken off keeps its place until the end.
            ...(goal.light !== undefined
              ? {light: fromLight! + (goal.light - fromLight!) * k}
              : fromLight === undefined
                ? {}
                : {light: fromLight}),
          };
          if (t >= 1) shown = goal;
          paint();
          if (t >= 1) {
            stop = undefined;
            settle = undefined;
            resolve(true);
            return;
          }
          frame = view.requestAnimationFrame(step);
        };
        stop = () => {
          if (frame !== undefined) view.cancelAnimationFrame(frame);
        };
        frame = view.requestAnimationFrame(step);
      });
    },
    configure(next) {
      if (disposed) return;
      settings = validated({...settings, ...next});
      paint();
    },
    dispose() {
      if (disposed) return;
      halt(false);
      disposed = true;
      map.off('styledata', onStyle);
    },
  };
}

type Mutable<T> = {-readonly [K in keyof T]: T[K]};

function merge(
  base: TileflowLineProgressShown,
  change: TileflowLineProgressState,
): Mutable<TileflowLineProgressShown> {
  const start = 'start' in change ? share(change.start, base.start) : base.start;
  const end = Math.max(start, 'end' in change ? share(change.end, base.end) : base.end);
  const opacity = 'opacity' in change ? share(change.opacity, base.opacity) : base.opacity;
  const light = 'light' in change ? change.light : base.light;
  return {
    start,
    end,
    opacity,
    ...(light === undefined || !Number.isFinite(light) ? {} : {light: share(light, 0)}),
  };
}

function share(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function validated(
  options: Omit<TileflowLineProgressOptions, 'initial'>,
): Required<Pick<TileflowLineProgressOptions, 'layers'>> &
  Pick<TileflowLineProgressGradientOptions, 'headLength' | 'lightLength'> {
  const {layers, headLength, lightLength} = options;
  if (!Array.isArray(layers) || layers.length === 0)
    throw new TypeError('Line progress needs at least one layer.');
  const ids = new Set<string>();
  for (const layer of layers) {
    if (typeof layer?.id !== 'string' || !layer.id)
      throw new TypeError('Line progress layers need an id.');
    if (ids.has(layer.id))
      throw new TypeError(`Line progress layer "${layer.id}" is listed twice.`);
    ids.add(layer.id);
    if (typeof layer.color !== 'string' || !layer.color)
      throw new TypeError(`Line progress layer "${layer.id}" needs a colour.`);
    if (layer.highlight !== undefined && (typeof layer.highlight !== 'string' || !layer.highlight))
      throw new TypeError(`Line progress layer "${layer.id}" has an invalid highlight.`);
    if (layer.opacity !== undefined && !(layer.opacity >= 0 && layer.opacity <= 1))
      throw new TypeError(`Line progress layer "${layer.id}" opacity runs from 0 to 1.`);
  }
  for (const [name, value] of [
    ['headLength', headLength],
    ['lightLength', lightLength],
  ] as const) {
    if (value !== undefined && !(value >= 0 && value <= 1))
      throw new TypeError(`Line progress ${name} is a share of the line, from 0 to 1.`);
  }
  return {layers: [...layers], headLength, lightLength};
}
