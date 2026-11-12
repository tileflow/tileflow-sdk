import type {
  Map as MapLibreMap,
  MapOptions,
  RequestParameters,
  StyleSpecification,
} from 'maplibre-gl';
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
  loadTileflowRuntimeStyle,
  loadTileflowStyleFonts,
  registerTileflowContourProtocol,
  registerTileflowPathGroundProtocol,
  registerTileflowPmtilesProtocol,
  registerTileflowWorldRequestBridge,
  reportTileflowMapError,
  type TileflowAppearanceBinding,
  type TileflowAppearanceInput,
  tileflowCanvasContextAttributes,
  type TileflowContourRequestScope,
  type TileflowMap3DAttachment,
  type TileflowMap3DLoader,
  type TileflowMapError,
  type TileflowMapReadinessState,
  tileflowMaxPitch,
  type TileflowNavigationControlBinding,
  type TileflowNavigationControlInput,
  type TileflowThemeController,
  type TileflowThemeTransition,
  type TileflowTransformRequest,
  type TileflowViewMode,
} from './browser.js';
import {createTileflowMapLifetime} from './map-lifetime';
import {
  createTileflowSessionController,
  type TileflowAnalytics,
  type TileflowRuntimeStyle,
} from './runtime.js';

export type TileflowMapSettings = {
  mapOptions?: Omit<MapOptions, 'container' | 'style'>;
  appearance?: TileflowAppearanceInput;
  viewMode?: TileflowViewMode;
  vegetation?: boolean;
  navigationControl?: TileflowNavigationControlInput;
};

export type TileflowMapMountOptions = {
  container: HTMLElement;
  runtimeStyle: TileflowRuntimeStyle;
  mapName?: string;
  /** The integration recorded by the map session, for example `react` or `javascript`. */
  source?: string;
  loadMapLibre: () => Promise<typeof import('maplibre-gl')>;
  loadScene: TileflowMap3DLoader;
  signal?: AbortSignal;
  getAnalytics?: () => TileflowAnalytics | undefined;
  /**
   * A getter must be pure. It is read before loading for request options, then again when mounting
   * for the latest camera and appearance. Request options remain fixed for this map's lifetime.
   */
  settings?: TileflowMapSettings | (() => TileflowMapSettings);
  onThemeChange?: (transition: TileflowThemeTransition) => void;
  onError?: (event: TileflowMapError) => void;
  onLoad?: (map: MapLibreMap) => void;
  onState?: (state: TileflowMapReadinessState) => void;
};

export type TileflowMountedMap = {
  map: MapLibreMap;
  maplibre: typeof import('maplibre-gl');
  themeController?: TileflowThemeController;
  appearance?: TileflowAppearanceBinding;
  scene: TileflowMap3DAttachment;
  navigation: TileflowNavigationControlBinding;
  /** Cancels pending work and releases the mounted resources; repeated calls do nothing. */
  dispose(): void;
};

type ResourceType = Parameters<NonNullable<MapOptions['transformRequest']>>[1];

/**
 * Mounts the shared Tileflow browser runtime around a resolved map. Frameworks retain ownership
 * of their own interaction views. An initial failure rejects after rollback; runtime and cleanup
 * failures use `onError`. The promise resolves after setup, while `onLoad` follows MapLibre load.
 */
export async function mountTileflowMap(
  options: TileflowMapMountOptions,
): Promise<TileflowMountedMap> {
  const lifetime = createTileflowMapLifetime({
    signal: options.signal,
    onCleanupError: (error) => reportTileflowMapError(options.onError, 'runtime', error),
  });
  const own = <T>(resource: T, cleanup: (resource: T) => void): T => {
    lifetime.defer(() => cleanup(resource));
    lifetime.signal.throwIfAborted();
    return resource;
  };
  const readSettings = () =>
    typeof options.settings === 'function' ? options.settings() : (options.settings ?? {});

  try {
    lifetime.signal.throwIfAborted();
    const userTransform = readSettings().mapOptions?.transformRequest ?? undefined;
    const getAnalytics = options.getAnalytics ?? (() => options.runtimeStyle.analytics);
    const source = options.source ?? 'javascript';
    const session = createTileflowSessionController({source});
    const resourceTransform = createTileflowTransformRequest<RequestParameters, ResourceType>({
      getAnalytics,
      sessionController: session,
      sessionId: session.sessionId,
      transformRequest: userTransform,
    });
    const styleLoadOptions = {
      signal: lifetime.signal,
      transformRequest: (url: string, type: 'Style' | 'Source') =>
        resourceTransform(url, type as ResourceType),
    };
    const [maplibre, prepared] = await lifetime.wait(
      Promise.all([
        options.loadMapLibre(),
        loadTileflowRuntimeStyle(options.runtimeStyle, styleLoadOptions).then(async (loaded) => {
          await loadTileflowStyleFonts(loaded.style, {fontFaces: loaded.fontFaces});
          return loaded;
        }),
      ]),
    );
    lifetime.signal.throwIfAborted();
    const settings = readSettings();
    const mapOptions = settings.mapOptions;
    const view = options.container.ownerDocument.defaultView;
    if (!view) throw new Error('Tileflow maps require a browser document.');

    const sessionStarter = createTileflowSessionStarter({
      getSessionId: () => session.sessionId,
      sessionId: session.sessionId,
      source,
    });
    const notice = own(attachTileflowFairUseNotice(options.container), (value) => value.dispose());
    registerTileflowContourProtocol({addProtocol: maplibre.addProtocol});
    registerTileflowPathGroundProtocol({addProtocol: maplibre.addProtocol});
    registerTileflowPmtilesProtocol({addProtocol: maplibre.addProtocol});
    const world = own(
      registerTileflowWorldRequestBridge({
        addProtocol: maplibre.addProtocol,
        onNotice: notice.update,
      }),
      (value) => value.dispose(),
    );
    const contour: TileflowContourRequestScope = own(
      createTileflowContourRequestScope({
        transformRequest: (url, type) => transformRequest(url, type as ResourceType),
      }),
      (value) => value.dispose(),
    );
    const transformRequest: TileflowTransformRequest<RequestParameters, ResourceType> =
      createTileflowTransformRequest<RequestParameters, ResourceType>({
        contourRequestScope: contour,
        getAnalytics,
        sessionController: session,
        sessionId: session.sessionId,
        transformRequest: userTransform,
        worldRequestBridge: world,
      });

    let mapRemoved = false;
    const map = own(
      new maplibre.Map({
        ...mapOptions,
        canvasContextAttributes: tileflowCanvasContextAttributes(
          mapOptions?.canvasContextAttributes,
        ),
        container: options.container,
        style: prepared.style as StyleSpecification,
        attributionControl: mapOptions?.attributionControl ?? {compact: true},
        validateStyle: mapOptions?.validateStyle ?? false,
        maxPitch: mapOptions?.maxPitch ?? tileflowMaxPitch,
        transformRequest,
      }),
      (value) => {
        if (mapRemoved) return;
        mapRemoved = true;
        value.remove();
      },
    );
    const onRemove = () => {
      mapRemoved = true;
      lifetime.dispose();
    };
    map.on('remove', onRemove);
    lifetime.defer(() => map.off('remove', onRemove));
    own(attachTileflowAtmosphere(map), (cleanup) => cleanup());
    own(attachTileflowBranding(map), (cleanup) => cleanup());
    own(attachTileflowNotices(map), (cleanup) => cleanup());
    own(attachTileflowNauticalLights(map), (cleanup) => cleanup());
    own(attachTileflowLabelPlacement(map), (cleanup) => cleanup());
    own(attachTileflowHorizonQueries(map), (cleanup) => cleanup());

    const themeController =
      options.runtimeStyle.theme === undefined
        ? undefined
        : own(
            createTileflowThemeController({
              initial: prepared.family ? prepared : options.runtimeStyle,
              initialStyle: prepared.style,
              styleLoadOptions,
              map,
              onTransition: (transition) => {
                if (!lifetime.signal.aborted) options.onThemeChange?.(transition);
              },
            }),
            (value) => value.dispose(),
          );
    const appearance = themeController
      ? own(
          createTileflowAppearanceBinding({
            controller: themeController,
            element: options.container,
            map,
            onError: (error, part) => reportTileflowMapError(options.onError, part, error),
          }),
          (value) => value.dispose(),
        )
      : undefined;
    appearance?.update(settings.appearance ?? {}, {transition: {duration: 0}});
    const scene = own(
      attachTileflowMap3D({
        map,
        ...(themeController ? {controller: themeController} : {}),
        vegetation: settings.vegetation,
        viewMode: settings.viewMode,
        load: options.loadScene,
        onError: (error) => reportTileflowMapError(options.onError, 'scene', error),
        // Direct scene readers need HTTP, not the MapLibre-only World or contour protocols.
        transformRequest: createTileflowTransformRequest({
          getAnalytics,
          sessionController: session,
          sessionId: session.sessionId,
          transformRequest: (url) => userTransform?.(url, 'Tile' as ResourceType),
        }),
      }),
      (value) => value.dispose(),
    );
    const navigation = own(
      createTileflowNavigationControlBinding({
        createControl: (controlOptions) => new maplibre.NavigationControl(controlOptions),
        map: {
          addControl: (control, position) => map.addControl(control, position),
          removeControl: (control) => {
            // MapLibre removes controls before emitting its own `remove` event.
            if (!mapRemoved) map.removeControl(control);
          },
        },
      }),
      (value) => value.dispose(),
    );
    navigation.update(mapOptions?.interactive === false ? false : settings.navigationControl);
    const resize = own(new ResizeObserver(() => map.resize()), (value) => value.disconnect());
    resize.observe(options.container);
    own(
      attachTileflowMapLifecycle({
        getSession: () => {
          const analytics = getAnalytics();
          return {
            analytics,
            styleId:
              analytics?.styleId ??
              (typeof options.runtimeStyle.style === 'string'
                ? options.runtimeStyle.style
                : options.mapName),
          };
        },
        map,
        onLoad: (loadedMap) => {
          if (!lifetime.signal.aborted) options.onLoad?.(loadedMap);
        },
        scheduler: {
          cancelFrame: (frame: number) => view.cancelAnimationFrame(frame),
          requestFrame: (callback) => view.requestAnimationFrame(callback),
        },
        sessionStarter,
        setState: (state) => {
          if (!lifetime.signal.aborted) options.onState?.(state);
        },
        subscribe: (subscribedMap, event, listener) => {
          const subscription = subscribedMap.on(event, listener);
          return () => subscription.unsubscribe();
        },
      }),
      (value) => value.dispose(),
    );
    return {
      map,
      maplibre,
      ...(themeController ? {themeController} : {}),
      ...(appearance ? {appearance} : {}),
      scene,
      navigation,
      dispose: () => lifetime.dispose(),
    };
  } catch (error) {
    lifetime.dispose(error);
    throw error;
  }
}
