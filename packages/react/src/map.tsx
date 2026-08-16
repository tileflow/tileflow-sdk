'use client';

import {
  type CSSProperties,
  type ImgHTMLAttributes,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import maplibregl, {
  type LngLatLike,
  type Map as MapLibreMap,
  type MapOptions as MapLibreMapOptions,
  type StyleSpecification,
} from 'maplibre-gl';
import {
  createTileflowSessionController,
  defaultTileflowManifestUrl,
  loadTileflowManifest,
  type MapLibreStyle,
  mergeTileflowAnalytics,
  normalizeTileflowCaptureId,
  normalizeTileflowStaticImageSize,
  resolveTileflowManifestMap,
  resolveTileflowMapMode,
  resolveTileflowRuntimeStyle,
  resolveTileflowStaticImageUrl,
  shouldLoadTileflowManifest,
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
} from '@tileflow/core/browser';

export type MapMarker = TileflowMapMarker;
export type TileflowMapOptions = Omit<MapLibreMapOptions, 'container' | 'style'>;

export type MapProps = {
  captureId?: string;
  map?: string;
  mode?: 'interactive' | 'image';
  config?: TileflowConfig;
  style?: MapLibreStyle;
  styleUrl?: string;
  imageUrl?: string;
  styleBaseUrl?: string;
  themes?: TileflowProjectThemes;
  manifestUrl?: string;
  preferLocalDev?: boolean;
  alt?: string;
  center?: [number, number];
  zoom?: number;
  className?: string;
  height?: CSSProperties['height'];
  imageLoading?: ImgHTMLAttributes<HTMLImageElement>['loading'];
  interactive?: boolean;
  mapOptions?: TileflowMapOptions;
  markers?: MapMarker[];
  analytics?: TileflowAnalytics;
  onLoad?: (map: MapLibreMap) => void;
};

const defaultCenter: [number, number] = [0, 20];
const defaultMarkers: MapMarker[] = [];

export function Map({
  captureId,
  map: mapName,
  mode = 'interactive',
  config,
  style,
  styleUrl,
  imageUrl,
  styleBaseUrl,
  themes,
  manifestUrl = defaultTileflowManifestUrl,
  preferLocalDev = true,
  alt = '',
  center,
  zoom,
  className,
  height = 420,
  imageLoading = 'eager',
  interactive,
  mapOptions,
  markers = defaultMarkers,
  analytics,
  onLoad,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const stableMapOptions = useStableMapOptions(mapOptions);
  const resolvedCenter = useStableMapOptionValue<LngLatLike>(
    center ?? stableMapOptions?.center ?? defaultCenter,
  );
  const resolvedZoom = zoom ?? stableMapOptions?.zoom ?? 2;
  const resolvedInteractive = interactive ?? stableMapOptions?.interactive ?? true;
  const staticImageCenter = center ?? defaultCenter;
  const centerRef = useRef<LngLatLike>(resolvedCenter);
  const zoomRef = useRef(resolvedZoom);
  const onLoadRef = useRef(onLoad);
  const mapNameRef = useRef(mapName);
  const resolvedAnalyticsRef = useRef<TileflowAnalytics | undefined>(undefined);
  const readinessRunRef = useRef(0);
  const markerController = useMemo(
    () =>
      createTileflowMarkerController<MapLibreMap, MapMarker, maplibregl.Marker>({
        attach(markerInstance, map, marker) {
          markerInstance.setLngLat(marker.coordinates).addTo(map);
          markerInstance.getElement().title = marker.label ?? marker.id;
        },
        create(marker) {
          return new maplibregl.Marker({
            color: marker.color ?? '#C6A15B',
          });
        },
        remove(markerInstance) {
          markerInstance.remove();
        },
      }),
    [],
  );
  const [manifestMap, setManifestMap] = useState<TileflowRuntimeManifestMap | null>(null);
  const [imageSize, setImageSize] = useState<{
    height: number;
    width: number;
  } | null>(null);
  const [captureState, setCaptureState] = useState<'error' | 'idle' | 'loading'>('loading');
  const resolvedCaptureId = normalizeTileflowCaptureId(captureId);
  const resolvedMode = resolveTileflowMapMode({imageUrl, mode, preferLocalDev});
  const isImageMode = resolvedMode === 'image';

  useEffect(() => {
    const shouldLoadManifest = shouldLoadTileflowManifest({
      config,
      imageMode: isImageMode,
      imageUrl,
      map: mapName,
      style,
      styleBaseUrl,
      styleUrl,
    });

    if (!shouldLoadManifest) {
      setManifestMap(null);
      return;
    }

    let cancelled = false;
    setManifestMap(null);

    loadTileflowManifest(manifestUrl)
      .then((manifest) => {
        if (cancelled) {
          return;
        }

        setManifestMap(manifest && mapName ? resolveTileflowManifestMap(manifest, mapName) : null);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load Tileflow manifest', error);
          setManifestMap(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [config, imageUrl, isImageMode, manifestUrl, mapName, style, styleUrl, styleBaseUrl]);

  const runtimeStyle = useMemo(() => {
    if (isImageMode) {
      return null;
    }

    return resolveTileflowRuntimeStyle({
      config,
      manifestMap,
      map: mapName,
      preferLocalDev,
      style,
      styleBaseUrl,
      styleUrl,
      themes,
    });
  }, [
    config,
    isImageMode,
    manifestMap,
    mapName,
    preferLocalDev,
    style,
    styleBaseUrl,
    styleUrl,
    themes,
  ]);

  const resolvedAnalytics = useMemo(
    () => mergeTileflowAnalytics(analytics, runtimeStyle?.analytics),
    [analytics, runtimeStyle],
  );

  useEffect(() => {
    centerRef.current = resolvedCenter;
    zoomRef.current = resolvedZoom;

    mapRef.current?.jumpTo({
      center: resolvedCenter,
      zoom: resolvedZoom,
    });
  }, [resolvedCenter, resolvedZoom]);

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
      (isImageMode
        ? resolveTileflowStaticImageUrl({
            center: staticImageCenter,
            imageSize,
            manifestMap,
            zoom: resolvedZoom,
          })
        : undefined),
    [imageSize, imageUrl, isImageMode, manifestMap, resolvedZoom, staticImageCenter],
  );
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
    if (!containerRef.current || !runtimeStyle) {
      return;
    }

    readinessRunRef.current += 1;
    setCaptureState('loading');

    const session = createTileflowSessionController({source: 'react'});
    const sessionStarter = createTileflowSessionStarter({
      getSessionId: () => session.sessionId,
      sessionId: session.sessionId,
      source: 'react',
    });
    const transformRequest = createTileflowTransformRequest({
      always: true,
      asyncAnalyticsTiming: 'resolution',
      getAnalytics: () => resolvedAnalyticsRef.current,
      sessionController: session,
      sessionId: session.sessionId,
      transformRequest: stableMapOptions?.transformRequest ?? undefined,
    });

    const map = new maplibregl.Map({
      ...stableMapOptions,
      container: containerRef.current,
      style: runtimeStyle.style as StyleSpecification | string,
      center: centerRef.current,
      zoom: zoomRef.current,
      interactive: resolvedInteractive,
      attributionControl: stableMapOptions?.attributionControl ?? {compact: true},
      transformRequest,
    });

    mapRef.current = map;
    const controls = resolvedInteractive ? new maplibregl.NavigationControl() : null;

    if (controls) {
      map.addControl(controls, 'top-right');
    }

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });

    resizeObserver.observe(containerRef.current);

    const lifecycle = attachTileflowMapLifecycle({
      getSession: () => {
        const analyticsForLoad = resolvedAnalyticsRef.current;

        return {
          analytics: analyticsForLoad,
          styleId:
            analyticsForLoad?.styleId ??
            (typeof runtimeStyle.style === 'string' ? runtimeStyle.style : mapNameRef.current),
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

    return () => {
      readinessRunRef.current += 1;
      try {
        lifecycle.dispose();
      } finally {
        try {
          resizeObserver.disconnect();
        } finally {
          try {
            markerController.clear();
          } finally {
            try {
              map.remove();
            } finally {
              if (mapRef.current === map) mapRef.current = null;
            }
          }
        }
      }
    };
  }, [markerController, resolvedInteractive, runtimeStyle, stableMapOptions]);

  useLayoutEffect(() => {
    if (!isImageMode) return;
    readinessRunRef.current += 1;
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

  useEffect(() => {
    const map = mapRef.current;

    markerController.clear();

    if (!map) {
      return;
    }

    markerController.replace(map, markers);

    return () => {
      markerController.clear();
    };
  }, [markerController, markers, runtimeStyle]);

  const frameStyle: CSSProperties = {
    height,
    minHeight: 240,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  };

  if (isImageMode) {
    return (
      <div
        className={className}
        data-tileflow-capture-id={resolvedCaptureId}
        data-tileflow-map={mapName}
        data-tileflow-state={captureState}
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
      </div>
    );
  }

  return (
    <div
      className={className}
      data-tileflow-capture-id={resolvedCaptureId}
      data-tileflow-map={mapName}
      data-tileflow-state={captureState}
      ref={containerRef}
      style={frameStyle}
    />
  );
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
