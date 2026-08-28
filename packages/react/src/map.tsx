'use client';

import {
  type CSSProperties,
  type ImgHTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {createPortal} from 'react-dom';
import type {
  LngLatLike,
  Map as MapLibreMap,
  MapOptions as MapLibreMapOptions,
  Marker as MapLibreMarker,
  Popup as MapLibrePopup,
  PointLike,
  StyleSpecification,
} from 'maplibre-gl';
import {
  attachTileflowFairUseNotice,
  attachTileflowMapLifecycle,
  createTileflowSessionStarter,
  createTileflowThemeController,
  createTileflowTransformRequest,
  getTileflowSystemColorScheme,
  loadTileflowStyleFonts,
  registerTileflowContourProtocol,
  registerTileflowWorldRequestBridge,
  subscribeTileflowSystemColorScheme,
  type TileflowThemeController,
  type TileflowThemeTransition,
} from '@tileflow/core/browser';
import {normalizeTileflowCaptureId} from '@tileflow/core/capture';
import {
  createTileflowSessionController,
  defaultTileflowManifestUrl,
  defaultTileflowRuntimeView,
  loadTileflowManifest,
  mergeTileflowAnalytics,
  normalizeTileflowRuntimeCenter,
  normalizeTileflowStaticImageSize,
  resolveTileflowManifestMap,
  resolveTileflowMapMode,
  resolveTileflowRuntimeStyle,
  resolveTileflowRuntimeTheme,
  resolveTileflowRuntimeView,
  resolveTileflowStaticImageUrl,
  shouldLoadTileflowManifest,
  type TileflowAnalytics,
  type TileflowMapMarker,
  type TileflowRuntimeManifestMap,
  type TileflowRuntimeSource,
} from '@tileflow/core/runtime';
import type {
  TileflowAnnotation,
  TileflowAnnotationViewContext,
  TileflowInteractionBinding,
  TileflowInteractionDiagnostic,
  TileflowInteractionEvent,
  TileflowInteractionState,
  TileflowInteractionViewContext,
} from '@tileflow/interactions';
import {
  createTileflowMapLibreDomRuntime,
  createTileflowMapLibreInteractionCoordinator,
  createTileflowMapLibreSemanticDomRuntime,
  type TileflowMapLibreDomRenderTarget,
  type TileflowMapLibreDomRuntime,
  type TileflowMapLibreInteractionCoordinator,
  type TileflowMapLibrePoiMap,
  type TileflowMapLibreSemanticDomRenderTarget,
  type TileflowMapLibreSemanticDomRuntime,
} from '@tileflow/interactions/maplibre';
import {imageModeMapInteractionDiagnostic, prepareTileflowReactAnnotations} from './annotations';
import {prepareTileflowReactInteractionBindings} from './interaction-bindings';
import {prepareTileflowReactInteractionState} from './interaction-state-input';
import {assertTileflowMapStyleInputs, type TileflowMapStyleSourceProps} from './map-style-inputs';
import {loadTileflowMapLibre} from './maplibre';

export type MapMarker = TileflowMapMarker;
export type TileflowMapSource = TileflowRuntimeSource;
export type TileflowMapOptions = Omit<MapLibreMapOptions, 'container' | 'style'>;

type TileflowManifestResolution = Readonly<{
  key: string;
  map: TileflowRuntimeManifestMap | null;
  state: 'error' | 'loading' | 'not-needed' | 'ready';
}>;

export type TileflowAnnotationRenderer<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = (context: TileflowAnnotationViewContext<TAnnotation>) => ReactNode;

export type TileflowInteractionRenderer<
  TAnnotation extends TileflowAnnotation = TileflowAnnotation,
> = (context: TileflowInteractionViewContext<TAnnotation>) => ReactNode;

type MapSharedProps = {
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
  onLoad?: (map: MapLibreMap) => void;
  onThemeChange?: (transition: TileflowThemeTransition) => void;
};

type TileflowAnnotationInputProps<TAnnotation extends TileflowAnnotation> =
  | Readonly<{
      annotations?: readonly TAnnotation[];
      markers?: never;
    }>
  | Readonly<{
      annotations?: never;
      markers?: readonly MapMarker[];
    }>;

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
  TileflowAnnotationInputProps<TAnnotation> &
  TileflowInteractionStateInputProps &
  TileflowInteractionRendererProps<TAnnotation> & {
    mode?: 'interactive';
    onInteractionDiagnostic?: (diagnostic: TileflowInteractionDiagnostic) => void;
    onInteractionEvent?: (event: TileflowInteractionEvent<TAnnotation>) => void;
    onInteractionStateChange?: (state: TileflowInteractionState) => void;
    renderMarker?: TileflowAnnotationRenderer<TAnnotation>;
  };

type MapImageProps = MapSharedProps & {
  annotations?: never;
  defaultInteractionState?: never;
  interactionState?: never;
  interactions?: never;
  markers?: never;
  mode: 'image';
  onInteractionDiagnostic?: never;
  onInteractionEvent?: never;
  onInteractionStateChange?: never;
  renderMarker?: never;
  renderPopup?: never;
  renderTooltip?: never;
};

export type MapProps<TAnnotation extends TileflowAnnotation = TileflowAnnotation> = (
  | MapInteractiveProps<TAnnotation>
  | MapImageProps
) &
  TileflowMapStyleSourceProps;

const defaultInteractions: readonly TileflowInteractionBinding[] = [];

export function Map<TAnnotation extends TileflowAnnotation = TileflowAnnotation>(
  props: MapProps<TAnnotation>,
) {
  assertTileflowMapStyleInputs(props);

  const {
    annotations,
    captureId,
    defaultInteractionState,
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
    markers,
    analytics,
    theme,
    interactionState,
    interactions = defaultInteractions,
    onInteractionDiagnostic,
    onInteractionEvent,
    onInteractionStateChange,
    onLoad,
    renderMarker,
    renderPopup,
    renderTooltip,
  } = props;
  const generalRenderPopup = renderPopup as TileflowInteractionRenderer<TAnnotation> | undefined;
  const generalRenderTooltip = renderTooltip as
    | TileflowInteractionRenderer<TAnnotation>
    | undefined;
  const sourceKind = source.kind;
  const sourceMap = source.kind === 'tileflow' ? source.map : undefined;
  const sourceManifestUrl = source.kind === 'tileflow' ? source.manifestUrl : undefined;
  const sourceStyle = source.kind === 'maplibre' ? source.style : undefined;
  const runtimeSource = useMemo<TileflowRuntimeSource>(
    () =>
      sourceKind === 'tileflow'
        ? {kind: 'tileflow', manifestUrl: sourceManifestUrl, map: sourceMap!}
        : {kind: 'maplibre', style: sourceStyle!},
    [sourceKind, sourceManifestUrl, sourceMap, sourceStyle],
  );
  const mapName = runtimeSource.kind === 'tileflow' ? runtimeSource.map : undefined;
  const manifestUrl =
    runtimeSource.kind === 'tileflow'
      ? (runtimeSource.manifestUrl ?? defaultTileflowManifestUrl)
      : defaultTileflowManifestUrl;
  const preparedAnnotations = useMemo(
    () => prepareTileflowReactAnnotations(annotations, markers),
    [annotations, markers],
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
  const mapRef = useRef<MapLibreMap | null>(null);
  const themeControllerRef = useRef<TileflowThemeController | undefined>(undefined);
  const runtimeStyleRef = useRef<ReturnType<typeof resolveTileflowRuntimeStyle>>(null);
  const interactionRuntimeRef = useRef<TileflowMapLibreDomRuntime<TAnnotation> | undefined>(
    undefined,
  );
  const semanticRuntimeRef = useRef<TileflowMapLibreSemanticDomRuntime | undefined>(undefined);
  const interactionCoordinatorRef = useRef<TileflowMapLibreInteractionCoordinator | undefined>(
    undefined,
  );
  const annotationsRef = useRef(preparedAnnotations.annotations);
  const annotationTitlesRef = useRef(preparedAnnotations.titles);
  const preparedInteractionsRef = useRef(preparedInteractions);
  const coordinatedInteractionStateRef = useRef(preparedInteractionState.state);
  const onInteractionDiagnosticRef = useRef(onInteractionDiagnostic);
  const onInteractionEventRef = useRef(onInteractionEvent);
  const onInteractionStateChangeRef = useRef(onInteractionStateChange);
  const onThemeChangeRef = useRef(props.onThemeChange);
  const renderMarkerRef = useRef(renderMarker);
  const renderPopupRef = useRef(renderPopup);
  const renderTooltipRef = useRef(renderTooltip);
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
  const [themeTransitionState, setThemeTransitionState] = useState<'error' | 'idle' | 'loading'>(
    'idle',
  );
  const [activeRuntimeResource, setActiveRuntimeResource] = useState<unknown>(undefined);
  const [annotationRenderTargets, setAnnotationRenderTargets] = useState<
    readonly TileflowMapLibreDomRenderTarget<TAnnotation>[]
  >([]);
  const [semanticRenderTargets, setSemanticRenderTargets] = useState<
    readonly TileflowMapLibreSemanticDomRenderTarget[]
  >([]);
  const [annotationBridgeDiagnostic, setAnnotationBridgeDiagnostic] =
    useState<TileflowInteractionDiagnostic>();
  const [semanticBridgeDiagnostic, setSemanticBridgeDiagnostic] =
    useState<TileflowInteractionDiagnostic>();
  const [stateBridgeDiagnostic, setStateBridgeDiagnostic] =
    useState<TileflowInteractionDiagnostic>();
  const [rendererBridgeDiagnostic, setRendererBridgeDiagnostic] =
    useState<TileflowInteractionDiagnostic>();
  const [annotationDiagnostics, setAnnotationDiagnostics] = useState<
    readonly TileflowInteractionDiagnostic[]
  >([]);
  const [semanticDiagnostics, setSemanticDiagnostics] = useState<
    readonly TileflowInteractionDiagnostic[]
  >([]);
  const stableMapOptions = useStableMapOptions(mapOptions);
  const resolvedCaptureId = normalizeTileflowCaptureId(captureId);
  const resolvedMode = resolveTileflowMapMode({mode});
  const isImageMode = resolvedMode === 'image';
  const shouldLoadManifest = shouldLoadTileflowManifest({
    source: runtimeSource,
  });
  const manifestRequestKey = shouldLoadManifest
    ? JSON.stringify([manifestUrl, mapName])
    : 'not-needed';
  const currentManifestResolution: TileflowManifestResolution =
    manifestResolution.key === manifestRequestKey
      ? manifestResolution
      : {
          key: manifestRequestKey,
          map: null,
          state: shouldLoadManifest ? 'loading' : 'not-needed',
        };
  const manifestMap =
    currentManifestResolution.state === 'ready' ? currentManifestResolution.map : null;
  const themeResolution = useMemo(() => {
    if (!manifestMap || runtimeSource.kind !== 'tileflow') {
      return {
        error: false,
        name: runtimeSource.kind === 'tileflow' && theme && theme !== 'system' ? theme : undefined,
      } as const;
    }

    try {
      return {
        error: false,
        name: resolveTileflowRuntimeTheme(manifestMap, theme, systemColorScheme).name,
      } as const;
    } catch {
      return {error: true, name: undefined} as const;
    }
  }, [manifestMap, runtimeSource, systemColorScheme, theme]);
  const resolvedThemeName = themeResolution.name;
  const manifestView = resolveTileflowRuntimeView({manifestMap});
  const manifestCenter = useStableMapOptionValue<[number, number]>(
    normalizeTileflowRuntimeCenter(manifestView.center),
  );
  const resolvedCenter = useStableMapOptionValue<LngLatLike>(
    center ?? stableMapOptions?.center ?? manifestCenter,
  );
  const resolvedZoom =
    zoom ?? stableMapOptions?.zoom ?? manifestView.zoom ?? defaultTileflowRuntimeView.zoom;
  const resolvedBearing = stableMapOptions?.bearing ?? manifestView.bearing;
  const resolvedPitch = stableMapOptions?.pitch ?? manifestView.pitch;
  const resolvedInteractive = interactive ?? stableMapOptions?.interactive ?? true;
  const staticImageCenter = useStableMapOptionValue<[number, number]>(
    normalizeTileflowRuntimeCenter(center ?? stableMapOptions?.center, manifestCenter),
  );
  const staticImageZoom =
    zoom ?? stableMapOptions?.zoom ?? manifestView.zoom ?? defaultTileflowRuntimeView.zoom;
  const centerRef = useRef<LngLatLike>(resolvedCenter);
  const zoomRef = useRef(resolvedZoom);
  const bearingRef = useRef(resolvedBearing);
  const pitchRef = useRef(resolvedPitch);
  const onLoadRef = useRef(onLoad);
  const mapNameRef = useRef(mapName);
  const resolvedAnalyticsRef = useRef<TileflowAnalytics | undefined>(undefined);
  const readinessRunRef = useRef(0);
  const hasAdditionalInteractionConfiguration =
    annotations !== undefined ||
    defaultInteractionState !== undefined ||
    interactionState !== undefined ||
    markers !== undefined ||
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
  const declarativeInteractionDiagnostics = useMemo(
    () =>
      [
        modeDiagnostic,
        ...preparedAnnotations.diagnostics,
        ...preparedInteractions.diagnostics,
        ...preparedInteractionState.diagnostics,
      ].filter(
        (diagnostic): diagnostic is TileflowInteractionDiagnostic => diagnostic !== undefined,
      ),
    [
      modeDiagnostic,
      preparedAnnotations.diagnostics,
      preparedInteractions.diagnostics,
      preparedInteractionState.diagnostics,
    ],
  );
  const interactionDiagnostics = [
    ...declarativeInteractionDiagnostics,
    ...(annotationBridgeDiagnostic ? [annotationBridgeDiagnostic] : []),
    ...(semanticBridgeDiagnostic ? [semanticBridgeDiagnostic] : []),
    ...(stateBridgeDiagnostic ? [stateBridgeDiagnostic] : []),
    ...(rendererBridgeDiagnostic ? [rendererBridgeDiagnostic] : []),
    ...annotationDiagnostics,
    ...semanticDiagnostics,
  ];
  const interactionDiagnostic =
    interactionDiagnostics.find((diagnostic) => diagnostic.level === 'error') ??
    interactionDiagnostics[0];
  const hasInteractionError = interactionDiagnostics.some(
    (diagnostic) => diagnostic.level === 'error',
  );
  const portalKeys = useMemo(
    () => [
      ...annotationRenderTargets.map((target) => `annotation:${target.key}`),
      ...semanticRenderTargets.map((target) => `semantic:${target.key}`),
    ],
    [annotationRenderTargets, semanticRenderTargets],
  );
  const portalReadiness = useTileflowPortalReadiness(portalKeys);
  const interactionReadiness = hasInteractionError
    ? 'error'
    : portalReadiness.idle
      ? 'idle'
      : 'loading';
  if (preparedAnnotations.ok) {
    annotationsRef.current = preparedAnnotations.annotations;
    annotationTitlesRef.current = preparedAnnotations.titles;
  }
  preparedInteractionsRef.current = preparedInteractions;
  onInteractionDiagnosticRef.current = onInteractionDiagnostic;
  onInteractionEventRef.current = onInteractionEvent;
  onInteractionStateChangeRef.current = onInteractionStateChange;
  renderMarkerRef.current = renderMarker;
  renderPopupRef.current = renderPopup;
  renderTooltipRef.current = renderTooltip;
  onThemeChangeRef.current = props.onThemeChange;

  useEffect(() => {
    if (theme !== 'system') return;
    setSystemColorScheme(getTileflowSystemColorScheme());
    return subscribeTileflowSystemColorScheme(setSystemColorScheme);
  }, [theme]);

  useEffect(() => {
    const previousKeys = reportedDeclarativeDiagnosticKeysRef.current;
    const nextKeys = new Set<string>();

    for (const diagnostic of declarativeInteractionDiagnostics) {
      const key = tileflowInteractionDiagnosticKey(diagnostic);
      nextKeys.add(key);
      if (!previousKeys.has(key)) onInteractionDiagnosticRef.current?.(diagnostic);
    }
    reportedDeclarativeDiagnosticKeysRef.current = nextKeys;
  }, [declarativeInteractionDiagnostics]);

  useEffect(() => {
    if (!shouldLoadManifest) {
      setManifestResolution({key: manifestRequestKey, map: null, state: 'not-needed'});
      return;
    }

    let cancelled = false;
    setManifestResolution({key: manifestRequestKey, map: null, state: 'loading'});

    loadTileflowManifest(manifestUrl)
      .then((manifest) => {
        if (cancelled) {
          return;
        }

        const resolvedMap =
          manifest && mapName ? resolveTileflowManifestMap(manifest, mapName) : null;
        setManifestResolution({
          key: manifestRequestKey,
          map: resolvedMap,
          state: resolvedMap ? 'ready' : 'error',
        });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load Tileflow manifest', error);
          setManifestResolution({key: manifestRequestKey, map: null, state: 'error'});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [manifestRequestKey, manifestUrl, mapName, shouldLoadManifest]);

  const runtimeStyle = useMemo(() => {
    if (isImageMode || themeResolution.error) {
      return null;
    }

    return resolveTileflowRuntimeStyle({
      colorScheme: systemColorScheme,
      manifestMap,
      source: runtimeSource,
      theme: themeResolution.name,
    });
  }, [isImageMode, manifestMap, runtimeSource, systemColorScheme, themeResolution]);
  runtimeStyleRef.current = runtimeStyle;
  const runtimeMapIdentity =
    runtimeSource.kind === 'tileflow'
      ? `${manifestUrl}\0${runtimeSource.map}`
      : runtimeSource.style;
  const runtimeStyleReady =
    runtimeStyle !== null || (themeResolution.error && mapRef.current !== null);

  const resolvedAnalytics = useMemo(
    () => mergeTileflowAnalytics(analytics, runtimeStyle?.analytics),
    [analytics, runtimeStyle],
  );

  useEffect(() => {
    centerRef.current = resolvedCenter;
    zoomRef.current = resolvedZoom;
    bearingRef.current = resolvedBearing;
    pitchRef.current = resolvedPitch;

    mapRef.current?.jumpTo({
      bearing: resolvedBearing,
      center: resolvedCenter,
      pitch: resolvedPitch,
      zoom: resolvedZoom,
    });
  }, [resolvedBearing, resolvedCenter, resolvedPitch, resolvedZoom]);

  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    mapNameRef.current = mapName;
  }, [mapName]);

  useEffect(() => {
    resolvedAnalyticsRef.current = resolvedAnalytics;
  }, [resolvedAnalytics]);

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
  const runtimeResolutionState: 'error' | 'idle' | 'loading' = (() => {
    if (shouldLoadManifest && currentManifestResolution.state !== 'ready') {
      return currentManifestResolution.state === 'error' ? 'error' : 'loading';
    }
    if (themeResolution.error) return 'error';
    if (isImageMode) {
      if (runtimeImageUrl) return 'idle';
      return imageUrl === undefined && imageSize === null ? 'loading' : 'error';
    }
    return runtimeStyle ? 'idle' : 'error';
  })();
  const currentCaptureState =
    activeRuntimeResource === (isImageMode ? runtimeImageUrl : runtimeStyle)
      ? captureState
      : 'loading';
  const effectiveCaptureState =
    currentCaptureState === 'error' ||
    interactionReadiness === 'error' ||
    runtimeResolutionState === 'error' ||
    themeTransitionState === 'error'
      ? 'error'
      : currentCaptureState === 'idle' &&
          interactionReadiness === 'idle' &&
          runtimeResolutionState === 'idle' &&
          themeTransitionState === 'idle'
        ? 'idle'
        : 'loading';
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

  useEffect(() => {
    const runtime = interactionRuntimeRef.current;
    if (!runtime || !preparedAnnotations.ok) return;

    try {
      setAnnotationBridgeDiagnostic(undefined);
      runtime.reconcile(preparedAnnotations.annotations);
    } catch (error) {
      console.error('Failed to reconcile Tileflow annotations', error);
      const diagnostic = createOverlayFailureDiagnostic(
        'Tileflow annotations could not be reconciled.',
      );
      setAnnotationBridgeDiagnostic(diagnostic);
      onInteractionDiagnosticRef.current?.(diagnostic);
    }
  }, [preparedAnnotations]);

  useEffect(() => {
    const runtime = semanticRuntimeRef.current;
    if (!runtime || !preparedInteractions.ok) return;

    try {
      setSemanticBridgeDiagnostic(undefined);
      runtime.reconcile(preparedInteractions.bindings);
    } catch (error) {
      console.error('Failed to reconcile Tileflow semantic interactions', error);
      const diagnostic = createOverlayFailureDiagnostic(
        'Tileflow semantic interactions could not be reconciled.',
      );
      setSemanticBridgeDiagnostic(diagnostic);
      onInteractionDiagnosticRef.current?.(diagnostic);
    }
  }, [preparedInteractions]);

  useEffect(() => {
    if (!preparedInteractionState.controlled || !preparedInteractionState.ok) return;

    try {
      setStateBridgeDiagnostic(undefined);
      interactionCoordinatorRef.current?.setInteractionState(preparedInteractionState.state);
      coordinatedInteractionStateRef.current = preparedInteractionState.state;
    } catch (error) {
      console.error('Failed to update Tileflow interaction state', error);
      const diagnostic = createOverlayFailureDiagnostic(
        'Tileflow interaction state could not be updated.',
      );
      setStateBridgeDiagnostic(diagnostic);
      onInteractionDiagnosticRef.current?.(diagnostic);
    }
  }, [preparedInteractionState]);

  useEffect(() => {
    const annotationRuntime = interactionRuntimeRef.current;
    const semanticRuntime = semanticRuntimeRef.current;
    if (!annotationRuntime && !semanticRuntime) return;

    try {
      setRendererBridgeDiagnostic(undefined);
      annotationRuntime?.setCustomRenderers({
        marker: renderMarker !== undefined,
        popup: renderPopup !== undefined,
        tooltip: renderTooltip !== undefined,
      });
      semanticRuntime?.setCustomRenderers({
        popup: renderPopup !== undefined,
        tooltip: renderTooltip !== undefined,
      });
    } catch (error) {
      console.error('Failed to update Tileflow interaction renderers', error);
      const diagnostic = createOverlayFailureDiagnostic(
        'Tileflow interaction renderers could not be updated.',
      );
      setRendererBridgeDiagnostic(diagnostic);
      onInteractionDiagnosticRef.current?.(diagnostic);
    }
  }, [renderMarker, renderPopup, renderTooltip]);

  useEffect(() => {
    setThemeTransitionState('idle');
    const initialRuntimeStyle = runtimeStyleRef.current;
    if (!containerRef.current || !initialRuntimeStyle) {
      return;
    }

    readinessRunRef.current += 1;
    setActiveRuntimeResource(initialRuntimeStyle);
    setCaptureState('loading');
    const container = containerRef.current;
    let cancelled = false;
    let disposeMap: (() => void) | undefined;

    void Promise.all([
      loadTileflowMapLibre(),
      loadTileflowStyleFonts(initialRuntimeStyle.style, {
        fontFaces: initialRuntimeStyle.fontFaces,
      }),
    ])
      .then(([maplibregl]) => {
        if (cancelled || containerRef.current !== container) {
          return;
        }

        const setupCleanups: (() => void)[] = [];
        let setupDisposed = false;
        const setupResources: {
          annotationRuntime?: TileflowMapLibreDomRuntime<TAnnotation>;
          coordinator?: TileflowMapLibreInteractionCoordinator;
          map?: MapLibreMap;
          semanticRuntime?: TileflowMapLibreSemanticDomRuntime;
        } = {};
        const registerCleanup = (cleanup: () => void) => setupCleanups.push(cleanup);
        disposeMap = () => {
          if (setupDisposed) return;
          setupDisposed = true;
          try {
            runTileflowReactCleanups([...setupCleanups].reverse());
          } finally {
            if (mapRef.current === setupResources.map) mapRef.current = null;
            if (interactionRuntimeRef.current === setupResources.annotationRuntime) {
              interactionRuntimeRef.current = undefined;
            }
            if (semanticRuntimeRef.current === setupResources.semanticRuntime) {
              semanticRuntimeRef.current = undefined;
            }
            if (interactionCoordinatorRef.current === setupResources.coordinator) {
              interactionCoordinatorRef.current = undefined;
            }
            setAnnotationDiagnostics([]);
            setAnnotationRenderTargets([]);
            setAnnotationBridgeDiagnostic(undefined);
            setSemanticDiagnostics([]);
            setSemanticRenderTargets([]);
            setSemanticBridgeDiagnostic(undefined);
            setStateBridgeDiagnostic(undefined);
            setRendererBridgeDiagnostic(undefined);
          }
        };

        const session = createTileflowSessionController({source: 'react'});
        const sessionStarter = createTileflowSessionStarter({
          getSessionId: () => session.sessionId,
          sessionId: session.sessionId,
          source: 'react',
        });
        const fairUseNotice = attachTileflowFairUseNotice(container);
        registerCleanup(() => fairUseNotice.dispose());
        registerTileflowContourProtocol({addProtocol: maplibregl.addProtocol});
        const worldRequestBridge = registerTileflowWorldRequestBridge({
          addProtocol: maplibregl.addProtocol,
          onNotice: fairUseNotice.update,
        });
        registerCleanup(() => worldRequestBridge.dispose());
        const transformRequest = createTileflowTransformRequest({
          always: true,
          asyncAnalyticsTiming: 'resolution',
          getAnalytics: () => resolvedAnalyticsRef.current,
          sessionController: session,
          sessionId: session.sessionId,
          transformRequest: stableMapOptions?.transformRequest ?? undefined,
          worldRequestBridge,
        });

        const map = new maplibregl.Map({
          ...stableMapOptions,
          container,
          style: initialRuntimeStyle.style as StyleSpecification | string,
          bearing: bearingRef.current,
          center: centerRef.current,
          pitch: pitchRef.current,
          zoom: zoomRef.current,
          interactive: resolvedInteractive,
          attributionControl: stableMapOptions?.attributionControl ?? {
            compact: true,
          },
          transformRequest,
        });

        mapRef.current = map;
        setupResources.map = map;
        registerCleanup(() => map.remove());
        const themeController =
          initialRuntimeStyle.theme === undefined
            ? undefined
            : createTileflowThemeController({
                initial: initialRuntimeStyle,
                map,
                onTransition(transition) {
                  onThemeChangeRef.current?.(transition);
                  if (transition.phase === 'preloading' || transition.phase === 'applying') {
                    setThemeTransitionState('loading');
                  } else if (transition.phase === 'error') {
                    setThemeTransitionState('error');
                  } else {
                    setThemeTransitionState('idle');
                  }
                },
              });
        if (themeController) {
          themeControllerRef.current = themeController;
          registerCleanup(() => {
            themeController.dispose();
            if (themeControllerRef.current === themeController) {
              themeControllerRef.current = undefined;
            }
          });
        }
        const browserWindow = container.ownerDocument.defaultView;
        if (!browserWindow) {
          throw new Error('Tileflow semantic interactions require a browser document.');
        }
        const interactionCoordinator = createTileflowMapLibreInteractionCoordinator({
          ...(controlledInteractionOwnershipRef.current
            ? {interactionState: coordinatedInteractionStateRef.current}
            : {defaultInteractionState: coordinatedInteractionStateRef.current}),
          onInteractionStateChange(state) {
            if (!controlledInteractionOwnershipRef.current) {
              coordinatedInteractionStateRef.current = state;
            }
            onInteractionStateChangeRef.current?.(state);
          },
        });
        interactionCoordinatorRef.current = interactionCoordinator;
        setupResources.coordinator = interactionCoordinator;
        registerCleanup(() => interactionCoordinator.dispose());
        const interactionRuntime = createTileflowMapLibreDomRuntime<
          MapLibreMap,
          TileflowReactMapLibrePositioned,
          TileflowReactMapLibrePositioned,
          TAnnotation
        >({
          createMarker({annotation, element}) {
            const marker = new maplibregl.Marker({element});
            element.title = annotationTitlesRef.current.get(annotation.id) ?? annotation.ariaLabel;

            return wrapMapLibrePositioned(marker);
          },
          createOverlay({container: overlayContainer, kind}) {
            const popup = new maplibregl.Popup({
              closeButton: false,
              closeOnClick: false,
              closeOnMove: false,
              focusAfterOpen: false,
              offset: kind === 'popup' ? 24 : 18,
            }).setDOMContent(overlayContainer);

            return wrapMapLibrePositioned(popup);
          },
          customMarker: renderMarkerRef.current !== undefined,
          customPopup: renderPopupRef.current !== undefined,
          customTooltip: renderTooltipRef.current !== undefined,
          document: container.ownerDocument,
          interactionState: interactionCoordinator.getInteractionState(),
          map,
          onInteractionStateChange: interactionCoordinator.requestInteractionState,
          onDiagnostic(diagnostic) {
            onInteractionDiagnosticRef.current?.(diagnostic);
          },
          updateMarker(_marker, {annotation, element}) {
            element.title = annotationTitlesRef.current.get(annotation.id) ?? annotation.ariaLabel;
          },
        });
        interactionRuntimeRef.current = interactionRuntime;
        setupResources.annotationRuntime = interactionRuntime;
        registerCleanup(() => interactionRuntime.dispose());
        const semanticRuntime = createTileflowMapLibreSemanticDomRuntime<
          MapLibreMap,
          TileflowReactMapLibrePositioned
        >({
          cancelFrame: (frame) => browserWindow.cancelAnimationFrame(frame),
          createOverlay({container: overlayContainer, kind}) {
            const popup = new maplibregl.Popup({
              closeButton: false,
              closeOnClick: false,
              closeOnMove: false,
              focusAfterOpen: false,
              offset: kind === 'popup' ? 24 : 18,
            }).setDOMContent(overlayContainer);

            return wrapMapLibrePositioned(popup);
          },
          customPopup: renderPopupRef.current !== undefined,
          customTooltip: renderTooltipRef.current !== undefined,
          document: container.ownerDocument,
          interactionState: interactionCoordinator.getInteractionState(),
          map,
          onDiagnostic(diagnostic) {
            onInteractionDiagnosticRef.current?.(diagnostic);
          },
          onInteractionStateChange: interactionCoordinator.requestInteractionState,
          poiMap: createTileflowMapLibrePoiMap(map),
          requestFrame: (callback) => browserWindow.requestAnimationFrame(() => callback()),
        });
        semanticRuntimeRef.current = semanticRuntime;
        setupResources.semanticRuntime = semanticRuntime;
        registerCleanup(() => semanticRuntime.dispose());
        const detachAnnotationRuntime = interactionCoordinator.attach(
          'annotation',
          interactionRuntime,
        );
        registerCleanup(detachAnnotationRuntime);
        const detachSemanticRuntime = interactionCoordinator.attach('semantic', semanticRuntime);
        registerCleanup(detachSemanticRuntime);
        const unsubscribeInteractionEvents = interactionRuntime.subscribeEvents((event) => {
          onInteractionEventRef.current?.(event);
        });
        registerCleanup(unsubscribeInteractionEvents);
        const unsubscribeDiagnostics = interactionRuntime.subscribeDiagnostics((diagnostics) => {
          setAnnotationDiagnostics(diagnostics);
        });
        registerCleanup(unsubscribeDiagnostics);
        const unsubscribeRenderTargets = interactionRuntime.subscribeRenderTargets((targets) => {
          setAnnotationRenderTargets(targets);
        });
        registerCleanup(unsubscribeRenderTargets);
        const unsubscribeSemanticEvents = semanticRuntime.subscribeEvents((event) => {
          if (event.target.kind === 'annotation') return;
          onInteractionEventRef.current?.({...event, target: event.target});
        });
        registerCleanup(unsubscribeSemanticEvents);
        const unsubscribeSemanticDiagnostics = semanticRuntime.subscribeDiagnostics(
          (diagnostics) => {
            setSemanticDiagnostics(diagnostics);
          },
        );
        registerCleanup(unsubscribeSemanticDiagnostics);
        const unsubscribeSemanticRenderTargets = semanticRuntime.subscribeRenderTargets(
          (targets) => {
            setSemanticRenderTargets(targets);
          },
        );
        registerCleanup(unsubscribeSemanticRenderTargets);

        setAnnotationDiagnostics(interactionRuntime.getDiagnostics());
        setAnnotationRenderTargets(interactionRuntime.getRenderTargets());
        setSemanticDiagnostics(semanticRuntime.getDiagnostics());
        setSemanticRenderTargets(semanticRuntime.getRenderTargets());
        try {
          setAnnotationBridgeDiagnostic(undefined);
          interactionRuntime.reconcile(annotationsRef.current);
        } catch (error) {
          console.error('Failed to reconcile Tileflow annotations', error);
          const diagnostic = createOverlayFailureDiagnostic(
            'Tileflow annotations could not be reconciled.',
          );
          setAnnotationBridgeDiagnostic(diagnostic);
          onInteractionDiagnosticRef.current?.(diagnostic);
        }
        const initialInteractions = preparedInteractionsRef.current;
        if (initialInteractions.ok) {
          try {
            setSemanticBridgeDiagnostic(undefined);
            semanticRuntime.reconcile(initialInteractions.bindings);
          } catch (error) {
            console.error('Failed to reconcile Tileflow semantic interactions', error);
            const diagnostic = createOverlayFailureDiagnostic(
              'Tileflow semantic interactions could not be reconciled.',
            );
            setSemanticBridgeDiagnostic(diagnostic);
            onInteractionDiagnosticRef.current?.(diagnostic);
          }
        }
        const controls = resolvedInteractive ? new maplibregl.NavigationControl() : null;

        if (controls) {
          map.addControl(controls, 'top-right');
        }

        const resizeObserver = new ResizeObserver(() => {
          map.resize();
        });

        registerCleanup(() => resizeObserver.disconnect());
        resizeObserver.observe(container);

        const lifecycle = attachTileflowMapLifecycle({
          getSession: () => {
            const analyticsForLoad = resolvedAnalyticsRef.current;

            return {
              analytics: analyticsForLoad,
              styleId:
                analyticsForLoad?.styleId ??
                (typeof initialRuntimeStyle.style === 'string'
                  ? initialRuntimeStyle.style
                  : mapNameRef.current),
            };
          },
          map,
          onLoad: (loadedMap) => {
            onLoadRef.current?.(loadedMap);
          },
          scheduler: {
            cancelFrame: (frame: number) => cancelAnimationFrame(frame),
            requestFrame: (callback) => requestAnimationFrame(callback),
          },
          sessionStarter,
          setState: setCaptureState,
          subscribe: (subscribedMap, event, listener) => {
            const subscription = subscribedMap.on(event, listener);
            return () => subscription.unsubscribe();
          },
        });
        registerCleanup(() => lifecycle.dispose());
        const latestRuntimeStyle = runtimeStyleRef.current;
        if (themeController && latestRuntimeStyle && latestRuntimeStyle !== initialRuntimeStyle) {
          setActiveRuntimeResource(latestRuntimeStyle);
          void themeController.setTheme(latestRuntimeStyle);
        }
      })
      .catch((error: unknown) => {
        try {
          disposeMap?.();
        } catch (cleanupError) {
          console.error('Failed to clean up the Tileflow map runtime', cleanupError);
        }
        if (!cancelled) {
          console.error('Failed to load the Tileflow map runtime', error);
          setCaptureState('error');
        }
      });

    return () => {
      cancelled = true;
      readinessRunRef.current += 1;
      disposeMap?.();
    };
  }, [resolvedInteractive, runtimeMapIdentity, runtimeStyleReady, stableMapOptions]);

  useEffect(() => {
    const controller = themeControllerRef.current;
    if (!controller) return;
    if (themeResolution.error) {
      void controller.setTheme(controller.getCurrent());
      return;
    }
    if (!runtimeStyle || controller.getCurrent() === runtimeStyle) return;
    setActiveRuntimeResource(runtimeStyle);
    void controller.setTheme(runtimeStyle).then((result) => {
      if (result.status === 'failed') {
        console.error('Failed to change the Tileflow map theme', result.error);
      }
    });
  }, [runtimeStyle, themeResolution.error]);

  useLayoutEffect(() => {
    if (!isImageMode) return;
    readinessRunRef.current += 1;
    setActiveRuntimeResource(runtimeImageUrl);
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
}

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
}>;

function TileflowAnnotationPortal<TAnnotation extends TileflowAnnotation>({
  onCommit,
  portalKey,
  readinessToken,
  renderMarker,
  renderPopup,
  renderTarget,
  renderTooltip,
}: TileflowAnnotationPortalProps<TAnnotation>) {
  useLayoutEffect(() => {
    onCommit(readinessToken, portalKey);
  }, [onCommit, portalKey, readinessToken]);

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

type TileflowReactMapLibrePositioned = ReturnType<typeof wrapMapLibrePositioned>;

function createTileflowMapLibrePoiMap(map: MapLibreMap): TileflowMapLibrePoiMap {
  return {
    getStyle: () => map.getStyle(),
    on(event, listener) {
      return map.on(event, listener);
    },
    queryRenderedFeatures(point, options) {
      return map.queryRenderedFeatures(point as PointLike, {
        layers: [...options.layers],
      }) as ReturnType<TileflowMapLibrePoiMap['queryRenderedFeatures']>;
    },
  };
}

function createOverlayFailureDiagnostic(message: string): TileflowInteractionDiagnostic {
  return {
    code: 'OVERLAY_FAILURE',
    level: 'error',
    message,
    path: '',
  };
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

function runTileflowReactCleanups(cleanups: readonly (() => void)[]): void {
  const errors: unknown[] = [];
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Tileflow React cleanup failed.');
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
