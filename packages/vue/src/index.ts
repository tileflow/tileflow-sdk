import maplibregl, {
  type LngLatLike,
  type Map as MapLibreMap,
  type MapOptions as MapLibreMapOptions,
  type RequestParameters,
  type RequestTransformFunction,
  type StyleSpecification,
} from 'maplibre-gl';
import {
  computed,
  type CSSProperties,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  type PropType,
  ref,
  shallowRef,
  watch,
} from 'vue';
import {
  createTileflowSessionId,
  defaultTileflowManifestUrl,
  loadTileflowManifest,
  type MapLibreStyle,
  mergeTileflowAnalytics,
  normalizeTileflowCaptureId,
  normalizeTileflowStaticImageSize,
  resolveTileflowAnalyticsRequestUrl,
  resolveTileflowManifestMap,
  resolveTileflowMapMode,
  resolveTileflowRuntimeStyle,
  resolveTileflowStaticImageUrl,
  shouldLoadTileflowManifest,
  startTileflowSession,
  type TileflowAnalytics,
  type TileflowConfig,
  type TileflowMapMarker,
  type TileflowProjectThemes,
  type TileflowRuntimeManifestMap,
} from '@tileflow/core';

export type TileflowMapMode = 'interactive' | 'image';
export type TileflowMapOptions = Omit<MapLibreMapOptions, 'container' | 'style'>;

export type TileflowMapProps = {
  alt?: string;
  analytics?: TileflowAnalytics;
  center?: [number, number];
  captureId?: string;
  className?: string;
  config?: TileflowConfig;
  height?: number | string;
  imageLoading?: HTMLImageElement['loading'];
  imageUrl?: string;
  interactive?: boolean;
  manifestUrl?: string;
  map?: string;
  mapOptions?: TileflowMapOptions;
  mapStyle?: MapLibreStyle;
  markers?: TileflowMapMarker[];
  mode?: TileflowMapMode;
  preferLocalDev?: boolean;
  styleBaseUrl?: string;
  styleUrl?: string;
  themes?: TileflowProjectThemes;
  tileBaseUrl?: string;
  zoom?: number;
};

const defaultCenter: [number, number] = [0, 20];
const defaultZoom = 2;

export const TileflowMap = defineComponent({
  name: 'TileflowMap',
  inheritAttrs: false,
  props: {
    alt: {
      default: '',
      type: String,
    },
    analytics: Object as PropType<TileflowAnalytics>,
    center: Array as unknown as PropType<[number, number]>,
    captureId: String,
    className: String,
    config: Object as PropType<TileflowConfig>,
    height: {
      default: 420,
      type: [Number, String] as PropType<number | string>,
    },
    imageLoading: {
      default: 'eager',
      type: String as PropType<HTMLImageElement['loading']>,
    },
    imageUrl: String,
    interactive: {
      default: undefined,
      type: Boolean as PropType<boolean | undefined>,
    },
    manifestUrl: {
      default: defaultTileflowManifestUrl,
      type: String,
    },
    map: String,
    mapOptions: Object as PropType<TileflowMapOptions>,
    mapStyle: Object as PropType<MapLibreStyle>,
    markers: {
      default: () => [],
      type: Array as PropType<TileflowMapMarker[]>,
    },
    mode: {
      default: 'interactive',
      type: String as PropType<TileflowMapMode>,
    },
    preferLocalDev: {
      default: true,
      type: Boolean,
    },
    styleBaseUrl: String,
    styleUrl: String,
    themes: Object as PropType<TileflowProjectThemes>,
    tileBaseUrl: String,
    zoom: Number,
  },
  emits: {
    load: (_map: MapLibreMap) => true,
  },
  setup(props, {attrs, emit}) {
    const containerRef = ref<HTMLDivElement | null>(null);
    const manifestMap = shallowRef<TileflowRuntimeManifestMap | null>(null);
    const imageSize = shallowRef<{height: number; width: number} | null>(null);
    const mapRef = shallowRef<MapLibreMap | null>(null);
    const captureState = ref<'error' | 'idle' | 'loading'>('loading');
    const sessionId = createTileflowSessionId();
    const markerInstances: maplibregl.Marker[] = [];
    const sessionStarts = new Set<string>();
    let imageResizeObserver: ResizeObserver | null = null;
    let mapResizeObserver: ResizeObserver | null = null;
    let manifestLoadId = 0;
    let readinessRunId = 0;

    const resolvedMode = computed(() =>
      resolveTileflowMapMode({
        imageUrl: props.imageUrl,
        mode: props.mode,
        preferLocalDev: props.preferLocalDev,
      }),
    );
    const isImageMode = computed(() => resolvedMode.value === 'image');
    const imageCenter = computed(() => props.center ?? defaultCenter);
    const imageZoom = computed(() => props.zoom ?? defaultZoom);
    const resolvedCenter = computed<LngLatLike>(
      () => props.center ?? props.mapOptions?.center ?? defaultCenter,
    );
    const resolvedZoom = computed(() => props.zoom ?? props.mapOptions?.zoom ?? defaultZoom);
    const resolvedInteractive = computed(
      () => props.interactive ?? props.mapOptions?.interactive ?? true,
    );
    const runtimeStyle = computed(() =>
      isImageMode.value
        ? null
        : resolveTileflowRuntimeStyle({
            config: props.config,
            manifestMap: manifestMap.value,
            map: props.map,
            preferLocalDev: props.preferLocalDev,
            style: props.mapStyle,
            styleBaseUrl: props.styleBaseUrl,
            styleUrl: props.styleUrl,
            themes: props.themes,
            tileBaseUrl: props.tileBaseUrl,
          }),
    );
    const resolvedAnalytics = computed(() =>
      mergeTileflowAnalytics(props.analytics, runtimeStyle.value?.analytics),
    );
    const runtimeImageUrl = computed(
      () =>
        props.imageUrl ??
        (isImageMode.value
          ? resolveTileflowStaticImageUrl({
              center: imageCenter.value,
              imageSize: imageSize.value,
              manifestMap: manifestMap.value,
              zoom: imageZoom.value,
            })
          : undefined),
    );
    const frameStyle = computed<CSSProperties>(() => ({
      height: formatHeight(props.height),
      minHeight: '240px',
      overflow: 'hidden',
      position: 'relative',
      width: '100%',
    }));
    const resolvedCaptureId = computed(() => normalizeTileflowCaptureId(props.captureId));

    const refreshManifest = async () => {
      const shouldLoad = shouldLoadTileflowManifest({
        config: props.config,
        imageMode: isImageMode.value,
        imageUrl: props.imageUrl,
        map: props.map,
        style: props.mapStyle,
        styleBaseUrl: props.styleBaseUrl,
        styleUrl: props.styleUrl,
      });

      if (!shouldLoad) {
        manifestMap.value = null;
        return;
      }

      const loadId = ++manifestLoadId;
      manifestMap.value = null;

      try {
        const manifest = await loadTileflowManifest(props.manifestUrl);

        if (loadId === manifestLoadId) {
          manifestMap.value =
            manifest && props.map ? resolveTileflowManifestMap(manifest, props.map) : null;
        }
      } catch (error) {
        if (loadId === manifestLoadId) {
          console.error('Failed to load Tileflow manifest', error);
          manifestMap.value = null;
        }
      }
    };

    const updateImageResizeObserver = () => {
      imageResizeObserver?.disconnect();
      imageResizeObserver = null;
      imageSize.value = null;

      if (!isImageMode.value || props.imageUrl || !containerRef.value) {
        return;
      }

      const element = containerRef.value;
      const updateImageSize = () => {
        const nextSize = normalizeTileflowStaticImageSize({
          height: element.clientHeight,
          width: element.clientWidth,
        });

        imageSize.value =
          imageSize.value?.height === nextSize.height && imageSize.value.width === nextSize.width
            ? imageSize.value
            : nextSize;
      };

      imageResizeObserver = new ResizeObserver(updateImageSize);
      imageResizeObserver.observe(element);
      updateImageSize();
    };

    const destroyMap = () => {
      readinessRunId += 1;
      mapResizeObserver?.disconnect();
      mapResizeObserver = null;
      clearMarkers(markerInstances);
      mapRef.value?.remove();
      mapRef.value = null;
    };

    const recreateMap = () => {
      destroyMap();
      captureState.value = 'loading';

      if (!containerRef.value || !runtimeStyle.value || isImageMode.value) {
        return;
      }

      const runtime = runtimeStyle.value;
      const map = new maplibregl.Map({
        ...props.mapOptions,
        attributionControl: props.mapOptions?.attributionControl ?? {compact: true},
        center: resolvedCenter.value,
        container: containerRef.value,
        interactive: resolvedInteractive.value,
        style: runtime.style as StyleSpecification | string,
        transformRequest: createTransformRequest(
          resolvedAnalytics.value,
          sessionId,
          props.mapOptions?.transformRequest,
        ),
        zoom: resolvedZoom.value,
      });

      mapRef.value = map;

      if (resolvedInteractive.value) {
        map.addControl(new maplibregl.NavigationControl(), 'top-right');
      }

      mapResizeObserver = new ResizeObserver(() => {
        map.resize();
      });
      mapResizeObserver.observe(containerRef.value);

      map.on('load', () => {
        const analyticsForLoad = resolvedAnalytics.value;
        const styleId =
          analyticsForLoad?.styleId ??
          (typeof runtime.style === 'string' ? runtime.style : props.map);

        emit('load', map);

        if (analyticsForLoad?.mapId) {
          const sessionKey = `${sessionId}:${analyticsForLoad.mapId}:${styleId ?? ''}`;

          if (!sessionStarts.has(sessionKey)) {
            sessionStarts.add(sessionKey);
            startTileflowSession(analyticsForLoad, {
              mapId: analyticsForLoad.mapId,
              sessionId,
              source: 'vue',
              styleId,
            });
          }
        }
      });
      map.on('dataloading', () => {
        readinessRunId += 1;
        captureState.value = 'loading';
      });
      map.on('styledataloading', () => {
        readinessRunId += 1;
        captureState.value = 'loading';
      });
      map.on('idle', () => {
        const runId = ++readinessRunId;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (runId === readinessRunId && mapRef.value === map) {
              captureState.value = 'idle';
            }
          });
        });
      });
      map.on('error', () => {
        readinessRunId += 1;
        captureState.value = 'error';
      });

      syncMarkers();
    };

    const syncView = () => {
      mapRef.value?.jumpTo({
        center: resolvedCenter.value,
        zoom: resolvedZoom.value,
      });
    };

    const syncMarkers = () => {
      const map = mapRef.value;

      clearMarkers(markerInstances);

      if (!map) {
        return;
      }

      for (const marker of props.markers) {
        const markerInstance = new maplibregl.Marker({
          color: marker.color ?? '#C6A15B',
        })
          .setLngLat(marker.coordinates)
          .addTo(map);

        markerInstance.getElement().title = marker.label ?? marker.id;
        markerInstances.push(markerInstance);
      }
    };

    const markImageReady = async (image: HTMLImageElement) => {
      const runId = ++readinessRunId;
      try {
        if (typeof image.decode === 'function') await image.decode();
      } catch {
        if (!image.complete || image.naturalWidth === 0) {
          if (runId === readinessRunId) captureState.value = 'error';
          return;
        }
      }
      if (runId === readinessRunId) captureState.value = 'idle';
    };

    const resetImageReadiness = async () => {
      if (!isImageMode.value) return;
      const runId = ++readinessRunId;
      captureState.value = 'loading';
      await nextTick();
      if (runId !== readinessRunId) return;
      const image = containerRef.value?.querySelector('img');
      if (!image?.complete) return;
      if (image.naturalWidth === 0) {
        captureState.value = 'error';
        return;
      }
      await markImageReady(image);
    };

    onMounted(() => {
      void refreshManifest();
      updateImageResizeObserver();
      recreateMap();
      void resetImageReadiness();
    });

    onBeforeUnmount(() => {
      imageResizeObserver?.disconnect();
      destroyMap();
    });

    watch(
      () => [
        props.config,
        props.imageUrl,
        props.manifestUrl,
        props.map,
        props.mapStyle,
        props.mode,
        props.preferLocalDev,
        props.styleBaseUrl,
        props.styleUrl,
      ],
      () => {
        void refreshManifest();
      },
    );
    watch(
      () => [isImageMode.value, runtimeImageUrl.value],
      () => {
        void resetImageReadiness();
      },
      {flush: 'post'},
    );
    watch(
      () => [props.imageUrl, props.mode, props.preferLocalDev],
      () => updateImageResizeObserver(),
      {flush: 'post'},
    );
    watch(
      () => [
        props.config,
        props.analytics,
        props.interactive,
        props.map,
        props.mapOptions,
        props.mapStyle,
        props.mode,
        props.preferLocalDev,
        props.styleBaseUrl,
        props.styleUrl,
        props.themes,
        props.tileBaseUrl,
        manifestMap.value,
      ],
      () => recreateMap(),
      {flush: 'post'},
    );
    watch(
      () => [props.center, props.zoom, props.mapOptions?.center, props.mapOptions?.zoom],
      () => syncView(),
      {flush: 'post'},
    );
    watch(
      () => props.markers,
      () => syncMarkers(),
      {flush: 'post'},
    );

    return () => {
      const rootAttrs = {...attrs};
      const classValue = [attrs.class, props.className];
      const styleValue = [attrs.style, frameStyle.value];
      delete rootAttrs.class;
      delete rootAttrs.style;

      return h(
        'div',
        {
          ...rootAttrs,
          class: classValue,
          'data-tileflow-capture-id': resolvedCaptureId.value,
          'data-tileflow-map': props.map,
          'data-tileflow-state': captureState.value,
          ref: containerRef,
          style: styleValue,
        },
        isImageMode.value && runtimeImageUrl.value
          ? h('img', {
              alt: props.alt,
              decoding: 'async',
              loading: props.imageLoading,
              onError: () => {
                readinessRunId += 1;
                captureState.value = 'error';
              },
              onLoad: (event: Event) =>
                void markImageReady(event.currentTarget as HTMLImageElement),
              src: runtimeImageUrl.value,
              style: {
                display: 'block',
                height: '100%',
                objectFit: 'cover',
                width: '100%',
              },
            })
          : undefined,
      );
    };
  },
});

export default TileflowMap;

function createTransformRequest(
  analytics: TileflowAnalytics | undefined,
  sessionId: string,
  userTransformRequest?: TileflowMapOptions['transformRequest'],
): RequestTransformFunction | undefined {
  if ((!analytics || analytics.enabled === false) && !userTransformRequest) {
    return undefined;
  }

  return (url, resourceType) => {
    const request = userTransformRequest?.(url, resourceType);

    if (isPromiseLike(request)) {
      return request.then(
        (resolvedRequest) =>
          applyTileflowAnalyticsRequest(url, resolvedRequest, analytics, sessionId) ??
          resolvedRequest,
      );
    }

    return applyTileflowAnalyticsRequest(url, request, analytics, sessionId);
  };
}

function applyTileflowAnalyticsRequest(
  url: string,
  request: RequestParameters | undefined,
  analytics: TileflowAnalytics | undefined,
  sessionId: string,
): RequestParameters | undefined {
  const requestUrl = request?.url ?? url;
  const nextUrl = resolveTileflowAnalyticsRequestUrl(requestUrl, analytics, sessionId);

  if (!nextUrl) {
    return request;
  }

  return request ? {...request, url: nextUrl} : {url: nextUrl};
}

function isPromiseLike<T>(value: T | Promise<T> | undefined): value is Promise<T> {
  return Boolean(value && typeof (value as Promise<T>).then === 'function');
}

function formatHeight(height: number | string): string {
  return typeof height === 'number' ? `${height}px` : height;
}

function clearMarkers(markerInstances: maplibregl.Marker[]): void {
  for (const marker of markerInstances) {
    marker.remove();
  }

  markerInstances.splice(0);
}
