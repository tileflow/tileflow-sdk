import * as maplibregl from 'maplibre-gl';
import type {Map as MapLibreMap, StyleSpecification} from 'maplibre-gl';
import {
  attachTileflowAtmosphere,
  attachTileflowFairUseNotice,
  attachTileflowHorizonQueries,
  attachTileflowLabelPlacement,
  attachTileflowMap3D,
  attachTileflowNauticalLights,
  attachTileflowNotices,
  createBoundaryFeatureState,
  createTileflowDepthMarkers,
  createTileflowMap3D,
  createTileflowThemeController,
  loadTileflowStyleFonts,
  playTileflowShot,
  registerTileflowContourProtocol,
  registerTileflowPmtilesProtocol,
  registerTileflowWorldRequestBridge,
  tileflowCanvasContextAttributes,
  type TileflowMap3DAttachment,
  tileflowMaxPitch,
  type TileflowThemeController,
  type TileflowThemeTransition,
} from '@tileflow/core/browser';
import {
  resolveTileflowManifestMap,
  resolveTileflowRuntimeStyle,
  resolveTileflowRuntimeView,
  type TileflowRuntimeManifestMap,
  type TileflowRuntimeStyle,
} from '@tileflow/core/runtime';
import {createAnimations, isShotFrame, shotFrame} from './animations';
import {type CameraController, createCameraController} from './camera';
import {createGestureController} from './camera-gestures';
import type {Overlay} from './content-contract';
import {createMapContentRegistry, type ResolvedOverlay} from './content-registry';
import {creditHtml, visibleCredits} from './credits';
import {createDataReader, type DataReference} from './data';
import {
  type Clock,
  createEventHub,
  createWarningAggregator,
  type Producer,
  systemClock,
} from './events';
import {type FeatureCollection, geoJSONProblem} from './geojson';
import {createLocationController, isLocationFrame, type LocationController} from './location';
import {loadMobileManifest} from './manifest';
import {
  type Camera,
  type Command,
  type EventName,
  type InitializeOptions,
  type MapOptions,
  protocol,
  ProtocolError,
  type ResourceKind,
} from './protocol';
import {
  createResourceFetch,
  resourceAddress,
  resourceOrigin,
  type ResourcePlatform,
  resourceTemplateAddress,
} from './resources';
import {createMapScene, type DecodedImage} from './scene';
import {createStyleRegistry, type StyleMap, type StyleRegistry} from './style-registry';
import {createStyleResourceLoader} from './style-resources';

const resourceKinds: Record<string, ResourceKind> = {
  Style: 'style',
  Source: 'source',
  Tile: 'tile',
  Glyphs: 'glyphs',
  SpriteImage: 'sprite',
  SpriteJSON: 'sprite',
  Image: 'image',
};
/** Resource kinds remembered per transport address, enough for the requests in flight. */
const maximumRememberedResources = 1024;

/** Decodes an application image: RGBA pixels for the style and a bitmap for depth markers. */
async function decodeImage(bytes: Uint8Array<ArrayBuffer>): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) throw new Error('No 2D canvas.');
  context.drawImage(bitmap, 0, 0);
  const {data} = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return {width: bitmap.width, height: bitmap.height, pixels: data, texture: bitmap};
}

/** Composes existing Core controllers. This module owns no account, grant or web session. */
export function createMobileMapRuntime(input: {
  container: HTMLElement;
  platform: ResourcePlatform;
  send: (event: EventName, result: unknown) => void;
  clock?: Clock;
}) {
  const lifetime = new AbortController();
  const clock = input.clock ?? systemClock;
  const fetchResource = createResourceFetch(input.platform, lifetime.signal);
  const styles = createStyleResourceLoader(fetchResource, lifetime.signal);
  const readData = createDataReader(input.platform, lifetime.signal);
  const events = createEventHub({send: input.send, clock});
  const emit = (event: EventName, produce: Producer) => events.emit(event, produce);
  const warnings = createWarningAggregator({
    clock,
    report: (warning) => events.emit('warning', () => warning),
  });
  const kinds = new Map<string, ResourceKind>();
  let map: MapLibreMap | undefined;
  let themes: TileflowThemeController | undefined;
  let scene: TileflowMap3DAttachment | undefined;
  let cameras: CameraController | undefined;
  let gestures: ReturnType<typeof createGestureController> | undefined;
  let activeOptions: MapOptions | undefined;
  // Regional credits of downloaded regions in view, as attribution entries.
  let credits: string[] = [];
  const attributionControl = () =>
    new maplibregl.AttributionControl({
      compact: true,
      ...(credits.length ? {customAttribution: credits} : {}),
    });
  let content: ReturnType<typeof createMapContentRegistry> | undefined;
  let styleRegistry: StyleRegistry | undefined;
  let appearance: ReturnType<typeof createMapScene> | undefined;
  let animations: ReturnType<typeof createAnimations> | undefined;
  let location: LocationController | undefined;
  let appearanceRevision = 0;
  let manifestMap: TileflowRuntimeManifestMap | undefined;
  let configuration: InitializeOptions | undefined;
  const cleanups: (() => void)[] = [];
  let disposed = false;
  let initializing = false;
  let contentRevision = 0;
  let appliedContent = 0;
  // The World request bridge reads fair-use headers from World tiles, as the web adapters do.
  const fairUseNotice = attachTileflowFairUseNotice(input.container);
  cleanups.push(() => fairUseNotice.dispose());
  const worldRequests = registerTileflowWorldRequestBridge({
    addProtocol: maplibregl.addProtocol,
    fetch: fetchResource,
    onNotice: fairUseNotice.update,
  });
  cleanups.push(() => worldRequests.dispose());
  const address = (url: string, type?: string) => {
    // These Core protocols route their nested requests through the same native transport.
    if (/^tileflow-(?:pmtiles|contour|world):\/\//u.test(url)) return url;
    const transport = resourceAddress(url, input.platform);
    if (type && resourceKinds[type]) {
      kinds.delete(transport);
      kinds.set(transport, resourceKinds[type]);
      if (kinds.size > maximumRememberedResources) kinds.delete(kinds.keys().next().value!);
    }
    return transport;
  };
  const assertActive = () => {
    if (disposed || lifetime.signal.aborted)
      throw new ProtocolError('disposed', 'The map is disposed.');
  };
  const pixelRatio = (options: MapOptions) =>
    Math.min(devicePixelRatio, {low: 1.5, balanced: 2, high: 3}[options.quality]);
  const requireMap = () => {
    assertActive();
    if (!map) throw new ProtocolError('notReady', 'The map is not initialized.');
    return map;
  };
  const requireCamera = () => {
    requireMap();
    return cameras!;
  };
  const camera = (): Camera => requireCamera().camera();
  const loadFonts = (style: TileflowRuntimeStyle) =>
    loadTileflowStyleFonts(style.style, {fontFaces: style.fontFaces, fetch: fetchResource});
  /** The theme's route inks reach the layers drawn in them after a theme or blend change. */
  const refreshInks = () => {
    if (themes && content && !disposed) content.setInks(themes.getRouteInks());
  };
  const reportTransition = (transition: TileflowThemeTransition) => {
    if (disposed) return;
    const {phase, currentTheme, targetTheme} = transition;
    if (phase === 'ready') refreshInks();
    emit('themeTransition', () => ({
      phase,
      ...(currentTheme === undefined ? {} : {currentTheme}),
      ...(targetTheme === undefined ? {} : {targetTheme}),
      ...(phase === 'ready' && themes ? {routeInks: themes.getRouteInks()} : {}),
    }));
    if (phase === 'ready') emit('themeChanged', () => ({theme: currentTheme ?? targetTheme}));
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    lifetime.abort();
    events.dispose();
    warnings.dispose();
    animations?.dispose();
    location?.dispose();
    appearance?.dispose();
    content?.dispose();
    styleRegistry?.dispose();
    cameras?.dispose();
    scene?.dispose();
    themes?.dispose();
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    map?.remove();
    map = undefined;
  };

  function applyOptions(options: MapOptions) {
    const current = requireMap();
    const previous = activeOptions;
    activeOptions = options;
    gestures?.apply(options.gestures);
    cameras?.setLimits(options.limits);
    cameras?.setAttribution(options.attribution, attributionControl);
    if (current.getPixelRatio() !== pixelRatio(options)) current.setPixelRatio(pixelRatio(options));
    if (previous?.viewMode !== options.viewMode) scene?.setViewMode(options.viewMode);
    if (previous?.vegetation !== options.vegetation) appearance?.setVegetation(options.vegetation);
    location?.setOptions(options.location);
  }

  async function initialize(options: InitializeOptions, signal: AbortSignal) {
    assertActive();
    if (map || initializing)
      throw new ProtocolError('invalidRequest', 'The map is already initialized.');
    initializing = true;
    configuration = options;
    events.set(options.events);
    emit('loading', () => null);
    try {
      const manifest = await loadMobileManifest(options.source, fetchResource, lifetime.signal);
      assertActive();
      signal.throwIfAborted();
      if (!manifest) throw new ProtocolError('resourceFailed', 'The map manifest was not found.');
      const selected = resolveTileflowManifestMap(manifest, options.source.map);
      if (!selected) throw new ProtocolError('resourceFailed', 'The map is not in the manifest.');
      manifestMap = selected;
      const resolvedStyle = resolveTileflowRuntimeStyle({
        source: options.source,
        manifestMap,
        theme: options.theme ?? undefined,
        colorScheme: options.colorScheme,
      });
      if (!resolvedStyle) throw new ProtocolError('resourceFailed', 'The map has no usable theme.');
      const style = await styles.prepare(resolvedStyle);
      await loadFonts(style);
      assertActive();
      signal.throwIfAborted();
      registerTileflowContourProtocol(
        {addProtocol: maplibregl.addProtocol},
        {
          transformDemUrl: (url) => resourceTemplateAddress(url, input.platform),
        },
      );
      registerTileflowPmtilesProtocol(
        {addProtocol: maplibregl.addProtocol},
        {
          transformArchiveUrl: (url) => resourceAddress(url, input.platform),
        },
      );
      const view = resolveTileflowRuntimeView({manifestMap});
      map = new maplibregl.Map({
        container: input.container,
        style: style.style as string | StyleSpecification,
        center: options.camera
          ? [options.camera.longitude, options.camera.latitude]
          : view.center
            ? [view.center[0], view.center[1]]
            : undefined,
        zoom: options.camera?.zoom ?? view.zoom,
        bearing: options.camera?.bearing ?? view.bearing,
        pitch: options.camera?.pitch ?? view.pitch,
        interactive: options.interactive,
        pixelRatio: pixelRatio(options.options),
        // The camera places the attribution, which is always shown, in the host's chosen corner.
        attributionControl: false,
        canvasContextAttributes: tileflowCanvasContextAttributes({
          antialias: options.renderer.antialias,
        }),
        // Tileflow's compiled styles are validated when they are built, so this is opt-in.
        validateStyle: options.renderer.validateStyle,
        maxPitch: tileflowMaxPitch,
        transformRequest: (url, type) => ({url: address(worldRequests.rewriteUrl(url), type)}),
      });
      cleanups.push(
        attachTileflowAtmosphere(map),
        attachTileflowNotices(map),
        attachTileflowNauticalLights(map),
        attachTileflowLabelPlacement(map),
        // Feature queries and taps keep working once a steep pitch shows the horizon.
        attachTileflowHorizonQueries(map),
      );
      themes = createTileflowThemeController({
        map,
        initial: style,
        loadFonts,
        loadStyle: styles.load,
        onTransition: reportTransition,
      });
      // The map's 3D scene mounts only once its style declares one, so 2D maps do not pay for it.
      scene = attachTileflowMap3D({
        map,
        controller: themes,
        viewMode: options.options.viewMode,
        ...(options.options.vegetation === null ? {} : {vegetation: options.options.vegetation}),
        load: () => Promise.resolve({createTileflowMap3D}),
        // The map continues in two dimensions; this is a warning, not a failure.
        onError: () => {
          if (!disposed)
            warnings.warn({
              code: 'resourceFailed',
              message: 'The 3D scene failed to load.',
              context: {resource: 'model', reason: 'scene'},
            });
        },
        transformRequest: (url) => ({url: address(url)}),
      });
      const current3D = scene;
      const themeController = themes;
      const shown = map;
      appearance = createMapScene({
        themes: themeController,
        attachment: current3D,
        read: readData,
        decode: decodeImage,
        boundaries: (settings) => createBoundaryFeatureState(shown, settings),
        depthMarkers: () => createTileflowDepthMarkers(shown),
        inksChanged: refreshInks,
      });
      cameras = createCameraController(map, {
        emit,
        wants: events.wants,
        // A shot and location following report their movement once, not once per frame.
        ignores: (event) => isShotFrame(event) || isLocationFrame(event),
        gesture: () => {
          animations?.gesture();
          location?.stopFollowing('gesture');
        },
      });
      const cameraController = cameras;
      location = createLocationController(map, {
        emit,
        clock,
        motion: (moving) => cameraController.reportMotion(moving, 'location'),
      });
      gestures = createGestureController(map, {emit, signal: lifetime.signal});
      applyOptions(options.options);
      if (options.insets) cameras.setInsets(options.insets);
      content = createMapContentRegistry(map, {
        emit,
        warn: warnings.warn,
        inks: () => themeController.getRouteInks(),
      });
      const contentRegistry = content;
      styleRegistry = createStyleRegistry(map as unknown as StyleMap, {
        readJSON: readJSONData,
        warn: (message) =>
          warnings.warn({
            code: 'rendererFailed',
            message,
            context: {reason: 'contentRestore'},
          }),
      });
      animations = createAnimations({
        emit,
        play: (motion, settings) =>
          playTileflowShot(
            {
              getCanvas: () => shown.getCanvas(),
              jumpTo: (next) => shown.jumpTo(next, shotFrame),
            },
            motion,
            settings,
          ),
        prepareBlend: async (names, position, signal) => {
          const prepared = await Promise.all(
            names.map((theme) => {
              const style = resolveTileflowRuntimeStyle({
                source: configuration!.source,
                manifestMap,
                theme,
              });
              if (!style)
                throw new ProtocolError('invalidRequest', 'The shot blends an unavailable theme.');
              return styles.prepare(style);
            }),
          );
          signal.throwIfAborted();
          appearanceRevision += 1;
          const result = await themeController.setBlend({themes: prepared, position});
          if (result.status === 'failed')
            throw new ProtocolError('resourceFailed', 'The theme blend could not be applied.');
          refreshInks();
          return (next) => {
            void themeController.setBlend({themes: prepared, position: next}).then(refreshInks);
          };
        },
        animateProgress: (request) => contentRegistry.animateProgress(request),
        stopProgress: (layers) => contentRegistry.stopProgress(layers),
        shotMoving: (moving) => cameraController.reportMotion(moving, 'api'),
      });
      map.on('load', () => {
        if (!disposed) emit('contentReady', () => ({camera: camera(), theme: style.theme}));
      });
      if (options.credits.length) {
        // Each regional credit shows while one of its boxes is in view.
        const creditMap = map;
        const update = () => {
          if (disposed || !activeOptions) return;
          const view = creditMap.getBounds();
          const sources = Object.values(creditMap.getStyle()?.sources ?? {})
            .map((source) => ('attribution' in source ? String(source.attribution ?? '') : ''))
            .join('\n');
          const entries = visibleCredits(options.credits, {
            west: view.getWest(),
            south: view.getSouth(),
            east: view.getEast(),
            north: view.getNorth(),
          })
            .filter((credit) => !sources.includes(credit.text))
            .map(creditHtml);
          if (entries.join('\n') === credits.join('\n')) return;
          credits = entries;
          cameras?.setAttribution(activeOptions.attribution, attributionControl, true);
        };
        creditMap.on('load', update);
        creditMap.on('moveend', update);
      }
      map.on('click', (event) => {
        const coordinate = {longitude: event.lngLat.lng, latitude: event.lngLat.lat};
        const point = {x: event.point.x, y: event.point.y};
        emit('tap', () => ({coordinate, point}));
      });
      map.on('error', (event) => {
        // The style registry reports a change MapLibre refuses as the request's own failure.
        if (disposed || styleRegistry?.capturing) return;
        const error = (event as {error?: {status?: unknown; url?: unknown}}).error;
        const url = typeof error?.url === 'string' ? error.url : undefined;
        const status =
          typeof error?.status === 'number' && error.status >= 100 && error.status <= 599
            ? error.status
            : undefined;
        const origin = url ? resourceOrigin(url) : undefined;
        const sourceId = (event as {sourceId?: unknown}).sourceId;
        const resource: ResourceKind =
          (url ? kinds.get(url) : undefined) ?? (typeof sourceId === 'string' ? 'source' : 'other');
        warnings.warn({
          code: 'resourceFailed',
          message: 'A map resource failed to load.',
          context: {
            resource,
            ...(origin ? {origin} : {}),
            ...(status === undefined ? {} : {status}),
          },
        });
      });
      map.getCanvas().addEventListener(
        'webglcontextlost',
        () => {
          if (!disposed)
            emit('error', () =>
              new ProtocolError('rendererFailed', 'The graphics context was lost.', {
                reason: 'graphicsContextLost',
              }).toWire(),
            );
        },
        {signal: lifetime.signal},
      );
      // The native host replays desired theme/content after initialize acknowledges. MapLibre
      // cannot accept style replacement while its initial style is still loading.
      const current = map;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          current.off('load', loaded);
          signal.removeEventListener('abort', cancelled);
          lifetime.signal.removeEventListener('abort', cancelled);
        };
        const loaded = () => {
          cleanup();
          resolve();
        };
        const cancelled = () => {
          cleanup();
          reject(new ProtocolError('cancelled', 'Initialization was cancelled.'));
        };
        current.on('load', loaded);
        signal.addEventListener('abort', cancelled, {once: true});
        lifetime.signal.addEventListener('abort', cancelled, {once: true});
        if (signal.aborted || lifetime.signal.aborted) cancelled();
        else if (current.loaded()) loaded();
      });
    } catch (error) {
      dispose();
      throw error;
    } finally {
      initializing = false;
    }
  }

  /** Reads JSON the host registered on the data channel. */
  async function readJSONData(reference: DataReference, signal: AbortSignal): Promise<unknown> {
    const bytes = await readData(reference, signal);
    try {
      return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)) as unknown;
    } catch {
      throw new ProtocolError('invalidRequest', 'The data is not valid JSON.', {resource: 'data'});
    }
  }

  const requireStyle = () => {
    requireMap();
    if (!styleRegistry) throw new ProtocolError('notReady', 'The map is not initialized.');
    return styleRegistry;
  };

  const requireScene = () => {
    requireMap();
    if (!appearance) throw new ProtocolError('notReady', 'The map is not initialized.');
    return appearance;
  };

  const cancelled = (signal: AbortSignal) => {
    assertActive();
    if (signal.aborted) throw new ProtocolError('cancelled', 'The request was cancelled.');
  };

  /** Reads each distinct payload once; data the current content already holds is reused. */
  async function resolveOverlays(
    overlays: readonly Overlay[],
    signal: AbortSignal,
  ): Promise<ResolvedOverlay[]> {
    const references = new Map(overlays.map((overlay) => [overlay.data.sha256, overlay.data]));
    const total = [...references.values()].reduce((sum, item) => sum + item.byteLength, 0);
    if (total > protocol.limits.maximumDataTotalBytes)
      throw new ProtocolError('invalidRequest', 'Application data exceeds its size limit.', {
        reason: 'dataTooLarge',
        resource: 'data',
        limit: protocol.limits.maximumDataTotalBytes,
      });
    const resolved = new Map<string, FeatureCollection>();
    await Promise.all(
      [...references.values()].map(async (reference) => {
        const held = content?.data(reference.sha256);
        if (held) {
          resolved.set(reference.sha256, held);
          return;
        }
        const bytes = await readData(reference, signal);
        let value: unknown;
        try {
          value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
        } catch {
          value = undefined;
        }
        const problem = geoJSONProblem(value);
        if (problem) {
          const layers = overlays
            .filter((overlay) => overlay.data.sha256 === reference.sha256)
            .map((overlay) => overlay.id)
            .join(', ');
          throw new ProtocolError(
            'invalidRequest',
            `GeoJSON for ${layers} is invalid at ${value === undefined ? '$' : problem}.`,
            {reason: 'invalidGeoJSON', resource: 'data'},
          );
        }
        resolved.set(reference.sha256, value as FeatureCollection);
      }),
    );
    return overlays.map(({data, ...overlay}) => ({
      ...overlay,
      data: resolved.get(data.sha256)!,
      digest: data.sha256,
    }));
  }

  return {
    dispose,
    /** Reads the payload of a request too large for a control message. */
    readPayload: (reference: DataReference, signal: AbortSignal) => readJSONData(reference, signal),
    async execute(command: Command, signal: AbortSignal): Promise<unknown> {
      cancelled(signal);
      switch (command.method) {
        case 'initialize':
          return initialize(command.payload, signal);
        case 'cancel':
          // The dispatcher answers cancellation itself.
          return null;
        case 'setEvents':
          events.set(command.payload.events);
          return null;
        case 'getCamera':
          return camera();
        case 'moveCamera':
          // A movement the application or a native control asks for ends location following.
          requireCamera();
          location?.stopFollowing(command.payload.reason);
          return requireCamera().move(command.payload, signal);
        case 'stopCamera':
          requireCamera().stop();
          location?.stopFollowing('api');
          return null;
        case 'cameraForBounds':
          return requireCamera().cameraForBounds(command.payload);
        case 'visibleBounds':
          return requireCamera().visibleBounds();
        case 'setInsets':
          requireCamera().setInsets(command.payload);
          return null;
        case 'setTheme': {
          const revision = ++appearanceRevision;
          requireMap();
          if (!configuration || !manifestMap || !themes)
            throw new ProtocolError('notReady', 'The map is not initialized.');
          const style = resolveTileflowRuntimeStyle({
            source: configuration.source,
            manifestMap,
            theme: command.payload.theme ?? undefined,
            colorScheme: command.payload.colorScheme ?? configuration.colorScheme,
            timeOfDay: command.payload.timeOfDay,
          });
          if (!style) throw new ProtocolError('resourceFailed', 'The theme is not available.');
          const prepared = await styles.prepare(style);
          signal.throwIfAborted();
          if (revision !== appearanceRevision) return {status: 'superseded'};
          assertActive();
          const result = await themes.setTheme(prepared, {
            transition: {duration: command.payload.duration},
          });
          if (result.status === 'failed')
            throw new ProtocolError('resourceFailed', 'The theme could not be applied.');
          refreshInks();
          return {status: result.status, theme: result.theme};
        }
        case 'setBlend': {
          const revision = ++appearanceRevision;
          requireMap();
          if (!configuration || !manifestMap || !themes)
            throw new ProtocolError('notReady', 'The map is not initialized.');
          const resolved = command.payload.themes.map((theme) =>
            resolveTileflowRuntimeStyle({source: configuration!.source, manifestMap, theme}),
          );
          if (resolved.some((style) => !style))
            throw new ProtocolError('invalidRequest', 'The blend contains an unavailable theme.');
          const prepared = await Promise.all(resolved.map((style) => styles.prepare(style!)));
          signal.throwIfAborted();
          if (revision !== appearanceRevision) return {status: 'superseded'};
          assertActive();
          const result = await themes.setBlend(
            {...command.payload, themes: prepared},
            {transition: {duration: command.payload.duration}},
          );
          if (result.status === 'failed')
            throw new ProtocolError('resourceFailed', 'The theme blend could not be applied.');
          refreshInks();
          return {status: result.status, theme: result.theme};
        }
        case 'setOptions':
          applyOptions(command.payload);
          return null;
        case 'setContent': {
          requireMap();
          const revision = ++contentRevision;
          const overlays = await resolveOverlays(command.payload.overlays, signal);
          cancelled(signal);
          // Reads finish out of order: content from a later call that already applied wins.
          if (revision < appliedContent) return {status: 'superseded'};
          content?.set({annotations: command.payload.annotations, overlays});
          appliedContent = revision;
          return null;
        }
        case 'project': {
          const point = requireMap().project([command.payload.longitude, command.payload.latitude]);
          return {x: point.x, y: point.y};
        }
        case 'unproject': {
          const coordinate = requireMap().unproject([command.payload.x, command.payload.y]).wrap();
          return {longitude: coordinate.lng, latitude: coordinate.lat};
        }
        case 'setVisibility': {
          const current = requireMap();
          input.container.style.visibility = command.payload.visible ? 'visible' : 'hidden';
          if (command.payload.visible) current.resize();
          else requireCamera().stop();
          return null;
        }
        case 'queryAtPoint':
          return requireMap()
            .queryRenderedFeatures([command.payload.x, command.payload.y])
            .slice(0, 50)
            .map((feature) => ({
              id: feature.id === undefined ? null : String(feature.id),
              source: feature.source,
              layer: feature.layer.id,
            }));
        case 'setViewMode':
          requireMap();
          // The view mode is part of the options the host replays to a new renderer.
          if (activeOptions) activeOptions = {...activeOptions, viewMode: command.payload.viewMode};
          return requireScene().setViewMode(command.payload);
        case 'setSun':
          return requireScene().setSun(command.payload);
        case 'setEmphasis':
          return requireScene().setEmphasis(command.payload, signal);
        case 'setStyleState':
          return requireScene().setStyleState(command.payload);
        case 'getRouteInks':
          return requireScene().routeInks();
        case 'setBoundaryValues':
          return requireScene().setBoundaryValues(command.payload, signal);
        case 'setImages':
          return requireScene().setImages(command.payload, signal);
        case 'setDepthMarkers':
          return requireScene().setDepthMarkers(command.payload);
        case 'animateLineProgress':
          requireMap();
          return animations!.animateProgress(command.payload);
        case 'playShot':
          requireMap();
          location!.stopFollowing('api');
          return animations!.playShot(command.payload, signal);
        case 'stopAnimation':
          requireMap();
          animations!.stop(command.payload.animation);
          return null;
        case 'updateLocation':
          requireMap();
          location!.update(command.payload);
          return null;
        case 'setFollowMode':
          requireMap();
          location!.follow(command.payload);
          return null;
        case 'addSource':
          return requireStyle().addSource(command.payload, signal);
        case 'removeSource':
          return requireStyle().removeSource(command.payload, signal);
        case 'setGeoJSONSourceData':
          return requireStyle().setGeoJSONSourceData(command.payload, signal);
        case 'updateGeoJSONSource':
          return requireStyle().updateGeoJSONSource(command.payload, signal);
        case 'addLayer':
          return requireStyle().addLayer(command.payload, signal);
        case 'updateLayer':
          return requireStyle().updateLayer(command.payload, signal);
        case 'moveLayer':
          return requireStyle().moveLayer(command.payload, signal);
        case 'removeLayer':
          return requireStyle().removeLayer(command.payload, signal);
        case 'setFeatureState':
          return requireStyle().setFeatureState(command.payload, signal);
        case 'getFeatureState':
          return requireStyle().getFeatureState(command.payload, signal);
        case 'removeFeatureState':
          return requireStyle().removeFeatureState(command.payload, signal);
        case 'queryRenderedFeatures':
          return requireStyle().queryRenderedFeatures(command.payload, signal);
        case 'querySourceFeatures':
          return requireStyle().querySourceFeatures(command.payload, signal);
        case 'queryCluster':
          return requireStyle().queryCluster(command.payload, signal);
        case 'readResult':
          // The dispatcher answers result reads itself.
          return null;
        case 'dispose':
          return dispose();
      }
    },
  };
}
