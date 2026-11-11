'use client';

import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  type ImgHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type RefAttributes,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {createPortal} from 'react-dom';
import type {Map as MapLibreMap, MapOptions as MapLibreMapOptions} from 'maplibre-gl';
import type {TileflowGeoJsonSource, TileflowMapLibreOverlay} from '@tileflow/core';
import {
  getTileflowSystemColorScheme,
  reportTileflowMapError,
  subscribeTileflowSystemColorScheme,
  type TileflowBounds,
  type TileflowColorOverrides,
  type TileflowEmphasis,
  type TileflowFitBoundsOptions,
  type TileflowMapError,
  type TileflowMapErrorCode,
  type TileflowNavigationControlInput,
  type TileflowThemeController,
  type TileflowThemeTransition,
  type TileflowViewMode,
} from '@tileflow/core/browser';
import {normalizeTileflowCaptureId} from '@tileflow/core/capture';
import {
  defaultTileflowManifestUrl,
  defaultTileflowRuntimeView,
  loadTileflowManifest,
  nearestTileflowBlendTheme,
  normalizeTileflowRuntimeCenter,
  normalizeTileflowStaticImageSize,
  resolveTileflowManifestMap,
  resolveTileflowMapMode,
  resolveTileflowRuntimeTheme,
  resolveTileflowRuntimeView,
  resolveTileflowStaticImageUrl,
  type TileflowAnalytics,
  type TileflowRuntimeManifestMap,
  type TileflowRuntimeSource,
} from '@tileflow/core/runtime';
import {
  createTileflowMap,
  type TileflowMapController,
  type TileflowMapControllerOptions,
  type TileflowMapRenderTargetList,
  type TileflowMapStatus,
} from '@tileflow/dom';
import {
  type TileflowAnnotation,
  type TileflowAnnotationViewContext,
  TileflowInteractionBinding,
  TileflowInteractionDiagnostic,
  TileflowInteractionEvent,
  TileflowInteractionState,
  TileflowInteractionViewContext,
  unusedTileflowRendererDiagnostics,
} from '@tileflow/interactions';
import type {
  TileflowAnnotationClusterOptions,
  TileflowMapLibreDomRenderTarget,
  TileflowMapLibreSemanticDomRenderTarget,
} from '@tileflow/interactions/maplibre';
import {imageModeMapInteractionDiagnostic, prepareTileflowReactAnnotations} from './annotations';
import {prepareTileflowReactInteractionBindings} from './interaction-bindings';
import {prepareTileflowReactInteractionState} from './interaction-state-input';
import {assertTileflowMapStyleInputs, type TileflowMapStyleSourceProps} from './map-style-inputs';

export type TileflowMapSource = TileflowRuntimeSource;
export type TileflowMapOptions = Omit<MapLibreMapOptions, 'container' | 'style'>;

type TileflowManifestResolution = Readonly<{
  key: string;
  map: TileflowRuntimeManifestMap | null;
  state: 'error' | 'loading' | 'ready';
}>;

export type TileflowAnnotationRenderer<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = (context: TileflowAnnotationViewContext<TAnnotation>) => ReactNode;

export type TileflowInteractionRenderer<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = (context: TileflowInteractionViewContext<TAnnotation>) => ReactNode;

type MapSharedProps = {
  vegetation?: boolean;
  viewMode?: TileflowViewMode;
  captureId?: string;
  imageUrl?: string;
  alt?: string;
  center?: [number, number];
  zoom?: number;
  className?: string;
  height?: CSSProperties['height'];
  imageLoading?: ImgHTMLAttributes<HTMLImageElement>['loading'];
  interactive?: boolean;
  mapOptions?: TileflowMapOptions;
  analytics?: TileflowAnalytics;
  /**
   * Called with `{code, error}` when the map cannot load its manifest, apply a theme, blend,
   * `colors` or `emphasis`, start its runtime or load its 3D scene. Without it, those failures go to
   * `console.error`.
   */
  onError?: (event: TileflowMapError) => void;
  onLoad?: (map: MapLibreMap) => void;
  onThemeChange?: (transition: TileflowThemeTransition) => void;
};

type TileflowInteractionStateInputProps =
  | Readonly<{
      defaultInteractionState?: never;
      interactionState?: TileflowInteractionState;
    }>
  | Readonly<{
      defaultInteractionState?: TileflowInteractionState;
      interactionState?: never;
    }>;

type TileflowInteractionRendererProps<TAnnotation extends TileflowAnnotation> =
  | Readonly<{
      interactions?: never;
      renderPopup?: TileflowAnnotationRenderer<TAnnotation>;
      renderTooltip?: TileflowAnnotationRenderer<TAnnotation>;
    }>
  | Readonly<{
      interactions: readonly TileflowInteractionBinding[];
      renderPopup?: TileflowInteractionRenderer<TAnnotation>;
      renderTooltip?: TileflowInteractionRenderer<TAnnotation>;
    }>;

type MapInteractiveProps<TAnnotation extends TileflowAnnotation> = MapSharedProps &
  TileflowInteractionStateInputProps &
  TileflowInteractionRendererProps<TAnnotation> & {
    /** Group `annotations` into accessible cluster buttons. Up to 1,000 annotations. */
    annotationClusters?: TileflowAnnotationClusterOptions;
    annotations?: readonly TAnnotation[];
    /**
     * Colour token overrides for the map, for example `{'surface.land': '#f4f1ea'}`, or colour knobs
     * the map declares, for example `{water: '#2563eb'}`. The overrides ease in over
     * `themeTransition`, stay through theme changes, and an empty object restores the map's own
     * colours. A value may use CSS variables, such as `var(--primary)` or
     * `color-mix(in oklab, var(--primary) 40%, white)`, read where the map sits and read again when
     * the page's theme changes. The map must be configurable at run time; an unknown token, an
     * invalid value or a variable with no value and no fallback is reported as an error and leaves
     * the colours unchanged.
     */
    colors?: TileflowColorOverrides;
    /** Overlays drawn over `dataSources` or compiled sources, keyed as in `defineMap`. */
    dataOverlays?: Readonly<Record<string, TileflowMapLibreOverlay>>;
    /** Application GeoJSON, keyed as in `defineMap`. A compiled source of the same key is filled. */
    dataSources?: Readonly<Record<string, TileflowGeoJsonSource>>;
    /**
     * Makes chosen modules of the map recede and its labels fade, so your own content reads first.
     * It eases in over `themeTransition` and stays through theme changes; leave it out for the map
     * as designed.
     */
    emphasis?: TileflowEmphasis;
    mode?: 'interactive';
    onInteractionDiagnostic?: (diagnostic: TileflowInteractionDiagnostic) => void;
    onInteractionEvent?: (event: TileflowInteractionEvent<TAnnotation>) => void;
    onInteractionStateChange?: (state: TileflowInteractionState) => void;
    renderMarker?: TileflowAnnotationRenderer<TAnnotation>;
  } & MapViewProps;

type MapViewProps = {
  /**
   * Shows these bounds, `[west, south, east, north]` or `[[west, south], [east, north]]`. The map
   * starts there, and moves to new bounds when this prop changes. `center` and `zoom` set the
   * view only until bounds are given.
   */
  bounds?: TileflowBounds;
  /**
   * Fits the map to all `annotations`, with 48 pixels of padding and at most zoom 15 unless
   * options say otherwise, and again whenever their positions change. `bounds` takes precedence.
   */
  fitAnnotations?: boolean | TileflowFitBoundsOptions;
  /** How `bounds` is fitted: `padding`, `maxZoom` and `duration`. */
  fitBoundsOptions?: TileflowFitBoundsOptions;
  /**
   * The zoom and compass buttons of an interactive map. A map shows none unless asked: `true` shows
   * them at `top-right`, and an object moves them or limits their buttons.
   */
  navigationControl?: TileflowNavigationControlInput;
};

type MapImageProps = MapSharedProps & {
  annotationClusters?: never;
  annotations?: never;
  colors?: never;
  dataOverlays?: never;
  dataSources?: never;
  defaultInteractionState?: never;
  emphasis?: never;
  interactionState?: never;
  interactions?: never;
  mode: 'image';
  onInteractionDiagnostic?: never;
  onInteractionEvent?: never;
  onInteractionStateChange?: never;
  renderMarker?: never;
  renderPopup?: never;
  renderTooltip?: never;
  bounds?: never;
  fitAnnotations?: never;
  fitBoundsOptions?: never;
  navigationControl?: never;
};

export type MapProps<TAnnotation extends TileflowAnnotation = TileflowAnnotation> = (
  MapInteractiveProps<TAnnotation> | MapImageProps
) &
  TileflowMapStyleSourceProps;

const defaultInteractions: readonly TileflowInteractionBinding[] = [];

/**
 * Props without `interactions`, where a popup or tooltip view receives the annotation it belongs
 * to. A view written inline gets its parameter types from this overload.
 */
export type MapAnnotationProps<TAnnotation extends TileflowAnnotation> = (
  Extract<MapInteractiveProps<TAnnotation>, {interactions?: never}> | MapImageProps
) &
  TileflowMapStyleSourceProps;

/** Props with `interactions`, where a view may belong to an annotation or to a map feature. */
export type MapInteractionProps<TAnnotation extends TileflowAnnotation> = Exclude<
  MapInteractiveProps<TAnnotation>,
  {interactions?: never}
> &
  TileflowMapStyleSourceProps;

/**
 * What a `ref` on `Map` gives an application: the objects behind the map, for the moments when the
 * props are not enough. Both are `null` until the map has loaded, in image mode, and after it is
 * taken down, so call them from event handlers and effects, not while rendering.
 */
export type TileflowMapHandle = Readonly<{
  /** The MapLibre map, or `null` while there is none. */
  getMap(): MapLibreMap | null;
  /** Changes the map's theme, colours and emphasis; `null` when the map's style has no themes. */
  getThemeController(): TileflowThemeController | null;
}>;

type MapComponent = {
  <TAnnotation extends TileflowAnnotation = TileflowAnnotation>(
    props: MapAnnotationProps<TAnnotation> & RefAttributes<TileflowMapHandle>,
  ): ReactElement;
  <TAnnotation extends TileflowAnnotation = TileflowAnnotation>(
    props: MapInteractionProps<TAnnotation> & RefAttributes<TileflowMapHandle>,
  ): ReactElement;
  displayName?: string;
};

// `forwardRef` serves React 18 and 19; React 19 would also accept `ref` as a plain prop.

const noRenderTargets: TileflowMapRenderTargetList<never> = {annotations: [], semantic: []};

// `forwardRef` serves React 18 and 19; React 19 would also accept `ref` as a plain prop.
export const Map = forwardRef(function Map<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
>(props: MapProps<TAnnotation>, ref: ForwardedRef<TileflowMapHandle>): ReactElement {
  assertTileflowMapStyleInputs(props);

  const {
    annotationClusters,
    annotations,
    colors,
    dataOverlays,
    dataSources,
    captureId,
    defaultInteractionState,
    emphasis,
    mode = 'interactive',
    source,
    imageUrl,
    alt = '',
    center,
    zoom,
    className,
    height = 420,
    imageLoading = 'eager',
    interactive,
    mapOptions,
    analytics,
    theme,
    timeOfDay,
    themeBlend,
    themeTransition,
    vegetation,
    viewMode = '3d',
    interactionState,
    interactions = defaultInteractions,
    onInteractionDiagnostic,
    onInteractionEvent,
    onInteractionStateChange,
    onError,
    onLoad,
    renderMarker,
    renderPopup,
    renderTooltip,
  } = props;
  const {bounds, fitAnnotations, fitBoundsOptions, navigationControl} = props;
  const generalRenderPopup = renderPopup as TileflowInteractionRenderer<TAnnotation> | undefined;
  const generalRenderTooltip = renderTooltip as
    TileflowInteractionRenderer<TAnnotation> | undefined;
  const sourceMap = source.map;
  const sourceManifestUrl = source.manifestUrl;
  const runtimeSource = useMemo<TileflowRuntimeSource>(
    () => ({manifestUrl: sourceManifestUrl, map: sourceMap}),
    [sourceManifestUrl, sourceMap],
  );
  const mapName = runtimeSource.map;
  const manifestUrl = runtimeSource.manifestUrl ?? defaultTileflowManifestUrl;
  const preparedAnnotations = useMemo(
    () => prepareTileflowReactAnnotations(annotations),
    [annotations],
  );
  const preparedInteractions = useMemo(
    () => prepareTileflowReactInteractionBindings(interactions),
    [interactions],
  );
  const controlledInteractionOwnershipRef = useRef(interactionState !== undefined);
  const preparedInteractionState = useMemo(
    () =>
      prepareTileflowReactInteractionState(
        interactionState,
        defaultInteractionState,
        controlledInteractionOwnershipRef.current,
      ),
    [defaultInteractionState, interactionState],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  // The interactive map lives in the framework-free controller; this component draws its views.
  const controllerRef = useRef<TileflowMapController<TAnnotation> | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      getMap: () => controllerRef.current?.getMap() ?? null,
      getThemeController: () => controllerRef.current?.getThemeController() ?? null,
    }),
    [],
  );
  const reportedDeclarativeDiagnosticKeysRef = useRef<ReadonlySet<string>>(new Set());
  const [manifestResolution, setManifestResolution] = useState<TileflowManifestResolution>({
    key: '',
    map: null,
    state: 'loading',
  });
  const [systemColorScheme, setSystemColorScheme] = useState<'dark' | 'light'>('light');
  const [imageSize, setImageSize] = useState<{
    height: number;
    width: number;
  } | null>(null);
  const [captureState, setCaptureState] = useState<'error' | 'idle' | 'loading'>('loading');
  const [activeImageUrl, setActiveImageUrl] = useState<string | undefined>(undefined);
  const [mapStatus, setMapStatus] = useState<TileflowMapStatus | null>(null);
  const [renderTargets, setRenderTargets] =
    useState<TileflowMapRenderTargetList<TAnnotation>>(noRenderTargets);
  const stableMapOptions = useStableMapOptions(mapOptions);
  const resolvedCaptureId = normalizeTileflowCaptureId(captureId);
  const resolvedMode = resolveTileflowMapMode({mode});
  const isImageMode = resolvedMode === 'image';
  const manifestRequestKey = JSON.stringify([manifestUrl, mapName]);
  const currentManifestResolution: TileflowManifestResolution =
    manifestResolution.key === manifestRequestKey
      ? manifestResolution
      : {key: manifestRequestKey, map: null, state: 'loading'};
  const manifestMap =
    currentManifestResolution.state === 'ready' ? currentManifestResolution.map : null;
  // A blend shows its nearest theme until the blend style is ready, and names it while blending.
  const themeBlendKey = themeBlend ? JSON.stringify(themeBlend.themes) : undefined;
  const blendThemeName = themeBlend ? nearestTileflowBlendTheme(themeBlend) : undefined;
  const themeResolution = useMemo(() => {
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
  }, [blendThemeName, manifestMap, systemColorScheme, theme, themeBlendKey, timeOfDay]);
  const liveStatus = isImageMode ? null : mapStatus;
  const resolvedThemeName = liveStatus ? liveStatus.theme : themeResolution.name;
  const manifestView = resolveTileflowRuntimeView({manifestMap});
  const manifestCenter = useStableMapOptionValue<[number, number]>(
    normalizeTileflowRuntimeCenter(manifestView.center),
  );
  const staticImageCenter = useStableMapOptionValue<[number, number]>(
    normalizeTileflowRuntimeCenter(center ?? stableMapOptions?.center, manifestCenter),
  );
  const staticImageZoom =
    zoom ?? stableMapOptions?.zoom ?? manifestView.zoom ?? defaultTileflowRuntimeView.zoom;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const reportError = useCallback(
    (code: TileflowMapErrorCode, cause: unknown) =>
      reportTileflowMapError(onErrorRef.current, code, cause),
    [],
  );
  const onInteractionDiagnosticRef = useRef(onInteractionDiagnostic);
  onInteractionDiagnosticRef.current = onInteractionDiagnostic;
  const readinessRunRef = useRef(0);
  const hasAdditionalInteractionConfiguration =
    annotationClusters !== undefined ||
    annotations !== undefined ||
    dataOverlays !== undefined ||
    dataSources !== undefined ||
    defaultInteractionState !== undefined ||
    interactionState !== undefined ||
    onInteractionDiagnostic !== undefined ||
    onInteractionEvent !== undefined ||
    onInteractionStateChange !== undefined ||
    renderMarker !== undefined ||
    renderPopup !== undefined ||
    renderTooltip !== undefined ||
    props.interactions !== undefined;
  const modeDiagnostic = useMemo(
    () =>
      isImageMode
        ? imageModeMapInteractionDiagnostic(
            preparedAnnotations.annotations.length,
            interactions.length,
            hasAdditionalInteractionConfiguration,
          )
        : undefined,
    [
      hasAdditionalInteractionConfiguration,
      interactions.length,
      isImageMode,
      preparedAnnotations.annotations.length,
    ],
  );
  const hasPopupRenderer = renderPopup !== undefined;
  const hasTooltipRenderer = renderTooltip !== undefined;
  const rendererDiagnostics = useMemo(
    () =>
      isImageMode
        ? []
        : unusedTileflowRendererDiagnostics({
            annotations: preparedAnnotations.annotations,
            bindings: interactions,
            hasPopupRenderer,
            hasTooltipRenderer,
          }),
    [hasPopupRenderer, hasTooltipRenderer, interactions, isImageMode, preparedAnnotations],
  );
  // What the map shows before it mounts, and in image mode; a mounted map reports its own.
  const declarativeInteractionDiagnostics = useMemo(
    () =>
      [
        modeDiagnostic,
        ...preparedAnnotations.diagnostics,
        ...preparedInteractions.diagnostics,
        ...preparedInteractionState.diagnostics,
        ...rendererDiagnostics,
      ].filter(
        (diagnostic): diagnostic is TileflowInteractionDiagnostic => diagnostic !== undefined,
      ),
    [
      modeDiagnostic,
      preparedAnnotations.diagnostics,
      preparedInteractions.diagnostics,
      preparedInteractionState.diagnostics,
      rendererDiagnostics,
    ],
  );
  const interactionDiagnostics = liveStatus?.diagnostics ?? declarativeInteractionDiagnostics;
  const interactionDiagnostic =
    interactionDiagnostics.find((diagnostic) => diagnostic.level === 'error') ??
    interactionDiagnostics[0];
  const hasInteractionError = interactionDiagnostics.some(
    (diagnostic) => diagnostic.level === 'error',
  );
  const annotationRenderTargets = isImageMode
    ? noRenderTargets.annotations
    : renderTargets.annotations;
  const semanticRenderTargets = isImageMode ? noRenderTargets.semantic : renderTargets.semantic;
  // A marker is selected while its popup is open: the popup has a render target of its own.
  const openPopupAnnotationIds = useMemo(
    () =>
      new Set(
        annotationRenderTargets
          .filter((target) => target.kind === 'popup')
          .map((target) => target.annotation.id),
      ),
    [annotationRenderTargets],
  );
  const portalKeys = useMemo(
    () => [
      ...annotationRenderTargets.map((target) => `annotation:${target.key}`),
      ...semanticRenderTargets.map((target) => `semantic:${target.key}`),
    ],
    [annotationRenderTargets, semanticRenderTargets],
  );
  const portalReadiness = useTileflowPortalReadiness(portalKeys);

  useEffect(() => {
    if (!isImageMode || theme !== 'system') return;
    setSystemColorScheme(getTileflowSystemColorScheme());
    return subscribeTileflowSystemColorScheme(setSystemColorScheme);
  }, [isImageMode, theme]);

  useEffect(() => {
    // A mounted interactive map reports its diagnostics itself.
    if (!isImageMode) return;
    const previousKeys = reportedDeclarativeDiagnosticKeysRef.current;
    const nextKeys = new Set<string>();

    for (const diagnostic of declarativeInteractionDiagnostics) {
      const key = tileflowInteractionDiagnosticKey(diagnostic);
      nextKeys.add(key);
      if (!previousKeys.has(key)) onInteractionDiagnosticRef.current?.(diagnostic);
    }
    reportedDeclarativeDiagnosticKeysRef.current = nextKeys;
  }, [declarativeInteractionDiagnostics, isImageMode]);

  useEffect(() => {
    // An interactive map loads its manifest itself.
    if (!isImageMode) return;
    let cancelled = false;
    setManifestResolution({key: manifestRequestKey, map: null, state: 'loading'});

    loadTileflowManifest(manifestUrl)
      .then((manifest) => {
        if (cancelled) {
          return;
        }

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
        setManifestResolution({
          key: manifestRequestKey,
          map: resolvedMap,
          state: resolvedMap ? 'ready' : 'error',
        });
      })
      .catch((error) => {
        if (!cancelled) {
          reportError('manifest', error);
          setManifestResolution({key: manifestRequestKey, map: null, state: 'error'});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isImageMode, manifestRequestKey, manifestUrl, mapName, reportError]);

  const controllerOptions: TileflowMapControllerOptions<TAnnotation> = {
    analytics,
    annotationClusters,
    annotations,
    bounds,
    center,
    colors,
    dataOverlays,
    dataSources,
    emphasis,
    fitAnnotations,
    fitBoundsOptions,
    interactions,
    interactive,
    mapOptions,
    navigationControl,
    onError,
    onInteractionDiagnostic,
    onInteractionEvent,
    onInteractionStateChange,
    onLoad,
    onStatusChange: setMapStatus,
    onThemeChange: props.onThemeChange,
    renderTargets: {
      marker: renderMarker !== undefined,
      onChange: setRenderTargets,
      popup: renderPopup !== undefined,
      tooltip: renderTooltip !== undefined,
    },
    source: runtimeSource,
    theme,
    themeBlend,
    themeTransition,
    timeOfDay,
    vegetation,
    viewMode,
    zoom,
    // Both are passed on, so a map given both reports it as it would with one.
    ...({defaultInteractionState, interactionState} as Pick<
      TileflowMapControllerOptions<TAnnotation>,
      'interactionState'
    >),
  };
  const controllerOptionsRef = useRef(controllerOptions);
  controllerOptionsRef.current = controllerOptions;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (isImageMode || !container) return;
    const controller = createTileflowMap(container, controllerOptionsRef.current, {
      sessionSource: 'react',
      // The frame this component draws carries the capture attributes.
      statusElement: null,
    });
    controllerRef.current = controller;
    setMapStatus(controller.getStatus());
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
      controller.destroy();
      setMapStatus(null);
      setRenderTargets(noRenderTargets);
    };
  }, [isImageMode]);

  // Every render hands its props over; the map does only the work a change asks for.
  useLayoutEffect(() => {
    controllerRef.current?.update(controllerOptions);
  });

  const runtimeImageUrl = useMemo(
    () =>
      imageUrl ??
      (isImageMode && !themeResolution.error
        ? resolveTileflowStaticImageUrl({
            center: staticImageCenter,
            colorScheme: systemColorScheme,
            imageSize,
            manifestMap,
            theme: themeResolution.name,
            zoom: staticImageZoom,
          })
        : undefined),
    [
      imageSize,
      imageUrl,
      isImageMode,
      manifestMap,
      staticImageCenter,
      staticImageZoom,
      systemColorScheme,
      themeResolution,
    ],
  );
  const effectiveCaptureState = ((): 'error' | 'idle' | 'loading' => {
    if (!isImageMode) {
      if (!liveStatus) return hasInteractionError ? 'error' : 'loading';
      if (liveStatus.readiness === 'error') return 'error';
      return liveStatus.readiness === 'idle' && portalReadiness.idle ? 'idle' : 'loading';
    }
    const runtimeResolutionState: 'error' | 'idle' | 'loading' =
      currentManifestResolution.state !== 'ready'
        ? currentManifestResolution.state === 'error'
          ? 'error'
          : 'loading'
        : themeResolution.error
          ? 'error'
          : runtimeImageUrl
            ? 'idle'
            : imageUrl === undefined && imageSize === null
              ? 'loading'
              : 'error';
    const currentCaptureState = activeImageUrl === runtimeImageUrl ? captureState : 'loading';
    const interactionReadiness = hasInteractionError ? 'error' : 'idle';
    const parts = [currentCaptureState, interactionReadiness, runtimeResolutionState];
    return parts.includes('error')
      ? 'error'
      : parts.every((part) => part === 'idle')
        ? 'idle'
        : 'loading';
  })();
  useEffect(() => {
    if (!isImageMode || imageUrl || !containerRef.current) {
      setImageSize(null);
      return;
    }

    const element = containerRef.current;
    const updateImageSize = () => {
      const nextSize = normalizeTileflowStaticImageSize({
        height: element.clientHeight,
        width: element.clientWidth,
      });

      setImageSize((currentSize) =>
        currentSize?.height === nextSize.height && currentSize.width === nextSize.width
          ? currentSize
          : nextSize,
      );
    };
    const resizeObserver = new ResizeObserver(updateImageSize);

    resizeObserver.observe(element);
    updateImageSize();

    return () => {
      resizeObserver.disconnect();
    };
  }, [imageUrl, isImageMode]);

  const themeResolutionCause = themeResolution.error ? themeResolution.cause : undefined;
  useEffect(() => {
    // An interactive map reports theme failures itself.
    if (isImageMode && themeResolution.error) reportError('theme', themeResolutionCause);
  }, [isImageMode, reportError, themeResolution.error, themeResolutionCause]);

  useLayoutEffect(() => {
    if (!isImageMode) return;
    readinessRunRef.current += 1;
    setActiveImageUrl(runtimeImageUrl);
    setCaptureState('loading');
    const image = imageRef.current;
    if (image?.complete) {
      if (image.naturalWidth === 0) setCaptureState('error');
      else void markImageReady(image);
    }
  }, [isImageMode, runtimeImageUrl]);

  async function markImageReady(image: HTMLImageElement) {
    const run = ++readinessRunRef.current;
    try {
      if (typeof image.decode === 'function') await image.decode();
    } catch {
      if (!image.complete || image.naturalWidth === 0) {
        if (readinessRunRef.current === run) setCaptureState('error');
        return;
      }
    }
    if (readinessRunRef.current === run) setCaptureState('idle');
  }

  const frameStyle: CSSProperties = {
    height,
    minHeight: 240,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  };
  const diagnosticView = interactionDiagnostic ? (
    <div
      data-tileflow-interaction-diagnostic={interactionDiagnostic.code}
      role="alert"
      style={interactionDiagnosticStyle}
    >
      {interactionDiagnostic.message}
    </div>
  ) : null;

  if (isImageMode) {
    return (
      <div
        className={className}
        data-tileflow-capture-id={resolvedCaptureId}
        data-tileflow-map={mapName}
        data-tileflow-theme={resolvedThemeName}
        data-tileflow-state={effectiveCaptureState}
        ref={containerRef}
        style={frameStyle}
      >
        {runtimeImageUrl ? (
          <img
            alt={alt}
            decoding="async"
            loading={imageLoading}
            onError={() => {
              readinessRunRef.current += 1;
              setCaptureState('error');
            }}
            onLoad={(event) => void markImageReady(event.currentTarget)}
            ref={imageRef}
            src={runtimeImageUrl}
            style={{
              display: 'block',
              height: '100%',
              objectFit: 'cover',
              width: '100%',
            }}
          />
        ) : null}
        {diagnosticView}
      </div>
    );
  }

  return (
    <>
      <div
        className={className}
        data-tileflow-capture-id={resolvedCaptureId}
        data-tileflow-map={mapName}
        data-tileflow-theme={resolvedThemeName}
        data-tileflow-state={effectiveCaptureState}
        style={frameStyle}
      >
        <div ref={containerRef} style={mapContainerStyle} />
        {diagnosticView}
      </div>
      {annotationRenderTargets.map((target) => {
        const portalKey = `annotation:${target.key}`;
        return createPortal(
          <TileflowAnnotationPortal
            onCommit={portalReadiness.markCommitted}
            portalKey={portalKey}
            readinessToken={portalReadiness.token}
            renderMarker={renderMarker}
            renderPopup={generalRenderPopup}
            renderTarget={target}
            renderTooltip={generalRenderTooltip}
            selected={openPopupAnnotationIds.has(target.annotation.id)}
          />,
          target.container,
          portalKey,
        );
      })}
      {semanticRenderTargets.map((target) => {
        const portalKey = `semantic:${target.key}`;
        return createPortal(
          <TileflowSemanticPortal<TAnnotation>
            onCommit={portalReadiness.markCommitted}
            portalKey={portalKey}
            readinessToken={portalReadiness.token}
            renderPopup={generalRenderPopup}
            renderTarget={target}
            renderTooltip={generalRenderTooltip}
          />,
          target.container,
          portalKey,
        );
      })}
    </>
  );
}) as unknown as MapComponent;

const mapContainerStyle: CSSProperties = {
  inset: 0,
  position: 'absolute',
};

const interactionDiagnosticStyle: CSSProperties = {
  background: '#7f1d1d',
  border: '1px solid #fecaca',
  borderRadius: 4,
  color: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  left: 12,
  maxWidth: 'calc(100% - 24px)',
  padding: '8px 10px',
  position: 'absolute',
  top: 12,
  zIndex: 10,
};

type TileflowAnnotationPortalProps<TAnnotation extends TileflowAnnotation> = Readonly<{
  onCommit: TileflowPortalCommitListener;
  portalKey: string;
  readinessToken: string;
  renderMarker?: TileflowAnnotationRenderer<TAnnotation>;
  renderPopup?: TileflowInteractionRenderer<TAnnotation>;
  renderTarget: TileflowMapLibreDomRenderTarget<TAnnotation>;
  renderTooltip?: TileflowInteractionRenderer<TAnnotation>;
  selected: boolean;
}>;

/** Hover and focus of a marker, read from its element so only this marker's view renders again. */
function useMarkerPointerState(container: HTMLElement, enabled: boolean) {
  const [state, setState] = useState({focused: false, hovered: false});
  useEffect(() => {
    if (!enabled) return;
    const element = container.closest<HTMLElement>('[data-tileflow-interaction="marker"]');
    if (!element) return;
    const set = (patch: Partial<typeof state>) => setState((previous) => ({...previous, ...patch}));
    const enter = () => set({hovered: true});
    const leave = () => set({hovered: false});
    const focus = () => set({focused: true});
    const blur = () => set({focused: false});
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('focusin', focus);
    element.addEventListener('focusout', blur);
    return () => {
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('focusin', focus);
      element.removeEventListener('focusout', blur);
    };
  }, [container, enabled]);
  return state;
}

function TileflowAnnotationPortal<TAnnotation extends TileflowAnnotation>({
  onCommit,
  portalKey,
  readinessToken,
  renderMarker,
  renderPopup,
  renderTarget,
  renderTooltip,
  selected,
}: TileflowAnnotationPortalProps<TAnnotation>) {
  useLayoutEffect(() => {
    onCommit(readinessToken, portalKey);
  }, [onCommit, portalKey, readinessToken]);
  const pointer = useMarkerPointerState(renderTarget.container, renderTarget.kind === 'marker');

  const {annotation} = renderTarget;
  const content =
    renderTarget.kind === 'marker'
      ? annotation.marker?.content
      : renderTarget.kind === 'tooltip'
        ? annotation.tooltip?.content
        : annotation.popup?.content;
  const context: TileflowAnnotationViewContext<TAnnotation> = {
    annotation,
    close: renderTarget.close,
    ...(content ? {content} : {}),
    target: {
      annotation,
      coordinate: annotation.coordinate,
      kind: 'annotation',
    },
    ...(content?.kind === 'view' ? {viewName: content.name} : {}),
    ...(renderTarget.kind === 'marker' ? {state: {...pointer, selected}} : {}),
  };
  if (renderTarget.kind === 'marker') return renderMarker?.(context) ?? null;
  const renderer = renderTarget.kind === 'tooltip' ? renderTooltip : renderPopup;
  return renderer?.(context) ?? null;
}

type TileflowSemanticPortalProps<TAnnotation extends TileflowAnnotation> = Readonly<{
  onCommit: TileflowPortalCommitListener;
  portalKey: string;
  readinessToken: string;
  renderPopup?: TileflowInteractionRenderer<TAnnotation>;
  renderTarget: TileflowMapLibreSemanticDomRenderTarget;
  renderTooltip?: TileflowInteractionRenderer<TAnnotation>;
}>;

function TileflowSemanticPortal<TAnnotation extends TileflowAnnotation>({
  onCommit,
  portalKey,
  readinessToken,
  renderPopup,
  renderTarget,
  renderTooltip,
}: TileflowSemanticPortalProps<TAnnotation>) {
  useLayoutEffect(() => {
    onCommit(readinessToken, portalKey);
  }, [onCommit, portalKey, readinessToken]);

  const context: TileflowInteractionViewContext<TAnnotation> = {
    close: renderTarget.close,
    content: renderTarget.content,
    target: renderTarget.target,
    ...(renderTarget.viewName ? {viewName: renderTarget.viewName} : {}),
  };
  const renderer = renderTarget.kind === 'tooltip' ? renderTooltip : renderPopup;
  return renderer?.(context) ?? null;
}

type TileflowPortalCommitListener = (readinessToken: string, portalKey: string) => void;

type TileflowPortalCommitSnapshot = Readonly<{
  keys: ReadonlySet<string>;
  token: string;
}>;

function useTileflowPortalReadiness(portalKeys: readonly string[]) {
  const signature = JSON.stringify([...portalKeys].sort());
  const versionRef = useRef({signature, version: 0});
  if (versionRef.current.signature !== signature) {
    versionRef.current = {signature, version: versionRef.current.version + 1};
  }
  const token = `${versionRef.current.version}:${signature}`;
  const expectedKeysRef = useRef({keys: [...portalKeys].sort(), token});
  if (expectedKeysRef.current.token !== token) {
    expectedKeysRef.current = {keys: [...portalKeys].sort(), token};
  }
  const expectedKeys = expectedKeysRef.current.keys;
  const [committed, setCommitted] = useState<TileflowPortalCommitSnapshot>(() => ({
    keys: new Set(),
    token,
  }));
  const [readyToken, setReadyToken] = useState(token);
  const readinessRunRef = useRef(0);
  const markCommitted = useCallback<TileflowPortalCommitListener>((committedToken, portalKey) => {
    setCommitted((current) => {
      if (current.token !== committedToken) {
        return {keys: new Set([portalKey]), token: committedToken};
      }
      if (current.keys.has(portalKey)) return current;
      return {keys: new Set([...current.keys, portalKey]), token: committedToken};
    });
  }, []);

  useLayoutEffect(() => {
    setCommitted((current) => (current.token === token ? current : {keys: new Set(), token}));
  }, [token]);

  useLayoutEffect(() => {
    if (
      readyToken === token ||
      committed.token !== token ||
      !expectedKeys.every((key) => committed.keys.has(key))
    ) {
      return;
    }

    const browserWindow = globalThis.window;
    const run = ++readinessRunRef.current;
    let secondFrame: number | undefined;
    const firstFrame = browserWindow.requestAnimationFrame(() => {
      secondFrame = browserWindow.requestAnimationFrame(() => {
        if (readinessRunRef.current === run) setReadyToken(token);
      });
    });

    return () => {
      readinessRunRef.current += 1;
      browserWindow.cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) browserWindow.cancelAnimationFrame(secondFrame);
    };
  }, [committed, expectedKeys, readyToken, token]);

  return {idle: readyToken === token, markCommitted, token};
}
function tileflowInteractionDiagnosticKey(diagnostic: TileflowInteractionDiagnostic): string {
  return [
    diagnostic.code,
    diagnostic.level,
    diagnostic.path ?? '',
    diagnostic.target ? JSON.stringify(diagnostic.target) : '',
    diagnostic.message,
  ].join('\u0000');
}
function useStableMapOptions(
  options: TileflowMapOptions | undefined,
): TileflowMapOptions | undefined {
  return useStableMapOptionValue(options);
}

function useStableMapOptionValue<T>(value: T): T {
  const valueRef = useRef(value);

  if (!areEquivalentMapOptionValues(valueRef.current, value)) {
    valueRef.current = value;
  }

  return valueRef.current;
}

function areEquivalentMapOptionValues(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, object>(),
): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }

  const seenRight = seen.get(left);

  if (seenRight) {
    return seenRight === right;
  }

  seen.set(left, right);

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areEquivalentMapOptionValues(value, right[index], seen))
    );
  }

  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) && areEquivalentMapOptionValues(left[key], right[key], seen),
    )
  );
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
