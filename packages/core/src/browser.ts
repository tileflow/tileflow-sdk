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
import {planTileflowThemeBlend, type TileflowThemeBlendPlan} from './theme-blend';
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
  off(event: string, listener: (event?: unknown) => void): unknown;
  on(event: string, listener: (event?: unknown) => void): unknown;
  setStyle: unknown;
};

export type TileflowThemeController = {
  dispose(): void;
  /** The active blend, or undefined when the map shows one theme. */
  getBlend(): TileflowThemeBlendState | undefined;
  /** The theme the map shows; during a blend, the nearest theme. */
  getCurrent(): TileflowRuntimeStyle;
  /**
   * Shows a blend of themes. The first request for a set of themes loads their styles and
   * prepares one style that holds all of them; later requests for the same themes only move the
   * position and take effect at once, so they can follow an animation or a slider.
   */
  setBlend(
    request: TileflowThemeBlendRequest,
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

  return {
    dispose() {
      disposed = true;
      requestId += 1;
      activeBlend?.blender.dispose();
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
      position,
    });
  }

  async function restore(previous: {current: TileflowRuntimeStyle; shown: Shown}): Promise<void> {
    const blend = previous.shown.blend;
    if (blend) {
      const position = blend.blender.position;
      const style = blend.plan.styleAt(position);
      await applyMapStyle(options.map, style, timeoutMs);
      activeBlend = {...blend, blender: createBlender(blend.plan, position)};
      shown = {blend: activeBlend, style};
    } else {
      await applyMapStyle(options.map, previous.shown.style, timeoutMs);
      shown = previous.shown;
    }
    current = previous.current;
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
  | 'dataloading'
  | 'error'
  | 'idle'
  | 'load'
  | 'styledataloading';

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
