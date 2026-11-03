import type {TileflowThemeTransitionResult} from './browser';
import {applyTileflowColorOverrides, type TileflowColorOverrides} from './color-program-runtime';
import {materializeTileflowStyleFamily} from './style-family';
import {readTileflowFamilyValue, type TileflowStyleFamily} from './style-family';
import {tileflowPaintReadsFeature} from './style-family-render';
import {mixTileflowColours} from './theme-blend';
import type {MapLibreStyle} from './types';

type Snapshot = {values: unknown[]; metadata: unknown; light: unknown; sky: unknown};
export type TileflowFamilyFrame = {
  metadata: readonly unknown[];
  lights: readonly unknown[];
  skies: readonly unknown[];
  position: number;
};
type Mixer = (t: number) => unknown;
type Pair = {
  from: Snapshot;
  to: Snapshot;
  mixers: (Mixer | undefined)[];
  metadata: Mixer;
  light: Mixer;
  sky: Mixer;
};

/** A parameter animation owns no sources, meshes, style reloads or application layers. */
export function createTileflowFamilyAnimator(options: {
  family: TileflowStyleFamily;
  initialTheme: string;
  initialColors?: TileflowColorOverrides;
  writePaint(layer: string, property: string, value: unknown): void;
  onFrame(frame: TileflowFamilyFrame): void;
  requestFrame?: (callback: (time: number) => void) => number;
  cancelFrame?: (id: number) => void;
  now?: () => number;
}) {
  const {family} = options;
  if (!family.updates.appearanceOnly)
    throw new TypeError('This family has structural alternatives.');
  const layers = family.updates.paint.map(([index]) =>
    String(readTileflowFamilyValue(family, ['layers', index, 'id'], options.initialTheme)),
  );
  const now = options.now ?? (() => performance.now());
  let overrides: TileflowColorOverrides = Object.freeze({...options.initialColors});
  let currentTheme = options.initialTheme;
  let styles = new Map<string, MapLibreStyle>();
  let shown = snapshot(options.initialTheme);
  let frameState: TileflowFamilyFrame = {
    metadata: [shown.metadata],
    lights: [shown.light],
    skies: [shown.sky],
    position: 0,
  };
  let frame: number | undefined;
  let settle: ((value: TileflowThemeTransitionResult) => void) | undefined;
  let sample: (() => Snapshot) | undefined;
  let disposed = false;
  let generation = 0;
  let blend: {key: string; themes: readonly string[]; pair: Pair; position: number} | undefined;

  function pair(from: Snapshot, to: Snapshot): Pair {
    return {
      from,
      to,
      mixers: from.values.map((v, i) =>
        same(v, to.values[i]) ? undefined : paintMixer(v, to.values[i]),
      ),
      metadata: mix(from.metadata, to.metadata),
      light: mix(from.light, to.light),
      sky: mix(from.sky, to.sky),
    };
  }
  function samplePair(p: Pair, t: number): Snapshot {
    return {
      values: p.mixers.map((value, i) => (value ? value(t) : p.from.values[i])),
      metadata: p.metadata(t),
      light: p.light(t),
      sky: p.sky(t),
    };
  }

  function document(theme: string): MapLibreStyle {
    let value = styles.get(theme);
    if (!value) {
      value = applyTileflowColorOverrides(materializeTileflowStyleFamily(family, theme), overrides);
      styles.set(theme, value);
      if (styles.size > 4) styles.delete(styles.keys().next().value!);
    }
    return value;
  }
  function snapshot(theme: string): Snapshot {
    if (Object.keys(overrides).length) {
      const style = document(theme);
      return {
        values: family.updates.paint.map(
          ([index, name]) =>
            (style.layers[index]?.paint as Record<string, unknown> | undefined)?.[name],
        ),
        metadata: style.metadata,
        light: style.light,
        sky: style.sky,
      };
    }
    return {
      values: family.updates.paint.map(([index, name]) =>
        readTileflowFamilyValue(family, ['layers', index, 'paint', name], theme),
      ),
      metadata: readTileflowFamilyValue(family, ['metadata'], theme),
      light: readTileflowFamilyValue(family, ['light'], theme),
      sky: readTileflowFamilyValue(family, ['sky'], theme),
    };
  }
  function cancel() {
    generation += 1;
    if (frame !== undefined) options.cancelFrame?.(frame);
    frame = undefined;
    if (sample) shown = sample();
    sample = undefined;
    blend = undefined;
    settle?.({status: 'superseded'});
    settle = undefined;
  }
  function write(from: Snapshot, to: Snapshot, mixers: (Mixer | undefined)[], t: number) {
    for (let index = 0; index < mixers.length; index += 1) {
      if (!mixers[index]) continue;
      options.writePaint(layers[index]!, family.updates.paint[index]![1], mixers[index]!(t));
    }
    frameState = {
      metadata: [from.metadata, to.metadata],
      lights: [from.light, to.light],
      skies: [from.sky, to.sky],
      position: t,
    };
    options.onFrame(frameState);
  }
  function change(
    to: Snapshot,
    theme: string,
    duration: number,
  ): Promise<TileflowThemeTransitionResult> {
    if (disposed) return Promise.resolve({status: 'superseded', theme});
    cancel();
    const run = generation;
    const from = shown;
    const mixers = from.values.map((value, i) =>
      same(value, to.values[i]) ? undefined : paintMixer(value, to.values[i]),
    );
    let position = 0;
    const metadata = mix(from.metadata, to.metadata);
    const light = mix(from.light, to.light);
    const sky = mix(from.sky, to.sky);
    sample = () => ({
      values: mixers.map((value, i) => (value ? value(position) : from.values[i])),
      metadata: metadata(position),
      light: light(position),
      sky: sky(position),
    });
    return new Promise((resolve) => {
      settle = resolve;
      const started = now();
      const step = () => {
        if (disposed || run !== generation) return;
        frame = undefined;
        const progress =
          duration > 0 && options.requestFrame ? Math.min(1, (now() - started) / duration) : 1;
        position = progress * progress * (3 - 2 * progress);
        try {
          write(from, to, mixers, position);
        } catch (error) {
          // Restore the last committed/sampled appearance. Errors remain visible to the caller.
          try {
            write(
              to,
              from,
              to.values.map((v, i) => mix(v, from.values[i])),
              1,
            );
          } catch {
            /* Renderer owns its diagnostics. */
          }
          sample = undefined;
          settle = undefined;
          resolve({
            status: 'failed',
            theme,
            error: error instanceof Error ? error : new Error(String(error)),
          });
          return;
        }
        if (progress === 1) {
          shown = to;
          sample = undefined;
          settle = undefined;
          resolve({status: 'applied', theme});
        } else frame = options.requestFrame!(step);
      };
      step();
    });
  }
  return {
    get frame() {
      return frameState;
    },
    dispose() {
      cancel();
      disposed = true;
    },
    getStyle: document,
    getColors: () => Object.freeze({...overrides}),
    setColors(value: TileflowColorOverrides, duration: number) {
      if (disposed) return Promise.resolve({status: 'superseded'} as const);
      try {
        const blending = blend;
        // Only materialize the visible endpoints; other presets remain shared until selected.
        const candidate = new Map(
          [...new Set([currentTheme, ...(blending?.themes ?? [])])].map((theme) => [
            theme,
            applyTileflowColorOverrides(materializeTileflowStyleFamily(family, theme), value),
          ]),
        );
        const previous = {overrides, styles};
        const nextOverrides = Object.freeze({...value});
        overrides = nextOverrides;
        styles = candidate;
        const next = blending
          ? samplePair(
              pair(snapshot(blending.themes[0]!), snapshot(blending.themes[1]!)),
              blending.position,
            )
          : snapshot(currentTheme);
        return change(next, currentTheme, duration).then((result) => {
          if (result.status === 'failed' && overrides === nextOverrides) {
            overrides = previous.overrides;
            styles = previous.styles;
          }
          return result;
        });
      } catch (error) {
        return Promise.resolve({
          status: 'failed',
          error: error instanceof Error ? error : new Error(String(error)),
        } as const);
      }
    },
    setTheme(theme: string, duration: number) {
      if (disposed) return Promise.resolve({status: 'superseded', theme} as const);
      try {
        const next = snapshot(theme);
        const previousTheme = currentTheme;
        currentTheme = theme;
        const pending = change(next, theme, duration);
        const run = generation;
        return pending.then((result) => {
          if (result.status === 'failed' && run === generation) currentTheme = previousTheme;
          return result;
        });
      } catch (error) {
        return Promise.resolve({
          status: 'failed',
          theme,
          error: error instanceof Error ? error : new Error(String(error)),
        } as const);
      }
    },
    setBlend(themes: readonly string[], position: number) {
      if (disposed) return Promise.resolve({status: 'superseded'} as const);
      if (
        !themes.length ||
        !Number.isFinite(position) ||
        position < 0 ||
        position > themes.length - 1
      )
        return Promise.resolve({
          status: 'failed',
          error: new TypeError('Invalid family blend position.'),
        } as const);
      try {
        const lower = Math.floor(position);
        const upper = Math.min(themes.length - 1, lower + 1);
        const key = `${themes[lower]}/${themes[upper]}`;
        const t = position - lower;
        const entering = blend?.key !== key;
        // Validate both endpoints before cancelling the currently valid appearance.
        const prepared = entering
          ? pair(snapshot(themes[lower]!), snapshot(themes[upper]!))
          : undefined;
        const previous = sample?.() ?? shown;
        if (entering) {
          cancel();
          blend = {key, themes: [themes[lower]!, themes[upper]!], pair: prepared!, position: t};
        }
        const p = blend!.pair;
        blend!.position = t;
        try {
          write(
            p.from,
            p.to,
            entering ? p.mixers.map((value, i) => value ?? (() => p.from.values[i])) : p.mixers,
            t,
          );
        } catch (error) {
          cancel();
          shown = previous;
          try {
            write(
              previous,
              previous,
              previous.values.map((value) => () => value),
              1,
            );
          } catch {
            /* The renderer also reports a lost or unavailable context. */
          }
          throw error;
        }
        sample = () => samplePair(p, t);
        currentTheme = themes[Math.round(position)]!;
        return Promise.resolve({status: 'applied', theme: themes[Math.round(position)]} as const);
      } catch (error) {
        return Promise.resolve({
          status: 'failed',
          error: error instanceof Error ? error : new Error(String(error)),
        } as const);
      }
    },
  };
}

/** Prepare only differing branches once, keeping shared expression structure outside the clock. */
function paintMixer(a: unknown, b: unknown): Mixer {
  if (tileflowPaintReadsFeature(a) || tileflowPaintReadsFeature(b)) return (t) => (t < 0.5 ? a : b);
  return mix(a, b);
}

function mix(a: unknown, b: unknown): Mixer {
  if (same(a, b)) return () => a;
  if (typeof a === 'number' && typeof b === 'number') return (t) => a + (b - a) * t;
  if (typeof a === 'string' && typeof b === 'string' && mixTileflowColours(a, b, 0.5) !== undefined)
    return (t) => (t === 0 ? a : t === 1 ? b : mixTileflowColours(a, b, t));
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    const entries = a.map((v, i) => mix(v, b[i]));
    return (t) => entries.map((v) => v(t));
  }
  if (record(a) && record(b) && same(Object.keys(a).sort(), Object.keys(b).sort())) {
    const entries = Object.entries(a).map(([key, value]) => [key, mix(value, b[key])] as const);
    return (t) => Object.fromEntries(entries.map(([key, value]) => [key, value(t)]));
  }
  return (t) => (t < 0.5 ? a : b);
}
export function mixTileflowFamilyValues(a: unknown, b: unknown, position: number): unknown {
  return mix(a, b)(position);
}
function same(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
