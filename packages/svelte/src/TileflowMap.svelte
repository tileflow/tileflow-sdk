<script lang="ts">
  import type {
    LngLatLike,
    Map as MapLibreMap,
    Marker as MapLibreMarker,
    PointLike,
    Popup as MapLibrePopup,
    StyleSpecification,
  } from 'maplibre-gl';
  import {createEventDispatcher, onMount, tick} from 'svelte';
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
    type TileflowRuntimeManifestMap,
  } from '@tileflow/core/runtime';
  import {
    attachTileflowFairUseNotice,
    attachTileflowMapLifecycle,
    createTileflowSessionStarter,
    createTileflowThemeController,
    createTileflowTransformRequest,
    getTileflowSystemColorScheme,
    loadTileflowStyleFonts,
    registerTileflowContourProtocol,
    registerTileflowPmtilesProtocol,
    registerTileflowWorldRequestBridge,
    subscribeTileflowSystemColorScheme,
    type TileflowFairUseNoticeController,
    type TileflowMapLifecycleAttachment,
    type TileflowThemeController,
    type TileflowWorldRequestBridge,
  } from '@tileflow/core/browser';
  import {
    initialTileflowInteractionState,
    tileflowInteractionStateSchema,
    validateTileflowAnnotations,
    validateTileflowInteractionBindings,
    type TileflowAnnotation,
    type TileflowAnnotationViewContext,
    type TileflowInteractionBinding,
    type TileflowInteractionContent,
    type TileflowInteractionDiagnostic,
    type TileflowInteractionDiagnosticCode,
    type TileflowInteractionState,
    type TileflowInteractionViewContext,
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
  import type {TileflowMapProps} from './index.js';
  import {loadTileflowMapLibre} from './maplibre.js';
  import {assertTileflowMapStyleInputs} from './style-source.js';

  export let alt: NonNullable<TileflowMapProps['alt']> = '';
  export let analytics: TileflowMapProps['analytics'] = undefined;
  export let annotations: TileflowMapProps['annotations'] = undefined;

  export let center: TileflowMapProps['center'] = undefined;
  export let captureId: TileflowMapProps['captureId'] = undefined;
  export let className: NonNullable<TileflowMapProps['className']> = '';
  export let defaultInteractionState: TileflowMapProps['defaultInteractionState'] = undefined;
  export let height: NonNullable<TileflowMapProps['height']> = 420;
  export let imageLoading: NonNullable<TileflowMapProps['imageLoading']> = 'eager';
  export let imageUrl: TileflowMapProps['imageUrl'] = undefined;
  export let interactive: TileflowMapProps['interactive'] = undefined;
  export let interactions: TileflowMapProps['interactions'] = undefined;
  export let interactionState: TileflowMapProps['interactionState'] = undefined;
  export let mapOptions: TileflowMapProps['mapOptions'] = undefined;
  export let marker: TileflowMapProps['marker'] = undefined;
  export let mode: NonNullable<TileflowMapProps['mode']> = 'interactive';
  export let onInteractionDiagnostic: TileflowMapProps['onInteractionDiagnostic'] = undefined;
  export let onInteractionEvent: TileflowMapProps['onInteractionEvent'] = undefined;
  export let onInteractionStateChange: TileflowMapProps['onInteractionStateChange'] = undefined;
  export let onThemeChange: TileflowMapProps['onThemeChange'] = undefined;
  export let popup: TileflowMapProps['popup'] = undefined;
  export let source: TileflowMapProps['source'];
  export let theme: TileflowMapProps['theme'] = undefined;
  export let tooltip: TileflowMapProps['tooltip'] = undefined;
  export let zoom: TileflowMapProps['zoom'] = undefined;

  let container: HTMLDivElement;
  let mapCaptureState: 'error' | 'idle' | 'loading' = 'loading';
  let imageSize: {height: number; width: number} | null = null;
  let imageResizeObserver: ResizeObserver | null = null;
  let mapInstance: MapLibreMap | null = null;
  let activeRuntimeResource: unknown = undefined;
  let mapFairUseNotice: TileflowFairUseNoticeController | null = null;
  let mapLifecycleAttachment: TileflowMapLifecycleAttachment | null = null;
  let annotationRuntime: TileflowMapLibreDomRuntime<TileflowAnnotation> | null = null;
  let annotationRuntimeDiagnosticsUnsubscribe: (() => void) | null = null;
  let annotationRuntimeEventsUnsubscribe: (() => void) | null = null;
  let annotationRuntimeTargetsUnsubscribe: (() => void) | null = null;
  let annotationRenderTargets: readonly TileflowMapLibreDomRenderTarget<TileflowAnnotation>[] = [];
  let annotationRuntimeCoordinatorDetach: (() => void) | null = null;
  let annotationRuntimeDiagnostics: readonly TileflowInteractionDiagnostic[] = [];
  let semanticRuntime: TileflowMapLibreSemanticDomRuntime | null = null;
  let semanticRuntimeCoordinatorDetach: (() => void) | null = null;
  let semanticRuntimeDiagnosticsUnsubscribe: (() => void) | null = null;
  let semanticRuntimeEventsUnsubscribe: (() => void) | null = null;
  let semanticRuntimeTargetsUnsubscribe: (() => void) | null = null;
  let semanticRenderTargets: readonly TileflowMapLibreSemanticDomRenderTarget[] = [];
  let semanticRuntimeDiagnostics: readonly TileflowInteractionDiagnostic[] = [];
  let initializeSemanticRuntime: (() => void) | null = null;
  let bridgeInteractionDiagnostics: Partial<
    Record<BridgeInteractionDiagnosticSource, TileflowInteractionDiagnostic>
  > = {};
  let activeInteractionDiagnosticKeys = new Set<string>();
  let interactionCaptureState: 'idle' | 'loading' = 'idle';
  let themeTransitionState: 'error' | 'idle' | 'loading' = 'idle';
  let effectiveInteractionCaptureState: 'error' | 'idle' | 'loading' = 'idle';
  let captureState: 'error' | 'idle' | 'loading' = 'loading';
  let hasInteractionErrors = false;
  let interactionReadinessRunId = 0;
  let interactionReadinessTargetKeys: readonly string[] = [];
  let hadInteractionErrors = false;
  let interactionRuntimesDisposing = false;
  let mapResizeObserver: ResizeObserver | null = null;
  let mapWorldRequestBridge: TileflowWorldRequestBridge | null = null;
  let themeController: TileflowThemeController | null = null;
  let systemColorScheme: 'dark' | 'light' = 'light';
  let unsubscribeSystemColorScheme: (() => void) | null = null;
  let loadedManifestMap: TileflowRuntimeManifestMap | null = null;
  let manifestMap: TileflowRuntimeManifestMap | null = null;
  let manifestLoadId = 0;
  let manifestResolutionKey = '';
  let manifestResolutionState: 'error' | 'loading' | 'not-needed' | 'ready' = 'loading';
  let mapLoadId = 0;
  let mounted = false;
  let refreshRunId = 0;
  let readinessRunId = 0;

  const dispatch = createEventDispatcher<{load: MapLibreMap}>();
  const controlledInteractionOwnership = interactionState !== undefined;
  const initialInteractionState =
    validateInteractionStateInput(interactionState, defaultInteractionState).length === 0
      ? (interactionState ?? defaultInteractionState ?? initialTileflowInteractionState)
      : initialTileflowInteractionState;
  const interactionCoordinator: TileflowMapLibreInteractionCoordinator =
    createTileflowMapLibreInteractionCoordinator({
      onInteractionStateChange(nextState) {
        if (interactionRuntimesDisposing) return;
        onInteractionStateChange?.(nextState);
      },
      ...(controlledInteractionOwnership
        ? {interactionState: initialInteractionState}
        : {defaultInteractionState: initialInteractionState}),
    });
  $: resolvedMode = resolveTileflowMapMode({mode});
  $: assertTileflowMapStyleInputs({source, theme});
  $: resolvedCaptureId = normalizeTileflowCaptureId(captureId);
  $: isImageMode = resolvedMode === 'image';
  $: mapName = source?.kind === 'tileflow' ? source.map : undefined;
  $: manifestUrl =
    source?.kind === 'tileflow'
      ? (source.manifestUrl ?? defaultTileflowManifestUrl)
      : defaultTileflowManifestUrl;
  $: shouldLoadManifest = shouldLoadTileflowManifest({
    source,
  });
  $: manifestRequestKey = shouldLoadManifest
    ? JSON.stringify([manifestUrl, mapName])
    : 'not-needed';
  $: currentManifestResolutionState =
    manifestResolutionKey === manifestRequestKey
      ? manifestResolutionState
      : shouldLoadManifest
        ? 'loading'
        : 'not-needed';
  $: manifestMap =
    manifestResolutionKey === manifestRequestKey && manifestResolutionState === 'ready'
      ? loadedManifestMap
      : null;
  $: themeResolution = resolveThemeSelection({
    colorScheme: systemColorScheme,
    manifestMap,
    source,
    theme,
  });
  $: resolvedThemeName = themeResolution.name;
  $: manifestView = resolveTileflowRuntimeView({manifestMap});
  $: manifestCenter = normalizeTileflowRuntimeCenter(manifestView.center);
  $: imageCenter = normalizeTileflowRuntimeCenter(center ?? mapOptions?.center, manifestCenter);
  $: imageZoom = zoom ?? mapOptions?.zoom ?? manifestView.zoom ?? defaultTileflowRuntimeView.zoom;
  $: resolvedCenter = center ?? mapOptions?.center ?? manifestCenter;
  $: resolvedZoom =
    zoom ?? mapOptions?.zoom ?? manifestView.zoom ?? defaultTileflowRuntimeView.zoom;
  $: resolvedBearing = mapOptions?.bearing ?? manifestView.bearing;
  $: resolvedPitch = mapOptions?.pitch ?? manifestView.pitch;
  $: resolvedInteractive = interactive ?? mapOptions?.interactive ?? true;
  $: runtimeStyle =
    isImageMode || themeResolution.error
      ? null
      : resolveTileflowRuntimeStyle({
          colorScheme: systemColorScheme,
          manifestMap,
          source,
          theme: themeResolution.name,
        });
  $: resolvedAnalytics = mergeTileflowAnalytics(analytics, runtimeStyle?.analytics);
  $: runtimeImageUrl =
    imageUrl ??
    (isImageMode && !themeResolution.error
      ? resolveTileflowStaticImageUrl({
          center: imageCenter,
          colorScheme: systemColorScheme,
          imageSize,
          manifestMap,
          theme: themeResolution.name,
          zoom: imageZoom,
        })
      : undefined);
  $: runtimeResolutionState = resolveRuntimeResolutionState({
    currentManifestResolutionState,
    imageSize,
    imageUrl,
    isImageMode,
    runtimeImageUrl,
    runtimeStyle,
    shouldLoadManifest,
    themeResolutionError: themeResolution.error,
  });
  $: currentMapCaptureState =
    activeRuntimeResource === (isImageMode ? runtimeImageUrl : runtimeStyle)
      ? mapCaptureState
      : 'loading';
  $: frameStyle = `height: ${formatHeight(height)}; min-height: 240px; overflow: hidden; position: relative; width: 100%;`;
  $: annotationResolution = resolveAnnotationInput(annotations);
  $: interactionBindingResolution = resolveInteractionBindingInput(interactions);
  $: interactionStateDiagnostics = validateInteractionStateInput(
    interactionState,
    defaultInteractionState,
  );
  $: hasInteractionConfiguration =
    annotations !== undefined ||
    interactions !== undefined ||
    interactionState !== undefined ||
    defaultInteractionState !== undefined ||
    onInteractionDiagnostic !== undefined ||
    onInteractionEvent !== undefined ||
    onInteractionStateChange !== undefined ||
    marker !== undefined ||
    tooltip !== undefined ||
    popup !== undefined;
  $: declarativeInteractionDiagnostics = [
    ...annotationResolution.diagnostics,
    ...interactionBindingResolution.diagnostics,
    ...interactionStateDiagnostics,
    ...(isImageMode && hasInteractionConfiguration
      ? [
          createInteractionDiagnostic(
            'UNSUPPORTED_MODE',
            'Annotations, semantic interactions, and interaction state are unavailable in image mode.',
          ),
        ]
      : []),
  ];
  $: interactionDiagnostics = [
    ...declarativeInteractionDiagnostics,
    ...annotationRuntimeDiagnostics,
    ...semanticRuntimeDiagnostics,
    ...Object.values(bridgeInteractionDiagnostics),
  ];
  $: hasInteractionErrors = interactionDiagnostics.some(({level}) => level === 'error');
  $: effectiveInteractionCaptureState = hasInteractionErrors ? 'error' : interactionCaptureState;
  $: captureState = combineCaptureStates(
    combineCaptureStates(
      combineCaptureStates(currentMapCaptureState, effectiveInteractionCaptureState),
      runtimeResolutionState,
    ),
    themeTransitionState,
  );
  $: if (mounted && hasInteractionErrors !== hadInteractionErrors) {
    handleInteractionErrorState(hasInteractionErrors);
  }
  $: if (mounted) publishNewInteractionDiagnostics(interactionDiagnostics);

  $: if (mounted) {
    imageUrl;
    interactive;
    mapOptions;
    mode;
    source;
    void refresh();
  }

  $: if (mounted) {
    theme;
    syncSystemColorSchemeSubscription();
  }

  $: if (mounted) {
    runtimeStyle;
    void switchTheme();
  }

  $: if (mounted) {
    center;
    manifestMap;
    zoom;
    mapOptions?.bearing;
    mapOptions?.center;
    mapOptions?.pitch;
    mapOptions?.zoom;
    syncView();
  }

  $: if (mounted) {
    annotations;
    syncAnnotations();
  }

  $: if (mounted) {
    interactions;
    syncSemanticInteractions();
  }

  $: if (mounted) {
    defaultInteractionState;
    interactionState;
    interactionStateDiagnostics;
    syncInteractionState();
  }

  $: if (mounted) {
    marker;
    popup;
    tooltip;
    syncCustomRenderers();
  }

  $: if (mounted && isImageMode) {
    runtimeImageUrl;
    void markImageLoading();
  }

  onMount(() => {
    mounted = true;
    syncSystemColorSchemeSubscription();

    return () => {
      mounted = false;
      refreshRunId += 1;
      manifestLoadId += 1;
      unsubscribeSystemColorScheme?.();
      imageResizeObserver?.disconnect();
      try {
        destroyMap();
      } finally {
        interactionCoordinator.dispose();
      }
    };
  });

  async function refresh() {
    const runId = ++refreshRunId;
    await refreshManifest();

    if (!mounted || runId !== refreshRunId) {
      return;
    }
    updateImageResizeObserver();
    await recreateMap(runId);
  }

  async function refreshManifest() {
    const shouldLoad = shouldLoadManifest;
    const requestKey = manifestRequestKey;

    if (!shouldLoad) {
      manifestLoadId += 1;
      loadedManifestMap = null;
      manifestResolutionKey = requestKey;
      manifestResolutionState = 'not-needed';
      return;
    }

    const loadId = ++manifestLoadId;
    loadedManifestMap = null;
    manifestResolutionKey = requestKey;
    manifestResolutionState = 'loading';

    try {
      const manifest = await loadTileflowManifest(manifestUrl);

      if (mounted && loadId === manifestLoadId) {
        const resolvedMap =
          manifest && mapName ? resolveTileflowManifestMap(manifest, mapName) : null;
        loadedManifestMap = resolvedMap;
        manifestResolutionState = resolvedMap ? 'ready' : 'error';
      }
    } catch (error) {
      if (mounted && loadId === manifestLoadId) {
        console.error('Failed to load Tileflow manifest', error);
        loadedManifestMap = null;
        manifestResolutionState = 'error';
      }
    }
  }

  function updateImageResizeObserver() {
    imageResizeObserver?.disconnect();
    imageResizeObserver = null;
    imageSize = null;

    if (!isImageMode || imageUrl || !container) {
      return;
    }

    const updateImageSize = () => {
      imageSize = normalizeTileflowStaticImageSize({
        height: container.clientHeight,
        width: container.clientWidth,
      });
    };

    imageResizeObserver = new ResizeObserver(updateImageSize);
    imageResizeObserver.observe(container);
    updateImageSize();
  }

  function destroyMap() {
    mapLoadId += 1;
    readinessRunId += 1;
    const lifecycleAttachment = mapLifecycleAttachment;
    const fairUseNotice = mapFairUseNotice;
    const annotationInteractionsForMap = annotationRuntime;
    const semanticInteractionsForMap = semanticRuntime;
    const detachAnnotationCoordinator = annotationRuntimeCoordinatorDetach;
    const detachSemanticCoordinator = semanticRuntimeCoordinatorDetach;
    const unsubscribeAnnotationDiagnostics = annotationRuntimeDiagnosticsUnsubscribe;
    const unsubscribeAnnotationEvents = annotationRuntimeEventsUnsubscribe;
    const unsubscribeAnnotationTargets = annotationRuntimeTargetsUnsubscribe;
    const unsubscribeSemanticDiagnostics = semanticRuntimeDiagnosticsUnsubscribe;
    const unsubscribeSemanticEvents = semanticRuntimeEventsUnsubscribe;
    const unsubscribeSemanticTargets = semanticRuntimeTargetsUnsubscribe;
    const currentMap = mapInstance;
    const currentThemeController = themeController;
    const worldRequestBridge = mapWorldRequestBridge;
    interactionRuntimesDisposing = true;
    mapFairUseNotice = null;
    mapLifecycleAttachment = null;
    mapInstance = null;
    annotationRuntime = null;
    annotationRuntimeCoordinatorDetach = null;
    annotationRuntimeDiagnosticsUnsubscribe = null;
    annotationRuntimeEventsUnsubscribe = null;
    annotationRuntimeTargetsUnsubscribe = null;
    semanticRuntime = null;
    semanticRuntimeCoordinatorDetach = null;
    semanticRuntimeDiagnosticsUnsubscribe = null;
    semanticRuntimeEventsUnsubscribe = null;
    semanticRuntimeTargetsUnsubscribe = null;
    initializeSemanticRuntime = null;
    annotationRenderTargets = [];
    semanticRenderTargets = [];
    interactionReadinessTargetKeys = [];
    interactionReadinessRunId += 1;
    interactionCaptureState = 'idle';
    annotationRuntimeDiagnostics = [];
    semanticRuntimeDiagnostics = [];
    bridgeInteractionDiagnostics = {};
    mapWorldRequestBridge = null;
    themeController = null;
    mapResizeObserver?.disconnect();
    mapResizeObserver = null;

    const errors: unknown[] = [];
    const cleanupSteps = [
      unsubscribeAnnotationTargets,
      unsubscribeAnnotationDiagnostics,
      unsubscribeAnnotationEvents,
      unsubscribeSemanticTargets,
      unsubscribeSemanticDiagnostics,
      unsubscribeSemanticEvents,
      detachAnnotationCoordinator,
      detachSemanticCoordinator,
      () => semanticInteractionsForMap?.dispose(),
      () => annotationInteractionsForMap?.dispose(),
      () => lifecycleAttachment?.dispose(),
      () => currentThemeController?.dispose(),
      () => worldRequestBridge?.dispose(),
      () => fairUseNotice?.dispose(),
      () => currentMap?.remove(),
    ];

    for (const cleanup of cleanupSteps) {
      if (!cleanup) continue;
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    interactionRuntimesDisposing = false;
    if (errors.length > 0) {
      console.error(
        'Failed to fully dispose the Tileflow map runtime',
        errors.length === 1 ? errors[0] : new AggregateError(errors),
      );
    }
  }

  async function recreateMap(runId: number) {
    destroyMap();
    mapCaptureState = 'loading';
    themeTransitionState = 'idle';

    if (isImageMode) {
      await markImageLoading();
      return;
    }

    activeRuntimeResource = runtimeStyle;
    if (!container || !runtimeStyle) {
      return;
    }

    const loadId = mapLoadId;
    const targetContainer = container;
    const runtime = runtimeStyle;
    let maplibregl: Awaited<ReturnType<typeof loadTileflowMapLibre>>;

    try {
      [maplibregl] = await Promise.all([
        loadTileflowMapLibre(),
        loadTileflowStyleFonts(runtime.style, {fontFaces: runtime.fontFaces}),
      ]);
    } catch (error) {
      if (mounted && runId === refreshRunId && loadId === mapLoadId) {
        console.error('Failed to load the Tileflow map runtime', error);
        mapCaptureState = 'error';
      }
      return;
    }

    if (
      !mounted ||
      runId !== refreshRunId ||
      loadId !== mapLoadId ||
      container !== targetContainer ||
      isImageMode
    ) {
      return;
    }

    const session = createTileflowSessionController({source: 'svelte'});
    const sessionStarter = createTileflowSessionStarter({
      getSessionId: () => session.sessionId,
      sessionId: session.sessionId,
      source: 'svelte',
    });
    mapFairUseNotice = attachTileflowFairUseNotice(targetContainer);
    registerTileflowContourProtocol({addProtocol: maplibregl.addProtocol});
    registerTileflowPmtilesProtocol({addProtocol: maplibregl.addProtocol});
    mapWorldRequestBridge = registerTileflowWorldRequestBridge({
      addProtocol: maplibregl.addProtocol,
      onNotice: mapFairUseNotice.update,
    });
    const maplibreMap = new maplibregl.Map({
      ...mapOptions,
      attributionControl: mapOptions?.attributionControl ?? {compact: true},
      bearing: resolvedBearing,
      center: resolvedCenter as LngLatLike,
      container: targetContainer,
      interactive: resolvedInteractive,
      pitch: resolvedPitch,
      style: runtime.style as StyleSpecification | string,
      transformRequest: createTileflowTransformRequest({
        always: true,
        asyncAnalyticsTiming: 'request',
        getAnalytics: () => resolvedAnalytics,
        sessionController: session,
        sessionId: session.sessionId,
        transformRequest: mapOptions?.transformRequest ?? undefined,
        worldRequestBridge: mapWorldRequestBridge,
      }),
      zoom: resolvedZoom,
    });

    mapInstance = maplibreMap;
    themeController =
      runtime.theme === undefined
        ? null
        : createTileflowThemeController({
            initial: runtime,
            map: maplibreMap,
            onTransition(transition) {
              onThemeChange?.(transition);
              if (transition.phase === 'preloading' || transition.phase === 'applying') {
                themeTransitionState = 'loading';
              } else if (transition.phase === 'error') {
                themeTransitionState = 'error';
              } else {
                themeTransitionState = 'idle';
              }
            },
          });

    setBridgeInteractionDiagnostic('annotation-runtime', null);
    try {
      const annotationInteractionsForMap = createTileflowMapLibreDomRuntime<
        MapLibreMap,
        MapLibreMarker,
        MapLibrePopup,
        TileflowAnnotation
      >({
        createMarker({annotation, element}) {
          element.title = annotation.ariaLabel;
          return new maplibregl.Marker({element});
        },
        createOverlay({container: overlayContainer, kind}) {
          return new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            closeOnMove: false,
            focusAfterOpen: false,
            offset: kind === 'popup' ? 24 : 18,
          }).setDOMContent(overlayContainer);
        },
        customMarker: marker !== undefined,
        customPopup: popup !== undefined,
        customTooltip: tooltip !== undefined,
        document: targetContainer.ownerDocument,
        interactionState: interactionCoordinator.getInteractionState(),
        map: maplibreMap,
        onInteractionStateChange: interactionCoordinator.requestInteractionState,
        updateMarker(_markerInstance, {annotation, element}) {
          element.title = annotation.ariaLabel;
        },
      });
      annotationRuntime = annotationInteractionsForMap;
      annotationRuntimeCoordinatorDetach = interactionCoordinator.attach(
        'annotation',
        annotationInteractionsForMap,
      );
      annotationRuntimeDiagnosticsUnsubscribe = annotationInteractionsForMap.subscribeDiagnostics(
        (diagnostics) => {
          annotationRuntimeDiagnostics = diagnostics;
        },
      );
      annotationRuntimeEventsUnsubscribe = annotationInteractionsForMap.subscribeEvents((event) => {
        if (!interactionRuntimesDisposing) onInteractionEvent?.(event);
      });
      annotationRuntimeTargetsUnsubscribe = annotationInteractionsForMap.subscribeRenderTargets(
        (targets) => {
          syncAnnotationRenderTargets(targets);
        },
      );
      annotationRuntimeDiagnostics = annotationInteractionsForMap.getDiagnostics();
      syncAnnotationRenderTargets(annotationInteractionsForMap.getRenderTargets());
      syncAnnotations();
    } catch (error) {
      console.error('Failed to initialize Tileflow annotations', error);
      setBridgeInteractionDiagnostic(
        'annotation-runtime',
        'Unable to initialize the Tileflow annotation runtime.',
      );
    }

    initializeSemanticRuntime = () => {
      if (semanticRuntime || interactionRuntimesDisposing || mapInstance !== maplibreMap) return;
      const browserWindow = targetContainer.ownerDocument.defaultView;
      if (!browserWindow) {
        setBridgeInteractionDiagnostic(
          'semantic-runtime',
          'Semantic interactions require a browser document.',
        );
        return;
      }

      setBridgeInteractionDiagnostic('semantic-runtime', null);
      try {
        const semanticInteractionsForMap = createTileflowMapLibreSemanticDomRuntime<
          MapLibreMap,
          MapLibrePopup
        >({
          cancelFrame: (frame) => browserWindow.cancelAnimationFrame(frame),
          createOverlay({container: overlayContainer, kind}) {
            return new maplibregl.Popup({
              closeButton: false,
              closeOnClick: false,
              closeOnMove: false,
              focusAfterOpen: false,
              offset: kind === 'popup' ? 24 : 18,
            }).setDOMContent(overlayContainer);
          },
          customPopup: popup !== undefined,
          customTooltip: tooltip !== undefined,
          document: targetContainer.ownerDocument,
          interactionState: interactionCoordinator.getInteractionState(),
          map: maplibreMap,
          onInteractionStateChange: interactionCoordinator.requestInteractionState,
          poiMap: createTileflowMapLibrePoiMap(maplibreMap),
          requestFrame: (callback) => browserWindow.requestAnimationFrame(() => callback()),
        });
        semanticRuntime = semanticInteractionsForMap;
        semanticRuntimeCoordinatorDetach = interactionCoordinator.attach(
          'semantic',
          semanticInteractionsForMap,
        );
        semanticRuntimeDiagnosticsUnsubscribe = semanticInteractionsForMap.subscribeDiagnostics(
          (diagnostics) => {
            semanticRuntimeDiagnostics = diagnostics;
          },
        );
        semanticRuntimeEventsUnsubscribe = semanticInteractionsForMap.subscribeEvents((event) => {
          if (!interactionRuntimesDisposing) onInteractionEvent?.(event);
        });
        semanticRuntimeTargetsUnsubscribe = semanticInteractionsForMap.subscribeRenderTargets(
          (targets) => {
            syncSemanticRenderTargets(targets);
          },
        );
        semanticRuntimeDiagnostics = semanticInteractionsForMap.getDiagnostics();
        syncSemanticRenderTargets(semanticInteractionsForMap.getRenderTargets());
      } catch (error) {
        console.error('Failed to initialize Tileflow semantic interactions', error);
        setBridgeInteractionDiagnostic(
          'semantic-runtime',
          'Unable to initialize the Tileflow semantic interaction runtime.',
        );
      }
    };
    syncSemanticInteractions();

    if (resolvedInteractive) {
      maplibreMap.addControl(new maplibregl.NavigationControl(), 'top-right');
    }

    mapResizeObserver = new ResizeObserver(() => {
      maplibreMap.resize();
    });
    mapResizeObserver.observe(targetContainer);

    mapLifecycleAttachment = attachTileflowMapLifecycle<MapLibreMap, number>({
      getSession: () => {
        const analyticsForLoad = resolvedAnalytics;
        return {
          analytics: analyticsForLoad,
          styleId:
            analyticsForLoad?.styleId ??
            (typeof runtime.style === 'string' ? runtime.style : mapName),
        };
      },
      map: maplibreMap,
      onLoad: () => dispatch('load', maplibreMap),
      scheduler: {
        cancelFrame: (frame) => cancelAnimationFrame(frame),
        requestFrame: (callback) => requestAnimationFrame(callback),
      },
      sessionStarter,
      setState: (state) => {
        mapCaptureState = state;
      },
      subscribe: (targetMap, event, listener) => {
        const subscription = targetMap.on(event, listener);
        return () => subscription.unsubscribe();
      },
    });
    if (themeController && runtimeStyle && runtimeStyle !== runtime) {
      activeRuntimeResource = runtimeStyle;
      void themeController.setTheme(runtimeStyle);
    }
  }

  async function switchTheme() {
    if (!themeController) return;
    if (themeResolution.error) {
      await themeController.setTheme(themeController.getCurrent());
      return;
    }
    const next = runtimeStyle;
    if (!next) return;
    activeRuntimeResource = next;
    const result = await themeController.setTheme(next);
    if (result.status === 'failed') {
      console.error('Failed to change the Tileflow map theme', result.error);
    }
  }

  function syncSystemColorSchemeSubscription() {
    unsubscribeSystemColorScheme?.();
    unsubscribeSystemColorScheme = null;
    if (theme !== 'system') return;
    systemColorScheme = getTileflowSystemColorScheme();
    unsubscribeSystemColorScheme = subscribeTileflowSystemColorScheme((scheme) => {
      systemColorScheme = scheme;
    });
  }

  function syncView() {
    mapInstance?.jumpTo({
      bearing: resolvedBearing,
      center: resolvedCenter as LngLatLike,
      pitch: resolvedPitch,
      zoom: resolvedZoom,
    });
  }

  function syncAnnotations() {
    if (!annotationRuntime) return;

    try {
      annotationRuntime.reconcile(
        annotationResolution.ok && !isImageMode ? annotationResolution.annotations : [],
      );
      void settleInteractionReadiness();
      setBridgeInteractionDiagnostic('annotation-runtime', null);
    } catch (error) {
      console.error('Failed to reconcile Tileflow annotations', error);
      setBridgeInteractionDiagnostic(
        'annotation-runtime',
        'Unable to reconcile the Tileflow annotation runtime.',
      );
    }
  }

  function syncSemanticInteractions() {
    const bindings =
      interactionBindingResolution.ok && !isImageMode ? interactionBindingResolution.bindings : [];
    if (bindings.length > 0 && !semanticRuntime) initializeSemanticRuntime?.();
    if (!semanticRuntime) return;

    try {
      semanticRuntime.reconcile(bindings);
      void settleInteractionReadiness();
      setBridgeInteractionDiagnostic('semantic-runtime', null);
    } catch (error) {
      console.error('Failed to reconcile Tileflow semantic interactions', error);
      setBridgeInteractionDiagnostic(
        'semantic-runtime',
        'Unable to reconcile the Tileflow semantic interaction runtime.',
      );
    }
  }

  function syncInteractionState() {
    if (
      !controlledInteractionOwnership ||
      interactionState === undefined ||
      interactionStateDiagnostics.length > 0
    ) {
      return;
    }
    try {
      interactionCoordinator.setInteractionState(interactionState);
      setBridgeInteractionDiagnostic('state', null);
    } catch (error) {
      console.error('Failed to synchronize Tileflow interaction state', error);
      setBridgeInteractionDiagnostic('state', 'Unable to synchronize Tileflow interaction state.');
    }
  }

  function syncCustomRenderers() {
    if (!annotationRuntime && !semanticRuntime) return;
    try {
      annotationRuntime?.setCustomRenderers({
        marker: marker !== undefined,
        popup: popup !== undefined,
        tooltip: tooltip !== undefined,
      });
      semanticRuntime?.setCustomRenderers({
        popup: popup !== undefined,
        tooltip: tooltip !== undefined,
      });
      void settleInteractionReadiness();
      setBridgeInteractionDiagnostic('renderers', null);
    } catch (error) {
      console.error('Failed to synchronize Tileflow interaction snippets', error);
      setBridgeInteractionDiagnostic(
        'renderers',
        'Unable to synchronize Tileflow interaction snippets.',
      );
    }
  }

  async function handleImageLoad(event: Event) {
    await markImageReady(event.currentTarget as HTMLImageElement);
  }

  async function markImageReady(image: HTMLImageElement) {
    const runId = ++readinessRunId;
    try {
      if (typeof image.decode === 'function') await image.decode();
    } catch {
      if (!image.complete || image.naturalWidth === 0) {
        if (runId === readinessRunId) mapCaptureState = 'error';
        return;
      }
    }
    if (runId === readinessRunId) mapCaptureState = 'idle';
  }

  async function markImageLoading() {
    const runId = ++readinessRunId;
    activeRuntimeResource = runtimeImageUrl;
    mapCaptureState = hasInteractionConfiguration ? 'error' : 'loading';
    if (hasInteractionConfiguration) return;
    await tick();
    if (!mounted || runId !== readinessRunId) return;
    const image = container?.querySelector('img');
    if (!image?.complete) return;
    if (image.naturalWidth === 0) {
      mapCaptureState = 'error';
      return;
    }
    await markImageReady(image);
  }

  function handleImageError() {
    readinessRunId += 1;
    mapCaptureState = 'error';
  }

  type AnnotationResolution = Readonly<{
    annotations: readonly TileflowAnnotation[];
    diagnostics: readonly TileflowInteractionDiagnostic[];
    ok: boolean;
  }>;

  type InteractionBindingResolution = Readonly<{
    bindings: readonly TileflowInteractionBinding[];
    diagnostics: readonly TileflowInteractionDiagnostic[];
    ok: boolean;
  }>;

  function resolveAnnotationInput(
    nextAnnotations: readonly TileflowAnnotation[] | undefined,
  ): AnnotationResolution {
    const candidates = nextAnnotations ?? [];
    const validation = validateTileflowAnnotations(candidates);
    if (!validation.ok) {
      return {
        annotations: [],
        diagnostics: validation.diagnostics,
        ok: false,
      };
    }

    return {annotations: candidates, diagnostics: [], ok: true};
  }

  function resolveInteractionBindingInput(
    nextInteractions: readonly TileflowInteractionBinding[] | undefined,
  ): InteractionBindingResolution {
    const candidates = nextInteractions ?? [];
    const validation = validateTileflowInteractionBindings(candidates);
    if (!validation.ok) {
      return {bindings: [], diagnostics: validation.diagnostics, ok: false};
    }
    return {bindings: candidates, diagnostics: [], ok: true};
  }

  function validateInteractionStateInput(
    controlledState: TileflowInteractionState | undefined,
    defaultState: TileflowInteractionState | undefined,
  ): readonly TileflowInteractionDiagnostic[] {
    if (controlledState !== undefined && defaultState !== undefined) {
      return [
        createInteractionDiagnostic(
          'INVALID_DOCUMENT',
          'interactionState and defaultInteractionState are mutually exclusive.',
        ),
      ];
    }

    if ((controlledState !== undefined) !== controlledInteractionOwnership) {
      return [
        createInteractionDiagnostic(
          'INVALID_DOCUMENT',
          'Tileflow interaction state ownership cannot switch between controlled and uncontrolled.',
        ),
      ];
    }

    const candidate = controlledState ?? defaultState;
    if (candidate === undefined) return [];
    const parsed = tileflowInteractionStateSchema.safeParse(candidate);
    if (parsed.success) return [];
    const root = controlledState === undefined ? '/defaultInteractionState' : '/interactionState';
    return parsed.error.issues.map((issue) =>
      createInteractionDiagnostic(
        'INVALID_DOCUMENT',
        issue.message,
        `${root}${jsonPointer(issue.path)}`,
      ),
    );
  }

  function createInteractionDiagnostic(
    code: TileflowInteractionDiagnosticCode,
    message: string,
    path?: string,
  ): TileflowInteractionDiagnostic {
    return {
      code,
      level: 'error',
      message,
      ...(path === undefined ? {} : {path}),
    };
  }

  type BridgeInteractionDiagnosticSource =
    | 'annotation-runtime'
    | 'portal'
    | 'renderers'
    | 'semantic-runtime'
    | 'state';

  function setBridgeInteractionDiagnostic(
    source: BridgeInteractionDiagnosticSource,
    message: string | null,
  ) {
    const current = bridgeInteractionDiagnostics[source];
    if (message === null ? current === undefined : current?.message === message) return;
    const next = {...bridgeInteractionDiagnostics};
    if (message === null) delete next[source];
    else next[source] = createInteractionDiagnostic('OVERLAY_FAILURE', message);
    bridgeInteractionDiagnostics = next;
  }

  function publishNewInteractionDiagnostics(diagnostics: readonly TileflowInteractionDiagnostic[]) {
    const nextKeys = new Set(diagnostics.map(interactionDiagnosticKey));
    for (const diagnostic of diagnostics) {
      if (!activeInteractionDiagnosticKeys.has(interactionDiagnosticKey(diagnostic))) {
        onInteractionDiagnostic?.(diagnostic);
      }
    }
    activeInteractionDiagnosticKeys = nextKeys;
  }

  function syncAnnotationRenderTargets(
    targets: readonly TileflowMapLibreDomRenderTarget<TileflowAnnotation>[],
  ) {
    annotationRenderTargets = targets;
    syncInteractionRenderTargetReadiness();
  }

  function syncSemanticRenderTargets(targets: readonly TileflowMapLibreSemanticDomRenderTarget[]) {
    semanticRenderTargets = targets;
    syncInteractionRenderTargetReadiness();
  }

  function syncInteractionRenderTargetReadiness() {
    const nextKeys = [
      ...annotationRenderTargets.map(({key}) => `annotation:${key}`),
      ...semanticRenderTargets.map(({key}) => `semantic:${key}`),
    ];
    if (
      nextKeys.length === interactionReadinessTargetKeys.length &&
      nextKeys.every((key, index) => key === interactionReadinessTargetKeys[index])
    ) {
      return;
    }
    interactionReadinessTargetKeys = nextKeys;
    void settleInteractionReadiness();
  }

  async function settleInteractionReadiness() {
    const runId = ++interactionReadinessRunId;
    if (!mounted || hasInteractionErrors) return;
    interactionCaptureState = 'loading';
    await tick();
    if (!mounted || runId !== interactionReadinessRunId || hasInteractionErrors) return;
    await nextAnimationFrame();
    if (!mounted || runId !== interactionReadinessRunId || hasInteractionErrors) return;
    await nextAnimationFrame();
    if (!mounted || runId !== interactionReadinessRunId || hasInteractionErrors) return;
    interactionCaptureState = 'idle';
  }

  function handleInteractionErrorState(hasErrors: boolean) {
    hadInteractionErrors = hasErrors;
    interactionReadinessRunId += 1;
    if (!hasErrors) void settleInteractionReadiness();
  }

  function nextAnimationFrame(): Promise<void> {
    const view = container?.ownerDocument.defaultView;
    if (!view) return Promise.resolve();
    return new Promise((resolve) => view.requestAnimationFrame(() => resolve()));
  }

  function combineCaptureStates(
    mapState: 'error' | 'idle' | 'loading',
    interactionStateForCapture: 'error' | 'idle' | 'loading',
  ): 'error' | 'idle' | 'loading' {
    if (mapState === 'error' || interactionStateForCapture === 'error') return 'error';
    return mapState === 'idle' && interactionStateForCapture === 'idle' ? 'idle' : 'loading';
  }

  function interactionDiagnosticKey(diagnostic: TileflowInteractionDiagnostic): string {
    return JSON.stringify([
      diagnostic.code,
      diagnostic.message,
      diagnostic.path,
      diagnostic.target,
    ]);
  }

  function jsonPointer(path: readonly PropertyKey[]): string {
    return path
      .map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1'))
      .map((segment) => `/${segment}`)
      .join('');
  }

  function portal(node: HTMLElement, target: HTMLElement) {
    let currentTarget = target;
    const move = (nextTarget: HTMLElement) => {
      currentTarget = nextTarget;
      currentTarget.append(node);
      setBridgeInteractionDiagnostic('portal', null);
    };

    try {
      move(target);
    } catch (error) {
      console.error('Failed to mount a Tileflow interaction snippet', error);
      setBridgeInteractionDiagnostic('portal', 'Unable to mount a Tileflow interaction snippet.');
    }

    return {
      destroy() {
        node.remove();
      },
      update(nextTarget: HTMLElement) {
        if (nextTarget === currentTarget) return;
        try {
          move(nextTarget);
        } catch (error) {
          console.error('Failed to move a Tileflow interaction snippet', error);
          setBridgeInteractionDiagnostic(
            'portal',
            'Unable to mount a Tileflow interaction snippet.',
          );
        }
      },
    };
  }

  function createAnnotationViewContext(
    renderTarget: TileflowMapLibreDomRenderTarget<TileflowAnnotation>,
  ): TileflowAnnotationViewContext {
    const content = getRenderTargetContent(renderTarget);
    return {
      annotation: renderTarget.annotation,
      close: renderTarget.close,
      content,
      target: {
        annotation: renderTarget.annotation,
        coordinate: renderTarget.annotation.coordinate,
        kind: 'annotation',
      },
      viewName: content?.kind === 'view' ? content.name : undefined,
    };
  }

  function getRenderTargetContent(
    renderTarget: TileflowMapLibreDomRenderTarget<TileflowAnnotation>,
  ): TileflowInteractionContent | undefined {
    switch (renderTarget.kind) {
      case 'marker':
        return renderTarget.annotation.marker?.content;
      case 'popup':
        return renderTarget.annotation.popup?.content;
      case 'tooltip':
        return renderTarget.annotation.tooltip?.content;
    }
  }

  function createSemanticViewContext(
    renderTarget: TileflowMapLibreSemanticDomRenderTarget,
  ): TileflowInteractionViewContext {
    return {
      close: renderTarget.close,
      content: renderTarget.content,
      target: renderTarget.target,
      viewName: renderTarget.viewName,
    };
  }

  function createTileflowMapLibrePoiMap(map: MapLibreMap): TileflowMapLibrePoiMap {
    return {
      getStyle: () => map.getStyle(),
      on: (event, listener) => map.on(event, listener),
      queryRenderedFeatures(point, options) {
        return map
          .queryRenderedFeatures(point as PointLike, {layers: [...options.layers]})
          .map((feature) => ({
            ...(feature.id === undefined ? {} : {id: feature.id}),
            layer: {id: feature.layer.id},
            ...(feature.properties === null ? {} : {properties: feature.properties}),
            ...(feature.source === undefined ? {} : {source: feature.source}),
            ...(feature.sourceLayer === undefined ? {} : {sourceLayer: feature.sourceLayer}),
          }));
      },
    };
  }

  function formatHeight(value: number | string): string {
    return typeof value === 'number' ? `${value}px` : value;
  }

  function resolveThemeSelection(input: {
    colorScheme: 'dark' | 'light';
    manifestMap: TileflowRuntimeManifestMap | null;
    source: TileflowMapProps['source'];
    theme: TileflowMapProps['theme'];
  }): Readonly<{error: boolean; name: string | undefined}> {
    if (!input.manifestMap || input.source.kind !== 'tileflow') {
      return {
        error: false,
        name:
          input.source.kind === 'tileflow' && input.theme && input.theme !== 'system'
            ? input.theme
            : undefined,
      };
    }

    try {
      return {
        error: false,
        name: resolveTileflowRuntimeTheme(input.manifestMap, input.theme, input.colorScheme).name,
      };
    } catch {
      return {error: true, name: undefined};
    }
  }

  function resolveRuntimeResolutionState(input: {
    currentManifestResolutionState: 'error' | 'loading' | 'not-needed' | 'ready';
    imageSize: {height: number; width: number} | null;
    imageUrl: string | undefined;
    isImageMode: boolean;
    runtimeImageUrl: string | undefined;
    runtimeStyle: ReturnType<typeof resolveTileflowRuntimeStyle>;
    shouldLoadManifest: boolean;
    themeResolutionError: boolean;
  }): 'error' | 'idle' | 'loading' {
    if (input.shouldLoadManifest && input.currentManifestResolutionState !== 'ready') {
      return input.currentManifestResolutionState === 'error' ? 'error' : 'loading';
    }
    if (input.themeResolutionError) return 'error';
    if (input.isImageMode) {
      if (input.runtimeImageUrl) return 'idle';
      return input.imageUrl === undefined && input.imageSize === null ? 'loading' : 'error';
    }
    return input.runtimeStyle ? 'idle' : 'error';
  }
</script>

<div
  bind:this={container}
  class={className}
  data-tileflow-capture-id={resolvedCaptureId}
  data-tileflow-map={mapName}
  data-tileflow-theme={resolvedThemeName}
  data-tileflow-state={captureState}
  style={frameStyle}
>
  {#if isImageMode && runtimeImageUrl}
    <img
      {alt}
      decoding="async"
      loading={imageLoading}
      on:error={handleImageError}
      on:load={handleImageLoad}
      src={runtimeImageUrl}
      style="display: block; height: 100%; object-fit: cover; width: 100%;"
    />
  {/if}
  {#each annotationRenderTargets as renderTarget (renderTarget.key)}
    {#if renderTarget.kind === 'marker' && marker}
      <div style="display: contents;" use:portal={renderTarget.container}>
        {@render marker(createAnnotationViewContext(renderTarget))}
      </div>
    {:else if renderTarget.kind === 'tooltip' && tooltip}
      <div style="display: contents;" use:portal={renderTarget.container}>
        {@render tooltip(createAnnotationViewContext(renderTarget))}
      </div>
    {:else if renderTarget.kind === 'popup' && popup}
      <div style="display: contents;" use:portal={renderTarget.container}>
        {@render popup(createAnnotationViewContext(renderTarget))}
      </div>
    {/if}
  {/each}
  {#each semanticRenderTargets as renderTarget (renderTarget.key)}
    {#if renderTarget.kind === 'tooltip' && tooltip}
      <div style="display: contents;" use:portal={renderTarget.container}>
        {@render tooltip(createSemanticViewContext(renderTarget))}
      </div>
    {:else if renderTarget.kind === 'popup' && popup}
      <div style="display: contents;" use:portal={renderTarget.container}>
        {@render popup(createSemanticViewContext(renderTarget))}
      </div>
    {/if}
  {/each}
</div>
