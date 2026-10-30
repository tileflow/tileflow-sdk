import {
  createTileflowDynamicImageRegistry,
  type TileflowDynamicImage,
  type TileflowDynamicImageHandle,
  type TileflowDynamicImageMap,
} from './dynamic-style-images';
import type {TileflowWorldRequestBridge} from './fair-use-browser';
import {isTileflowThemeName} from './portable-identity-rules';
import {type TileflowRouteInks, tileflowRouteInksAt, tileflowStyleRouteInks} from './route-inks';
import {
  getTileflowStyleFontFaces,
  resolveTileflowAnalyticsRequestUrl,
  startTileflowSession,
  type TileflowAnalytics,
  type TileflowRuntimeColorScheme,
  type TileflowRuntimeStyle,
  type TileflowSessionController,
  type TileflowStyleFontFace,
  type TileflowThemeBlendSelection,
  validateTileflowThemeBlendSelection,
} from './runtime';
import {readTileflowSky, tileflowSkyAtSun, tileflowSkyMetadataKey, tileflowSkySunKey} from './sky';
import {
  mixTileflowAzimuths,
  readTileflowSunPreset,
  resolveTileflowSun,
  tileflowStyleSunPreset,
  type TileflowSun,
  tileflowSunLight,
  tileflowSunPosition,
  type TileflowSunPreset,
  tileflowSunPresetAt,
} from './sun';
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
import {
  prepareTileflowThemeGeometry,
  waitForTileflowThemeGeometry,
} from './theme-preparation-browser';
import type {MapLibreStyle} from './types';

export {
  attachTileflowAtmosphere,
  type TileflowAtmosphereMap,
  type TileflowAtmosphereRuntimeOptions,
} from './atmosphere-browser';
export {tileflowMaxPitch} from './camera-limits';
export {attachTileflowSky, tileflowSkyLayerId, type TileflowSkyMap} from './sky-browser';
export {
  readTileflowSky,
  tileflowSkyAtSun,
  tileflowSkyMetadataKey,
  type TileflowSkyColours,
  type TileflowSkyMetadata,
  type TileflowSkyTimesOfDay,
} from './sky';
export {
  attachTileflowSkyHaze,
  tileflowSkyHazeLayerId,
  type TileflowSkyHazeMap,
} from './sky-haze-browser';
export {tileflowCanvasContextAttributes} from './canvas-context-browser';
export {
  createBoundaryFeatureState,
  type CreateBoundaryFeatureStateOptions,
  type TileflowBoundaryFeatureState,
  type TileflowFeatureStateMap,
} from './boundary-areas/feature-state';
export {
  attachTileflowLabelPlacement,
  type TileflowLabelPlacementMap,
} from './label-placement-browser';
export {
  tileflowLineProgressGradient,
  type TileflowLineProgressGradientOptions,
  type TileflowLineProgressState,
} from './line-progress';
export {
  createTileflowLineProgress,
  type TileflowLineProgressAnimation,
  type TileflowLineProgressController,
  type TileflowLineProgressLayer,
  type TileflowLineProgressMap,
  type TileflowLineProgressOptions,
  type TileflowLineProgressShown,
} from './line-progress-browser';
export {
  mixTileflowRouteInks,
  readTileflowRouteInks,
  tileflowDefaultRouteInks,
  tileflowRouteMetadataKey,
  tileflowStyleRouteInks,
  type TileflowRouteInks,
} from './route-inks';
export {
  createTileflowBuildings3D,
  tileflowBuildings3DLayerId,
  tileflowSunLightMatrix,
  type TileflowBuildings3D,
  type TileflowBuildings3DChange,
  type TileflowBuildings3DMap,
  type TileflowBuildings3DOptions,
  type TileflowBuildings3DThemes,
} from './buildings-3d-browser';
export {
  meshTileflowBuildings,
  tileflowBuildingExtent,
  tileflowBuildingVertexBytes,
  type TileflowBuildingMesh,
  type TileflowBuildingMeshOptions,
} from './buildings-3d-mesh';
export {
  createTileflowStreetLights,
  tileflowStreetLightsLayerId,
  type TileflowStreetLights,
  type TileflowStreetLightsMap,
  type TileflowStreetLightsOptions,
} from './street-lights-browser';
export {
  readTileflowBuildings3D,
  readTileflowTeamModelName,
  type TileflowBuildingModelPlacement,
  tileflowBuildingModelPlacementLimit,
  type TileflowBuildings3DDesign,
  tileflowBuildingsMetadataKey,
  tileflowTeamModelUrl,
} from './buildings-3d-design';
export {
  createTileflowTrees3D,
  tileflowTrees3DLayerId,
  type TileflowTrees3D,
  type TileflowTrees3DChange,
  type TileflowTrees3DMap,
  type TileflowTrees3DOptions,
  type TileflowTrees3DThemes,
} from './trees-3d-browser';
export {
  placeTileflowTrees,
  readTileflowVegetation3D,
  tileflowTreeBytes,
  tileflowTreeFormOf,
  tileflowTreeForms,
  tileflowVegetationMetadataKey,
  type TileflowTreeFields,
  type TileflowTreeForm,
  type TileflowTreeFormMix,
  type TileflowTreeFormRange,
  type TileflowTreeLayers,
  type TileflowTreePlacement,
  type TileflowTreePlacementOptions,
  type TileflowTreeRange,
  type TileflowTreeRegion,
  type TileflowVegetation3D,
} from './trees-3d';
export {
  placeTileflowStreetLights,
  readTileflowStreetLights,
  tileflowStreetLightsMetadataKey,
  type TileflowStreetLightsDesign,
  tileflowStreetLightBytes,
  type TileflowStreetLightEstimate,
  type TileflowStreetLightLayers,
  type TileflowStreetLightPlacement,
  type TileflowStreetLightPlacementOptions,
} from './street-lights';
export {
  mixTileflowSunPresets,
  readTileflowSunPreset,
  resolveTileflowSun,
  tileflowDefaultSunPreset,
  tileflowStyleSunPreset,
  tileflowSunDirection,
  tileflowSunMetadataKey,
  tileflowSunPosition,
  type TileflowSun,
  type TileflowSunPreset,
} from './sun';
export {
  createTileflowTileReader,
  readTileflowMapTileSource,
  tileflowTilePointToLngLat,
  tileflowTilesForBounds,
  type TileflowTile,
  type TileflowTileAddress,
  type TileflowTileAreaRequest,
  type TileflowTileReader,
  type TileflowTileReaderOptions,
  type TileflowTileRequestTransform,
  type TileflowTileSourceMap,
} from './tile-reader';
export {
  decodeTileflowVectorTile,
  type TileflowTileFeature,
  type TileflowTileGeometryType,
  type TileflowTileLayer,
  type TileflowVectorTileDecodeOptions,
} from './vector-tile-decode';
export {
  createTileflowGroundLayers,
  tileflowGroundBeforeId,
  type TileflowGroundLayer,
  type TileflowGroundLayers,
  type TileflowGroundLayersMap,
  type TileflowGroundLayersOptions,
  type TileflowGroundOrderMap,
} from './ground-layers-browser';
export {
  createTileflowDepthMarkers,
  tileflowDepthMarkerPlacement,
  type TileflowDepthMarker,
  type TileflowDepthMarkerHandle,
  type TileflowDepthMarkerMap,
  type TileflowDepthMarkers,
  type TileflowDepthMarkersOptions,
} from './depth-markers-browser';
export {
  tileflowShotStateAt,
  type TileflowShotCamera,
  type TileflowShotKeyframe,
  type TileflowShotMotion,
  type TileflowShotState,
} from './capture-shot-motion';
export {
  playTileflowShot,
  type TileflowShotCue,
  type TileflowShotPlayback,
  type TileflowShotPlaybackOptions,
  type TileflowShotPlayerMap,
} from './shot-player-browser';
export type {
  TileflowDynamicImage,
  TileflowDynamicImageContext,
  TileflowDynamicImageHandle,
} from './dynamic-style-images';
export {
  validateTileflowEmphasis,
  type TileflowEmphasis,
  type TileflowEmphasisArea,
  type TileflowEmphasisModule,
} from './theme-emphasis';
export {tileflowLayerDomainMetadataKey} from './layer-domain';
export {
  attachTileflowNotices,
  type TileflowNoticeControl,
  type TileflowNoticeControlPosition,
  type TileflowNoticesMap,
  type TileflowNoticesOptions,
} from './notices-browser';
export {
  readTileflowNotices,
  tileflowNoticeLimits,
  tileflowNoticesMetadataKey,
  type TileflowMapNotice,
} from './notices';
export {
  attachTileflowNauticalLights,
  type TileflowNauticalLightsMap,
} from './nautical-lights-browser';
export {
  readTileflowNauticalLights,
  tileflowNauticalLightStates,
  tileflowNauticalLightsMetadataKey,
  type TileflowNauticalLights,
} from './nautical-lights';
export {
  tileflowLightRhythm,
  tileflowLightRhythmConventions,
  tileflowLightStateAt,
  type TileflowLightCharacteristic,
  type TileflowLightPhase,
  type TileflowLightRhythm,
  type TileflowLightState,
} from './nautical-light-rhythm';

export * from './fair-use-browser';
export {
  registerTileflowPathGroundProtocol,
  type TileflowPathGroundRegistry,
} from './path-ground-browser';
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
 * How a theme change appears. Compatible themes interpolate on the live map, including its sky
 * and 3D lighting. Other styles use a stationary cover that clears when the camera moves.
 * A browser preference for reduced motion changes at once.
 */
export type TileflowThemeTransitionOptions = Readonly<{
  /** Milliseconds from 0 (immediate) to 5000. Themes and blends default to 450; other changes to 0. */
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
  /**
   * Holds back what would make MapLibre lay tiles out again: the change of nearest theme, with
   * the labels, icons, and values it switches, and mixed pattern artwork. Colours, numbers, the
   * sky, and light keep following the position, so a camera move or a recording never waits on
   * the blend. The next request without `hold` brings what was held back in at once.
   */
  hold?: boolean;
}>;

/**
 * A blend of named themes as the React, Vue, and Svelte maps take it: `hold` holds back what
 * would make MapLibre lay tiles out again, as `TileflowThemeBlendRequest.hold` does, and the next
 * selection without it brings what waited in at once.
 */
export type TileflowBrowserThemeBlendSelection = TileflowThemeBlendSelection &
  Readonly<{hold?: boolean}>;

export function validateTileflowBrowserThemeBlendSelection(
  value: unknown,
): value is TileflowBrowserThemeBlendSelection {
  if (!validateTileflowThemeBlendSelection(value)) return false;
  const {hold} = value as {hold?: unknown};
  return hold === undefined || typeof hold === 'boolean';
}

export type TileflowThemeBlendState = Readonly<{
  /** Whether changes held back by `hold` are waiting for a request without it. */
  held: boolean;
  position: number;
  /**
   * Positions where the nearest theme changes over values that make MapLibre lay tiles out
   * again, such as icon names, layout values, and values that read feature data or state. Plan
   * a camera move or a recording around them, or pass `hold` across them.
   */
  relayoutAt: readonly number[];
  themes: readonly string[];
}>;

export type TileflowStyleSwitchMap = TileflowThemeMotionMap &
  TileflowDynamicImageMap & {
    getCenter?: unknown;
    getGlobalState?: unknown;
    off(event: string, listener: (event?: unknown) => void): unknown;
    on(event: string, listener: (event?: unknown) => void): unknown;
    setGlobalStateProperty?: unknown;
    setStyle: unknown;
  };

/** A value an application sets for the whole style, which themes read with `expr.globalState`. */
export type TileflowStyleStateValue = boolean | number | string | null;

/**
 * Where an application places the sun. `azimuth` (degrees clockwise from north) and `altitude`
 * (degrees above the horizon) place it directly; `date` places the real sun of that instant over
 * `location` ([longitude, latitude]), the map's centre when it is left out.
 */
export type TileflowSunRequest =
  | Readonly<{altitude: number; azimuth: number}>
  | Readonly<{date: Date | number; location?: readonly [number, number]}>;

export type TileflowThemeController = {
  dispose(): void;
  /** Own a fixed-size RGBA image with a stable name across themes, restored after style reloads. */
  registerImage(name: string, image: TileflowDynamicImage): TileflowDynamicImageHandle;
  /** The active blend, or undefined when the map shows one theme. */
  getBlend(): TileflowThemeBlendState | undefined;
  /** The theme the map shows; during a blend, the nearest theme. */
  getCurrent(): TileflowRuntimeStyle;
  /** The emphasis requested last, or undefined when the map is shown as designed. */
  getEmphasis(): TileflowEmphasis | undefined;
  /**
   * The route inks of the theme on screen, for an application's own route layers. During a blend
   * they are mixed between the neighbouring themes at the blend's position, as the map's colours
   * are. Read them again after a theme change or a blend move.
   */
  getRouteInks(): TileflowRouteInks;
  /** The value a style state was set to last, or undefined when it has not been set. */
  getState(name: string): TileflowStyleStateValue | undefined;
  /**
   * What the compiled styles on screen hold under a metadata key, for an application's own layers
   * drawn in the map's design (Core's 3D trees read their colours this way): one value outside a
   * blend, and during a blend one per blended theme, in order, with the blend's position, so a layer
   * can mix them as the map does. A style without the key gives undefined in its place.
   */
  getThemeMetadata(key: string): Readonly<{values: readonly unknown[]; position: number}>;
  /**
   * The sun the map shows, for an application's own 3D layers: its direction, the light it and
   * the sky give, and how dark its shadows fall. It is the theme's sun (`lighting.sun`), mixed
   * between neighbouring themes during a blend, unless `setSun` placed it. Read it when drawing;
   * the map redraws whenever it changes.
   */
  getSun(): TileflowSun;
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
  /**
   * Places the sun by direction or by the real sun of a date and place; `undefined` returns it to
   * the themes' suns. The themes keep the sun's colours, strengths, and shadow strength, and the
   * map's light turns to the new direction, anchored to the map. The sun turns the short way round
   * over the transition; a request that follows an animation, such as a clock, passes none.
   */
  setSun(
    request: TileflowSunRequest | undefined,
    options?: TileflowThemeChangeOptions,
  ): Promise<TileflowThemeTransitionResult>;
  setTheme(
    style: TileflowRuntimeStyle,
    options?: TileflowThemeChangeOptions,
  ): Promise<TileflowThemeTransitionResult>;
};

const maximumBlendThemes = 8;
const maximumTransitionMs = 5_000;
const defaultThemeTransitionMs = 450;
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
type SunDirection = {altitude: number; azimuth: number; source: TileflowSun['source']};
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
  const defaultThemeTransition = normalizeThemeTransitionDuration(
    options.transition,
    defaultThemeTransitionMs,
  );
  const styleIdentities = new WeakMap<object, number>();
  // The route inks of each blended theme, in blend order, by the blend's plan.
  const blendRouteInks = new WeakMap<TileflowThemeBlendPlan, readonly TileflowRouteInks[]>();
  const blendMetadata = new WeakMap<TileflowThemeBlendPlan, readonly unknown[]>();
  let nextStyleIdentity = 0;
  let current = options.initial;
  // getStyle serializes every layer. URL-backed themes must not repeat that work for
  // every 3D draw, shadow query and palette lookup while their metadata is unchanged.
  let metadataStyle: {metadata?: unknown} | undefined;
  const invalidateMetadata = () => {
    metadataStyle = undefined;
  };
  const releaseMetadata = () => {
    options.map.off('styledata', invalidateMetadata);
    options.map.off('style.load', invalidateMetadata);
    options.map.off('remove', releaseMetadata);
    invalidateMetadata();
  };
  options.map.on('styledata', invalidateMetadata);
  options.map.on('style.load', invalidateMetadata);
  options.map.on('remove', releaseMetadata);
  let shown: Shown = {style: options.initial.style};
  let activeBlend: ActiveBlend | undefined;
  let pendingBlend: PendingBlend | undefined;
  let stopThemeMotion: (() => void) | undefined;
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
  let images: ReturnType<typeof createTileflowDynamicImageRegistry> | undefined;
  // The sun: the presets of each blend's themes, whether the themes describe a sun, the preset of
  // a single theme on screen, and the direction an application placed it in (`shown` eases towards
  // the request; undefined follows the themes).
  const blendSuns = new WeakMap<
    TileflowThemeBlendPlan,
    {presets: readonly TileflowSunPreset[]; published: boolean}
  >();
  let themeSun: {preset: TileflowSunPreset; published: boolean} | undefined;
  let sunRequest: SunDirection | undefined;
  let sunShown: SunDirection | undefined;
  let sunRun = 0;
  let sunStop: (() => void) | undefined;
  let sunSettle: ((result: TileflowThemeTransitionResult) => void) | undefined;
  let sunLightWritten: string | undefined;
  // The sky a placed sun wrote, and the sky of the style a theme given by URL compiled.
  let sunSkyWritten: string | undefined;
  let urlStyleSky: unknown;

  function imageContext() {
    return {
      theme: current.theme!,
      blend: activeBlend
        ? Object.freeze({
            position: activeBlend.blender.position,
            themes: Object.freeze(activeBlend.themes.map((theme) => theme.theme!)),
          })
        : undefined,
      states: Object.freeze(
        Object.fromEntries([...states].map(([name, state]) => [name, state.shown])),
      ),
    };
  }

  return {
    dispose() {
      disposed = true;
      stopThemeMotion?.();
      releaseMetadata();
      images?.dispose();
      requestId += 1;
      activeBlend?.blender.dispose();
      stopEmphasisMotion({status: 'superseded', theme: current.theme});
      for (const state of states.values())
        stopStateMotion(state, {status: 'superseded', theme: current.theme});
      stopSunMotion({status: 'superseded', theme: current.theme});
    },
    getBlend() {
      if (!activeBlend) return undefined;
      return {
        held: activeBlend.blender.held,
        position: activeBlend.blender.position,
        relayoutAt: activeBlend.blender.relayoutAt,
        themes: activeBlend.themes.map((theme) => theme.theme!),
      };
    },
    registerImage(name, definition) {
      if (disposed) throw new Error('Tileflow theme controller is disposed.');
      if (activeBlend?.plan.images.some((image) => image.names.includes(name))) {
        throw new TypeError('Dynamic image names must remain identical across blended themes.');
      }
      images ??= createTileflowDynamicImageRegistry(options.map, imageContext, resetStates);
      return images.register(name, definition);
    },
    getCurrent() {
      return current;
    },
    getEmphasis() {
      return emphasis;
    },
    getRouteInks() {
      const scheme = current.colorScheme === 'dark' ? 'dark' : 'light';
      const blended = activeBlend && blendRouteInks.get(activeBlend.plan);
      if (activeBlend && blended)
        return tileflowRouteInksAt(blended, activeBlend.blender.position) ?? blended[0]!;
      return tileflowStyleRouteInks(
        typeof current.style === 'string' ? shownStyleDocument() : current.style,
        scheme,
      );
    },
    getState(name) {
      return typeof name === 'string' ? states.get(name.trim())?.value : undefined;
    },
    getThemeMetadata(key) {
      const read = (metadata: unknown) =>
        typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
          ? (metadata as Record<string, unknown>)[key]
          : undefined;
      const blended = activeBlend && blendMetadata.get(activeBlend.plan);
      if (activeBlend && blended)
        return {values: blended.map(read), position: activeBlend.blender.position};
      const style =
        typeof current.style === 'string'
          ? (metadataStyle ??= shownStyleDocument())
          : current.style;
      return {values: [read(style?.metadata)], position: 0};
    },
    getSun() {
      return sunNow();
    },
    setSun(request, changeOptions) {
      if (disposed) return Promise.resolve(disposedResult(current.theme));
      const target = sunDirectionOf(request);
      if (target instanceof TypeError)
        return Promise.resolve({error: target, status: 'failed', theme: current.theme});
      const transition = transitionOf(changeOptions);
      if (transition instanceof TypeError)
        return Promise.resolve({error: transition, status: 'failed', theme: current.theme});
      return changeSun(target, reducedMotion() ? 0 : transition);
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
      const transition = transitionOf(changeOptions, defaultThemeTransition);
      if (transition instanceof TypeError)
        return Promise.resolve({error: transition, status: 'failed', theme: targetTheme});
      stopThemeMotion?.();
      const key = blendKey(request.themes);
      if (activeBlend?.key === key) {
        // The same themes: only the position moves, at once, superseding older pending changes.
        requestId += 1;
        activeBlend.blender.set(request.position, {hold: request.hold === true});
        current = activeBlend.themes[activeBlend.blender.dominant]!;
        images?.invalidate();
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
      const transition = transitionOf(changeOptions, defaultThemeTransition);
      if (transition instanceof TypeError)
        return Promise.resolve({error: transition, status: 'failed', theme: style.theme});
      stopThemeMotion?.();
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

  function transitionOf(
    changeOptions: TileflowThemeChangeOptions | undefined,
    defaultDuration = defaultTransition,
  ): number | TypeError {
    if (changeOptions?.transition === undefined) return defaultDuration;
    try {
      return normalizeThemeTransitionDuration(changeOptions.transition, defaultDuration);
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

  // The style document the map shows, for a theme given by URL.
  function shownStyleDocument(): {metadata?: unknown} | undefined {
    const getStyle = options.map.getStyle;
    if (typeof getStyle !== 'function') return undefined;
    try {
      return (getStyle as () => {metadata?: unknown} | undefined).call(options.map);
    } catch {
      return undefined;
    }
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
    const plan = planTileflowThemeBlend(styles);
    images?.assertBlend(plan.images);
    blendMetadata.set(
      plan,
      styles.map((style) => (style as {metadata?: unknown}).metadata),
    );
    blendRouteInks.set(
      plan,
      styles.map((style, index) =>
        tileflowStyleRouteInks(style, themes[index]!.colorScheme === 'dark' ? 'dark' : 'light'),
      ),
    );
    blendSuns.set(plan, {
      presets: styles.map((style) => tileflowStyleSunPreset(style)),
      published: styles.some((style) => readTileflowSunPreset(style.metadata) !== undefined),
    });
    return plan;
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
    let cover: ReturnType<typeof beginTileflowStyleCrossfade>;
    const styleInput =
      target.kind === 'theme' ? target.style.style : target.plan.styleAt(target.position());

    try {
      let liveTransition = false;
      // A photograph cannot follow a rotating globe or 3D scene. Use the existing
      // blend renderer so both appearances are drawn with the current camera.
      if (
        target.kind === 'theme' &&
        !activeBlend &&
        target.transition > 0 &&
        !reducedMotion() &&
        tileflowThemeMotionView(options.map) &&
        canBlendTileflowThemes(options.map)
      ) {
        const themes = [previous.current, target.style];
        let plan: TileflowThemeBlendPlan | undefined;
        try {
          plan = await prepareBlend(themes);
        } catch {
          // Different sources, layers or artwork require a complete style switch.
        }
        if (disposed || runId !== requestId) return {status: 'superseded', theme: targetTheme};
        if (plan) {
          liveTransition = true;
          // Our animation clock owns the interpolation; native paint transitions would lag
          // behind it and jump when the final style replaces the temporary blend.
          const style = {...plan.styleAt(0), transition: {duration: 0, delay: 0}};
          const from =
            typeof previous.shown.style === 'string'
              ? await loadStyle(previous.shown.style)
              : previous.shown.style;
          if (!(await prepareGeometry(from, style, runId))) {
            if (!disposed) await restore(previous);
            return {status: 'superseded', theme: targetTheme};
          }
          await applyMapStyle(options.map, style, timeoutMs);
          if (disposed) return {status: 'superseded', theme: targetTheme};
          const blender = createBlender(plan, 0, true);
          activeBlend = {blender, key: '', plan, themes};
          shown = {blend: activeBlend, style};
          shownLayers = style.layers;
          resetEmphasis();
          resetStates();
          resetSun(undefined);
          await animateTheme(blender, themes, target.transition, runId);
          if (!disposed && runId === requestId) {
            const destination =
              typeof styleInput === 'string' ? await loadStyle(styleInput) : styleInput;
            const finalBlendStyle = {...plan.styleAt(1), transition: {duration: 0, delay: 0}};
            await prepareGeometry(finalBlendStyle, destination, runId);
          }
          blender.dispose();
          activeBlend = undefined;
          if (disposed) return {status: 'superseded', theme: targetTheme};
          if (runId !== requestId) {
            await restore(previous);
            return {status: 'superseded', theme: targetTheme};
          }
          // Remove temporary blend layers after reaching the exact destination.
          // The final style has the same appearance and keeps the native camera.
        }
      }
      if (!liveTransition) {
        cover = beginTileflowStyleCrossfade(options.map, target.transition);
      }
      activeBlend?.blender.dispose();
      activeBlend = undefined;
      if (target.kind === 'blend') images?.assertBlend(target.plan.images);
      invalidateMetadata();
      await applyMapStyle(options.map, styleInput, timeoutMs);
      invalidateMetadata();
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
      resetSun(target.kind === 'theme' ? styleInput : undefined);
      images?.invalidate();
      await cover?.finish({stop: () => disposed || runId !== requestId});
      options.onTransition?.({
        currentTheme: current.theme,
        phase: 'ready',
        targetTheme: current.theme,
      });
      return {status: 'applied', theme: current.theme};
    } catch (error) {
      cover?.cancel();
      activeBlend?.blender.dispose();
      activeBlend = undefined;
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

  async function prepareGeometry(from: MapLibreStyle, to: MapLibreStyle, runId: number) {
    const getStyle = options.map.getStyle;
    const displayed = typeof getStyle === 'function' ? getStyle.call(options.map) : undefined;
    const preparation = prepareTileflowThemeGeometry(displayed ?? from, to);
    if (!preparation) return !disposed && runId === requestId;
    await applyMapStyle(options.map, preparation.style, timeoutMs);
    const ready = await waitForTileflowThemeGeometry(
      options.map,
      timeoutMs,
      () => disposed || runId !== requestId,
    );
    if (ready) preparation.reveal(options.map);
    return ready;
  }

  function animateTheme(
    blender: TileflowThemeBlender,
    themes: readonly TileflowRuntimeStyle[],
    duration: number,
    runId: number,
  ): Promise<void> {
    const view = tileflowThemeMotionView(options.map)!;
    return new Promise((resolve, reject) => {
      const now = () => view.performance?.now?.() ?? Date.now();
      const started = now();
      let frame: number | undefined;
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (frame !== undefined) {
          view.cancelAnimationFrame?.(frame);
          view.clearTimeout(frame);
        }
        if (stopThemeMotion === cancel) stopThemeMotion = undefined;
        if (error) reject(error);
        else resolve();
      };
      const cancel = () => finish();
      const step = () => {
        frame = undefined;
        if (disposed || runId !== requestId) return finish();
        try {
          const t = Math.min(1, (now() - started) / duration);
          blender.set(t * t * (3 - 2 * t));
          current = themes[blender.dominant]!;
          images?.invalidate();
          if (t >= 1) finish();
          else frame = view.requestAnimationFrame?.(step) ?? view.setTimeout(step, 16);
        } catch (error) {
          finish(error);
        }
      };
      stopThemeMotion = cancel;
      step();
    });
  }

  function createBlender(
    plan: TileflowThemeBlendPlan,
    position: number,
    liveTransition = false,
  ): TileflowThemeBlender {
    return createTileflowThemeBlender(options.map, plan, {
      cover(change) {
        if (liveTransition) return change();
        // Values that read feature state switch with a re-layout; a snapshot covers it.
        const fade = beginTileflowStyleCrossfade(options.map, blendLabelFadeMs);
        change();
        void fade?.finish();
      },
      labelFadeMs: liveTransition || reducedMotion() ? 0 : blendLabelFadeMs,
      // The ground colour moves with the blend, and colours that recede follow it.
      onPosition: () => {
        if (emphasisShown) writeEmphasis(false);
        // The blend wrote its own light and sky; the sun's take their place.
        sunLightWritten = undefined;
        sunSkyWritten = undefined;
        writeSunLight();
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
    resetSun(blend ? undefined : previous.shown.style);
    images?.invalidate();
  }

  // --- Sun ---

  /** The sun preset of the themes on screen, mixed at the blend's position. */
  function themeSunPreset(): {preset: TileflowSunPreset; published: boolean} {
    const blended = activeBlend && blendSuns.get(activeBlend.plan);
    if (activeBlend && blended) {
      return {
        preset:
          tileflowSunPresetAt(blended.presets, activeBlend.blender.position) ?? blended.presets[0]!,
        published: blended.published,
      };
    }
    if (!themeSun) {
      // A theme given by URL is read from the map once its style is on it.
      const style = typeof current.style === 'string' ? shownStyleDocument() : current.style;
      themeSun = {
        preset: tileflowStyleSunPreset(style as {light?: unknown; metadata?: unknown} | undefined),
        published: readTileflowSunPreset(style?.metadata) !== undefined,
      };
    }
    return themeSun;
  }

  function sunNow(): TileflowSun {
    const {preset} = themeSunPreset();
    if (!sunShown) return resolveTileflowSun(preset);
    return resolveTileflowSun(preset, sunShown, sunShown.source);
  }

  /** The sky the themes on screen compiled, mixed at the blend's position. */
  function themeSky(): unknown {
    if (activeBlend?.plan.sky !== undefined)
      return fillTileflowThemeBlendTemplate(activeBlend.plan.sky, activeBlend.blender.position);
    return typeof shown.style === 'string' ? urlStyleSky : shown.style.sky;
  }

  /**
   * Publishes the sun on screen for the map's sky layer, and while an application places the sun,
   * gives the sky the colours of its hour from the time-of-day skies the themes carry.
   */
  function writeSunSky(): void {
    const sun = sunNow();
    try {
      (options.map as unknown as Record<symbol, unknown>)[tileflowSkySunKey] = {
        altitude: sun.altitude,
        azimuth: sun.azimuth,
        direction: sun.direction,
        source: sun.source,
      };
    } catch {
      // A frozen map object keeps the themes' sun for its sky.
    }
    const setSky = options.map.setSky as ((sky: unknown, options?: object) => unknown) | undefined;
    if (typeof setSky !== 'function') return;
    const style = typeof shown.style === 'string' ? shownStyleDocument() : shown.style;
    const times = readTileflowSky(
      (style?.metadata as Record<string, unknown> | undefined)?.[tileflowSkyMetadataKey],
    )?.timesOfDay;
    const base = themeSky();
    try {
      if (sunShown && times && isPlainObject(base)) {
        const at = tileflowSkyAtSun(times, sun);
        const sky = {
          ...base,
          'sky-color': at.color,
          'horizon-color': at.horizonColor,
          'fog-color': at.horizonColor,
          'sky-horizon-blend': at.horizonBlend,
        };
        const key = JSON.stringify(sky);
        if (key === sunSkyWritten) return;
        setSky.call(options.map, sky, {validate: false});
        sunSkyWritten = key;
      } else if (sunSkyWritten !== undefined) {
        setSky.call(options.map, base, {validate: false});
        sunSkyWritten = undefined;
      }
    } catch {
      // MapLibre refuses while a style loads; resetSun() writes the sky after it.
    }
  }

  /** The map's light points from the sun when the themes describe one or an application placed it. */
  function writeSunLight(): void {
    writeSunSky();
    const {published} = themeSunPreset();
    if (!published && !sunShown) return;
    const setLight = options.map.setLight as
      ((light: unknown, options?: object) => unknown) | undefined;
    if (typeof setLight !== 'function') return;
    const sun = sunNow();
    const blendLight =
      activeBlend?.plan.light !== undefined
        ? fillTileflowThemeBlendTemplate(activeBlend.plan.light, activeBlend.blender.position)
        : undefined;
    const base = (blendLight ?? shownStyleLight()) as Parameters<typeof tileflowSunLight>[1];
    const light = tileflowSunLight(sun, base);
    const key = JSON.stringify(light);
    if (key === sunLightWritten) return;
    try {
      setLight.call(options.map, light, {validate: false});
      sunLightWritten = key;
    } catch {
      // MapLibre refuses while a style loads; resetSun() writes the light after it.
    }
  }

  function shownStyleLight(): unknown {
    const style = typeof shown.style === 'string' ? undefined : shown.style;
    return style?.light;
  }

  /** After a new style: the themes' sun is read again and the light follows the sun on screen. */
  function resetSun(style: MapLibreStyle | string | undefined): void {
    sunSkyWritten = undefined;
    urlStyleSky =
      typeof style === 'string'
        ? (shownStyleDocument() as {sky?: unknown} | undefined)?.sky
        : undefined;
    themeSun =
      style === undefined || typeof style === 'string'
        ? undefined
        : {
            preset: tileflowStyleSunPreset(style),
            published: readTileflowSunPreset(style.metadata) !== undefined,
          };
    sunLightWritten = undefined;
    writeSunLight();
  }

  /** The direction a request asks for; undefined returns the sun to the themes. */
  function sunDirectionOf(
    request: TileflowSunRequest | undefined,
  ): SunDirection | undefined | TypeError {
    if (request === undefined) return undefined;
    if (typeof request !== 'object' || request === null)
      return new TypeError('Sun requests are objects with a direction or a date.');
    if ('date' in request) {
      const time = request.date instanceof Date ? request.date.getTime() : request.date;
      if (typeof time !== 'number' || !Number.isFinite(time))
        return new TypeError('A sun request date must be a valid Date or a time in milliseconds.');
      const location = request.location ?? mapCentre();
      if (!location)
        return new TypeError('A sun request without a location needs a map with getCenter().');
      try {
        return {...tileflowSunPosition(time, location), source: 'date'};
      } catch (error) {
        return error as TypeError;
      }
    }
    const {azimuth, altitude} = request as {altitude?: unknown; azimuth?: unknown};
    if (typeof azimuth !== 'number' || !Number.isFinite(azimuth))
      return new TypeError('A sun azimuth must be a finite number of degrees.');
    if (typeof altitude !== 'number' || !Number.isFinite(altitude) || Math.abs(altitude) > 90)
      return new TypeError('A sun altitude must be a number of degrees from -90 to 90.');
    return {azimuth, altitude, source: 'direction'};
  }

  function mapCentre(): readonly [number, number] | undefined {
    const getCenter = options.map.getCenter as (() => {lat?: unknown; lng?: unknown}) | undefined;
    if (typeof getCenter !== 'function') return undefined;
    const centre = getCenter.call(options.map);
    return typeof centre?.lng === 'number' && typeof centre.lat === 'number'
      ? [centre.lng, centre.lat]
      : undefined;
  }

  function stopSunMotion(result?: TileflowThemeTransitionResult): void {
    sunStop?.();
    sunStop = undefined;
    const settle = sunSettle;
    sunSettle = undefined;
    if (result) settle?.(result);
  }

  function changeSun(
    target: SunDirection | undefined,
    duration: number,
  ): Promise<TileflowThemeTransitionResult> {
    stopSunMotion({status: 'superseded', theme: current.theme});
    const run = ++sunRun;
    sunRequest = target;
    const from: SunDirection = sunShown ?? {...themeSunPreset().preset, source: 'theme'};
    const view = tileflowThemeMotionView(options.map);
    const finish = () => {
      sunShown = sunRequest;
      sunLightWritten = undefined;
      writeSunLight();
      if (!sunShown) restoreThemeLight();
    };
    if (duration <= 0 || !view) {
      finish();
      return Promise.resolve({status: 'applied', theme: current.theme});
    }
    return new Promise((resolve) => {
      sunSettle = resolve;
      const now = () => view.performance?.now?.() ?? Date.now();
      const start = now();
      let cancelled = false;
      let frame: number | undefined;
      const step = () => {
        frame = undefined;
        if (cancelled || disposed || run !== sunRun) return;
        const t = Math.min(1, (now() - start) / duration);
        const eased = t * t * (3 - 2 * t);
        // Returning to the themes follows their sun, which a blend may be moving.
        const to = target ?? themeSunPreset().preset;
        sunShown = {
          azimuth: mixTileflowAzimuths(from.azimuth, to.azimuth, eased),
          altitude: from.altitude + (to.altitude - from.altitude) * eased,
          source: target?.source ?? from.source,
        };
        writeSunLight();
        if (t >= 1) {
          sunStop = undefined;
          sunSettle = undefined;
          finish();
          resolve({status: 'applied', theme: current.theme});
          return;
        }
        frame = view.requestAnimationFrame?.(step) ?? view.setTimeout(step, 16);
      };
      sunStop = () => {
        cancelled = true;
        if (frame !== undefined) {
          view.cancelAnimationFrame?.(frame);
          view.clearTimeout(frame);
        }
      };
      step();
    });
  }

  /** Puts back the light the themes compiled, once the sun follows them again. */
  function restoreThemeLight(): void {
    if (themeSunPreset().published) return;
    const setLight = options.map.setLight as
      ((light: unknown, options?: object) => unknown) | undefined;
    if (typeof setLight !== 'function') return;
    const themeLight =
      activeBlend?.plan.light !== undefined
        ? fillTileflowThemeBlendTemplate(activeBlend.plan.light, activeBlend.blender.position)
        : shownStyleLight();
    // MapLibre changes only the values it is given, so the ones the theme leaves unset return to
    // MapLibre's defaults.
    const light = {...mapLibreDefaultLight, ...(isPlainObject(themeLight) ? themeLight : {})};
    try {
      setLight.call(options.map, light, {validate: false});
    } catch {
      // The next style brings its own light.
    }
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
    images?.invalidate(name);
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

/** MapLibre's light where a style sets none. */
const mapLibreDefaultLight = Object.freeze({
  anchor: 'viewport',
  color: '#ffffff',
  intensity: 0.5,
  position: [1.15, 210, 30],
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  defaultDuration = 0,
): number {
  const duration = transition?.duration ?? defaultDuration;
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
      map.off('render', handleRenderedStyle);
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
    const handleRenderedStyle = () => {
      const isStyleLoaded = map.isStyleLoaded;
      if (typeof isStyleLoaded === 'function' && isStyleLoaded.call(map) === true) settle();
    };
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
    map.on('render', handleRenderedStyle);
    map.on('error', handleError);
    try {
      if (typeof map.setStyle !== 'function') {
        throw new TypeError('Tileflow theme changes require MapLibre setStyle().');
      }
      const setStyle = map.setStyle as (
        style: MapLibreStyle | string,
        options?: {diff?: boolean; validate?: boolean},
      ) => unknown;
      // A theme's style is compiled, and validated, when its map is built.
      setStyle.call(map, style, {diff: true, validate: false});
      // MapLibre emits no style.load for an empty diff. The live transition's
      // first style may already match the map, even while camera tiles load.
      handleRenderedStyle();
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

/**
 * Compose the caller's request transform with Tileflow analytics, the Hosted session, and the
 * World bridge. Analytics are read when each request starts, so an asynchronous user transform
 * never attaches analytics that changed while it was pending.
 */
export function createTileflowTransformRequest<
  TRequest extends TileflowTransformRequestParameters = TileflowTransformRequestParameters,
  TResourceType = unknown,
>(options: {
  getAnalytics: () => TileflowAnalytics | undefined;
  sessionController?: TileflowSessionController;
  sessionId: string;
  transformRequest?: TileflowUserTransformRequest<TRequest, TResourceType>;
  worldRequestBridge?: TileflowWorldRequestBridge;
}): TileflowTransformRequest<TRequest, TResourceType> {
  return (url, resourceType) => {
    const request = options.transformRequest?.(url, resourceType);
    const analytics = options.getAnalytics();
    const apply = (resolvedRequest: TRequest | undefined) =>
      applyTileflowRequest(
        url,
        resolvedRequest,
        analytics,
        options.sessionId,
        options.sessionController,
        options.worldRequestBridge,
      );

    if (isPromiseLike(request)) {
      return request.then((resolvedRequest) => apply(resolvedRequest) ?? resolvedRequest);
    }
    return apply(request);
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

export {
  readTileflowVegetationDisplay,
  resolveTileflowVegetationRepresentation,
  tileflowVegetationDisplayMetadataKey,
  type TileflowVegetationDisplay,
  type TileflowVegetationRepresentation,
  type TileflowViewMode,
} from './vegetation-display';

export {
  createTileflowVegetation,
  type TileflowVegetationOptions,
  type TileflowVegetationController,
} from './vegetation-browser';

export {
  createTileflowMap3D,
  type TileflowMap3D,
  type TileflowMap3DMap,
  type TileflowMap3DOptions,
} from './map-3d-browser';

export {
  attachTileflowMap3D,
  tileflowMap3DDeclarations,
  tileflowMap3DMetadataKeys,
  tileflowMapDeclares3D,
  type AttachTileflowMap3DOptions,
  type TileflowMap3DAttachment,
  type TileflowMap3DLoader,
  type TileflowMap3DSource,
} from './map-3d-attach-browser';
export type {TileflowCameraOptions} from './camera';
