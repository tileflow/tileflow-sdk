import * as maplibregl from 'maplibre-gl';
import type {Map as MapLibreMap, StyleSpecification} from 'maplibre-gl';
import {
  attachTileflowAtmosphere,
  attachTileflowFairUseNotice,
  attachTileflowLabelPlacement,
  attachTileflowMap3D,
  attachTileflowNauticalLights,
  attachTileflowNotices,
  createTileflowMap3D,
  createTileflowThemeController,
  loadTileflowStyleFonts,
  registerTileflowContourProtocol,
  registerTileflowPmtilesProtocol,
  registerTileflowWorldRequestBridge,
  tileflowCanvasContextAttributes,
  type TileflowMap3DAttachment,
  tileflowMaxPitch,
  type TileflowThemeController,
} from '@tileflow/core/browser';
import {
  resolveTileflowManifestMap,
  resolveTileflowRuntimeStyle,
  resolveTileflowRuntimeView,
  type TileflowRuntimeManifestMap,
  type TileflowRuntimeStyle,
} from '@tileflow/core/runtime';
import type {Overlay} from './content-contract';
import {createMapContentRegistry, type ResolvedOverlay} from './content-registry';
import {createDataReader} from './data';
import {
  apiCameraChange as api,
  cameraReason,
  type Clock,
  createEventHub,
  createWarningAggregator,
  type Producer,
  systemClock,
} from './events';
import {type FeatureCollection, geoJSONProblem} from './geojson';
import {loadMobileManifest} from './manifest';
import {
  type Camera,
  type CameraReason,
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
  let controls: maplibregl.NavigationControl | undefined;
  let activeOptions: MapOptions | undefined;
  let content: ReturnType<typeof createMapContentRegistry> | undefined;
  let appearanceRevision = 0;
  let manifestMap: TileflowRuntimeManifestMap | undefined;
  let configuration: InitializeOptions | undefined;
  const cleanups: (() => void)[] = [];
  let cameraFrame: number | undefined;
  let disposed = false;
  let initializing = false;
  let cameraRevision = 0;
  let contentRevision = 0;
  let appliedContent = 0;
  let movement: CameraReason = 'system';
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
  const camera = (): Camera => {
    const current = requireMap();
    const center = current.getCenter().wrap();
    return {
      longitude: center.lng,
      latitude: center.lat,
      zoom: current.getZoom(),
      bearing: current.getBearing(),
      pitch: current.getPitch(),
    };
  };
  const loadFonts = (style: TileflowRuntimeStyle) =>
    loadTileflowStyleFonts(style.style, {fontFaces: style.fontFaces, fetch: fetchResource});
  const emitCamera = (event: 'cameraMoveStarted' | 'cameraMoved' | 'cameraMoveEnded') => {
    const reason = movement;
    emit(event, () => ({camera: camera(), reason, revision: ++cameraRevision}));
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    lifetime.abort();
    events.dispose();
    warnings.dispose();
    content?.dispose();
    if (cameraFrame !== undefined) cancelAnimationFrame(cameraFrame);
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
    const {pan, zoom, rotate, pitch} = options.gestures;
    if (pan) current.dragPan.enable();
    else current.dragPan.disable();
    if (zoom) current.scrollZoom.enable();
    else current.scrollZoom.disable();
    if (zoom) current.doubleClickZoom.enable();
    else current.doubleClickZoom.disable();
    if (zoom) {
      current.touchZoomRotate.enable();
      if (rotate) current.touchZoomRotate.enableRotation();
      else current.touchZoomRotate.disableRotation();
    } else current.touchZoomRotate.disable();
    if (rotate) current.dragRotate.enable();
    else current.dragRotate.disable();
    if (pitch) current.touchPitch.enable();
    else current.touchPitch.disable();
    if (current.getPixelRatio() !== pixelRatio(options)) current.setPixelRatio(pixelRatio(options));
    if (options.controls && !controls) {
      controls = new maplibregl.NavigationControl({visualizePitch: true});
      current.addControl(controls, 'top-right');
    } else if (!options.controls && controls) {
      current.removeControl(controls);
      controls = undefined;
    }
    if (previous?.viewMode !== options.viewMode) scene?.setViewMode(options.viewMode);
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
        attributionControl: {compact: true},
        canvasContextAttributes: tileflowCanvasContextAttributes(),
        // Tileflow's compiled styles are validated when they are built.
        validateStyle: false,
        maxPitch: tileflowMaxPitch,
        transformRequest: (url, type) => ({url: address(worldRequests.rewriteUrl(url), type)}),
      });
      cleanups.push(
        attachTileflowAtmosphere(map),
        attachTileflowNotices(map),
        attachTileflowNauticalLights(map),
        attachTileflowLabelPlacement(map),
      );
      themes = createTileflowThemeController({
        map,
        initial: style,
        loadFonts,
        loadStyle: styles.load,
        onTransition: (transition) => {
          if (!disposed && transition.phase === 'ready') {
            const theme = transition.currentTheme ?? transition.targetTheme;
            emit('themeChanged', () => ({theme}));
          }
        },
      });
      // The map's 3D scene mounts only once its style declares one, so 2D maps do not pay for it.
      scene = attachTileflowMap3D({
        map,
        controller: themes,
        viewMode: options.options.viewMode,
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
      applyOptions(options.options);
      content = createMapContentRegistry(map, {emit, warn: warnings.warn});
      map.on('load', () => {
        if (!disposed) emit('contentReady', () => ({camera: camera(), theme: style.theme}));
      });
      map.on('movestart', (event) => {
        movement = cameraReason(event);
        emitCamera('cameraMoveStarted');
      });
      map.on('move', (event) => {
        // A gesture can take over a movement that an animation started.
        if (cameraReason(event) === 'gesture') movement = 'gesture';
        if (cameraFrame !== undefined || !events.wants('cameraMoved')) return;
        cameraFrame = requestAnimationFrame(() => {
          cameraFrame = undefined;
          emitCamera('cameraMoved');
        });
      });
      map.on('moveend', () => {
        if (cameraFrame !== undefined) cancelAnimationFrame(cameraFrame);
        cameraFrame = undefined;
        // The settled camera supersedes any update still waiting for its interval.
        events.discard('cameraMoved');
        emitCamera('cameraMoveEnded');
      });
      map.on('click', (event) => {
        const coordinate = {longitude: event.lngLat.lng, latitude: event.lngLat.lat};
        const point = {x: event.point.x, y: event.point.y};
        emit('tap', () => ({coordinate, point}));
      });
      map.on('error', (event) => {
        if (disposed) return;
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
        case 'setCamera': {
          const current = requireMap();
          const next = command.payload.camera;
          current.easeTo(
            {
              center: [next.longitude, next.latitude],
              zoom: next.zoom,
              bearing: next.bearing,
              pitch: next.pitch,
              duration: command.payload.duration,
            },
            api,
          );
          return null;
        }
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
        case 'fitBounds': {
          const {west, south, east, north, ...options} = command.payload;
          requireMap().fitBounds(
            [
              [west, south],
              [east < west ? east + 360 : east, north],
            ],
            options,
            api,
          );
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
          else current.stop();
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
        case 'dispose':
          return dispose();
      }
    },
  };
}
