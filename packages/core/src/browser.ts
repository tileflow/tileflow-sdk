import type {TileflowWorldRequestBridge} from './fair-use-browser';
import {isTileflowThemeName} from './portable-identity-rules';
import {
  getTileflowStyleFontFaces,
  resolveTileflowAnalyticsRequestUrl,
  startTileflowSession,
  type TileflowAnalytics,
  type TileflowRuntimeColorScheme,
  type TileflowRuntimeStyle,
  type TileflowSessionController,
  type TileflowStyleFontFace,
} from './runtime';
import {
  fillTileflowThemeBlendTemplate,
  planTileflowThemeBlend,
  type TileflowThemeBlendPlan,
} from './theme-blend';
import {
  emphasizeTileflowValue,
  firstColour,
  planTileflowEmphasis,
  type TileflowEmphasis,
  tileflowEmphasisGround,
  type TileflowEmphasisTarget,
  validateTileflowEmphasis,
} from './theme-emphasis';
import {
  beginTileflowStyleCrossfade,
  canBlendTileflowThemes,
  createTileflowThemeBlender,
  prefersReducedMotion,
  type TileflowThemeBlender,
  type TileflowThemeMotionMap,
  tileflowThemeMotionView,
} from './theme-motion-browser';
import type {MapLibreStyle} from './types';

export {attachTileflowAtmosphere, type TileflowAtmosphereMap} from './atmosphere-browser';
export {
  validateTileflowEmphasis,
  type TileflowEmphasis,
  type TileflowEmphasisArea,
  type TileflowEmphasisModule,
} from './theme-emphasis';
export {tileflowLayerDomainMetadataKey} from './layer-domain';

export * from './fair-use-browser';
export {
  registerTileflowContourProtocol,
  tileflowMaplibreContourVersion,
  type TileflowContourProtocolHandler,
  type TileflowContourProtocolRegistrationOptions,
  type TileflowContourProtocolRegistry,
  type TileflowContourProtocolRequest,
  type TileflowContourProtocolResponse,
} from './contour-browser';
export {
  registerTileflowPmtilesProtocol,
  tileflowPmtilesMaximumDirectoryDepth,
  tileflowPmtilesProtocol,
  type TileflowPmtilesProtocolRegistrationOptions,
  type TileflowPmtilesProtocolHandler,
  type TileflowPmtilesProtocolRegistry,
} from './pmtiles-browser';

export type TileflowMapReadinessState = 'error' | 'idle' | 'loading';

type TileflowColorSchemeMediaQuery = {
  addEventListener?: (event: 'change', listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  matches: boolean;
  removeEventListener?: (event: 'change', listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
};

const systemColorSchemeListeners = new Set<(scheme: TileflowRuntimeColorScheme) => void>();
let systemColorSchemeQuery: TileflowColorSchemeMediaQuery | undefined;
let systemColorScheme: TileflowRuntimeColorScheme = 'light';

/** Read the browser preference without persisting or mutating user state. */
export function getTileflowSystemColorScheme(): TileflowRuntimeColorScheme {
  ensureSystemColorSchemeQuery();
  return systemColorScheme;
}

/**
 * Subscribe through one process-wide `matchMedia` listener, regardless of adapter or map count.
 */
export function subscribeTileflowSystemColorScheme(
  listener: (scheme: TileflowRuntimeColorScheme) => void,
): () => void {
  ensureSystemColorSchemeQuery();
  systemColorSchemeListeners.add(listener);
  return () => {
    systemColorSchemeListeners.delete(listener);
    if (systemColorSchemeListeners.size === 0 && systemColorSchemeQuery) {
      systemColorSchemeQuery.removeEventListener?.('change', handleSystemColorSchemeChange);
      systemColorSchemeQuery.removeListener?.(handleSystemColorSchemeChange);
      systemColorSchemeQuery = undefined;
    }
  };
}

function ensureSystemColorSchemeQuery(): void {
  if (systemColorSchemeQuery) return;
  const browser = globalThis as typeof globalThis & {
    matchMedia?: (query: string) => TileflowColorSchemeMediaQuery;
  };
  if (!browser.matchMedia) {
    systemColorScheme = 'light';
    return;
  }
  systemColorSchemeQuery = browser.matchMedia('(prefers-color-scheme: dark)');
  systemColorScheme = systemColorSchemeQuery.matches ? 'dark' : 'light';
  systemColorSchemeQuery.addEventListener?.('change', handleSystemColorSchemeChange);
  if (!systemColorSchemeQuery.addEventListener) {
    systemColorSchemeQuery.addListener?.(handleSystemColorSchemeChange);
  }
}

function handleSystemColorSchemeChange(): void {
  if (!systemColorSchemeQuery) return;
  const next = systemColorSchemeQuery.matches ? 'dark' : 'light';
  if (next === systemColorScheme) return;
  systemColorScheme = next;
  for (const listener of systemColorSchemeListeners) listener(next);
}

export type TileflowThemeTransitionPhase = 'applying' | 'error' | 'preloading' | 'ready';

export type TileflowThemeTransition = Readonly<{
  currentTheme?: string;
  error?: Error;
  phase: TileflowThemeTransitionPhase;
  targetTheme?: string;
}>;

export type TileflowThemeTransitionResult = Readonly<{
  error?: Error;
  status: 'applied' | 'failed' | 'superseded';
  theme?: string;
}>;

/**
 * How a theme change appears. With a `duration`, the map cross-fades from the previous theme to
 * the new one: a snapshot of the previous frame covers the map, follows the camera, and fades out
 * once the new theme is drawn. A browser preference for reduced motion changes at once.
 */
export type TileflowThemeTransitionOptions = Readonly<{
  /** Cross-fade length in milliseconds, from 0 (the default, an immediate change) to 5000. */
  duration?: number;
}>;

export type TileflowThemeChangeOptions = Readonly<{
  transition?: TileflowThemeTransitionOptions;
}>;

/**
 * A continuous mix of two or more themes of the same map. `position` places the map between
 * neighbouring themes: 0 is the first, 1 the second, and 1.25 a quarter of the way from the second
 * to the third. Ground colours, patterns, the sky, and light follow the position; labels and icons
 * cross-fade when the nearest theme changes.
 */
export type TileflowThemeBlendRequest = Readonly<{
  position: number;
  /** Two to eight concrete themes of one map, in blend order. */
  themes: readonly TileflowRuntimeStyle[];
}>;

export type TileflowThemeBlendState = Readonly<{
  position: number;
  themes: readonly string[];
}>;

export type TileflowStyleSwitchMap = TileflowThemeMotionMap & {
  getGlobalState?: unknown;
  off(event: string, listener: (event?: unknown) => void): unknown;
  on(event: string, listener: (event?: unknown) => void): unknown;
  setGlobalStateProperty?: unknown;
  setStyle: unknown;
};

/** A value an application sets for the whole style, which themes read with `expr.globalState`. */
export type TileflowStyleStateValue = boolean | number | string | null;

export type TileflowThemeController = {
  dispose(): void;
  /** The active blend, or undefined when the map shows one theme. */
  getBlend(): TileflowThemeBlendState | undefined;
  /** The theme the map shows; during a blend, the nearest theme. */
  getCurrent(): TileflowRuntimeStyle;
  /** The emphasis requested last, or undefined when the map is shown as designed. */
  getEmphasis(): TileflowEmphasis | undefined;
  /** The value a style state was set to last, or undefined when it has not been set. */
  getState(name: string): TileflowStyleStateValue | undefined;
  /**
   * Shows a blend of themes. The first request for a set of themes loads their styles and
   * prepares one style that holds all of them; later requests for the same themes only move the
   * position and take effect at once, so they can follow an animation or a slider.
   */
  setBlend(
    request: TileflowThemeBlendRequest,
    options?: TileflowThemeChangeOptions,
  ): Promise<TileflowThemeTransitionResult>;
  /**
   * Makes chosen modules of the map recede and its labels and icons fade, so an application's own
   * content reads first; `undefined` returns the map to its design. The change eases over the
   * transition, and the emphasis stays through later theme changes and blend positions. Values
   * that MapLibre evaluates per feature change at once, under a cross-fade.
   */
  setEmphasis(
    emphasis: TileflowEmphasis | undefined,
    options?: TileflowThemeChangeOptions,
  ): Promise<TileflowThemeTransitionResult>;
  /**
   * Sets a style-wide state that the map's themes read with `expr.globalState(name)`. A number
   * eases from the value it shows to the new one over the transition, so a colour or size that a
   * theme interpolates on it moves smoothly; other values, and a number set for the first time,
   * change at once. A value that also reads feature data or feature state is laid out again by
   * MapLibre at each change, so it follows late and costs more. States stay through theme changes
   * and blends. Needs a MapLibre map with global state (GL JS 5.6 or later).
   */
  setState(
    name: string,
    value: TileflowStyleStateValue,
    options?: TileflowThemeChangeOptions,
  ): Promise<TileflowThemeTransitionResult>;
  setTheme(
    style: TileflowRuntimeStyle,
    options?: TileflowThemeChangeOptions,
  ): Promise<TileflowThemeTransitionResult>;
};

const maximumBlendThemes = 8;
const maximumTransitionMs = 5_000;
/** Labels and icons cross-fade this long when the nearest theme of a blend changes. */
const blendLabelFadeMs = 450;
const maximumTileflowBlendStyleBytes = 16 * 1024 * 1024;

type ActiveBlend = {
  blender: TileflowThemeBlender;
  key: string;
  plan: TileflowThemeBlendPlan;
  themes: readonly TileflowRuntimeStyle[];
};
type PendingBlend = {
  key: string;
  position: number;
  promise: Promise<TileflowThemeTransitionResult>;
};
type Shown = {blend?: ActiveBlend; style: MapLibreStyle | string};
// A style state: the value it was set to, the value on the map (between the two while a number
// eases), and the motion moving it.
type StyleState = {
  run: number;
  settle?: (result: TileflowThemeTransitionResult) => void;
  shown: TileflowStyleStateValue | undefined;
  stop?: () => void;
  value: TileflowStyleStateValue;
};
type Target =
  | {kind: 'theme'; style: TileflowRuntimeStyle; transition: number}
  | {
      kind: 'blend';
      key: string;
      plan: TileflowThemeBlendPlan;
      position: () => number;
      themes: readonly TileflowRuntimeStyle[];
      transition: number;
    };

function validateStyleState(name: unknown, value: unknown): TypeError | undefined {
  if (typeof name !== 'string' || !name.trim())
    return new TypeError('Style state names must be non-empty strings.');
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return undefined;
  return new TypeError('Style state values must be booleans, finite numbers, strings, or null.');
}

/**
 * Transactionally changes a MapLibre style while preserving the map instance and camera.
 * Independent font preloads start immediately; style application is serialized and last request wins.
 */
export function createTileflowThemeController(options: {
  initial: TileflowRuntimeStyle;
  loadFonts?: (style: TileflowRuntimeStyle) => Promise<void>;
  /** Loads a theme's style document for a blend; defaults to a same-origin-credentials fetch. */
  loadStyle?: (url: string) => Promise<MapLibreStyle>;
  map: TileflowStyleSwitchMap;
  onTransition?: (transition: TileflowThemeTransition) => void;
  timeoutMs?: number;
  /** The default for every change; each change may pass its own. */
  transition?: TileflowThemeTransitionOptions;
}): TileflowThemeController {
  assertConcreteRuntimeTheme(options.initial, 'initial');
  const loadFonts =
    options.loadFonts ??
    ((runtimeStyle: TileflowRuntimeStyle) =>
      loadTileflowStyleFonts(runtimeStyle.style, {fontFaces: runtimeStyle.fontFaces}));
  const loadStyle = options.loadStyle ?? loadTileflowBlendStyle;
  const timeoutMs = normalizeThemeTransitionTimeout(options.timeoutMs);
  const defaultTransition = normalizeThemeTransitionDuration(options.transition);
  const styleIdentities = new WeakMap<object, number>();
  let nextStyleIdentity = 0;
  let current = options.initial;
  let shown: Shown = {style: options.initial.style};
  let activeBlend: ActiveBlend | undefined;
  let pendingBlend: PendingBlend | undefined;
  let disposed = false;
  let requestId = 0;
  let applyQueue: Promise<void> = Promise.resolve();
  // The layers of the style the map shows, as they were applied, for emphasis.
  let shownLayers: readonly unknown[] | undefined =
    typeof options.initial.style === 'string' ? undefined : options.initial.style.layers;
  // Emphasis: the latest request, the request whose values are on the map (kept while it eases
  // out), its eased strength and goal, and the values it changes in the shown style.
  let emphasis: TileflowEmphasis | undefined;
  let emphasisShown: TileflowEmphasis | undefined;
  let emphasisStrength = 0;
  let emphasisGoal = 0;
  let emphasisTargets = new Map<string, TileflowEmphasisTarget>();
  let emphasisBase = new Map<string, unknown>();
  let emphasisBlended = new Set<string>();
  let emphasisGroundTemplate: unknown;
  let emphasisStaticGround: string | undefined;
  const emphasisWritten = new Map<string, string>();
  let emphasisRun = 0;
  let emphasisFrame: (() => void) | undefined;
  let emphasisSettle: ((result: TileflowThemeTransitionResult) => void) | undefined;
  const states = new Map<string, StyleState>();

  return {
    dispose() {
      disposed = true;
      requestId += 1;
      activeBlend?.blender.dispose();
      stopEmphasisMotion({status: 'superseded', theme: current.theme});
      for (const state of states.values())
        stopStateMotion(state, {status: 'superseded', theme: current.theme});
    },
    getBlend() {
      if (!activeBlend) return undefined;
      return {
        position: activeBlend.blender.position,
        themes: activeBlend.themes.map((theme) => theme.theme!),
      };
    },
    getCurrent() {
      return current;
    },
    getEmphasis() {
      return emphasis;
    },
    getState(name) {
      return typeof name === 'string' ? states.get(name.trim())?.value : undefined;
    },
    setState(name, value, changeOptions) {
      const invalid = validateStyleState(name, value);
      if (invalid) return Promise.resolve({error: invalid, status: 'failed', theme: current.theme});
      if (disposed) return Promise.resolve(disposedResult(current.theme));
      if (typeof options.map.setGlobalStateProperty !== 'function') {
        return Promise.resolve({
          error: new TypeError('Style states need a MapLibre map with global state (GL JS 5.6+).'),
          status: 'failed',
          theme: current.theme,
        });
      }
      const transition = transitionOf(changeOptions);
      if (transition instanceof TypeError)
        return Promise.resolve({error: transition, status: 'failed', theme: current.theme});
      return changeState(name.trim(), value, reducedMotion() ? 0 : transition);
    },
    setEmphasis(request, changeOptions) {
      if (request !== undefined) {
        const invalid = validateTileflowEmphasis(request);
        if (invalid)
          return Promise.resolve({error: invalid, status: 'failed', theme: current.theme});
      }
      if (disposed) return Promise.resolve(disposedResult(current.theme));
      const transition = transitionOf(changeOptions);
      if (transition instanceof TypeError)
        return Promise.resolve({error: transition, status: 'failed', theme: current.theme});
      return changeEmphasis(request, reducedMotion() ? 0 : transition);
    },
    setBlend(request, changeOptions) {
      const targetTheme = nearestTheme(request);
      const invalid = validateBlendRequest(request);
      if (invalid) return Promise.resolve({error: invalid, status: 'failed', theme: targetTheme});
      if (disposed) return Promise.resolve(disposedResult(targetTheme));
      const transition = transitionOf(changeOptions);
      if (transition instanceof TypeError)
        return Promise.resolve({error: transition, status: 'failed', theme: targetTheme});
      const key = blendKey(request.themes);
      if (activeBlend?.key === key) {
        // The same themes: only the position moves, at once, superseding older pending changes.
        requestId += 1;
        activeBlend.blender.set(request.position);
        current = activeBlend.themes[activeBlend.blender.dominant]!;
        return Promise.resolve({status: 'applied', theme: current.theme});
      }
      if (pendingBlend?.key === key) {
        pendingBlend.position = request.position;
        return pendingBlend.promise;
      }
      const runId = ++requestId;
      options.onTransition?.({currentTheme: current.theme, phase: 'preloading', targetTheme});
      const pending: PendingBlend = {key, position: request.position, promise: undefined!};
      pending.promise = prepareBlend(request.themes)
        .then(
          (plan) =>
            enqueue(runId, {
              key,
              kind: 'blend',
              plan,
              position: () => pending.position,
              themes: request.themes,
              transition,
            }),
          (error: unknown) => handlePreloadFailure(runId, targetTheme, error),
        )
        .finally(() => {
          if (pendingBlend === pending) pendingBlend = undefined;
        });
      pendingBlend = pending;
      return pending.promise;
    },
    setTheme(style, changeOptions) {
      const invalidTheme = validateConcreteRuntimeTheme(style, 'target');
      if (invalidTheme) {
        return Promise.resolve({error: invalidTheme, status: 'failed', theme: style.theme});
      }
      if (disposed) return Promise.resolve(disposedResult(style.theme));
      const transition = transitionOf(changeOptions);
      if (transition instanceof TypeError)
        return Promise.resolve({error: transition, status: 'failed', theme: style.theme});
      const runId = ++requestId;
      pendingBlend = undefined;
      options.onTransition?.({
        currentTheme: current.theme,
        phase: 'preloading',
        targetTheme: style.theme,
      });
      let preloaded: Promise<void>;
      try {
        preloaded = loadFonts(style);
      } catch (error) {
        return Promise.resolve(handlePreloadFailure(runId, style.theme, error));
      }
      return preloaded.then(
        () => enqueue(runId, {kind: 'theme', style, transition}),
        (error: unknown) => handlePreloadFailure(runId, style.theme, error),
      );
    },
  };

  function transitionOf(changeOptions: TileflowThemeChangeOptions | undefined): number | TypeError {
    if (changeOptions?.transition === undefined) return defaultTransition;
    try {
      return normalizeThemeTransitionDuration(changeOptions.transition);
    } catch (error) {
      return error as TypeError;
    }
  }

  function blendKey(themes: readonly TileflowRuntimeStyle[]): string {
    return JSON.stringify(
      themes.map((theme) => {
        if (typeof theme.style === 'string') return [theme.theme, theme.style];
        let identity = styleIdentities.get(theme.style);
        if (identity === undefined) {
          nextStyleIdentity += 1;
          identity = nextStyleIdentity;
          styleIdentities.set(theme.style, identity);
        }
        return [theme.theme, identity];
      }),
    );
  }

  async function prepareBlend(
    themes: readonly TileflowRuntimeStyle[],
  ): Promise<TileflowThemeBlendPlan> {
    if (!canBlendTileflowThemes(options.map)) {
      throw new TypeError('Tileflow theme blends require a MapLibre GL JS map.');
    }
    const [styles] = await Promise.all([
      Promise.all(
        themes.map((theme) =>
          typeof theme.style === 'string' ? loadStyle(theme.style) : Promise.resolve(theme.style),
        ),
      ),
      Promise.all(themes.map((theme) => loadFonts(theme))),
    ]);
    return planTileflowThemeBlend(styles);
  }

  function enqueue(runId: number, target: Target): Promise<TileflowThemeTransitionResult> {
    const operation = applyQueue.then(
      () => applyTarget(runId, target),
      () => applyTarget(runId, target),
    );
    applyQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  function targetThemeOf(target: Target): string | undefined {
    return target.kind === 'theme'
      ? target.style.theme
      : target.themes[Math.round(clampBlendPosition(target.position(), target.themes.length))]
          ?.theme;
  }

  async function applyTarget(
    runId: number,
    target: Target,
  ): Promise<TileflowThemeTransitionResult> {
    const targetTheme = targetThemeOf(target);
    if (disposed || runId !== requestId) return {status: 'superseded', theme: targetTheme};
    // A new style waits while the map's WebGL context is lost (see whenContextAvailable).
    await whenContextAvailable(options.map);
    if (disposed || runId !== requestId) return {status: 'superseded', theme: targetTheme};
    const previous = {current, shown};
    options.onTransition?.({currentTheme: previous.current.theme, phase: 'applying', targetTheme});
    const cover = beginTileflowStyleCrossfade(options.map, target.transition);
    activeBlend?.blender.dispose();
    activeBlend = undefined;
    const styleInput =
      target.kind === 'theme' ? target.style.style : target.plan.styleAt(target.position());

    try {
      await applyMapStyle(options.map, styleInput, timeoutMs);
      if (disposed) {
        cover?.cancel();
        return {status: 'superseded', theme: targetTheme};
      }
      if (runId !== requestId) {
        // MapLibre cannot cancel an in-flight setStyle(). A newer request can therefore supersede
        // this operation after the style has already reached `style.load`. Restore the last
        // committed style before releasing the serialized queue; otherwise a newer request whose
        // preload fails would leave this superseded style visible and make `current` lie.
        cover?.cancel();
        try {
          await restore(previous);
        } catch {
          // A queued newer operation remains authoritative. If none exists, its own preload error
          // already owns the public transition state and MapLibre owns the restoration diagnostic.
        }
        return {status: 'superseded', theme: targetTheme};
      }
      if (target.kind === 'theme') {
        current = target.style;
        shown = {style: styleInput};
      } else {
        const blender = createBlender(target.plan, target.position());
        activeBlend = {blender, key: target.key, plan: target.plan, themes: target.themes};
        shown = {blend: activeBlend, style: styleInput};
        current = target.themes[blender.dominant]!;
        if (pendingBlend?.key === target.key) pendingBlend = undefined;
      }
      // A new style shows the design; an emphasis returns at once, under the same cross-fade.
      shownLayers = typeof styleInput === 'string' ? undefined : styleInput.layers;
      resetEmphasis();
      resetStates();
      await cover?.finish({stop: () => disposed || runId !== requestId});
      options.onTransition?.({
        currentTheme: current.theme,
        phase: 'ready',
        targetTheme: current.theme,
      });
      return {status: 'applied', theme: current.theme};
    } catch (error) {
      cover?.cancel();
      const normalized = normalizeThemeTransitionError(error, 'Tileflow theme change failed.');
      try {
        await restore(previous);
      } catch {
        // The original failure remains authoritative; the map owns any MapLibre diagnostics.
      }
      if (disposed || runId !== requestId) return {status: 'superseded', theme: targetTheme};
      options.onTransition?.({
        currentTheme: current.theme,
        error: normalized,
        phase: 'error',
        targetTheme,
      });
      return {error: normalized, status: 'failed', theme: targetTheme};
    }
  }

  function createBlender(plan: TileflowThemeBlendPlan, position: number): TileflowThemeBlender {
    return createTileflowThemeBlender(options.map, plan, {
      cover(change) {
        // Values that read feature state switch with a re-layout; a snapshot covers it.
        const fade = beginTileflowStyleCrossfade(options.map, blendLabelFadeMs);
        change();
        void fade?.finish();
      },
      labelFadeMs: reducedMotion() ? 0 : blendLabelFadeMs,
      // The ground colour moves with the blend, and colours that recede follow it.
      onPosition: () => {
        if (emphasisShown) writeEmphasis(false);
      },
      position,
      transform: (layer, property, value) => emphasisValue(layer, property, value),
    });
  }

  async function restore(previous: {current: TileflowRuntimeStyle; shown: Shown}): Promise<void> {
    await whenContextAvailable(options.map);
    const blend = previous.shown.blend;
    if (blend) {
      const position = blend.blender.position;
      const style = blend.plan.styleAt(position);
      await applyMapStyle(options.map, style, timeoutMs);
      activeBlend = {...blend, blender: createBlender(blend.plan, position)};
      shown = {blend: activeBlend, style};
      shownLayers = style.layers;
    } else {
      await applyMapStyle(options.map, previous.shown.style, timeoutMs);
      shown = previous.shown;
      shownLayers = typeof shown.style === 'string' ? undefined : shown.style.layers;
    }
    current = previous.current;
    resetEmphasis();
    resetStates();
  }

  // --- Style states ---

  /** Writes a state to the map; a style still loading takes it once it is applied. */
  function writeState(name: string, value: TileflowStyleStateValue): void {
    const set = options.map.setGlobalStateProperty as
      ((name: string, value: unknown) => unknown) | undefined;
    try {
      set?.call(options.map, name, value);
    } catch {
      // MapLibre refuses while a style loads; resetStates() writes the state after it.
    }
  }

  /** After a new style: every state is written again, at the value it shows. */
  function resetStates(): void {
    for (const [name, state] of states) {
      if (state.shown !== undefined) writeState(name, state.shown);
    }
  }

  function stopStateMotion(state: StyleState, result?: TileflowThemeTransitionResult): void {
    state.stop?.();
    state.stop = undefined;
    const settle = state.settle;
    state.settle = undefined;
    if (result) settle?.(result);
  }

  function changeState(
    name: string,
    value: TileflowStyleStateValue,
    duration: number,
  ): Promise<TileflowThemeTransitionResult> {
    const state: StyleState = states.get(name) ?? {run: 0, shown: undefined, value};
    states.set(name, state);
    stopStateMotion(state, {status: 'superseded', theme: current.theme});
    const run = ++state.run;
    const from = state.shown;
    state.value = value;
    const view = tileflowThemeMotionView(options.map);
    if (
      duration <= 0 ||
      !view ||
      typeof from !== 'number' ||
      typeof value !== 'number' ||
      from === value
    ) {
      state.shown = value;
      writeState(name, value);
      return Promise.resolve({status: 'applied', theme: current.theme});
    }

    return new Promise((resolve) => {
      state.settle = resolve;
      const now = () => view.performance?.now?.() ?? Date.now();
      const start = now();
      // A hundredth of the change is below what the eye sees; skipping it saves writes.
      const least = Math.abs(value - from) / 100;
      let cancelled = false;
      let frame: number | undefined;
      const step = () => {
        frame = undefined;
        if (cancelled || disposed || run !== state.run) return;
        const t = Math.min(1, (now() - start) / duration);
        const eased = t * t * (3 - 2 * t);
        const shown = t >= 1 ? value : from + (value - from) * eased;
        if (t >= 1 || Math.abs(shown - (state.shown as number)) >= least) {
          state.shown = shown;
          writeState(name, shown);
        }
        if (t >= 1) {
          state.stop = undefined;
          state.settle = undefined;
          resolve({status: 'applied', theme: current.theme});
          return;
        }
        frame = view.requestAnimationFrame(step);
      };
      state.stop = () => {
        cancelled = true;
        if (frame !== undefined) view.cancelAnimationFrame(frame);
      };
      frame = view.requestAnimationFrame(step);
    });
  }

  // --- Emphasis ---

  function valueKey(layer: string, property: string): string {
    return `${layer}\u0000${property}`;
  }

  /** The layers of the shown style, as applied: from the style document, or else from the map. */
  function layersShown(): readonly unknown[] {
    if (shownLayers) return shownLayers;
    const getStyle = options.map.getStyle;
    if (typeof getStyle !== 'function') return [];
    const style = (getStyle as () => {layers?: unknown[]} | undefined).call(options.map);
    shownLayers = Array.isArray(style?.layers) ? style.layers : [];
    return shownLayers;
  }

  /**
   * Plans the shown emphasis for the shown style. `onMap` holds the values on the map now; a value
   * not in it shows the design.
   */
  function planEmphasis(onMap: ReadonlyMap<string, string> = new Map()): void {
    const layers = layersShown();
    const targets = emphasisShown ? planTileflowEmphasis(layers, emphasisShown) : [];
    emphasisTargets = new Map(
      targets.map((target) => [valueKey(target.layer, target.property), target]),
    );
    const paintOf = new Map<string, Record<string, unknown>>();
    for (const layer of layers) {
      if (layer && typeof layer === 'object' && typeof (layer as {id?: unknown}).id === 'string') {
        const paint = (layer as {paint?: unknown}).paint;
        paintOf.set(
          (layer as {id: string}).id,
          paint && typeof paint === 'object' ? (paint as Record<string, unknown>) : {},
        );
      }
    }
    emphasisBase = new Map(
      targets.map((target) => [
        valueKey(target.layer, target.property),
        paintOf.get(target.layer)?.[target.property],
      ]),
    );
    emphasisStaticGround = tileflowEmphasisGround(layers);
    emphasisBlended = new Set(
      activeBlend?.plan.paints.map((paint) => valueKey(paint.layer, paint.property)) ?? [],
    );
    const background = layers.find(
      (layer) =>
        layer && typeof layer === 'object' && (layer as {type?: unknown}).type === 'background',
    ) as {id?: unknown} | undefined;
    emphasisGroundTemplate = activeBlend?.plan.paints.find(
      (paint) => paint.layer === background?.id && paint.property === 'background-color',
    )?.template;
    emphasisWritten.clear();
    for (const [key, base] of emphasisBase) {
      emphasisWritten.set(key, onMap.get(key) ?? JSON.stringify(base ?? null));
    }
  }

  /** After a new style: its values show the design, so the emphasis is planned and written anew. */
  function resetEmphasis(): void {
    if (!emphasisShown) return;
    planEmphasis();
    writeEmphasis(true);
  }

  function emphasisGround(): string | undefined {
    if (activeBlend && emphasisGroundTemplate !== undefined) {
      return firstColour(
        fillTileflowThemeBlendTemplate(emphasisGroundTemplate, activeBlend.blender.position),
      );
    }
    return emphasisStaticGround;
  }

  /** A paint value as the emphasis shows it now. Values read per feature are already at the goal. */
  function emphasisValue(layer: string, property: string, value: unknown): unknown {
    const target = emphasisShown ? emphasisTargets.get(valueKey(layer, property)) : undefined;
    if (!target) return value;
    const strength = target.featureData ? emphasisGoal : emphasisStrength;
    return emphasizeTileflowValue(target, value, {
      ground: emphasisGround(),
      keep: strength > 0 ? emphasisShown?.keep : undefined,
      strength,
    });
  }

  /** Writes every emphasised value that changed; `blended` also refreshes the blend's values. */
  function writeEmphasis(blended: boolean): void {
    if (blended && activeBlend && emphasisTargets.size > 0) {
      activeBlend.blender.refresh((layer, property) =>
        emphasisTargets.has(valueKey(layer, property)),
      );
    }
    const setPaint = options.map.setPaintProperty as
      ((layer: string, name: string, value: unknown, options?: object) => unknown) | undefined;
    const getLayer = options.map.getLayer as ((layer: string) => unknown) | undefined;
    if (typeof setPaint !== 'function') return;
    for (const [key, target] of emphasisTargets) {
      if (emphasisBlended.has(key)) continue;
      const value = emphasisValue(target.layer, target.property, emphasisBase.get(key));
      const serialized = JSON.stringify(value ?? null);
      if (emphasisWritten.get(key) === serialized) continue;
      if (typeof getLayer === 'function' && !getLayer.call(options.map, target.layer)) continue;
      emphasisWritten.set(key, serialized);
      setPaint.call(options.map, target.layer, target.property, value, {validate: false});
    }
  }

  function stopEmphasisMotion(result?: TileflowThemeTransitionResult): void {
    emphasisFrame?.();
    emphasisFrame = undefined;
    const settle = emphasisSettle;
    emphasisSettle = undefined;
    if (result) settle?.(result);
  }

  function changeEmphasis(
    request: TileflowEmphasis | undefined,
    duration: number,
  ): Promise<TileflowThemeTransitionResult> {
    stopEmphasisMotion({status: 'superseded', theme: current.theme});
    const run = ++emphasisRun;
    emphasis = request;
    // Values the new request no longer changes go back to the design first.
    const before = emphasisTargets;
    if (request) {
      const leaving = new Map(emphasisWritten);
      const previous = emphasisShown;
      emphasisShown = request;
      planEmphasis(leaving);
      if (previous) {
        const setPaint = options.map.setPaintProperty as (
          layer: string,
          name: string,
          value: unknown,
          options?: object,
        ) => unknown;
        for (const [key, target] of before) {
          if (emphasisTargets.has(key) || typeof setPaint !== 'function') continue;
          const base = layerPaint(target.layer, target.property);
          setPaint.call(options.map, target.layer, target.property, base, {validate: false});
        }
      }
    }
    if (!emphasisShown) return Promise.resolve({status: 'applied', theme: current.theme});

    emphasisGoal = request ? 1 : 0;
    const from = emphasisStrength;
    const to = emphasisGoal;
    // Values read per feature change once, at the start; a snapshot of the map covers them.
    const switches = [...emphasisTargets.values()].some((target) => target.featureData);
    const cover = switches ? beginTileflowStyleCrossfade(options.map, duration) : undefined;
    const view = tileflowThemeMotionView(options.map);

    return new Promise((resolve) => {
      emphasisSettle = resolve;
      const finish = () => {
        emphasisFrame = undefined;
        emphasisStrength = to;
        writeEmphasis(true);
        if (to === 0) {
          // As designed again: nothing left to follow.
          emphasisShown = undefined;
          emphasisTargets = new Map();
          emphasisWritten.clear();
        }
        emphasisSettle = undefined;
        resolve({status: 'applied', theme: current.theme});
      };
      writeEmphasis(true);
      void cover?.finish({stop: () => disposed || run !== emphasisRun});
      if (duration <= 0 || !view || from === to) {
        finish();
        return;
      }
      const now = () => view.performance?.now?.() ?? Date.now();
      const start = now();
      let cancelled = false;
      let frame: number | undefined;
      const step = () => {
        frame = undefined;
        if (cancelled || disposed || run !== emphasisRun) return;
        const t = Math.min(1, (now() - start) / duration);
        const eased = t * t * (3 - 2 * t);
        const strength = from + (to - from) * eased;
        // A hundredth of the change is below what the eye sees; skipping it saves writes.
        if (t >= 1) return finish();
        if (Math.abs(strength - emphasisStrength) >= 0.01) {
          emphasisStrength = strength;
          writeEmphasis(true);
        }
        frame = view.requestAnimationFrame(step);
      };
      emphasisFrame = () => {
        cancelled = true;
        if (frame !== undefined) view.cancelAnimationFrame(frame);
      };
      frame = view.requestAnimationFrame(step);
    });
  }

  /** A layer's paint value in the shown style, as designed. */
  function layerPaint(layer: string, property: string): unknown {
    const key = valueKey(layer, property);
    if (activeBlend && emphasisBlended.has(key))
      return activeBlend.blender.baseValue(layer, property);
    for (const entry of layersShown()) {
      if (entry && typeof entry === 'object' && (entry as {id?: unknown}).id === layer) {
        const paint = (entry as {paint?: Record<string, unknown>}).paint;
        return paint?.[property];
      }
    }
    return undefined;
  }

  function reducedMotion(): boolean {
    const view = tileflowThemeMotionView(options.map);
    return view ? prefersReducedMotion(view) : false;
  }

  function handlePreloadFailure(
    runId: number,
    targetTheme: string | undefined,
    error: unknown,
  ): TileflowThemeTransitionResult {
    if (disposed || runId !== requestId) return {status: 'superseded', theme: targetTheme};
    const normalized = normalizeThemeTransitionError(error, 'Tileflow theme preload failed.');
    options.onTransition?.({
      currentTheme: current.theme,
      error: normalized,
      phase: 'error',
      targetTheme,
    });
    return {error: normalized, status: 'failed', theme: targetTheme};
  }
}

function disposedResult(theme: string | undefined): TileflowThemeTransitionResult {
  return {error: new Error('Tileflow theme controller is disposed.'), status: 'failed', theme};
}

function clampBlendPosition(position: number, themes: number): number {
  return Math.min(themes - 1, Math.max(0, Number.isFinite(position) ? position : 0));
}

function nearestTheme(request: TileflowThemeBlendRequest): string | undefined {
  if (!Array.isArray(request?.themes) || request.themes.length === 0) return undefined;
  return request.themes[Math.round(clampBlendPosition(request.position, request.themes.length))]
    ?.theme;
}

function validateBlendRequest(request: TileflowThemeBlendRequest): TypeError | undefined {
  if (
    !request ||
    !Array.isArray(request.themes) ||
    request.themes.length < 2 ||
    request.themes.length > maximumBlendThemes
  ) {
    return new TypeError(
      `A Tileflow theme blend requires two to ${maximumBlendThemes} concrete themes.`,
    );
  }
  for (const theme of request.themes) {
    const invalid = validateConcreteRuntimeTheme(theme, 'target');
    if (invalid) return invalid;
  }
  if (
    typeof request.position !== 'number' ||
    !Number.isFinite(request.position) ||
    request.position < 0 ||
    request.position > request.themes.length - 1
  ) {
    return new TypeError(
      `A Tileflow theme blend position must be a number from 0 to ${request.themes.length - 1}.`,
    );
  }
  return undefined;
}

function normalizeThemeTransitionDuration(
  transition: TileflowThemeTransitionOptions | undefined,
): number {
  const duration = transition?.duration ?? 0;
  if (
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration < 0 ||
    duration > maximumTransitionMs
  ) {
    throw new TypeError(
      `A Tileflow theme transition duration must be a number of milliseconds from 0 to ${maximumTransitionMs}.`,
    );
  }
  return Math.round(duration);
}

/** Fetches a theme's style document with the same request policy as style font metadata. */
async function loadTileflowBlendStyle(url: string): Promise<MapLibreStyle> {
  const response = await globalThis.fetch(resolveTileflowBrowserResourceUrl(url), {
    cache: 'default',
    credentials: 'same-origin',
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Tileflow theme style failed: ${response.status}`);
  const bytes = await readBoundedTileflowBrowserResource(
    response,
    maximumTileflowBlendStyleBytes,
    'Tileflow theme style',
  );
  const style: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!style || typeof style !== 'object' || !Array.isArray((style as MapLibreStyle).layers)) {
    throw new Error('Tileflow theme style is not a MapLibre style document.');
  }
  return style as MapLibreStyle;
}

function assertConcreteRuntimeTheme(style: TileflowRuntimeStyle, role: 'initial' | 'target'): void {
  const error = validateConcreteRuntimeTheme(style, role);
  if (error) throw error;
}

function validateConcreteRuntimeTheme(
  style: TileflowRuntimeStyle,
  role: 'initial' | 'target',
): TypeError | undefined {
  if (isTileflowThemeName(style.theme)) return undefined;
  return new TypeError(
    `Tileflow theme controller ${role} style requires a concrete portable theme name; received ${JSON.stringify(style.theme)}.`,
  );
}

/**
 * Resolves once the map's WebGL context can draw. MapLibre GL JS 6.12 and 6.13 throw from the frame
 * loop when `setStyle()` runs while the context is lost, so a style waits for
 * `webglcontextrestored`. A map without a canvas, or one whose context cannot be read, is taken to
 * be drawing.
 */
function whenContextAvailable(map: TileflowStyleSwitchMap): Promise<void> {
  if (!isContextLost(map)) return Promise.resolve();
  return new Promise((resolve) => {
    const restored = () => {
      map.off('webglcontextrestored', restored);
      resolve();
    };
    map.on('webglcontextrestored', restored);
  });
}

function isContextLost(map: TileflowStyleSwitchMap): boolean {
  if (typeof map.getCanvas !== 'function') return false;
  try {
    const canvas = (map.getCanvas as () => HTMLCanvasElement | undefined).call(map);
    // The context MapLibre made is returned again; the other kind is null on the same canvas.
    const context = canvas?.getContext?.('webgl2') ?? canvas?.getContext?.('webgl');
    return context?.isContextLost?.() === true;
  } catch {
    return false;
  }
}

function applyMapStyle(
  map: TileflowStyleSwitchMap,
  style: MapLibreStyle | string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      map.off('style.load', handleLoad);
      map.off('error', handleError);
    };
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const handleLoad = () => settle();
    const handleError = (event?: unknown) =>
      settle(
        normalizeThemeTransitionError(
          isRecordWithError(event) ? event.error : event,
          'MapLibre rejected the Tileflow theme.',
        ),
      );
    const timeout = setTimeout(
      () => settle(new Error(`Tileflow theme change timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );

    map.on('style.load', handleLoad);
    map.on('error', handleError);
    try {
      if (typeof map.setStyle !== 'function') {
        throw new TypeError('Tileflow theme changes require MapLibre setStyle().');
      }
      const setStyle = map.setStyle as (
        style: MapLibreStyle | string,
        options?: {diff?: boolean},
      ) => unknown;
      setStyle.call(map, style, {diff: true});
    } catch (error) {
      settle(normalizeThemeTransitionError(error, 'MapLibre rejected the Tileflow theme.'));
    }
  });
}

function normalizeThemeTransitionTimeout(value: number | undefined): number {
  const resolved = value ?? 15_000;
  if (!Number.isSafeInteger(resolved) || resolved < 100 || resolved > 60_000) {
    throw new TypeError('Tileflow theme transition timeout must be an integer from 100 to 60000.');
  }
  return resolved;
}

function normalizeThemeTransitionError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function isRecordWithError(value: unknown): value is {error: unknown} {
  return Boolean(value && typeof value === 'object' && 'error' in value);
}

export type TileflowMapLifecycleEvent =
  'dataloading' | 'error' | 'idle' | 'load' | 'styledataloading';

export type TileflowFrameScheduler<TFrame> = {
  cancelFrame: (frame: TFrame) => void;
  requestFrame: (callback: () => void) => TFrame;
};

export type TileflowMapLifecycleSubscriber<TMap> = (
  map: TMap,
  event: TileflowMapLifecycleEvent,
  listener: () => void,
) => () => void;

export type TileflowSessionSender = (
  analytics: TileflowAnalytics | undefined,
  input: {
    mapId?: string;
    sessionId: string;
    source: string;
    styleId?: string;
  },
) => void;

export type TileflowSessionStarter = {
  clear: () => void;
  start: (analytics: TileflowAnalytics | undefined, styleId?: string) => boolean;
};

export type TileflowMapLifecycleAttachment = {
  dispose: () => void;
  invalidate: (state?: TileflowMapReadinessState) => void;
};

export type TileflowStyleFontLoadOptions = {
  /** Already resolved manifest metadata. An explicit empty array avoids fetching the style. */
  fontFaces?: readonly TileflowStyleFontFace[];
  fetch?: typeof globalThis.fetch;
};

const maximumTileflowFontBytes = 1024 * 1024;
const maximumTileflowFontStyleBytes = 4 * 1024 * 1024;
const loadedTileflowFontFaces = new Map<string, Promise<void>>();

/** Loads content-addressed style font faces before MapLibre starts shaping labels. */
export async function loadTileflowStyleFonts(
  style: MapLibreStyle | string,
  options: TileflowStyleFontLoadOptions = {},
): Promise<void> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const styleUrl = typeof style === 'string' ? resolveTileflowBrowserResourceUrl(style) : undefined;
  const fontFaces =
    options.fontFaces === undefined
      ? typeof style === 'string'
        ? await fetchTileflowStyleFontFaces(styleUrl!, fetcher)
        : getTileflowStyleFontFaces(style)
      : getTileflowStyleFontFaces({
          metadata: {'tileflow:fontFaces': [...options.fontFaces]},
        });

  if (fontFaces.length === 0) return;

  const browser = globalThis as typeof globalThis & {
    FontFace?: new (
      family: string,
      source: ArrayBuffer,
      descriptors?: {style?: string; weight?: string},
    ) => {load(): Promise<unknown>};
    document?: {baseURI?: string; fonts?: {add(face: unknown): unknown}};
  };
  const FontFaceConstructor = browser.FontFace;
  const fontSet = browser.document?.fonts;
  if (!FontFaceConstructor || !fontSet) {
    throw new Error('Tileflow web fonts require the browser FontFace API.');
  }

  await Promise.all(
    fontFaces.map(async (definition) => {
      const source = resolveTileflowBrowserResourceUrl(definition.source, styleUrl);
      const key = `${definition.family}\0${source}\0${definition.style ?? ''}\0${definition.weight ?? ''}`;
      let loaded = loadedTileflowFontFaces.get(key);
      if (!loaded) {
        loaded = loadTileflowFontFace(
          definition,
          source,
          fetcher,
          FontFaceConstructor,
          fontSet,
        ).catch((error: unknown) => {
          loadedTileflowFontFaces.delete(key);
          throw error;
        });
        loadedTileflowFontFaces.set(key, loaded);
      }
      await loaded;
    }),
  );
}

async function fetchTileflowStyleFontFaces(
  styleUrl: string,
  fetcher: typeof globalThis.fetch,
): Promise<TileflowStyleFontFace[]> {
  const response = await fetcher(styleUrl, {
    cache: 'default',
    credentials: 'same-origin',
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Tileflow style font metadata failed: ${response.status}`);
  const source = await readBoundedTileflowBrowserResource(
    response,
    maximumTileflowFontStyleBytes,
    'Tileflow style font metadata',
  );
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(source));
  } catch {
    throw new Error('Tileflow style font metadata is not valid JSON.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Tileflow style font metadata is invalid.');
  }
  return getTileflowStyleFontFaces(input as Pick<MapLibreStyle, 'metadata'>);
}

async function loadTileflowFontFace(
  definition: TileflowStyleFontFace,
  source: string,
  fetcher: typeof globalThis.fetch,
  FontFaceConstructor: new (
    family: string,
    source: ArrayBuffer,
    descriptors?: {style?: string; weight?: string},
  ) => {load(): Promise<unknown>},
  fontSet: {add(face: unknown): unknown},
): Promise<void> {
  const response = await fetcher(source, {
    cache: 'force-cache',
    credentials: 'same-origin',
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Tileflow font failed: ${response.status}`);
  const bytes = await readBoundedTileflowBrowserResource(
    response,
    maximumTileflowFontBytes,
    'Tileflow font',
  );
  const fontFace = new FontFaceConstructor(definition.family, bytes.buffer as ArrayBuffer, {
    ...(definition.style ? {style: definition.style} : {}),
    ...(definition.weight ? {weight: definition.weight} : {}),
  });
  await fontFace.load();
  fontSet.add(fontFace);
}

async function readBoundedTileflowBrowserResource(
  response: Response,
  maximumBytes: number,
  label: string,
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && /^\d+$/u.test(contentLength) && Number(contentLength) > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${label} exceeds the maximum response size.`);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!value) continue;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${label} exceeds the maximum response size.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function resolveTileflowBrowserResourceUrl(value: string, baseUrl?: string): string {
  const browser = globalThis as typeof globalThis & {document?: {baseURI?: string}};
  const base = baseUrl ?? browser.document?.baseURI ?? 'http://localhost/';
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new TypeError('Tileflow font resource URL is invalid.');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new TypeError('Tileflow font resource URL is invalid.');
  }
  return url.toString();
}

export type TileflowTransformRequestParameters = {
  url: string;
};

export type TileflowComposedRequest<TRequest extends TileflowTransformRequestParameters> = Pick<
  TRequest,
  'url'
> &
  Partial<Omit<TRequest, 'url'>>;

export type TileflowTransformRequest<
  TRequest extends TileflowTransformRequestParameters,
  TResourceType,
> = (
  url: string,
  resourceType?: TResourceType,
) => Promise<TileflowComposedRequest<TRequest>> | TileflowComposedRequest<TRequest> | undefined;

export type TileflowUserTransformRequest<
  TRequest extends TileflowTransformRequestParameters,
  TResourceType,
> = (url: string, resourceType?: TResourceType) => Promise<TRequest> | TRequest | undefined;

export type TileflowAsyncAnalyticsTiming = 'request' | 'resolution';

export function createTileflowSessionStarter(options: {
  getSessionId?: () => string;
  sessionId: string;
  source: string;
  startSession?: TileflowSessionSender;
}): TileflowSessionStarter {
  const starts = new Set<string>();
  const send = options.startSession ?? startTileflowSession;

  return {
    clear() {
      starts.clear();
    },
    start(analytics, styleId) {
      const mapId = analytics?.mapId;
      const sessionId = options.getSessionId?.() ?? options.sessionId;

      if (!mapId) {
        return false;
      }

      const key = `${sessionId}:${mapId}:${styleId ?? ''}`;

      if (starts.has(key)) {
        return false;
      }

      starts.add(key);
      send(analytics, {
        mapId,
        sessionId,
        source: options.source,
        styleId,
      });
      return true;
    },
  };
}

export function attachTileflowMapLifecycle<TMap, TFrame>(options: {
  getSession?: () => {analytics: TileflowAnalytics | undefined; styleId?: string};
  map: TMap;
  onLoad?: (map: TMap) => void;
  scheduler: TileflowFrameScheduler<TFrame>;
  sessionStarter?: TileflowSessionStarter;
  setState: (state: TileflowMapReadinessState) => void;
  subscribe: TileflowMapLifecycleSubscriber<TMap>;
}): TileflowMapLifecycleAttachment {
  let disposed = false;
  let generation = 0;
  const frames = new Set<TFrame>();
  const unsubscribers: Array<() => void> = [];

  const cancelFrames = () => {
    for (const frame of frames) {
      options.scheduler.cancelFrame(frame);
    }
    frames.clear();
  };

  const invalidate = (state?: TileflowMapReadinessState) => {
    generation += 1;
    cancelFrames();

    if (state) {
      options.setState(state);
    }
  };

  const scheduleFrame = (callback: () => void) => {
    const frame = options.scheduler.requestFrame(() => {
      frames.delete(frame);
      callback();
    });
    frames.add(frame);
  };

  const handleLoad = () => {
    if (disposed) {
      return;
    }

    options.onLoad?.(options.map);
    const session = options.getSession?.();

    if (session) {
      options.sessionStarter?.start(session.analytics, session.styleId);
    }
  };

  const handleLoading = () => {
    if (!disposed) {
      invalidate('loading');
    }
  };

  const handleIdle = () => {
    if (disposed) {
      return;
    }

    generation += 1;
    cancelFrames();
    const run = generation;

    scheduleFrame(() => {
      if (disposed || generation !== run) {
        return;
      }

      scheduleFrame(() => {
        if (!disposed && generation === run) {
          options.setState('idle');
        }
      });
    });
  };

  const handleError = () => {
    if (!disposed) {
      invalidate('error');
    }
  };

  invalidate('loading');

  try {
    for (const [event, listener] of [
      ['load', handleLoad],
      ['dataloading', handleLoading],
      ['styledataloading', handleLoading],
      ['idle', handleIdle],
      ['error', handleError],
    ] satisfies Array<[TileflowMapLifecycleEvent, () => void]>) {
      unsubscribers.push(options.subscribe(options.map, event, listener));
    }
  } catch (error) {
    disposed = true;
    generation += 1;
    cancelFrames();
    try {
      disposeFunctions(unsubscribers);
    } catch {
      // Preserve the subscription error that caused the partial attachment rollback.
    }
    throw error;
  }

  return {
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      generation += 1;
      cancelFrames();
      disposeFunctions(unsubscribers);
    },
    invalidate(state) {
      if (!disposed) {
        invalidate(state);
      }
    },
  };
}

export function createTileflowTransformRequest<
  TRequest extends TileflowTransformRequestParameters = TileflowTransformRequestParameters,
  TResourceType = unknown,
>(options: {
  always: true;
  asyncAnalyticsTiming?: TileflowAsyncAnalyticsTiming;
  getAnalytics: () => TileflowAnalytics | undefined;
  sessionController?: TileflowSessionController;
  sessionId: string;
  transformRequest?: TileflowUserTransformRequest<TRequest, TResourceType>;
  worldRequestBridge?: TileflowWorldRequestBridge;
}): TileflowTransformRequest<TRequest, TResourceType>;
export function createTileflowTransformRequest<
  TRequest extends TileflowTransformRequestParameters = TileflowTransformRequestParameters,
  TResourceType = unknown,
>(options: {
  always?: boolean;
  asyncAnalyticsTiming?: TileflowAsyncAnalyticsTiming;
  getAnalytics: () => TileflowAnalytics | undefined;
  sessionController?: TileflowSessionController;
  sessionId: string;
  transformRequest?: TileflowUserTransformRequest<TRequest, TResourceType>;
  worldRequestBridge?: TileflowWorldRequestBridge;
}): TileflowTransformRequest<TRequest, TResourceType> | undefined;
export function createTileflowTransformRequest<
  TRequest extends TileflowTransformRequestParameters = TileflowTransformRequestParameters,
  TResourceType = unknown,
>(options: {
  always?: boolean;
  asyncAnalyticsTiming?: TileflowAsyncAnalyticsTiming;
  getAnalytics: () => TileflowAnalytics | undefined;
  sessionController?: TileflowSessionController;
  sessionId: string;
  transformRequest?: TileflowUserTransformRequest<TRequest, TResourceType>;
  worldRequestBridge?: TileflowWorldRequestBridge;
}): TileflowTransformRequest<TRequest, TResourceType> | undefined {
  if (!options.always && !options.transformRequest && !options.worldRequestBridge) {
    const analytics = options.getAnalytics();
    const requiresCommercialSession = Boolean(options.sessionController && analytics?.mapId);

    if (!requiresCommercialSession && (!analytics || analytics.enabled === false)) {
      return undefined;
    }
  }

  const asyncAnalyticsTiming = options.asyncAnalyticsTiming ?? 'request';

  return (url, resourceType) => {
    const request = options.transformRequest?.(url, resourceType);
    const analyticsAtRequest =
      asyncAnalyticsTiming === 'request' ? options.getAnalytics() : undefined;

    if (isPromiseLike(request)) {
      return request.then(
        (resolvedRequest) =>
          applyTileflowRequest(
            url,
            resolvedRequest,
            asyncAnalyticsTiming === 'resolution' ? options.getAnalytics() : analyticsAtRequest,
            options.sessionId,
            options.sessionController,
            options.worldRequestBridge,
          ) ?? resolvedRequest,
      );
    }

    return applyTileflowRequest(
      url,
      request,
      asyncAnalyticsTiming === 'resolution' ? options.getAnalytics() : analyticsAtRequest,
      options.sessionId,
      options.sessionController,
      options.worldRequestBridge,
    );
  };
}

function applyTileflowRequest<TRequest extends TileflowTransformRequestParameters>(
  url: string,
  request: TRequest | undefined,
  analytics: TileflowAnalytics | undefined,
  sessionId: string,
  sessionController: TileflowSessionController | undefined,
  worldRequestBridge: TileflowWorldRequestBridge | undefined,
): Promise<TileflowComposedRequest<TRequest>> | TileflowComposedRequest<TRequest> | undefined {
  const requestUrl = request?.url ?? url;

  if (sessionController) {
    return sessionController
      .resolveRequestUrl(requestUrl, analytics)
      .then(
        (nextUrl) =>
          applyWorldRequestBridge(
            composeTileflowRequest(url, request, nextUrl, true) ??
              ({url} as TileflowComposedRequest<TRequest>),
            worldRequestBridge,
          ) ?? ({url} as TileflowComposedRequest<TRequest>),
      );
  }

  return applyWorldRequestBridge(
    composeTileflowRequest(
      url,
      request,
      resolveTileflowAnalyticsRequestUrl(requestUrl, analytics, sessionId),
      Boolean(worldRequestBridge),
    ),
    worldRequestBridge,
  );
}

function applyWorldRequestBridge<TRequest extends TileflowTransformRequestParameters>(
  request: TileflowComposedRequest<TRequest> | undefined,
  bridge: TileflowWorldRequestBridge | undefined,
): TileflowComposedRequest<TRequest> | undefined {
  if (!request || !bridge) return request;
  const url = bridge.rewriteUrl(request.url);
  return url === request.url ? request : ({...request, url} as TileflowComposedRequest<TRequest>);
}

function composeTileflowRequest<TRequest extends TileflowTransformRequestParameters>(
  originalUrl: string,
  request: TRequest | undefined,
  nextUrl: string | undefined,
  ensureRequest: boolean,
): TileflowComposedRequest<TRequest> | undefined {
  if (!nextUrl) {
    return (
      request ??
      (ensureRequest ? ({url: originalUrl} as TileflowComposedRequest<TRequest>) : undefined)
    );
  }

  return (
    request ? {...request, url: nextUrl} : {url: nextUrl}
  ) as TileflowComposedRequest<TRequest>;
}

function disposeFunctions(disposers: Array<() => void>): void {
  let firstError: unknown;
  let failed = false;

  for (const dispose of disposers.splice(0).reverse()) {
    try {
      dispose();
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }

  if (failed) {
    throw firstError;
  }
}

function isPromiseLike<T>(value: T | Promise<T> | undefined): value is Promise<T> {
  return Boolean(value && typeof (value as Promise<T>).then === 'function');
}
