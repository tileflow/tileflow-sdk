import type {TileflowColorOverrides} from './color-program-runtime';
import {
  type TileflowDynamicImage,
  type TileflowDynamicImageHandle,
  type TileflowDynamicImageMap,
} from './dynamic-style-images';
import {type TileflowRouteInks} from './route-inks';
import {
  type TileflowRuntimeColorScheme,
  type TileflowRuntimeStyle,
  type TileflowThemeBlendSelection,
  validateTileflowThemeBlendSelection,
} from './runtime';
import {type TileflowSun} from './sun';
import {type TileflowEmphasis} from './theme-emphasis';
import {type TileflowThemeMotionMap} from './theme-motion-browser';

export type {TileflowColorOverrides} from './color-program-runtime';

export {attachTileflowBranding, createTileflowBrandingLink} from './branding-browser';
export type {TileflowBrandingMap, TileflowBrandingOptions} from './branding-browser';
export {readTileflowBrandingSources, parseTileflowBrandingPolicy} from './branding';
export type {TileflowBrandingPolicy, TileflowBrandingSource} from './branding';

export {
  type TileflowLoadedRuntimeStyle,
  type TileflowRuntimeStyleLoadOptions,
} from './style-resources-browser';

export {
  type TileflowAtmosphereMap,
  type TileflowAtmosphereRuntimeOptions,
} from './atmosphere-browser';
export {tileflowMaxPitch} from './camera-limits';
export {tileflowHorizonScaleFactor, type TileflowHorizonQueryMap} from './horizon-queries-browser';
export {tileflowSkyLayerId, type TileflowSkyMap} from './sky-browser';
export {
  readTileflowSky,
  tileflowSkyAtSun,
  tileflowSkyMetadataKey,
  type TileflowSkyColours,
  type TileflowSkyMetadata,
  type TileflowSkyTimesOfDay,
} from './sky';
export {tileflowSkyHazeLayerId, type TileflowSkyHazeMap} from './sky-haze-browser';
export {
  createBoundaryFeatureState,
  type CreateBoundaryFeatureStateOptions,
  type TileflowBoundaryFeatureState,
  type TileflowFeatureStateMap,
} from './boundary-areas/feature-state';
export {type TileflowLabelPlacementMap} from './label-placement-browser';
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
  type TileflowBuildingStandIns,
} from './buildings-3d-browser';
export type {TileflowStandInArea} from './building-stand-ins';
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
export {type TileflowNauticalLightsMap} from './nautical-lights-browser';
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

export type {
  TileflowFairUseNotice,
  TileflowFairUseNoticeController,
  TileflowFairUseNoticeState,
  TileflowWorldProtocolHandler,
  TileflowWorldProtocolRequest,
  TileflowWorldProtocolResponse,
  TileflowWorldRequestBridge,
} from './fair-use-browser';
export * from './map-error';
export {
  hasTileflowCssVariable,
  resolveTileflowCssVariables,
  TileflowCssVariableError,
} from './css-variables';
export * from './theme-appearance-browser';
export {createTileflowAppearanceController} from './appearance-browser';
export type {TileflowAppearanceSelection} from './appearance';
export {type TileflowPathGroundRegistry} from './path-ground-browser';
export * from './navigation-control-browser';
export * from './camera-fit-browser';
export {
  createTileflowContourRequestScope,
  tileflowMaplibreContourVersion,
  type TileflowContourFetch,
  type TileflowContourFetchInit,
  type TileflowContourFetchResponse,
  type TileflowContourRequestParameters,
  type TileflowContourRequestResourceType,
  type TileflowContourRequestScope,
  type TileflowContourRequestTransform,
  type TileflowContourProtocolHandler,
  type TileflowContourProtocolRegistrationOptions,
  type TileflowContourProtocolRegistry,
  type TileflowContourProtocolRequest,
  type TileflowContourProtocolResponse,
} from './contour-browser';
export {
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
  /** Rebuild the style to retry failed renderer resources, bypassing appearance-only updates. */
  rebuild?: boolean;
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
  /** Replace named colour overrides; an empty record restores the map author's colours. */
  setColors(
    colors: TileflowColorOverrides,
    options?: TileflowThemeChangeOptions,
  ): Promise<TileflowThemeTransitionResult>;
  getColors(): TileflowColorOverrides;
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
  type TileflowMap3DPending,
} from './map-3d-browser';

export {
  tileflowMap3DDeclarations,
  tileflowMap3DMetadataKeys,
  tileflowMapDeclares3D,
  type AttachTileflowMap3DOptions,
  type TileflowMap3DAttachment,
  type TileflowMap3DLoader,
  type TileflowMap3DSource,
} from './map-3d-attach-browser';
export type {TileflowCameraOptions} from './camera';
