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
  attachTileflowAtmosphere,
  attachTileflowBranding,
  attachTileflowFairUseNotice,
  attachTileflowHorizonQueries,
  attachTileflowLabelPlacement,
  attachTileflowMap3D,
  attachTileflowMapLifecycle,
  attachTileflowNauticalLights,
  attachTileflowNotices,
  createTileflowAppearanceBinding,
  createTileflowContourRequestScope,
  createTileflowNavigationControlBinding,
  createTileflowSessionStarter,
  createTileflowThemeController,
  createTileflowTransformRequest,
  getTileflowSystemColorScheme,
  loadTileflowRuntimeStyle,
  loadTileflowStyleFonts,
  registerTileflowContourProtocol,
  registerTileflowPathGroundProtocol,
  registerTileflowPmtilesProtocol,
  registerTileflowWorldRequestBridge,
  reportTileflowMapError,
  resolveTileflowCameraFit,
  subscribeTileflowSystemColorScheme,
  type TileflowAppearanceBinding,
  type TileflowBounds,
  type TileflowBrowserThemeBlendSelection,
  type TileflowCameraFit,
  tileflowCanvasContextAttributes,
  type TileflowColorOverrides,
  type TileflowEmphasis,
  type TileflowFitBoundsOptions,
  type TileflowMap3DAttachment,
  type TileflowMapError,
  type TileflowMapErrorCode,
  tileflowMaxPitch,
  type TileflowNavigationControlBinding,
  type TileflowNavigationControlInput,
  type TileflowThemeController,
  type TileflowThemeTransition,
  type TileflowThemeTransitionOptions,
  type TileflowViewMode,
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
  resolveTileflowManifestMap,
  resolveTileflowRuntimeStyle,
  resolveTileflowRuntimeTheme,
  resolveTileflowRuntimeThemeBlend,
  resolveTileflowRuntimeView,
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
  prepareTileflowAnnotations,
  prepareTileflowInteractionBindings,
  prepareTileflowInteractionState,
  tileflowInteractionDiagnosticKey,
} from './inputs';
import {loadTileflowMapLibre} from './maplibre';
import {createTileflowReconciler, runTileflowCleanups} from './reconcile';
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
     * Settles with the MapLibre map when it first loads; rejects when it cannot start or when the
     * controller is destroyed first.
     */
    ready: Promise<MapLibreMap>;
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
  let annotationDiagnostics: readonly TileflowInteractionDiagnostic[] = [];
  let semanticDiagnostics: readonly TileflowInteractionDiagnostic[] = [];
  let reportedDeclarativeDiagnosticKeys: ReadonlySet<string> = new Set();

  // Objects behind the map while it is mounted.
  let map: MapLibreMap | null = null;
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

  let resolveReady!: (map: MapLibreMap) => void;
  let rejectReady!: (error: unknown) => void;
  let readySettled = false;
  const ready = new Promise<MapLibreMap>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // An application that never awaits `ready` should not see an unhandled rejection.
  ready.catch(() => undefined);
  const settleReady = (outcome: {error: unknown} | {map: MapLibreMap}) => {
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
    const themeResolution = memo(
      'themeResolution',
      [blendThemeName, manifestMap, systemColorScheme, theme, themeBlendKey, timeOfDay],
      () => {
        const selection = blendThemeName ?? theme;
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
      },
    );
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
    const external = options.renderTargets;
    const hasMarkerRenderer = external
      ? external.marker === true
      : options.views?.marker !== undefined;
    const hasPopupRenderer = external
      ? external.popup === true
      : options.views?.popup !== undefined;
    const hasTooltipRenderer = external
      ? external.tooltip === true
      : options.views?.tooltip !== undefined;
    const rendererDiagnostics = memo(
      'rendererDiagnostics',
      [hasPopupRenderer, hasTooltipRenderer, interactions, preparedAnnotations],
      () =>
        unusedTileflowRendererDiagnostics({
          annotations: preparedAnnotations.annotations,
          bindings: interactions,
          hasPopupRenderer,
          hasTooltipRenderer,
        }),
    );
    const declarativeDiagnostics = memo(
      'declarativeDiagnostics',
      [
        preparedAnnotations.diagnostics,
        preparedInteractions.diagnostics,
        preparedInteractionState.diagnostics,
        rendererDiagnostics,
      ],
      () => [
        ...preparedAnnotations.diagnostics,
        ...preparedInteractions.diagnostics,
        ...preparedInteractionState.diagnostics,
        ...rendererDiagnostics,
      ],
    );
    const runtimeStyle = memo(
      'runtimeStyle',
      [manifestMap, runtimeSource, systemColorScheme, themeResolution],
      () =>
        themeResolution.error
          ? null
          : resolveTileflowRuntimeStyle({
              colorScheme: systemColorScheme,
              manifestMap,
              source: runtimeSource,
              theme: themeResolution.name,
            }),
    );
    const blendResolution = memo(
      'blendResolution',
      [manifestMap, runtimeSource, themeBlendKey],
      (): {cause?: unknown; styles: TileflowRuntimeStyle[] | null} => {
        if (!manifestMap || !themeBlendKey) return {styles: null};
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
    const runtimeResolutionState: TileflowMapReadiness =
      currentManifest.state !== 'ready'
        ? currentManifest.state === 'error'
          ? 'error'
          : 'loading'
        : themeResolution.error || !runtimeStyle
          ? 'error'
          : 'idle';

    return {
      annotationClusters,
      blendResolution,
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
      runtimeMapIdentity: `${manifestUrl}\0${runtimeSource.map}`,
      runtimeResolutionState,
      runtimeSource,
      runtimeStyle,
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

    effect('systemColorScheme', [options.theme], () => {
      if (options.theme !== 'system') return;
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
        dataRuntime?.reconcile(dataInput);
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
        d.resolvedInteractive,
        d.runtimeMapIdentity,
        d.runtimeStyle !== null || (d.themeResolution.error && map !== null),
        d.mapOptions,
      ],
      () => mountMap(),
    );

    effect('theme', [d.runtimeStyle, d.themeBlendKey, d.themeResolution.error], () => {
      const controller = themeController;
      if (!controller || d.themeBlendKey) return;
      if (d.themeResolution.error) {
        void controller.setTheme(controller.getCurrent());
        return;
      }
      // Leaving a blend applies the selected theme even when it is the blend's nearest one.
      if (
        !d.runtimeStyle ||
        (controller.getCurrent() === d.runtimeStyle && !controller.getBlend())
      ) {
        return;
      }
      activeRuntimeResource = d.runtimeStyle;
      invalidate();
      void controller
        .setTheme(d.runtimeStyle, {transition: options.themeTransition})
        .then((result) => {
          if (result.status === 'failed') {
            reportError('theme', result.error ?? new Error('The map theme could not be changed.'));
          }
        });
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

  /** Creates the MapLibre map and everything attached to it; the cleanup takes all of it down. */
  function mountMap(): (() => void) | undefined {
    themeTransitionState = 'idle';
    invalidate();
    const initialRuntimeStyle = current.runtimeStyle;
    if (!initialRuntimeStyle) return undefined;

    activeRuntimeResource = initialRuntimeStyle;
    captureState = 'loading';
    let cancelled = false;
    let disposeMap: (() => void) | undefined;
    const {mapOptions, resolvedInteractive} = current;

    const resourceLifetime = new AbortController();
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
        if (cancelled || destroyed) return;

        const setupCleanups: (() => void)[] = [];
        let setupDisposed = false;
        const registerCleanup = (cleanup: () => void) => setupCleanups.push(cleanup);
        disposeMap = () => {
          if (setupDisposed) return;
          setupDisposed = true;
          try {
            runTileflowCleanups([...setupCleanups].reverse());
          } finally {
            map = null;
            interactionRuntime = undefined;
            semanticRuntime = undefined;
            interactionCoordinator = undefined;
            annotationDiagnostics = [];
            annotationRenderTargets = [];
            annotationBridgeDiagnostic = undefined;
            semanticDiagnostics = [];
            semanticRenderTargets = [];
            semanticBridgeDiagnostic = undefined;
            stateBridgeDiagnostic = undefined;
            rendererBridgeDiagnostic = undefined;
            invalidate();
          }
        };

        const sessionStarter = createTileflowSessionStarter({
          getSessionId: () => session.sessionId,
          sessionId: session.sessionId,
          source: sessionSource,
        });
        const fairUseNotice = attachTileflowFairUseNotice(container);
        registerCleanup(() => fairUseNotice.dispose());
        registerTileflowContourProtocol({addProtocol: maplibregl.addProtocol});
        registerTileflowPathGroundProtocol({addProtocol: maplibregl.addProtocol});
        registerTileflowPmtilesProtocol({addProtocol: maplibregl.addProtocol});
        const worldRequestBridge = registerTileflowWorldRequestBridge({
          addProtocol: maplibregl.addProtocol,
          onNotice: fairUseNotice.update,
        });
        registerCleanup(() => worldRequestBridge.dispose());
        // Contour DEM requests leave through the shared protocol and come back to this map's
        // transform, so they carry this map's session like its hillshade tiles.
        const contourRequestScope = createTileflowContourRequestScope({
          transformRequest: (url, resourceType) =>
            transformRequest(
              url,
              resourceType as Parameters<
                NonNullable<TileflowMapLibreOptions['transformRequest']>
              >[1],
            ),
        });
        registerCleanup(() => contourRequestScope.dispose());
        const transformRequest = createTileflowTransformRequest({
          contourRequestScope,
          getAnalytics: () => current.resolvedAnalytics,
          sessionController: session,
          sessionId: session.sessionId,
          transformRequest: mapOptions?.transformRequest ?? undefined,
          worldRequestBridge,
        });

        const mapLibreMap = new maplibregl.Map({
          ...mapOptions,
          canvasContextAttributes: tileflowCanvasContextAttributes(
            mapOptions?.canvasContextAttributes,
          ),
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
        registerCleanup(() => mapLibreMap.remove());
        registerCleanup(attachTileflowAtmosphere(mapLibreMap));
        registerCleanup(attachTileflowBranding(mapLibreMap));
        registerCleanup(attachTileflowNotices(mapLibreMap));
        registerCleanup(attachTileflowNauticalLights(mapLibreMap));
        registerCleanup(attachTileflowLabelPlacement(mapLibreMap));
        // Feature queries and taps keep working once a steep pitch shows the horizon.
        registerCleanup(attachTileflowHorizonQueries(mapLibreMap));
        const controller =
          initialRuntimeStyle.theme === undefined
            ? undefined
            : createTileflowThemeController({
                initial: prepared.family ? prepared : initialRuntimeStyle,
                initialStyle: prepared.style,
                styleLoadOptions,
                map: mapLibreMap,
                onTransition(transition) {
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
          registerCleanup(() => {
            controller.dispose();
            if (themeController === controller) themeController = undefined;
          });
          // Colours and emphasis the application declared show from the first frame the style
          // allows, without easing in from the theme's own look.
          const appearance = createTileflowAppearanceBinding({
            controller,
            // CSS variables in `colors` are read where the map sits.
            element: container,
            map: mapLibreMap,
            onError: (error, part) => reportError(part, error),
          });
          appearanceBinding = appearance;
          registerCleanup(() => {
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
          onError: (error) => reportError('scene', error),
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
        registerCleanup(() => {
          mapScene.dispose();
          if (scene === mapScene) scene = undefined;
        });

        const coordinator = createTileflowMapLibreInteractionCoordinator({
          ...(controlledInteractionOwnership
            ? {interactionState: coordinatedInteractionState}
            : {defaultInteractionState: coordinatedInteractionState}),
          onInteractionStateChange(state) {
            if (!controlledInteractionOwnership) coordinatedInteractionState = state;
            options.onInteractionStateChange?.(state);
          },
        });
        interactionCoordinator = coordinator;
        registerCleanup(() => coordinator.dispose());
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
        registerCleanup(() => annotationRuntime.dispose());
        // Registered ahead of semantic POIs: a click on a cluster belongs to the cluster.
        const mapDataRuntime = createTileflowMapLibreDataRuntime<
          MapLibreMap,
          Positioned,
          TAnnotation
        >({
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
        registerCleanup(() => {
          mapDataRuntime.dispose();
          if (dataRuntime === mapDataRuntime) dataRuntime = undefined;
        });
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
        registerCleanup(() => featureRuntime.dispose());
        registerCleanup(coordinator.attach('annotation', annotationRuntime));
        registerCleanup(coordinator.attach('semantic', featureRuntime));
        registerCleanup(
          annotationRuntime.subscribeEvents((event) => options.onInteractionEvent?.(event)),
        );
        registerCleanup(
          annotationRuntime.subscribeDiagnostics((diagnostics) => {
            annotationDiagnostics = diagnostics;
            invalidate();
          }),
        );
        registerCleanup(
          annotationRuntime.subscribeRenderTargets((targets) => {
            annotationRenderTargets = targets;
            invalidate();
          }),
        );
        registerCleanup(
          featureRuntime.subscribeEvents((event) => {
            if (event.target.kind === 'annotation') return;
            options.onInteractionEvent?.({...event, target: event.target});
          }),
        );
        registerCleanup(
          featureRuntime.subscribeDiagnostics((diagnostics) => {
            semanticDiagnostics = diagnostics;
            invalidate();
          }),
        );
        registerCleanup(
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
        mapDataRuntime.reconcile(dataInput);
        const initialInteractions = current.preparedInteractions;
        if (initialInteractions.ok)
          reconcileInteractions(featureRuntime, initialInteractions.bindings);

        const navigation = createTileflowNavigationControlBinding({
          createControl: (controlOptions) => new maplibregl.NavigationControl(controlOptions),
          map: mapLibreMap,
        });
        navigationBinding = navigation;
        registerCleanup(() => {
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
        registerCleanup(() => resizeObserver.disconnect());
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
            captureState = state;
            invalidate();
          },
          subscribe: (subscribedMap, event, listener) => {
            const subscription = subscribedMap.on(event, listener);
            return () => subscription.unsubscribe();
          },
        });
        registerCleanup(() => lifecycle.dispose());
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
          activeRuntimeResource = latestRuntimeStyle;
          void controller.setTheme(latestRuntimeStyle, {transition: options.themeTransition});
        }
        invalidate();
      })
      .catch((error: unknown) => {
        resourceLifetime.abort();
        try {
          disposeMap?.();
        } catch (cleanupError) {
          reportError('runtime', cleanupError);
        }
        if (!cancelled && !destroyed) {
          reportError('runtime', error);
          captureState = 'error';
          invalidate();
        }
      });

    return () => {
      cancelled = true;
      resourceLifetime.abort();
      disposeMap?.();
    };
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
    const currentCaptureState = activeRuntimeResource === d.runtimeStyle ? captureState : 'loading';
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
      theme: d.themeResolution.name,
    };
  }

  function emitStatus() {
    if (destroyed) return;
    const status = computeStatus();
    if (
      lastStatus &&
      lastStatus.readiness === status.readiness &&
      lastStatus.theme === status.theme &&
      lastStatus.diagnostics.length === status.diagnostics.length &&
      lastStatus.diagnostics.every((diagnostic, index) => diagnostic === status.diagnostics[index])
    ) {
      return;
    }
    lastStatus = status;
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

  reconcile();

  return {
    container,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      settleReady({error: new DOMException('The Tileflow map was destroyed.', 'AbortError')});
      try {
        viewHost.dispose();
        reconciler.dispose();
      } finally {
        if (statusElement) {
          for (const attribute of statusAttributes) statusElement.removeAttribute(attribute);
        }
      }
    },
    getInteractionState: () =>
      interactionCoordinator?.getInteractionState() ?? coordinatedInteractionState,
    getMap: () => map,
    getRenderTargets: () => lastRenderTargets,
    getStatus: () => lastStatus ?? computeStatus(),
    getThemeController: () => themeController ?? null,
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
