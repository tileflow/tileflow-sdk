<script lang="ts">
  import maplibregl, {
    type LngLatLike,
    type Map as MapLibreMap,
    type MapOptions as MapLibreMapOptions,
    type StyleSpecification,
  } from 'maplibre-gl';
  import {createEventDispatcher, onMount, tick} from 'svelte';
  import {
    createTileflowSessionId,
    defaultTileflowManifestUrl,
    loadTileflowManifest,
    mergeTileflowAnalytics,
    normalizeTileflowCaptureId,
    normalizeTileflowStaticImageSize,
    resolveTileflowManifestMap,
    resolveTileflowMapMode,
    resolveTileflowRuntimeStyle,
    resolveTileflowStaticImageUrl,
    shouldLoadTileflowManifest,
    type MapLibreStyle,
    type TileflowAnalytics,
    type TileflowConfig,
    type TileflowMapMarker,
    type TileflowProjectThemes,
    type TileflowRuntimeManifestMap,
  } from '@tileflow/core';
  import {
    attachTileflowMapLifecycle,
    createTileflowMarkerController,
    createTileflowSessionStarter,
    createTileflowTransformRequest,
    type TileflowMapLifecycleAttachment,
  } from '@tileflow/core/browser';

  export let alt = '';
  export let analytics: TileflowAnalytics | undefined = undefined;
  type TileflowMapOptions = Omit<MapLibreMapOptions, 'container' | 'style'>;

  const defaultCenter: [number, number] = [0, 20];
  const defaultZoom = 2;

  export let center: [number, number] | undefined = undefined;
  export let captureId: string | undefined = undefined;
  export let className = '';
  export let config: TileflowConfig | undefined = undefined;
  export let height: number | string = 420;
  export let imageLoading: HTMLImageElement['loading'] = 'eager';
  export let imageUrl: string | undefined = undefined;
  export let interactive: boolean | undefined = undefined;
  export let manifestUrl = defaultTileflowManifestUrl;
  export let map: string | undefined = undefined;
  export let mapOptions: TileflowMapOptions | undefined = undefined;
  export let mapStyle: MapLibreStyle | undefined = undefined;
  export let markers: TileflowMapMarker[] = [];
  export let mode: 'interactive' | 'image' = 'interactive';
  export let preferLocalDev = true;
  export let styleBaseUrl: string | undefined = undefined;
  export let styleUrl: string | undefined = undefined;
  export let themes: TileflowProjectThemes | undefined = undefined;
  export let tileBaseUrl: string | undefined = undefined;
  export let zoom: number | undefined = undefined;

  let container: HTMLDivElement;
  let captureState: 'error' | 'idle' | 'loading' = 'loading';
  let imageSize: {height: number; width: number} | null = null;
  let imageResizeObserver: ResizeObserver | null = null;
  let mapInstance: MapLibreMap | null = null;
  let mapLifecycleAttachment: TileflowMapLifecycleAttachment | null = null;
  let mapResizeObserver: ResizeObserver | null = null;
  let manifestMap: TileflowRuntimeManifestMap | null = null;
  let manifestLoadId = 0;
  let mounted = false;
  let refreshRunId = 0;
  let readinessRunId = 0;

  const dispatch = createEventDispatcher<{load: MapLibreMap}>();
  const sessionId = createTileflowSessionId();
  const sessionStarter = createTileflowSessionStarter({sessionId, source: 'svelte'});
  const markerController = createTileflowMarkerController<
    MapLibreMap,
    TileflowMapMarker,
    maplibregl.Marker
  >({
    attach(markerInstance, targetMap, definition) {
      markerInstance.setLngLat(definition.coordinates).addTo(targetMap);
      markerInstance.getElement().title = definition.label ?? definition.id;
    },
    create: (definition) =>
      new maplibregl.Marker({
        color: definition.color ?? '#C6A15B',
      }),
    remove: (markerInstance) => markerInstance.remove(),
  });

  $: resolvedMode = resolveTileflowMapMode({imageUrl, mode, preferLocalDev});
  $: resolvedCaptureId = normalizeTileflowCaptureId(captureId);
  $: isImageMode = resolvedMode === 'image';
  $: imageCenter = center ?? defaultCenter;
  $: imageZoom = zoom ?? defaultZoom;
  $: resolvedCenter = center ?? mapOptions?.center ?? defaultCenter;
  $: resolvedZoom = zoom ?? mapOptions?.zoom ?? defaultZoom;
  $: resolvedInteractive = interactive ?? mapOptions?.interactive ?? true;
  $: runtimeStyle = isImageMode
    ? null
    : resolveTileflowRuntimeStyle({
        config,
        manifestMap,
        map,
        preferLocalDev,
        style: mapStyle,
        styleBaseUrl,
        styleUrl,
        themes,
        tileBaseUrl,
      });
  $: resolvedAnalytics = mergeTileflowAnalytics(analytics, runtimeStyle?.analytics);
  $: runtimeImageUrl =
    imageUrl ??
    (isImageMode
      ? resolveTileflowStaticImageUrl({
          center: imageCenter,
          imageSize,
          manifestMap,
          zoom: imageZoom,
        })
      : undefined);
  $: frameStyle = `height: ${formatHeight(height)}; min-height: 240px; overflow: hidden; position: relative; width: 100%;`;

  $: if (mounted) {
    config;
    imageUrl;
    interactive;
    manifestUrl;
    map;
    mapOptions;
    mapStyle;
    mode;
    preferLocalDev;
    styleBaseUrl;
    styleUrl;
    themes;
    tileBaseUrl;
    void refresh();
  }

  $: if (mounted) {
    center;
    zoom;
    mapOptions?.center;
    mapOptions?.zoom;
    syncView();
  }

  $: if (mounted) {
    markers;
    syncMarkers();
  }

  $: if (mounted && isImageMode) {
    runtimeImageUrl;
    void markImageLoading();
  }

  onMount(() => {
    mounted = true;

    return () => {
      mounted = false;
      refreshRunId += 1;
      manifestLoadId += 1;
      imageResizeObserver?.disconnect();
      destroyMap();
    };
  });

  async function refresh() {
    const runId = ++refreshRunId;
    await refreshManifest();

    if (!mounted || runId !== refreshRunId) {
      return;
    }

    updateImageResizeObserver();
    recreateMap();
  }

  async function refreshManifest() {
    const shouldLoad = shouldLoadTileflowManifest({
      config,
      imageMode: isImageMode,
      imageUrl,
      map,
      style: mapStyle,
      styleBaseUrl,
      styleUrl,
    });

    if (!shouldLoad) {
      manifestLoadId += 1;
      manifestMap = null;
      return;
    }

    const loadId = ++manifestLoadId;
    manifestMap = null;

    try {
      const manifest = await loadTileflowManifest(manifestUrl);

      if (mounted && loadId === manifestLoadId) {
        manifestMap = manifest && map ? resolveTileflowManifestMap(manifest, map) : null;
      }
    } catch (error) {
      if (mounted && loadId === manifestLoadId) {
        console.error('Failed to load Tileflow manifest', error);
        manifestMap = null;
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
    readinessRunId += 1;
    const lifecycleAttachment = mapLifecycleAttachment;
    const currentMap = mapInstance;
    mapLifecycleAttachment = null;
    mapInstance = null;
    mapResizeObserver?.disconnect();
    mapResizeObserver = null;

    try {
      lifecycleAttachment?.dispose();
    } finally {
      try {
        markerController.dispose();
      } finally {
        currentMap?.remove();
      }
    }
  }

  function recreateMap() {
    destroyMap();
    captureState = 'loading';

    if (!container || !runtimeStyle || isImageMode) {
      return;
    }

    const runtime = runtimeStyle;
    const maplibreMap = new maplibregl.Map({
      ...mapOptions,
      attributionControl: mapOptions?.attributionControl ?? {compact: true},
      center: resolvedCenter as LngLatLike,
      container,
      interactive: resolvedInteractive,
      style: runtime.style as StyleSpecification | string,
      transformRequest: createTileflowTransformRequest({
        always: true,
        asyncAnalyticsTiming: 'request',
        getAnalytics: () => resolvedAnalytics,
        sessionId,
        transformRequest: mapOptions?.transformRequest ?? undefined,
      }),
      zoom: resolvedZoom,
    });

    mapInstance = maplibreMap;

    if (resolvedInteractive) {
      maplibreMap.addControl(new maplibregl.NavigationControl(), 'top-right');
    }

    mapResizeObserver = new ResizeObserver(() => {
      maplibreMap.resize();
    });
    mapResizeObserver.observe(container);

    mapLifecycleAttachment = attachTileflowMapLifecycle<MapLibreMap, number>({
      getSession: () => {
        const analyticsForLoad = resolvedAnalytics;
        return {
          analytics: analyticsForLoad,
          styleId:
            analyticsForLoad?.styleId ?? (typeof runtime.style === 'string' ? runtime.style : map),
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
        captureState = state;
      },
      subscribe: (targetMap, event, listener) => {
        const subscription = targetMap.on(event, listener);
        return () => subscription.unsubscribe();
      },
    });

    syncMarkers();
  }

  function syncView() {
    mapInstance?.jumpTo({
      center: resolvedCenter as LngLatLike,
      zoom: resolvedZoom,
    });
  }

  function syncMarkers() {
    if (!mapInstance) {
      markerController.clear();
      return;
    }

    markerController.replace(mapInstance, markers);
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
        if (runId === readinessRunId) captureState = 'error';
        return;
      }
    }
    if (runId === readinessRunId) captureState = 'idle';
  }

  async function markImageLoading() {
    const runId = ++readinessRunId;
    captureState = 'loading';
    await tick();
    if (!mounted || runId !== readinessRunId) return;
    const image = container?.querySelector('img');
    if (!image?.complete) return;
    if (image.naturalWidth === 0) {
      captureState = 'error';
      return;
    }
    await markImageReady(image);
  }

  function handleImageError() {
    readinessRunId += 1;
    captureState = 'error';
  }

  function formatHeight(value: number | string): string {
    return typeof value === 'number' ? `${value}px` : value;
  }
</script>

<div
  bind:this={container}
  class={className}
  data-tileflow-capture-id={resolvedCaptureId}
  data-tileflow-map={map}
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
</div>
