import {
  fillTileflowThemeBlendTemplate,
  type TileflowThemeBlendImage,
  type TileflowThemeBlendPaint,
  type TileflowThemeBlendPlan,
  type TileflowThemeBlendSwitch,
} from '@tileflow/core/native';
import type {
  NativeThemeImage,
  NativeThemeValue,
  NativeThemeValues,
} from './native-surface-contract';

/** Labels, icons, and switched values cross-fade this long when the nearest theme changes. */
export const nativeBlendLabelFadeMs = 450;
/** A four-hundredth of a theme is below what the eye sees; whole themes are always reached. */
const minimumStep = 0.0025;
/** Pattern artwork is mixed again only when the position moves by a thirty-second of a theme. */
const imageSteps = 32;

export type NativeThemeBlendPort = Readonly<{
  apply(values: NativeThemeValues): Promise<unknown>;
  /** Resolves false when the map cannot be covered; values then change at once. */
  cover(duration: number): Promise<boolean>;
  reveal(duration: number): Promise<void>;
}>;

/**
 * Drives a map that shows `plan.styleAt(baked)` to other blend positions. Ground values follow
 * every position; symbol values and switches change at the nearest theme under a short cover.
 * Batches run one at a time and later positions coalesce, so a fast-moving position never queues
 * more than one batch behind the one in flight.
 */
export function createNativeThemeBlender(
  plan: TileflowThemeBlendPlan,
  port: NativeThemeBlendPort,
  options: Readonly<{baked: number; failed(): void}>,
) {
  const clamp = (value: number) =>
    Math.min(plan.themes - 1, Math.max(0, Number.isFinite(value) ? value : 0));
  const ground = plan.paints.filter((paint) => paint.follows === 'position');
  const symbols = plan.paints.filter((paint) => paint.follows === 'dominant');
  const patterns = plan.images.filter((image) => image.follows === 'position');
  const shownPaints = new Map<TileflowThemeBlendPaint, string>();
  const shownSwitches = new Map<TileflowThemeBlendSwitch, string>();
  const shownImages = new Map<TileflowThemeBlendImage, string>();
  let shownLight: string | undefined;
  const baked = clamp(options.baked);
  let position = baked;
  let dominant = Math.round(baked);
  let target = baked;
  let stepped = baked;
  let scheduled = false;
  let disposed = false;
  let queue: Promise<void> = Promise.resolve();

  // The style already shows the baked position: ground at it, symbols at its nearest theme.
  for (const paint of ground)
    shownPaints.set(paint, key(fillTileflowThemeBlendTemplate(paint.template, baked)));
  for (const paint of symbols)
    shownPaints.set(paint, key(fillTileflowThemeBlendTemplate(paint.template, dominant)));
  for (const entry of plan.switches) shownSwitches.set(entry, key(entry.values[dominant] ?? null));
  for (const image of patterns) shownImages.set(image, imageKey(image, baked));
  if (plan.light !== undefined) shownLight = key(fillTileflowThemeBlendTemplate(plan.light, baked));

  function groundValues(at: number): NativeThemeValues | undefined {
    const paint: NativeThemeValue[] = [];
    for (const entry of ground) {
      const value = fillTileflowThemeBlendTemplate(entry.template, at);
      const shown = key(value);
      if (shownPaints.get(entry) === shown) continue;
      shownPaints.set(entry, shown);
      paint.push([entry.layer, entry.property, value]);
    }
    const images: NativeThemeImage[] = [];
    for (const image of patterns) {
      const shown = imageKey(image, at);
      if (shownImages.get(image) === shown) continue;
      shownImages.set(image, shown);
      const [index, t] = imageMix(image, at);
      images.push([image.names[0]!, image.names[index]!, image.names[index + 1]!, t]);
    }
    let light: Record<string, unknown> | undefined;
    if (plan.light !== undefined) {
      const value = fillTileflowThemeBlendTemplate(plan.light, at);
      const shown = key(value);
      if (shown !== shownLight) {
        shownLight = shown;
        light = value as Record<string, unknown>;
      }
    }
    if (!paint.length && !images.length && light === undefined) return undefined;
    return {paint, images, ...(light === undefined ? {} : {light})};
  }

  function nearestValues(theme: number): NativeThemeValues | undefined {
    const paint: NativeThemeValue[] = [];
    const layout: NativeThemeValue[] = [];
    for (const entry of symbols) {
      const value = fillTileflowThemeBlendTemplate(entry.template, theme);
      const shown = key(value);
      if (shownPaints.get(entry) === shown) continue;
      shownPaints.set(entry, shown);
      paint.push([entry.layer, entry.property, value]);
    }
    for (const entry of plan.switches) {
      // `null` restores a property that the nearest theme does not set.
      const value = entry.values[theme] ?? null;
      const shown = key(value);
      if (shownSwitches.get(entry) === shown) continue;
      shownSwitches.set(entry, shown);
      (entry.group === 'paint' ? paint : layout).push([entry.layer, entry.property, value]);
    }
    if (!paint.length && !layout.length) return undefined;
    return {paint, layout};
  }

  async function step(): Promise<void> {
    scheduled = false;
    if (disposed) return;
    const goal = target;
    stepped = goal;
    const reachesTheme = goal % 1 === 0 && goal !== position;
    if (Math.abs(goal - position) >= minimumStep || reachesTheme) {
      position = goal;
      const values = groundValues(position);
      if (values) await port.apply(values);
    }
    const nearest = Math.round(goal);
    if (nearest !== dominant && !disposed) {
      dominant = nearest;
      const values = nearestValues(nearest);
      if (values) {
        const covered = await port.cover(nativeBlendLabelFadeMs).catch(() => false);
        if (disposed) return;
        await port.apply(values);
        // The fade runs while later positions keep applying beneath the cover.
        if (covered) void port.reveal(nativeBlendLabelFadeMs).catch(() => undefined);
      }
    }
  }

  function schedule() {
    if (scheduled || disposed) return;
    scheduled = true;
    queue = queue.then(step).then(
      () => {
        // Positions that arrived while the batch was in flight.
        if (!disposed && target !== stepped) schedule();
      },
      () => {
        if (disposed) return;
        disposed = true;
        options.failed();
      },
    );
  }

  return Object.freeze({
    get position() {
      return position;
    },
    get dominant() {
      return dominant;
    },
    set(next: number): void {
      if (disposed) return;
      target = clamp(next);
      schedule();
    },
    /** Resolves once every scheduled batch has been sent. */
    async whenIdle(): Promise<void> {
      for (;;) {
        const pending = queue;
        await pending;
        if (pending === queue && !scheduled) return;
      }
    },
    dispose(): void {
      disposed = true;
    },
  });
}

function key(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined';
}

function imageMix(image: TileflowThemeBlendImage, at: number): [number, number] {
  const quantized = Math.round(at * imageSteps) / imageSteps;
  const index = Math.min(image.names.length - 2, Math.max(0, Math.floor(quantized)));
  return [index, Math.min(1, Math.max(0, quantized - index))];
}

function imageKey(image: TileflowThemeBlendImage, at: number): string {
  return imageMix(image, at).join(':');
}
