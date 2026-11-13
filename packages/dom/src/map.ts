import type {
  LngLatLike,
  Map as MapLibreMap,
  MapOptions as MapLibreMapOptions,
  Marker as MapLibreMarker,
  Popup as MapLibrePopup,
  PointLike,
  StyleSpecification,
} from 'maplibre-gl';
import type {TileflowGeoJsonSource, TileflowMapLibreOverlay} from '@tileflow/core';
import {
  attachTileflowBranding,
  createTileflowAppearanceBinding,
  createTileflowContourRequestScope,
  createTileflowNavigationControlBinding,
  getTileflowSystemColorScheme,
  reportTileflowMapError,
  resolveTileflowCameraFit,
  subscribeTileflowSystemColorScheme,
  type TileflowAppearanceBinding,
  type TileflowBounds,
  type TileflowBrowserThemeBlendSelection,
  type TileflowCameraFit,
  type TileflowColorOverrides,
  type TileflowEmphasis,
  type TileflowFitBoundsOptions,
  type TileflowLoadedRuntimeStyle,
  type TileflowMap3DAttachment,
  type TileflowMapError,
  type TileflowMapErrorCode,
  tileflowMaxPitch,
  type TileflowNavigationControlBinding,
  type TileflowNavigationControlInput,
  type TileflowRuntimeStyleLoadOptions,
  type TileflowThemeController,
  type TileflowThemeTransition,
  type TileflowThemeTransitionOptions,
  type TileflowViewMode,
  attachTileflowAtmosphere,
  attachTileflowFairUseNotice,
  attachTileflowHorizonQueries,
  attachTileflowLabelPlacement,
  attachTileflowMap3D,
  attachTileflowMapLifecycle,
  attachTileflowNauticalLights,
  attachTileflowNotices,
  createTileflowSessionStarter,
  createTileflowThemeController,
  createTileflowTransformRequest,
  loadTileflowRuntimeStyle,
  loadTileflowStyleFonts,
  registerTileflowContourProtocol,
  registerTileflowPathGroundProtocol,
  registerTileflowPmtilesProtocol,
  registerTileflowWorldRequestBridge,
  tileflowCanvasContextAttributes,
} from '@tileflow/core/browser';
import {normalizeTileflowCaptureId} from '@tileflow/core/capture';
import {
  createTileflowSessionController,
  defaultTileflowManifestUrl,
  defaultTileflowRuntimeView,
  loadTileflowManifest,
  mergeTileflowAnalytics,
  nearestTileflowBlendTheme,
  normalizeTileflowRuntimeCenter,
  normalizeTileflowStaticImageSize,
  resolveTileflowManifestMap,
  resolveTileflowRuntimeStyle,
  resolveTileflowRuntimeTheme,
  resolveTileflowRuntimeThemeBlend,
  resolveTileflowRuntimeView,
  resolveTileflowStaticImageUrl,
  type TileflowAnalytics,
  type TileflowRuntimeManifestMap,
  type TileflowRuntimeSource,
  type TileflowRuntimeStyle,
  type TileflowThemeSelection,
  type TileflowTimeOfDay,
} from '@tileflow/core/runtime';
import {
  type TileflowAnnotation,
  type TileflowInteractionBinding,
  type TileflowInteractionDiagnostic,
  type TileflowInteractionEvent,
  type TileflowInteractionState,
  tileflowInteractionStateSchema,
  unusedTileflowRendererDiagnostics,
} from '@tileflow/interactions';
import {
  createTileflowMapLibreDataRuntime,
  createTileflowMapLibreDomRuntime,
  createTileflowMapLibreInteractionCoordinator,
  createTileflowMapLibreSemanticDomRuntime,
  type TileflowAnnotationClusterOptions,
  type TileflowMapLibreDataInput,
  type TileflowMapLibreDataRuntime,
  type TileflowMapLibreDomRenderTarget,
  type TileflowMapLibreDomRuntime,
  type TileflowMapLibreInteractionCoordinator,
  type TileflowMapLibrePoiMap,
  type TileflowMapLibreSemanticDomRenderTarget,
  type TileflowMapLibreSemanticDomRuntime,
} from '@tileflow/interactions/maplibre';
import {
  assertTileflowMapStyleOptions,
  createOverlayFailureDiagnostic,
  imageModeMapInteractionDiagnostic,
  prepareTileflowAnnotations,
  prepareTileflowInteractionBindings,
  prepareTileflowInteractionState,
  tileflowInteractionDiagnosticKey,
  type TileflowPreparedAnnotations,
  type TileflowPreparedInteractionBindings,
  type TileflowPreparedInteractionState,
} from './inputs';
import {loadTileflowMapLibre, type TileflowMapLibre} from './maplibre';
import {createTileflowReconciler, runTileflowCleanups} from './reconcile';
import {createTileflowResourceScope, type TileflowResourceScope} from './scope';
import {
  createTileflowMapViewHost,
  type TileflowMapRenderTargetList,
  type TileflowMapViewHost,
  type TileflowMapViews,
} from './views';

/** MapLibre options a map passes through, apart from the container and style it owns. */
export type TileflowMapLibreOptions = Omit<MapLibreMapOptions, 'container' | 'style'>;

export type TileflowMapReadiness = 'error' | 'idle' | 'loading';

/**
 * Where the map stands, for capture and for an application's own loading or error view. The map
 * draws nothing for it: `diagnostics` are for the application to show.
 */
export type TileflowMapStatus = Readonly<{
  /** Interaction problems: invalid annotations, interactions or state, and runtime failures. */
  diagnostics: readonly TileflowInteractionDiagnostic[];
  /** `idle` once the map, its theme and its views have settled; `error` when one cannot. */
  readiness: TileflowMapReadiness;
  /** The concrete theme shown, once it is known. */
  theme: string | undefined;
  /** In image mode, the image to show, once it is known. */
  imageUrl: string | undefined;
}>;

/**
 * For a framework that draws views itself, such as through portals: the map leaves the elements of
 * the kinds marked `true` empty and hands every element to `onChange`.
 */
export type TileflowMapRenderTargetsOptions<TAnnotation extends TileflowAnnotation> = Readonly<{
  marker?: boolean;
  onChange: (targets: TileflowMapRenderTargetList<TAnnotation>) => void;
  popup?: boolean;
  tooltip?: boolean;
}>;

type TileflowMapInteractionStateOptions =
  | Readonly<{defaultInteractionState?: never; interactionState?: TileflowInteractionState}>
  | Readonly<{defaultInteractionState?: TileflowInteractionState; interactionState?: never}>;

export type TileflowMapControllerOptions<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = TileflowMapInteractionStateOptions & {
  /** The map to show, by name, from the manifest at `manifestUrl` or the default one. */
  source: TileflowRuntimeSource;
  /**
   * `image` shows a static image of the map instead of MapLibre: `imageUrl`, or one the map's
   * static renderer makes for the container's size, `center`, `zoom` and theme.
   */
  mode?: 'image' | 'interactive';
  imageUrl?: string;
  /** The image's alternative text; empty unless given. */
  alt?: string;
  /** How the browser loads the image; `eager` unless given. */
  imageLoading?: 'eager' | 'lazy';
  /**
   * The `<img>` a framework renders itself (with `imageUrl` from the status), so the image can be
   * rendered on the server. Without it, the map adds its own image to the container.
   */
  image?: HTMLImageElement | null;
  theme?: TileflowThemeSelection;
  /** Optional artistic preset; ignored by maps without this capability. */
  timeOfDay?: TileflowTimeOfDay;
  /** Shows a continuous blend of the map's themes instead of `theme`. */
  themeBlend?: TileflowBrowserThemeBlendSelection;
  /** Cross-fades theme, blend, colour and emphasis changes. */
  themeTransition?: TileflowThemeTransitionOptions;
  /** Colour token or knob overrides, which may use CSS variables read where the map sits. */
  colors?: TileflowColorOverrides;
  /** Makes chosen modules of the map recede so the application's content reads first. */
  emphasis?: TileflowEmphasis;
  vegetation?: boolean;
  viewMode?: TileflowViewMode;
  center?: [number, number];
  zoom?: number;
  /** Shows these bounds; `center` and `zoom` set the view only until bounds are given. */
  bounds?: TileflowBounds;
  /** Fits the map to all annotations, and again whenever their positions change. */
  fitAnnotations?: boolean | TileflowFitBoundsOptions;
  fitBoundsOptions?: TileflowFitBoundsOptions;
  interactive?: boolean;
  /** Zoom and compass buttons; none unless asked. */
  navigationControl?: TileflowNavigationControlInput;
  mapOptions?: TileflowMapLibreOptions;
  analytics?: TileflowAnalytics;
  /** Group `annotations` into accessible cluster buttons. Up to 1,000 annotations. */
  annotationClusters?: TileflowAnnotationClusterOptions;
  annotations?: readonly TAnnotation[];
  dataOverlays?: Readonly<Record<string, TileflowMapLibreOverlay>>;
  dataSources?: Readonly<Record<string, TileflowGeoJsonSource>>;
  interactions?: readonly TileflowInteractionBinding[];
  /** Views drawn into marker, popup and tooltip elements. */
  views?: TileflowMapViews<TAnnotation>;
  /** Hands view elements to a framework that draws them; replaces `views`. */
  renderTargets?: TileflowMapRenderTargetsOptions<TAnnotation>;
  onError?: (event: TileflowMapError) => void;
  onLoad?: (map: MapLibreMap) => void;
  onThemeChange?: (transition: TileflowThemeTransition) => void;
  onInteractionDiagnostic?: (diagnostic: TileflowInteractionDiagnostic) => void;
  onInteractionEvent?: (event: TileflowInteractionEvent<TAnnotation>) => void;
  onInteractionStateChange?: (state: TileflowInteractionState) => void;
  onStatusChange?: (status: TileflowMapStatus) => void;
};

/** Options read once, when the map is created. */
export type TileflowMapCreateOptions = Readonly<{
  /** Names the map in deterministic capture, as `data-tileflow-capture-id`. */
  captureId?: string;
  /** Names the integration in session analytics; adapters pass their framework. */
  sessionSource?: string;
  /**
   * Receives `data-tileflow-map`, `data-tileflow-theme`, `data-tileflow-state` and
   * `data-tileflow-capture-id`; the container unless given, none when `null`.
   */
  statusElement?: HTMLElement | null;
}>;

export type TileflowMapController<TAnnotation extends TileflowAnnotation = TileflowAnnotation> =
  Readonly<{
    container: HTMLElement;
    /**
     * Settles with the MapLibre map when it first loads, or with `null` once an image-mode map has
     * shown its image; rejects when it cannot start or when the controller is destroyed first.
     */
    ready: Promise<MapLibreMap | null>;
    /** Takes the map down, empties what it added to the container, and stops every listener. */
    destroy(): void;
    getInteractionState(): TileflowInteractionState;
    /** The MapLibre map, or `null` before it is created and after it is taken down. */
    getMap(): MapLibreMap | null;
    getRenderTargets(): TileflowMapRenderTargetList<TAnnotation>;
    getStatus(): TileflowMapStatus;
    /** Changes theme, colours and emphasis; `null` until the map exists or when it has no themes. */
    getThemeController(): TileflowThemeController | null;
    setAnnotations(annotations: readonly TAnnotation[] | undefined): void;
    setBounds(bounds: TileflowBounds | undefined, options?: TileflowFitBoundsOptions): void;
    setColors(colors: TileflowColorOverrides | undefined): void;
    setEmphasis(emphasis: TileflowEmphasis | undefined): void;
    setInteractions(interactions: readonly TileflowInteractionBinding[] | undefined): void;
    /** Opens or closes a popup; on a controlled map it is the same as passing `interactionState`. */
    setInteractionState(state: TileflowInteractionState): void;
    setTheme(theme: TileflowThemeSelection | undefined): void;
    setThemeBlend(themeBlend: TileflowBrowserThemeBlendSelection | undefined): void;
    setView(view: Readonly<{center?: [number, number]; zoom?: number}>): void;
    setViews(views: TileflowMapViews<TAnnotation> | undefined): void;
    /**
     * Applies changed options. Keys left out keep their value; a key given as `undefined` clears it.
     * Unchanged values do no work, so an adapter can pass all of its props on every render.
     */
    update(options: Partial<TileflowMapControllerOptions<TAnnotation>>): void;
  }>;

type ManifestResolution = Readonly<{
  key: string;
  map: TileflowRuntimeManifestMap | null;
  state: 'error' | 'loading' | 'ready';
}>;

type Positioned = ReturnType<typeof wrapMapLibrePositioned>;

/** A map that has been created, with the scope that owns it and what is attached to it. */
type MountedMap = Readonly<{
  map: MapLibreMap;
  maplibregl: TileflowMapLibre;
  scope: TileflowResourceScope;
}>;

/** A theme by the selection that asked for it, such as `system`, and the theme it resolved to. */
type ThemeChoice = Readonly<{
  selection: TileflowThemeSelection | undefined;
  theme: string | undefined;
}>;

/** A requested theme the map could not show, and what the map shows instead. */
type FailedTheme = ThemeChoice & Readonly<{fallback: ThemeChoice}>;

const noInteractions: readonly TileflowInteractionBinding[] = [];
const statusAttributes = [
  'data-tileflow-capture-id',
  'data-tileflow-map',
  'data-tileflow-state',
  'data-tileflow-theme',
] as const;

/**
 * Mounts a Tileflow map in `container` and returns its controller. The container should have a
 * size; the map fills it and follows its resizes. Nothing is drawn around the map: loading,
 * error and diagnostic views belong to the application, from `getStatus` and `onStatusChange`.
 */
export function createTileflowMap<TAnnotation extends TileflowAnnotation = TileflowAnnotation>(
  container: HTMLElement,
  initialOptions: TileflowMapControllerOptions<TAnnotation>,
  createOptions: TileflowMapCreateOptions = {},
): TileflowMapController<TAnnotation> {
  if (!container || typeof container !== 'object' || !container.ownerDocument) {
    throw new TypeError('createTileflowMap needs an HTML element to mount the map in.');
  }
  const ownerWindow = container.ownerDocument.defaultView;
  if (!ownerWindow) throw new Error('A Tileflow map needs a browser document.');
  const browserWindow: Window = ownerWindow;
  assertTileflowMapStyleOptions(initialOptions);
  if (initialOptions.views && initialOptions.renderTargets) {
    throw new TypeError('A Tileflow map takes views or renderTargets, not both.');
  }

  const sessionSource = createOptions.sessionSource ?? 'dom';
  const statusElement =
    createOptions.statusElement === undefined ? container : createOptions.statusElement;
  const captureId = normalizeTileflowCaptureId(createOptions.captureId);
  const controlledInteractionOwnership = initialOptions.interactionState !== undefined;

  let options: TileflowMapControllerOptions<TAnnotation> = {...initialOptions};
  let destroyed = false;
  let reconciling = false;
  let dirty = false;
  let scheduled = false;

  // State the map itself changes, like a component's state.
  let manifestResolution: ManifestResolution = {key: '', map: null, state: 'loading'};
  let systemColorScheme: 'dark' | 'light' = 'light';
  let captureState: TileflowMapReadiness = 'loading';
  let themeTransitionState: TileflowMapReadiness = 'idle';
  let activeRuntimeResource: unknown;
  let annotationRenderTargets: readonly TileflowMapLibreDomRenderTarget<TAnnotation>[] = [];
  let semanticRenderTargets: readonly TileflowMapLibreSemanticDomRenderTarget[] = [];
  let annotationBridgeDiagnostic: TileflowInteractionDiagnostic | undefined;
  let semanticBridgeDiagnostic: TileflowInteractionDiagnostic | undefined;
  let stateBridgeDiagnostic: TileflowInteractionDiagnostic | undefined;
  let rendererBridgeDiagnostic: TileflowInteractionDiagnostic | undefined;
  let viewBridgeDiagnostic: TileflowInteractionDiagnostic | undefined;
  let dataBridgeDiagnostic: TileflowInteractionDiagnostic | undefined;
  let interactionStartDiagnostic: TileflowInteractionDiagnostic | undefined;
  let annotationDiagnostics: readonly TileflowInteractionDiagnostic[] = [];
  let semanticDiagnostics: readonly TileflowInteractionDiagnostic[] = [];
  let reportedDeclarativeDiagnosticKeys: ReadonlySet<string> = new Set();
  let imageSize: {height: number; width: number} | null = null;
  let managedImage: HTMLImageElement | null = null;
  let imageReadinessRun = 0;
  // The theme on the map, and the last request it could not show: the map keeps showing the
  // applied theme, and the status reports it, until the request changes.
  let themeMapIdentity: string | undefined;
  let appliedTheme: ThemeChoice | undefined;
  let failedTheme: FailedTheme | undefined;
  // The last theme selection that named a theme of the map, which an unknown name falls back to,
  // whether its change is still on the way or applied.
  let validThemeSelection: TileflowThemeSelection | undefined;

  // Objects behind the map while it is mounted.
  let map: MapLibreMap | null = null;
  let mounted: MountedMap | undefined;
  let scene: TileflowMap3DAttachment | undefined;
  let themeController: TileflowThemeController | undefined;
  let appearanceBinding: TileflowAppearanceBinding | undefined;
  let navigationBinding: TileflowNavigationControlBinding | undefined;
  let interactionRuntime: TileflowMapLibreDomRuntime<TAnnotation> | undefined;
  let semanticRuntime: TileflowMapLibreSemanticDomRuntime | undefined;
  let interactionCoordinator: TileflowMapLibreInteractionCoordinator | undefined;
  let dataRuntime: TileflowMapLibreDataRuntime<TAnnotation> | undefined;
  let appliedCameraFitKey: string | undefined;
  let lastStatus: TileflowMapStatus | undefined;

  // Values derived on the last pass, read by callbacks that outlive it.
  let current!: ReturnType<typeof derive>;
  let annotationsForRuntime: readonly TAnnotation[] = [];
  let annotationTitles: ReadonlyMap<string, string> = new Map();
  let coordinatedInteractionState: TileflowInteractionState = prepareTileflowInteractionState(
    initialOptions.interactionState,
    initialOptions.defaultInteractionState,
  ).state;
  let dataInput: TileflowMapLibreDataInput<TAnnotation> = {};

  let resolveReady!: (map: MapLibreMap | null) => void;
  let rejectReady!: (error: unknown) => void;
  let readySettled = false;
  const ready = new Promise<MapLibreMap | null>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // An application that never awaits `ready` should not see an unhandled rejection.
  ready.catch(() => undefined);
  const settleReady = (outcome: {error: unknown} | {map: MapLibreMap | null}) => {
    if (readySettled) return;
    readySettled = true;
    if ('map' in outcome) resolveReady(outcome.map);
    else rejectReady(outcome.error);
  };

  const reconciler = createTileflowReconciler();
  const reportError = (code: TileflowMapErrorCode, cause: unknown) => {
    reportTileflowMapError(options.onError, code, cause);
    if (code === 'manifest' || code === 'runtime') {
      settleReady({error: cause instanceof Error ? cause : new Error(String(cause))});
    }
  };
  const reportDiagnostic = (diagnostic: TileflowInteractionDiagnostic) =>
    options.onInteractionDiagnostic?.(diagnostic);
  const viewHost: TileflowMapViewHost<TAnnotation> = createTileflowMapViewHost<TAnnotation>({
    onChange: () => invalidate(),
    onError(error) {
      console.error('Failed to render a Tileflow map view', error);
      viewBridgeDiagnostic = createOverlayFailureDiagnostic(
        'A Tileflow map view could not be rendered.',
      );
      reportDiagnostic(viewBridgeDiagnostic);
      invalidate();
    },
    window: browserWindow,
  });

  /** State changes made by the map run one pass after the current task, batched. */
  function invalidate() {
    if (destroyed) return;
    if (reconciling) {
      dirty = true;
      return;
    }
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      reconcile();
    });
  }

  function derive() {
    const memo = reconciler.memo;
    const stable = reconciler.stable;
    const {
      annotationClusters,
      annotations,
      bounds,
      dataOverlays,
      dataSources,
      defaultInteractionState,
      fitAnnotations,
      fitBoundsOptions,
      interactionState,
      source,
      theme,
      themeBlend,
      timeOfDay,
    } = options;
    const interactions = options.interactions ?? noInteractions;
    const runtimeSource = memo('runtimeSource', [source.manifestUrl, source.map], () => ({
      manifestUrl: source.manifestUrl,
      map: source.map,
    }));
    const mapName = runtimeSource.map;
    const manifestUrl = runtimeSource.manifestUrl ?? defaultTileflowManifestUrl;
    const runtimeMapIdentity = `${manifestUrl}\0${mapName}`;
    if (themeMapIdentity !== runtimeMapIdentity) {
      themeMapIdentity = runtimeMapIdentity;
      appliedTheme = undefined;
      failedTheme = undefined;
      validThemeSelection = undefined;
    }
    const preparedAnnotations = memo('annotations', [annotations], () =>
      prepareTileflowAnnotations(annotations),
    );
    const preparedInteractions = memo('interactions', [interactions], () =>
      prepareTileflowInteractionBindings(interactions),
    );
    const preparedInteractionState = memo(
      'interactionState',
      [defaultInteractionState, interactionState],
      () =>
        prepareTileflowInteractionState(
          interactionState,
          defaultInteractionState,
          controlledInteractionOwnership,
        ),
    );
    const cameraFit = memo(
      'cameraFit',
      [annotations, bounds, fitAnnotations, fitBoundsOptions],
      () =>
        resolveTileflowCameraFit({
          annotations: annotations ?? [],
          bounds,
          fitAnnotations,
          fitBoundsOptions,
        }),
    );
    const mapOptions = stable('mapOptions', options.mapOptions);
    const manifestRequestKey = JSON.stringify([manifestUrl, mapName]);
    const currentManifest: ManifestResolution =
      manifestResolution.key === manifestRequestKey
        ? manifestResolution
        : {key: manifestRequestKey, map: null, state: 'loading'};
    const manifestMap = currentManifest.state === 'ready' ? currentManifest.map : null;
    const themeBlendKey = themeBlend ? JSON.stringify(themeBlend.themes) : undefined;
    const blendThemeName = themeBlend ? nearestTileflowBlendTheme(themeBlend) : undefined;
    const resolveSelection = (selection: TileflowThemeSelection | undefined) => {
      if (!manifestMap) {
        return {
          error: false,
          name: selection && selection !== 'system' ? selection : undefined,
        } as const;
      }
      try {
        if (themeBlendKey) {
          for (const name of JSON.parse(themeBlendKey) as string[]) {
            resolveTileflowRuntimeTheme(manifestMap, name);
          }
        }
        return {
          error: false,
          name: resolveTileflowRuntimeTheme(
            manifestMap,
            selection,
            systemColorScheme,
            themeBlendKey ? undefined : timeOfDay,
          ).name,
        } as const;
      } catch (cause) {
        return {cause, error: true, name: undefined} as const;
      }
    };
    const themeResolution = memo(
      'themeResolution',
      [blendThemeName, manifestMap, systemColorScheme, theme, themeBlendKey, timeOfDay],
      () => resolveSelection(blendThemeName ?? theme),
    );
    // What the map follows. A request it could not show leaves it on the theme applied before;
    // an unknown name leaves it on the last selection that named a theme, still on its way or
    // applied. Either keeps following the system when that selection did.
    const themeRequestFailed =
      failedTheme !== undefined &&
      failedTheme.selection === theme &&
      failedTheme.theme === themeResolution.name;
    const themeChoice = memo(
      'themeChoice',
      [
        failedTheme,
        manifestMap,
        systemColorScheme,
        themeBlendKey,
        themeRequestFailed,
        themeResolution,
        timeOfDay,
        validThemeSelection,
      ],
      () => {
        if (blendThemeName) return {resolution: themeResolution, selection: theme};
        if (themeRequestFailed && failedTheme) {
          const {fallback} = failedTheme;
          const resolution = resolveSelection(fallback.selection);
          // The fallback's own theme is the one that failed: stay on the applied theme.
          return resolution.error || resolution.name === failedTheme.theme
            ? {resolution: {error: false, name: fallback.theme} as const, selection: fallback.theme}
            : {resolution, selection: fallback.selection};
        }
        if (themeResolution.error) {
          return {
            resolution: resolveSelection(validThemeSelection),
            selection: validThemeSelection,
          };
        }
        return {resolution: themeResolution, selection: theme};
      },
    );
    const themeSelection = themeChoice.selection;
    const shownThemeResolution = themeChoice.resolution;
    const manifestView = resolveTileflowRuntimeView({manifestMap});
    const manifestCenter = stable<[number, number]>(
      'manifestCenter',
      normalizeTileflowRuntimeCenter(manifestView.center),
    );
    const resolvedCenter = stable<LngLatLike>(
      'center',
      options.center ?? mapOptions?.center ?? manifestCenter,
    );
    const resolvedZoom =
      options.zoom ?? mapOptions?.zoom ?? manifestView.zoom ?? defaultTileflowRuntimeView.zoom;
    const resolvedBearing = mapOptions?.bearing ?? manifestView.bearing;
    const resolvedPitch = mapOptions?.pitch ?? manifestView.pitch;
    const resolvedInteractive = options.interactive ?? mapOptions?.interactive ?? true;
    const isImageMode = options.mode === 'image';
    const renderers = tileflowMapRenderers(options);
    const {hasMarkerRenderer, hasPopupRenderer, hasTooltipRenderer} = renderers;
    const hasInteractionConfiguration = hasTileflowMapInteractionConfiguration(options, renderers);
    const declarativeDiagnostics = memo(
      'declarativeDiagnostics',
      [
        hasInteractionConfiguration,
        hasPopupRenderer,
        hasTooltipRenderer,
        interactions,
        isImageMode,
        preparedAnnotations,
        preparedInteractions,
        preparedInteractionState,
      ],
      () =>
        tileflowMapDeclarativeDiagnostics({
          hasInteractionConfiguration,
          hasPopupRenderer,
          hasTooltipRenderer,
          interactions,
          isImageMode,
          preparedAnnotations,
          preparedInteractions,
          preparedInteractionState,
        }),
    );
    // Kept while equal, so asking for the theme already on its way does not ask again.
    const runtimeStyle = stable(
      'runtimeStyle',
      memo(
        'runtimeStyle',
        [isImageMode, manifestMap, runtimeSource, systemColorScheme, shownThemeResolution],
        () =>
          isImageMode || shownThemeResolution.error
            ? null
            : resolveTileflowRuntimeStyle({
                colorScheme: systemColorScheme,
                manifestMap,
                source: runtimeSource,
                theme: shownThemeResolution.name,
              }),
      ),
    );
    const blendResolution = memo(
      'blendResolution',
      [isImageMode, manifestMap, runtimeSource, themeBlendKey],
      (): {cause?: unknown; styles: TileflowRuntimeStyle[] | null} => {
        if (isImageMode || !manifestMap || !themeBlendKey) return {styles: null};
        try {
          return {
            styles: resolveTileflowRuntimeThemeBlend({
              blend: {position: 0, themes: JSON.parse(themeBlendKey) as string[]},
              manifestMap,
              source: runtimeSource,
            }),
          };
        } catch (cause) {
          return {cause, styles: null};
        }
      },
    );
    const resolvedAnalytics = memo('analytics', [options.analytics, runtimeStyle], () =>
      mergeTileflowAnalytics(options.analytics, runtimeStyle?.analytics),
    );
    const staticImageCenter = stable<[number, number]>(
      'staticImageCenter',
      normalizeTileflowRuntimeCenter(options.center ?? mapOptions?.center, manifestCenter),
    );
    const runtimeImageUrl = memo(
      'runtimeImageUrl',
      [
        imageSize,
        options.imageUrl,
        isImageMode,
        manifestMap,
        staticImageCenter,
        resolvedZoom,
        systemColorScheme,
        themeResolution,
      ],
      () =>
        options.imageUrl ??
        (isImageMode && !themeResolution.error
          ? resolveTileflowStaticImageUrl({
              center: staticImageCenter,
              colorScheme: systemColorScheme,
              imageSize,
              manifestMap,
              theme: themeResolution.name,
              zoom: resolvedZoom,
            })
          : undefined),
    );
    const runtimeResolutionState: TileflowMapReadiness =
      currentManifest.state !== 'ready'
        ? currentManifest.state === 'error'
          ? 'error'
          : 'loading'
        : themeResolution.error || themeRequestFailed
          ? 'error'
          : isImageMode
            ? runtimeImageUrl
              ? 'idle'
              : options.imageUrl === undefined && imageSize === null
                ? 'loading'
                : 'error'
            : runtimeStyle
              ? 'idle'
              : 'error';

    return {
      annotationClusters,
      blendResolution,
      isImageMode,
      runtimeImageUrl,
      cameraFit,
      dataOverlays,
      dataSources,
      declarativeDiagnostics,
      hasMarkerRenderer,
      hasPopupRenderer,
      hasTooltipRenderer,
      manifestRequestKey,
      manifestUrl,
      mapName,
      mapOptions,
      preparedAnnotations,
      preparedInteractions,
      preparedInteractionState,
      resolvedAnalytics,
      resolvedBearing,
      resolvedCenter,
      resolvedInteractive,
      resolvedPitch,
      resolvedZoom,
      runtimeMapIdentity,
      runtimeResolutionState,
      runtimeSource,
      manifestReady: manifestMap !== null,
      runtimeStyle,
      shownThemeResolution,
      themeRequestFailed,
      themeSelection,
      themeBlendHold: themeBlend?.hold === true,
      themeBlendKey,
      themeBlendPosition: themeBlend?.position,
      themeResolution,
    };
  }

  function reconcile() {
    if (destroyed) return;
    reconciling = true;
    try {
      do {
        dirty = false;
        pass();
      } while (dirty && !destroyed);
    } finally {
      reconciling = false;
    }
    emitStatus();
  }

  function pass() {
    const effect = reconciler.effect;
    const d = derive();
    current = d;
    if (d.preparedAnnotations.ok) {
      annotationsForRuntime = d.preparedAnnotations.annotations;
      annotationTitles = d.preparedAnnotations.titles;
    }
    dataInput = {
      annotationClusters: d.annotationClusters,
      annotations: d.preparedAnnotations.annotations,
      dataOverlays: d.dataOverlays,
      dataSources: d.dataSources,
    };

    effect('scene', [options.vegetation, options.viewMode ?? '3d'], () => {
      scene?.setVegetation(options.vegetation);
      scene?.setViewMode(options.viewMode ?? '3d');
    });

    effect('imageSize', [d.isImageMode, options.imageUrl], () => {
      imageSize = null;
      invalidate();
      if (!d.isImageMode || options.imageUrl) return;
      const updateImageSize = () => {
        const next = normalizeTileflowStaticImageSize({
          height: container.clientHeight,
          width: container.clientWidth,
        });
        if (imageSize?.height === next.height && imageSize.width === next.width) return;
        imageSize = next;
        invalidate();
      };
      const resizeObserver = new ResizeObserver(updateImageSize);
      resizeObserver.observe(container);
      updateImageSize();
      return () => resizeObserver.disconnect();
    });

    // Without a framework's own image, the map adds one while it shows an image.
    const ownsImage = d.isImageMode && options.image === undefined;
    effect('managedImage', [ownsImage], () => {
      if (!ownsImage) return;
      const image = container.ownerDocument.createElement('img');
      image.decoding = 'async';
      image.style.cssText = 'display: block; height: 100%; object-fit: cover; width: 100%;';
      managedImage = image;
      invalidate();
      return () => {
        image.remove();
        if (managedImage === image) managedImage = null;
      };
    });
    const imageElement = ownsImage ? managedImage : (options.image ?? null);
    const alt = options.alt ?? '';
    const imageLoading = options.imageLoading ?? 'eager';
    effect('managedImageAttributes', [managedImage, d.runtimeImageUrl, alt, imageLoading], () => {
      const image = managedImage;
      if (!image) return;
      image.alt = alt;
      image.loading = imageLoading;
      if (!d.runtimeImageUrl) {
        image.remove();
        image.removeAttribute('src');
        return;
      }
      if (image.getAttribute('src') !== d.runtimeImageUrl) image.src = d.runtimeImageUrl;
      if (!image.isConnected) container.append(image);
    });

    effect('imageReadiness', [d.isImageMode, d.runtimeImageUrl, imageElement], () => {
      if (!d.isImageMode) return;
      imageReadinessRun += 1;
      activeRuntimeResource = d.runtimeImageUrl;
      captureState = 'loading';
      invalidate();
      const image = imageElement;
      if (!image) return;
      const markReady = async () => {
        const run = ++imageReadinessRun;
        try {
          if (typeof image.decode === 'function') await image.decode();
        } catch {
          if (!image.complete || image.naturalWidth === 0) {
            if (imageReadinessRun === run) {
              captureState = 'error';
              invalidate();
            }
            return;
          }
        }
        if (imageReadinessRun !== run) return;
        captureState = 'idle';
        invalidate();
      };
      const fail = () => {
        imageReadinessRun += 1;
        captureState = 'error';
        invalidate();
      };
      const load = () => void markReady();
      image.addEventListener('load', load);
      image.addEventListener('error', fail);
      if (image.complete && image.getAttribute('src')) {
        if (image.naturalWidth === 0) fail();
        else void markReady();
      }
      return () => {
        image.removeEventListener('load', load);
        image.removeEventListener('error', fail);
      };
    });

    if (d.manifestReady && !d.themeResolution.error && !d.themeRequestFailed) {
      validThemeSelection = options.theme;
    }
    // A failed request is tried again once the selection, or the theme it resolves to, changes.
    if (
      failedTheme &&
      (failedTheme.selection !== options.theme || failedTheme.theme !== d.themeResolution.name)
    ) {
      failedTheme = undefined;
    }

    effect('systemColorScheme', [d.themeSelection], () => {
      if (d.themeSelection !== 'system') return;
      systemColorScheme = getTileflowSystemColorScheme();
      invalidate();
      return subscribeTileflowSystemColorScheme((scheme) => {
        systemColorScheme = scheme;
        invalidate();
      });
    });

    effect('declarativeDiagnostics', [d.declarativeDiagnostics], () => {
      const previousKeys = reportedDeclarativeDiagnosticKeys;
      const nextKeys = new Set<string>();
      for (const diagnostic of d.declarativeDiagnostics) {
        const key = tileflowInteractionDiagnosticKey(diagnostic);
        nextKeys.add(key);
        if (!previousKeys.has(key)) reportDiagnostic(diagnostic);
      }
      reportedDeclarativeDiagnosticKeys = nextKeys;
    });

    effect('manifest', [d.manifestRequestKey, d.manifestUrl, d.mapName], () => {
      let cancelled = false;
      const {manifestRequestKey, manifestUrl, mapName} = d;
      manifestResolution = {key: manifestRequestKey, map: null, state: 'loading'};
      invalidate();
      loadTileflowManifest(manifestUrl)
        .then((manifest) => {
          if (cancelled) return;
          const resolvedMap =
            manifest && mapName ? resolveTileflowManifestMap(manifest, mapName) : null;
          if (!resolvedMap) {
            reportError(
              'manifest',
              new Error(
                manifest
                  ? `The Tileflow manifest at ${manifestUrl} has no map named "${mapName}".`
                  : `No Tileflow manifest was found at ${manifestUrl}.`,
              ),
            );
          }
          manifestResolution = {
            key: manifestRequestKey,
            map: resolvedMap,
            state: resolvedMap ? 'ready' : 'error',
          };
          invalidate();
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          reportError('manifest', error);
          manifestResolution = {key: manifestRequestKey, map: null, state: 'error'};
          invalidate();
        });
      return () => {
        cancelled = true;
      };
    });

    effect('camera', [d.resolvedBearing, d.resolvedCenter, d.resolvedPitch, d.resolvedZoom], () => {
      map?.jumpTo({
        bearing: d.resolvedBearing,
        center: d.resolvedCenter,
        pitch: d.resolvedPitch,
        zoom: d.resolvedZoom,
      });
    });

    effect('navigationControl', [options.navigationControl, d.resolvedInteractive], () => {
      navigationBinding?.update(d.resolvedInteractive ? options.navigationControl : false);
    });

    effect('cameraFit', [d.cameraFit], () => {
      if (!map || appliedCameraFitKey === d.cameraFit.key) return;
      appliedCameraFitKey = d.cameraFit.key;
      if (d.cameraFit.error) reportError('camera', new Error(d.cameraFit.error));
      if (d.cameraFit.fit) fitCameraTo(map, d.cameraFit.fit);
    });

    effect('reconcileAnnotations', [d.preparedAnnotations], () => {
      if (!interactionRuntime || !d.preparedAnnotations.ok) return;
      reconcileAnnotations(interactionRuntime, d.preparedAnnotations.annotations);
    });

    effect(
      'reconcileData',
      [d.annotationClusters, d.dataOverlays, d.dataSources, d.preparedAnnotations],
      () => {
        if (dataRuntime) reconcileData(dataRuntime);
      },
    );

    // Interactions that could not start try again once what they show changes.
    effect(
      'restartInteractions',
      [
        d.annotationClusters,
        d.dataOverlays,
        d.dataSources,
        d.hasMarkerRenderer,
        d.hasPopupRenderer,
        d.hasTooltipRenderer,
        d.preparedAnnotations,
        d.preparedInteractions,
      ],
      () => {
        if (interactionStartDiagnostic && mounted && !mounted.scope.disposed) {
          attachInteractions(mounted);
        }
      },
    );

    effect('reconcileInteractions', [d.preparedInteractions], () => {
      if (!semanticRuntime || !d.preparedInteractions.ok) return;
      reconcileInteractions(semanticRuntime, d.preparedInteractions.bindings);
    });

    effect('controlledInteractionState', [d.preparedInteractionState], () => {
      const prepared = d.preparedInteractionState;
      if (!prepared.controlled || !prepared.ok) return;
      try {
        stateBridgeDiagnostic = undefined;
        interactionCoordinator?.setInteractionState(prepared.state);
        coordinatedInteractionState = prepared.state;
      } catch (error) {
        console.error('Failed to update Tileflow interaction state', error);
        stateBridgeDiagnostic = createOverlayFailureDiagnostic(
          'Tileflow interaction state could not be updated.',
        );
        reportDiagnostic(stateBridgeDiagnostic);
      }
      invalidate();
    });

    effect(
      'customRenderers',
      [d.hasMarkerRenderer, d.hasPopupRenderer, d.hasTooltipRenderer],
      () => {
        if (!interactionRuntime && !semanticRuntime) return;
        try {
          rendererBridgeDiagnostic = undefined;
          interactionRuntime?.setCustomRenderers({
            marker: d.hasMarkerRenderer,
            popup: d.hasPopupRenderer,
            tooltip: d.hasTooltipRenderer,
          });
          semanticRuntime?.setCustomRenderers({
            popup: d.hasPopupRenderer,
            tooltip: d.hasTooltipRenderer,
          });
        } catch (error) {
          console.error('Failed to update Tileflow interaction renderers', error);
          rendererBridgeDiagnostic = createOverlayFailureDiagnostic(
            'Tileflow interaction renderers could not be updated.',
          );
          reportDiagnostic(rendererBridgeDiagnostic);
        }
        invalidate();
      },
    );

    effect(
      'mount',
      [
        d.isImageMode,
        d.resolvedInteractive,
        d.runtimeMapIdentity,
        d.runtimeStyle !== null || (d.themeResolution.error && map !== null),
        d.mapOptions,
      ],
      () => (d.isImageMode ? undefined : mountMap()),
    );

    effect('theme', [d.runtimeStyle, d.themeBlendKey], () => {
      const controller = themeController;
      if (!controller || d.themeBlendKey) return;
      // Leaving a blend applies the selected theme even when it is the blend's nearest one.
      if (
        !d.runtimeStyle ||
        (controller.getCurrent() === d.runtimeStyle && !controller.getBlend())
      ) {
        return;
      }
      requestTheme(controller, d.runtimeStyle, d.themeSelection);
    });

    const themeResolutionCause = d.themeResolution.error ? d.themeResolution.cause : undefined;
    effect('themeError', [d.themeResolution.error, themeResolutionCause], () => {
      if (d.themeResolution.error) reportError('theme', themeResolutionCause);
    });

    effect('blendError', [d.blendResolution.cause], () => {
      if (d.blendResolution.cause !== undefined) reportError('blend', d.blendResolution.cause);
    });

    effect('appearance', [options.colors, options.emphasis], () => {
      appearanceBinding?.update(
        {colors: options.colors, emphasis: options.emphasis},
        {transition: options.themeTransition},
      );
    });

    effect(
      'blend',
      [d.blendResolution.styles, d.runtimeStyle, d.themeBlendHold, d.themeBlendPosition],
      () => {
        const controller = themeController;
        const styles = d.blendResolution.styles;
        const position = d.themeBlendPosition;
        if (!controller || !styles || position === undefined) return;
        if (d.runtimeStyle) {
          activeRuntimeResource = d.runtimeStyle;
          invalidate();
        }
        void controller
          .setBlend(
            {hold: d.themeBlendHold, position, themes: styles},
            {transition: options.themeTransition},
          )
          .then((result) => {
            if (result.status === 'failed') {
              reportError(
                'blend',
                result.error ?? new Error('The map themes could not be blended.'),
              );
            }
          });
      },
    );

    reconciler.commit();
    syncViews();
  }

  function reconcileAnnotations(
    runtime: TileflowMapLibreDomRuntime<TAnnotation>,
    annotations: readonly TAnnotation[],
  ) {
    try {
      annotationBridgeDiagnostic = undefined;
      runtime.reconcile(annotations);
    } catch (error) {
      console.error('Failed to reconcile Tileflow annotations', error);
      annotationBridgeDiagnostic = createOverlayFailureDiagnostic(
        'Tileflow annotations could not be reconciled.',
      );
      reportDiagnostic(annotationBridgeDiagnostic);
    }
    invalidate();
  }

  function reconcileData(runtime: TileflowMapLibreDataRuntime<TAnnotation>) {
    try {
      dataBridgeDiagnostic = undefined;
      runtime.reconcile(dataInput);
    } catch (error) {
      console.error('Failed to reconcile Tileflow data layers', error);
      dataBridgeDiagnostic = createOverlayFailureDiagnostic(
        'Tileflow data layers could not be reconciled.',
      );
      reportDiagnostic(dataBridgeDiagnostic);
    }
    invalidate();
  }

  function reconcileInteractions(
    runtime: TileflowMapLibreSemanticDomRuntime,
    bindings: readonly TileflowInteractionBinding[],
  ) {
    try {
      semanticBridgeDiagnostic = undefined;
      runtime.reconcile(bindings);
    } catch (error) {
      console.error('Failed to reconcile Tileflow semantic interactions', error);
      semanticBridgeDiagnostic = createOverlayFailureDiagnostic(
        'Tileflow semantic interactions could not be reconciled.',
      );
      reportDiagnostic(semanticBridgeDiagnostic);
    }
    invalidate();
  }

  // The same lists the runtimes start from, so a new map hands over nothing until they change.
  let lastRenderTargets: TileflowMapRenderTargetList<TAnnotation> = {
    annotations: annotationRenderTargets,
    semantic: semanticRenderTargets,
  };
  function syncViews() {
    if (
      lastRenderTargets.annotations !== annotationRenderTargets ||
      lastRenderTargets.semantic !== semanticRenderTargets
    ) {
      lastRenderTargets = {annotations: annotationRenderTargets, semantic: semanticRenderTargets};
      options.renderTargets?.onChange(lastRenderTargets);
    }
    viewHost.sync(lastRenderTargets, options.renderTargets ? {} : (options.views ?? {}));
  }

  /**
   * Starts the MapLibre map for the current style. Everything the mount acquires belongs to one
   * scope, and the returned cleanup releases it: a load that answers after the cleanup creates
   * nothing, and a failure halfway releases what was acquired until then.
   */
  function mountMap(): (() => void) | undefined {
    themeTransitionState = 'idle';
    invalidate();
    const initialRuntimeStyle = current.runtimeStyle;
    if (!initialRuntimeStyle) return undefined;

    activeRuntimeResource = initialRuntimeStyle;
    captureState = 'loading';
    const scope = createTileflowResourceScope();
    const {mapOptions} = current;

    const resourceLifetime = new AbortController();
    scope.add(() => resourceLifetime.abort());
    const session = createTileflowSessionController({source: sessionSource});
    const resourceTransform = createTileflowTransformRequest({
      getAnalytics: () => current.resolvedAnalytics,
      sessionController: session,
      sessionId: session.sessionId,
      transformRequest: mapOptions?.transformRequest ?? undefined,
    });
    const styleLoadOptions = {
      signal: resourceLifetime.signal,
      transformRequest: (url: string, type: 'Style' | 'Source') =>
        resourceTransform(
          url,
          type as Parameters<NonNullable<TileflowMapLibreOptions['transformRequest']>>[1],
        ),
    };
    void Promise.all([
      loadTileflowMapLibre(),
      loadTileflowRuntimeStyle(initialRuntimeStyle, styleLoadOptions).then(async (prepared) => {
        await loadTileflowStyleFonts(prepared.style, {fontFaces: prepared.fontFaces});
        return prepared;
      }),
    ])
      .then(([maplibregl, prepared]) => {
        // A load that ignored the cancellation must not create a map for a mount already gone.
        if (scope.disposed || destroyed) return;
        createMap(scope, maplibregl, prepared, {initialRuntimeStyle, session, styleLoadOptions});
      })
      .catch((error: unknown) => {
        const cancelled = scope.disposed || destroyed;
        try {
          scope.dispose();
        } catch (cleanupError) {
          console.error('Failed to release a Tileflow map that could not start', cleanupError);
        }
        if (cancelled) return;
        reportError('runtime', error);
        captureState = 'error';
        invalidate();
      });

    return () => scope.dispose();
  }

  function createMap(
    scope: TileflowResourceScope,
    maplibregl: TileflowMapLibre,
    prepared: TileflowLoadedRuntimeStyle,
    context: Readonly<{
      initialRuntimeStyle: TileflowRuntimeStyle;
      session: ReturnType<typeof createTileflowSessionController>;
      styleLoadOptions: TileflowRuntimeStyleLoadOptions;
    }>,
  ) {
    const {initialRuntimeStyle, session, styleLoadOptions} = context;
    const {mapOptions, resolvedInteractive} = current;
    // Released last: what the map shows goes back to its state before the mount.
    scope.add(() => {
      map = null;
      mounted = undefined;
      appliedTheme = undefined;
      invalidate();
    });

    const sessionStarter = createTileflowSessionStarter({
      getSessionId: () => session.sessionId,
      sessionId: session.sessionId,
      source: sessionSource,
    });
    const fairUseNotice = attachTileflowFairUseNotice(container);
    scope.add(() => fairUseNotice.dispose());
    // The protocols are shared by every map on the page; each map has its own channel or scope in
    // them, so taking one map down leaves the others' requests working.
    registerTileflowContourProtocol({addProtocol: maplibregl.addProtocol});
    registerTileflowPathGroundProtocol({addProtocol: maplibregl.addProtocol});
    registerTileflowPmtilesProtocol({addProtocol: maplibregl.addProtocol});
    const worldRequestBridge = registerTileflowWorldRequestBridge({
      addProtocol: maplibregl.addProtocol,
      onNotice: fairUseNotice.update,
    });
    scope.add(() => worldRequestBridge.dispose());
    // Contour DEM requests leave through the shared protocol and come back to this map's
    // transform, so they carry this map's session like its hillshade tiles.
    const contourRequestScope = createTileflowContourRequestScope({
      transformRequest: (url, resourceType) =>
        transformRequest(
          url,
          resourceType as Parameters<NonNullable<TileflowMapLibreOptions['transformRequest']>>[1],
        ),
    });
    scope.add(() => contourRequestScope.dispose());
    const transformRequest = createTileflowTransformRequest({
      contourRequestScope,
      getAnalytics: () => current.resolvedAnalytics,
      sessionController: session,
      sessionId: session.sessionId,
      transformRequest: mapOptions?.transformRequest ?? undefined,
      worldRequestBridge,
    });

    // The camera and interactivity are read now, so changes made while the map loaded apply.
    const mapLibreMap = new maplibregl.Map({
      ...mapOptions,
      canvasContextAttributes: tileflowCanvasContextAttributes(mapOptions?.canvasContextAttributes),
      container,
      style: prepared.style as StyleSpecification,
      bearing: current.resolvedBearing,
      center: current.resolvedCenter,
      pitch: current.resolvedPitch,
      zoom: current.resolvedZoom,
      interactive: resolvedInteractive,
      attributionControl: mapOptions?.attributionControl ?? {compact: true},
      // Tileflow's compiled styles are validated when they are built.
      validateStyle: mapOptions?.validateStyle ?? false,
      maxPitch: mapOptions?.maxPitch ?? tileflowMaxPitch,
      transformRequest,
    });

    map = mapLibreMap;
    // An application may take the map down itself with `getMap().remove()`. MapLibre has then
    // removed its controls and style, so the controller stops as `destroy()` would without
    // removing the map again. It waits until every `remove` listener has run, so the parts that
    // release themselves when the map goes have done so first.
    let removedByMapLibre = false;
    scope.add(() => {
      if (!removedByMapLibre) mapLibreMap.remove();
    });
    const handleRemove = () => {
      removedByMapLibre = true;
      if (map !== mapLibreMap) return;
      map = null;
      queueMicrotask(teardown);
    };
    mapLibreMap.on('remove', handleRemove);
    scope.add(() => mapLibreMap.off('remove', handleRemove));

    scope.add(attachTileflowAtmosphere(mapLibreMap));
    scope.add(attachTileflowBranding(mapLibreMap));
    scope.add(attachTileflowNotices(mapLibreMap));
    scope.add(attachTileflowNauticalLights(mapLibreMap));
    scope.add(attachTileflowLabelPlacement(mapLibreMap));
    // Feature queries and taps keep working once a steep pitch shows the horizon.
    scope.add(attachTileflowHorizonQueries(mapLibreMap));
    const controller =
      initialRuntimeStyle.theme === undefined
        ? undefined
        : createTileflowThemeController({
            initial: prepared.family ? prepared : initialRuntimeStyle,
            initialStyle: prepared.style,
            styleLoadOptions,
            map: mapLibreMap,
            onTransition(transition) {
              if (themeController !== controller) return;
              options.onThemeChange?.(transition);
              themeTransitionState =
                transition.phase === 'preloading' || transition.phase === 'applying'
                  ? 'loading'
                  : transition.phase === 'error'
                    ? 'error'
                    : 'idle';
              invalidate();
            },
          });
    if (controller) {
      themeController = controller;
      scope.add(() => {
        controller.dispose();
        if (themeController === controller) themeController = undefined;
      });
      appliedTheme = {selection: current.themeSelection, theme: initialRuntimeStyle.theme};
      // Colours and emphasis the application declared show from the first frame the style allows,
      // without easing in from the theme's own look.
      const appearance = createTileflowAppearanceBinding({
        controller,
        // CSS variables in `colors` are read where the map sits.
        element: container,
        map: mapLibreMap,
        onError: (error, part) => {
          if (appearanceBinding === appearance) reportError(part, error);
        },
      });
      appearanceBinding = appearance;
      scope.add(() => {
        appearance.dispose();
        if (appearanceBinding === appearance) appearanceBinding = undefined;
      });
      appearance.update(
        {colors: options.colors, emphasis: options.emphasis},
        {transition: {duration: 0}},
      );
    }
    // The map's 3D scene loads only once its style declares one, so 2D maps do not pay for it.
    const mapScene = attachTileflowMap3D({
      map: mapLibreMap,
      ...(controller ? {controller} : {}),
      vegetation: options.vegetation,
      viewMode: options.viewMode ?? '3d',
      load: () => import('@tileflow/core/3d'),
      onError: (error) => {
        if (scene === mapScene) reportError('scene', error);
      },
      // Direct tile readers use HTTP, not MapLibre's custom World protocol.
      transformRequest: createTileflowTransformRequest({
        getAnalytics: () => current.resolvedAnalytics,
        sessionController: session,
        sessionId: session.sessionId,
        transformRequest: (url) =>
          mapOptions?.transformRequest?.(
            url,
            'Tile' as Parameters<NonNullable<TileflowMapLibreOptions['transformRequest']>>[1],
          ),
      }),
    });
    scene = mapScene;
    scope.add(() => {
      mapScene.dispose();
      if (scene === mapScene) scene = undefined;
    });

    mounted = {map: mapLibreMap, maplibregl, scope};
    attachInteractions(mounted);

    const navigation = createTileflowNavigationControlBinding({
      createControl: (controlOptions) => new maplibregl.NavigationControl(controlOptions),
      map: mapLibreMap,
    });
    navigationBinding = navigation;
    scope.add(() => {
      navigation.dispose();
      if (navigationBinding === navigation) navigationBinding = undefined;
    });
    navigation.update(current.resolvedInteractive ? options.navigationControl : false);
    // The first view is set without moving; later changes to the request move the camera.
    const initialFit = current.cameraFit;
    appliedCameraFitKey = initialFit.key;
    if (initialFit.error) reportError('camera', new Error(initialFit.error));
    if (initialFit.fit) fitCameraTo(mapLibreMap, initialFit.fit, 0);

    const resizeObserver = new ResizeObserver(() => mapLibreMap.resize());
    scope.add(() => resizeObserver.disconnect());
    resizeObserver.observe(container);

    const lifecycle = attachTileflowMapLifecycle({
      getSession: () => {
        const analyticsForLoad = current.resolvedAnalytics;
        return {
          analytics: analyticsForLoad,
          styleId:
            analyticsForLoad?.styleId ??
            (typeof initialRuntimeStyle.style === 'string'
              ? initialRuntimeStyle.style
              : current.mapName),
        };
      },
      map: mapLibreMap,
      onLoad: (loadedMap) => {
        settleReady({map: loadedMap});
        options.onLoad?.(loadedMap);
      },
      scheduler: {
        cancelFrame: (frame: number) => browserWindow.cancelAnimationFrame(frame),
        requestFrame: (callback) => browserWindow.requestAnimationFrame(callback),
      },
      sessionStarter,
      setState: (state) => {
        if (map !== mapLibreMap) return;
        captureState = state;
        invalidate();
      },
      subscribe: (subscribedMap, event, listener) => {
        const subscription = subscribedMap.on(event, listener);
        return () => subscription.unsubscribe();
      },
    });
    scope.add(() => lifecycle.dispose());

    // A theme or blend chosen while the map loaded follows now.
    const latestRuntimeStyle = current.runtimeStyle;
    const latestBlend =
      current.blendResolution.styles && current.themeBlendPosition !== undefined
        ? {
            hold: current.themeBlendHold,
            position: current.themeBlendPosition,
            themes: current.blendResolution.styles,
          }
        : null;
    if (controller && latestBlend) {
      if (latestRuntimeStyle) activeRuntimeResource = latestRuntimeStyle;
      void controller.setBlend(latestBlend, {transition: options.themeTransition});
    } else if (controller && latestRuntimeStyle && latestRuntimeStyle !== initialRuntimeStyle) {
      requestTheme(controller, latestRuntimeStyle, current.themeSelection);
    }
    invalidate();
  }

  /**
   * Starts markers, popups, semantic interactions and data layers on a mounted map, in a scope of
   * their own: when they cannot start, only what they acquired is released, the map stays, and
   * they start again once their inputs change. They are released before the map they need.
   */
  function attachInteractions(target: MountedMap) {
    const {map: mapLibreMap, maplibregl} = target;
    const scope = target.scope.child();
    scope.add(() => {
      interactionRuntime = undefined;
      semanticRuntime = undefined;
      interactionCoordinator = undefined;
      dataRuntime = undefined;
      annotationDiagnostics = [];
      annotationRenderTargets = [];
      annotationBridgeDiagnostic = undefined;
      semanticDiagnostics = [];
      semanticRenderTargets = [];
      semanticBridgeDiagnostic = undefined;
      stateBridgeDiagnostic = undefined;
      rendererBridgeDiagnostic = undefined;
      dataBridgeDiagnostic = undefined;
      invalidate();
    });
    try {
      startInteractions(scope, mapLibreMap, maplibregl);
      interactionStartDiagnostic = undefined;
    } catch (error) {
      console.error('Failed to start Tileflow map interactions', error);
      try {
        scope.dispose();
      } catch (cleanupError) {
        console.error('Failed to release Tileflow map interactions', cleanupError);
      }
      interactionStartDiagnostic = createOverlayFailureDiagnostic(
        'Tileflow map interactions could not start.',
      );
      reportDiagnostic(interactionStartDiagnostic);
    }
    invalidate();
  }

  function startInteractions(
    scope: TileflowResourceScope,
    mapLibreMap: MapLibreMap,
    maplibregl: TileflowMapLibre,
  ) {
    const coordinator = createTileflowMapLibreInteractionCoordinator({
      ...(controlledInteractionOwnership
        ? {interactionState: coordinatedInteractionState}
        : {defaultInteractionState: coordinatedInteractionState}),
      onInteractionStateChange(state) {
        if (interactionCoordinator !== coordinator) return;
        if (!controlledInteractionOwnership) coordinatedInteractionState = state;
        options.onInteractionStateChange?.(state);
      },
    });
    interactionCoordinator = coordinator;
    scope.add(() => coordinator.dispose());
    const createOverlay = ({
      container: overlayContainer,
      kind,
    }: {
      container: HTMLElement;
      kind: 'popup' | 'tooltip';
    }) =>
      wrapMapLibrePositioned(
        new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          closeOnMove: false,
          focusAfterOpen: false,
          offset: kind === 'popup' ? 24 : 18,
        }).setDOMContent(overlayContainer),
      );
    const annotationRuntime = createTileflowMapLibreDomRuntime<
      MapLibreMap,
      Positioned,
      Positioned,
      TAnnotation
    >({
      createMarker({annotation, element}) {
        const marker = new maplibregl.Marker({element});
        element.title = annotationTitles.get(annotation.id) ?? annotation.ariaLabel;
        return wrapMapLibrePositioned(marker);
      },
      createOverlay,
      customMarker: current.hasMarkerRenderer,
      customPopup: current.hasPopupRenderer,
      customTooltip: current.hasTooltipRenderer,
      document: container.ownerDocument,
      interactionState: coordinator.getInteractionState(),
      map: mapLibreMap,
      onInteractionStateChange: coordinator.requestInteractionState,
      onDiagnostic: reportDiagnostic,
      updateMarker(_marker, {annotation, element}) {
        element.title = annotationTitles.get(annotation.id) ?? annotation.ariaLabel;
      },
    });
    interactionRuntime = annotationRuntime;
    scope.add(() => annotationRuntime.dispose());
    // Registered ahead of semantic POIs: a click on a cluster belongs to the cluster.
    const mapDataRuntime = createTileflowMapLibreDataRuntime<MapLibreMap, Positioned, TAnnotation>({
      createMarker: ({element}) => wrapMapLibrePositioned(new maplibregl.Marker({element})),
      document: container.ownerDocument,
      map: mapLibreMap,
      onDiagnostic: reportDiagnostic,
      onInteractionEvent(event) {
        options.onInteractionEvent?.(event as TileflowInteractionEvent<TAnnotation>);
      },
      setHiddenAnnotations: annotationRuntime.setHiddenAnnotations,
    });
    dataRuntime = mapDataRuntime;
    scope.add(() => mapDataRuntime.dispose());
    const featureRuntime = createTileflowMapLibreSemanticDomRuntime<MapLibreMap, Positioned>({
      cancelFrame: (frame) => browserWindow.cancelAnimationFrame(frame),
      createOverlay,
      customPopup: current.hasPopupRenderer,
      customTooltip: current.hasTooltipRenderer,
      document: container.ownerDocument,
      interactionState: coordinator.getInteractionState(),
      map: mapLibreMap,
      onDiagnostic: reportDiagnostic,
      onInteractionStateChange: coordinator.requestInteractionState,
      poiMap: createTileflowMapLibrePoiMap(mapLibreMap),
      requestFrame: (callback) => browserWindow.requestAnimationFrame(() => callback()),
    });
    semanticRuntime = featureRuntime;
    scope.add(() => featureRuntime.dispose());
    scope.add(coordinator.attach('annotation', annotationRuntime));
    scope.add(coordinator.attach('semantic', featureRuntime));
    scope.add(annotationRuntime.subscribeEvents((event) => options.onInteractionEvent?.(event)));
    scope.add(
      annotationRuntime.subscribeDiagnostics((diagnostics) => {
        annotationDiagnostics = diagnostics;
        invalidate();
      }),
    );
    scope.add(
      annotationRuntime.subscribeRenderTargets((targets) => {
        annotationRenderTargets = targets;
        invalidate();
      }),
    );
    scope.add(
      featureRuntime.subscribeEvents((event) => {
        if (event.target.kind === 'annotation') return;
        options.onInteractionEvent?.({...event, target: event.target});
      }),
    );
    scope.add(
      featureRuntime.subscribeDiagnostics((diagnostics) => {
        semanticDiagnostics = diagnostics;
        invalidate();
      }),
    );
    scope.add(
      featureRuntime.subscribeRenderTargets((targets) => {
        semanticRenderTargets = targets;
        invalidate();
      }),
    );

    annotationDiagnostics = annotationRuntime.getDiagnostics();
    annotationRenderTargets = annotationRuntime.getRenderTargets();
    semanticDiagnostics = featureRuntime.getDiagnostics();
    semanticRenderTargets = featureRuntime.getRenderTargets();
    reconcileAnnotations(annotationRuntime, annotationsForRuntime);
    reconcileData(mapDataRuntime);
    const initialInteractions = current.preparedInteractions;
    if (initialInteractions.ok) reconcileInteractions(featureRuntime, initialInteractions.bindings);
  }

  /**
   * Asks the theme controller for a style and records what the map then shows. A request that
   * fails leaves the theme applied before it; when the failed one was already standing in for an
   * earlier failure, the map stays on the applied theme rather than trying again.
   */
  function requestTheme(
    controller: TileflowThemeController,
    style: TileflowRuntimeStyle,
    selection: TileflowThemeSelection | undefined,
  ) {
    const requested: ThemeChoice = {selection: options.theme, theme: current.themeResolution.name};
    const standingIn = current.themeRequestFailed || current.themeResolution.error;
    activeRuntimeResource = style;
    invalidate();
    void controller.setTheme(style, {transition: options.themeTransition}).then((result) => {
      if (destroyed || themeController !== controller) return;
      if (result.status === 'applied') {
        appliedTheme = {selection, theme: result.theme};
        if (!standingIn) failedTheme = undefined;
      } else if (result.status === 'failed') {
        const shown = controller.getCurrent().theme;
        const applied = appliedTheme ?? {selection: shown, theme: shown};
        failedTheme = {
          ...requested,
          fallback: standingIn ? {selection: applied.theme, theme: applied.theme} : applied,
        };
        reportError('theme', result.error ?? new Error('The map theme could not be changed.'));
      }
      invalidate();
    });
  }

  function computeStatus(): TileflowMapStatus {
    const d = current;
    const diagnostics = [
      ...d.declarativeDiagnostics,
      ...(annotationBridgeDiagnostic ? [annotationBridgeDiagnostic] : []),
      ...(semanticBridgeDiagnostic ? [semanticBridgeDiagnostic] : []),
      ...(stateBridgeDiagnostic ? [stateBridgeDiagnostic] : []),
      ...(rendererBridgeDiagnostic ? [rendererBridgeDiagnostic] : []),
      ...(viewBridgeDiagnostic ? [viewBridgeDiagnostic] : []),
      ...(dataBridgeDiagnostic ? [dataBridgeDiagnostic] : []),
      ...(interactionStartDiagnostic ? [interactionStartDiagnostic] : []),
      ...annotationDiagnostics,
      ...semanticDiagnostics,
    ];
    const interactionReadiness: TileflowMapReadiness = diagnostics.some(
      (diagnostic) => diagnostic.level === 'error',
    )
      ? 'error'
      : viewHost.isSettled()
        ? 'idle'
        : 'loading';
    const currentCaptureState =
      activeRuntimeResource === (d.isImageMode ? d.runtimeImageUrl : d.runtimeStyle)
        ? captureState
        : 'loading';
    const parts = [
      currentCaptureState,
      interactionReadiness,
      d.runtimeResolutionState,
      themeTransitionState,
    ];
    return {
      diagnostics,
      readiness: parts.includes('error')
        ? 'error'
        : parts.every((part) => part === 'idle')
          ? 'idle'
          : 'loading',
      theme: d.shownThemeResolution.name,
      imageUrl: d.isImageMode ? d.runtimeImageUrl : undefined,
    };
  }

  function emitStatus() {
    if (destroyed) return;
    const status = computeStatus();
    if (
      lastStatus &&
      lastStatus.readiness === status.readiness &&
      lastStatus.theme === status.theme &&
      lastStatus.imageUrl === status.imageUrl &&
      lastStatus.diagnostics.length === status.diagnostics.length &&
      lastStatus.diagnostics.every((diagnostic, index) => diagnostic === status.diagnostics[index])
    ) {
      return;
    }
    lastStatus = status;
    // An image-mode map is ready once its image shows.
    if (current.isImageMode && status.readiness === 'idle') settleReady({map: null});
    if (statusElement) {
      setAttribute(statusElement, 'data-tileflow-capture-id', captureId);
      setAttribute(statusElement, 'data-tileflow-map', current.mapName);
      setAttribute(statusElement, 'data-tileflow-theme', status.theme);
      setAttribute(statusElement, 'data-tileflow-state', status.readiness);
    }
    options.onStatusChange?.(status);
  }

  function update(next: Partial<TileflowMapControllerOptions<TAnnotation>>) {
    if (destroyed) return;
    const merged = {...options, ...next} as TileflowMapControllerOptions<TAnnotation>;
    assertTileflowMapStyleOptions(merged);
    if (merged.views && merged.renderTargets) {
      throw new TypeError('A Tileflow map takes views or renderTargets, not both.');
    }
    options = merged;
    if (reconciling) {
      dirty = true;
      return;
    }
    reconcile();
  }

  /**
   * Stops the controller: `destroy()`, or the application removing the MapLibre map itself. Every
   * part is released even when one fails, and a failure is logged rather than thrown into the
   * framework's teardown.
   */
  function teardown() {
    if (destroyed) return;
    destroyed = true;
    settleReady({error: new DOMException('The Tileflow map was destroyed.', 'AbortError')});
    try {
      runTileflowCleanups([() => viewHost.dispose(), () => reconciler.dispose()]);
    } catch (error) {
      console.error('Failed to release a Tileflow map', error);
    } finally {
      map = null;
      mounted = undefined;
      if (statusElement) {
        for (const attribute of statusAttributes) statusElement.removeAttribute(attribute);
      }
    }
  }

  reconcile();

  return {
    container,
    destroy: teardown,
    getInteractionState: () =>
      interactionCoordinator?.getInteractionState() ?? coordinatedInteractionState,
    getMap: () => map,
    getRenderTargets: () => lastRenderTargets,
    getStatus: () => lastStatus ?? computeStatus(),
    getThemeController: () => (map ? (themeController ?? null) : null),
    ready,
    setAnnotations: (annotations) => update({annotations}),
    setBounds: (bounds, fitBoundsOptions) =>
      update(fitBoundsOptions === undefined ? {bounds} : {bounds, fitBoundsOptions}),
    setColors: (colors) => update({colors}),
    setEmphasis: (emphasis) => update({emphasis}),
    setInteractions: (interactions) => update({interactions}),
    setInteractionState(state) {
      if (controlledInteractionOwnership) {
        update({interactionState: state});
        return;
      }
      const parsed = tileflowInteractionStateSchema.parse(state);
      coordinatedInteractionState = parsed;
      interactionCoordinator?.setInteractionState(parsed);
    },
    setTheme: (theme) => update({theme}),
    setThemeBlend: (themeBlend) => update({themeBlend}),
    setView: (view) => update(view),
    setViews: (views) => update({views}),
    update,
  };
}

type TileflowMapRenderers = Readonly<{
  hasMarkerRenderer: boolean;
  hasPopupRenderer: boolean;
  hasTooltipRenderer: boolean;
}>;

/** Any option set, read only for which keys hold a value. */
type TileflowMapOptionPresence = {readonly [K in keyof TileflowMapControllerOptions]?: unknown};

function tileflowMapRenderers(options: {
  readonly renderTargets?: Readonly<{marker?: boolean; popup?: boolean; tooltip?: boolean}>;
  readonly views?: Readonly<{marker?: unknown; popup?: unknown; tooltip?: unknown}>;
}): TileflowMapRenderers {
  const external = options.renderTargets;
  return external
    ? {
        hasMarkerRenderer: external.marker === true,
        hasPopupRenderer: external.popup === true,
        hasTooltipRenderer: external.tooltip === true,
      }
    : {
        hasMarkerRenderer: options.views?.marker !== undefined,
        hasPopupRenderer: options.views?.popup !== undefined,
        hasTooltipRenderer: options.views?.tooltip !== undefined,
      };
}

/** Anything that only an interactive map can use, so image mode reports it. */
function hasTileflowMapInteractionConfiguration(
  options: TileflowMapOptionPresence,
  renderers: TileflowMapRenderers,
): boolean {
  return (
    options.annotationClusters !== undefined ||
    options.annotations !== undefined ||
    options.dataOverlays !== undefined ||
    options.dataSources !== undefined ||
    options.defaultInteractionState !== undefined ||
    options.interactionState !== undefined ||
    options.interactions !== undefined ||
    options.onInteractionDiagnostic !== undefined ||
    options.onInteractionEvent !== undefined ||
    options.onInteractionStateChange !== undefined ||
    renderers.hasMarkerRenderer ||
    renderers.hasPopupRenderer ||
    renderers.hasTooltipRenderer
  );
}

function tileflowMapDeclarativeDiagnostics(input: {
  hasInteractionConfiguration: boolean;
  hasPopupRenderer: boolean;
  hasTooltipRenderer: boolean;
  interactions: readonly TileflowInteractionBinding[];
  isImageMode: boolean;
  preparedAnnotations: TileflowPreparedAnnotations<TileflowAnnotation>;
  preparedInteractions: TileflowPreparedInteractionBindings;
  preparedInteractionState: TileflowPreparedInteractionState;
}): readonly TileflowInteractionDiagnostic[] {
  const modeDiagnostic = input.isImageMode
    ? imageModeMapInteractionDiagnostic(
        input.preparedAnnotations.annotations.length,
        input.interactions.length,
        input.hasInteractionConfiguration,
      )
    : undefined;
  return [
    ...(modeDiagnostic ? [modeDiagnostic] : []),
    ...input.preparedAnnotations.diagnostics,
    ...input.preparedInteractions.diagnostics,
    ...input.preparedInteractionState.diagnostics,
    ...(input.isImageMode
      ? []
      : unusedTileflowRendererDiagnostics({
          annotations: input.preparedAnnotations.annotations,
          bindings: input.interactions,
          hasPopupRenderer: input.hasPopupRenderer,
          hasTooltipRenderer: input.hasTooltipRenderer,
        })),
  ];
}

/**
 * The status a map with these options has before it mounts: for server rendering and a framework's
 * first render, so the page shows the same theme, diagnostics and image before and after mount.
 * `controlledInteractionOwnership` is whether the map started with `interactionState`.
 */
export function getTileflowMapInitialStatus<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
>(
  options: TileflowMapControllerOptions<TAnnotation>,
  controlledInteractionOwnership = options.interactionState !== undefined,
): TileflowMapStatus {
  const interactions = options.interactions ?? noInteractions;
  const renderers = tileflowMapRenderers(options);
  const isImageMode = options.mode === 'image';
  const diagnostics = tileflowMapDeclarativeDiagnostics({
    hasInteractionConfiguration: hasTileflowMapInteractionConfiguration(options, renderers),
    hasPopupRenderer: renderers.hasPopupRenderer,
    hasTooltipRenderer: renderers.hasTooltipRenderer,
    interactions,
    isImageMode,
    preparedAnnotations: prepareTileflowAnnotations(options.annotations),
    preparedInteractions: prepareTileflowInteractionBindings(interactions),
    preparedInteractionState: prepareTileflowInteractionState(
      options.interactionState,
      options.defaultInteractionState,
      controlledInteractionOwnership,
    ),
  });
  const selection = options.themeBlend
    ? nearestTileflowBlendTheme(options.themeBlend)
    : options.theme;
  return {
    diagnostics,
    imageUrl: isImageMode ? options.imageUrl : undefined,
    readiness: diagnostics.some((diagnostic) => diagnostic.level === 'error') ? 'error' : 'loading',
    theme: selection && selection !== 'system' ? selection : undefined,
  };
}

function setAttribute(element: HTMLElement, name: string, value: string | undefined) {
  if (value === undefined) element.removeAttribute(name);
  else if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

/** Moves the camera to bounds. `duration` overrides the request's, so the first view is set at once. */
function fitCameraTo(map: MapLibreMap, fit: TileflowCameraFit, duration?: number): void {
  map.fitBounds(fit.bounds, {
    ...(fit.options.maxZoom === undefined ? {} : {maxZoom: fit.options.maxZoom}),
    ...(fit.options.padding === undefined ? {} : {padding: fit.options.padding}),
    ...(duration !== undefined
      ? {duration}
      : fit.options.duration === undefined
        ? {}
        : {duration: fit.options.duration}),
  });
}

function wrapMapLibrePositioned(positioned: MapLibreMarker | MapLibrePopup) {
  return {
    addTo(map: MapLibreMap) {
      positioned.addTo(map);
    },
    remove() {
      positioned.remove();
    },
    setLngLat(coordinate: readonly [number, number]) {
      positioned.setLngLat([coordinate[0], coordinate[1]]);
    },
  };
}

function createTileflowMapLibrePoiMap(map: MapLibreMap): TileflowMapLibrePoiMap {
  const poiMap = map as unknown as TileflowMapLibrePoiMap;
  return {
    getStyle: () => map.getStyle(),
    on(event, listener) {
      return poiMap.on(event, listener);
    },
    queryRenderedFeatures(point, queryOptions) {
      return map.queryRenderedFeatures(point as PointLike, {
        layers: [...queryOptions.layers],
      }) as ReturnType<TileflowMapLibrePoiMap['queryRenderedFeatures']>;
    },
  };
}
