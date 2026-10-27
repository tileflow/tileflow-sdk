import * as maplibregl from 'maplibre-gl';
import type {Map as MapLibreMap, StyleSpecification} from 'maplibre-gl';
import {
  attachTileflowAtmosphere,
  createTileflowBuildings3D,
  createTileflowStreetLights,
  createTileflowThemeController,
  createTileflowVegetation,
  loadTileflowStyleFonts,
  registerTileflowContourProtocol,
  registerTileflowPmtilesProtocol,
  type TileflowBuildings3D,
  type TileflowStreetLights,
  type TileflowThemeController,
  type TileflowVegetationController,
} from '@tileflow/core/browser';
import {
  resolveTileflowManifestMap,
  resolveTileflowRuntimeStyle,
  resolveTileflowRuntimeView,
  type TileflowRuntimeManifestMap,
  type TileflowRuntimeStyle,
} from '@tileflow/core/runtime';
import {createMapContentRegistry} from './content-registry';
import {loadMobileManifest} from './manifest';
import {
  type Camera,
  type Command,
  type EventName,
  type InitializeOptions,
  type MapOptions,
  ProtocolError,
} from './protocol';
import {
  createResourceFetch,
  resourceAddress,
  type ResourcePlatform,
  resourceTemplateAddress,
} from './resources';
import {createStyleResourceLoader} from './style-resources';

/** Composes existing Core controllers. This module owns no account, grant or web session. */
export function createMobileMapRuntime(input: {
  container: HTMLElement;
  platform: ResourcePlatform;
  emit: (event: EventName, result: unknown) => void;
}) {
  const lifetime = new AbortController();
  const fetchResource = createResourceFetch(input.platform, lifetime.signal);
  const styles = createStyleResourceLoader(fetchResource, lifetime.signal);
  let map: MapLibreMap | undefined;
  let themes: TileflowThemeController | undefined;
  let vegetation: TileflowVegetationController | undefined;
  let buildings: TileflowBuildings3D | undefined;
  let streetLights: TileflowStreetLights | undefined;
  let controls: maplibregl.NavigationControl | undefined;
  let activeOptions: MapOptions | undefined;
  let content: ReturnType<typeof createMapContentRegistry> | undefined;
  let appearanceRevision = 0;
  let manifestMap: TileflowRuntimeManifestMap | undefined;
  let configuration: InitializeOptions | undefined;
  let detachAtmosphere: (() => void) | undefined;
  let cameraFrame: number | undefined;
  let disposed = false;
  let initializing = false;
  let cameraRevision = 0;
  const address = (url: string) => {
    // These Core protocols route their nested archive/DEM requests through the same transport.
    if (url.startsWith('tileflow-pmtiles://') || url.startsWith('tileflow-contour://')) return url;
    return resourceAddress(url, input.platform);
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
  const emitCamera = (final: boolean) => {
    if (disposed || !map) return;
    input.emit('cameraChanged', {camera: camera(), revision: ++cameraRevision, final});
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    lifetime.abort();
    content?.dispose();
    if (cameraFrame !== undefined) cancelAnimationFrame(cameraFrame);
    vegetation?.dispose();
    buildings?.dispose();
    streetLights?.dispose();
    themes?.dispose();
    detachAtmosphere?.();
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
    if (previous?.viewMode !== options.viewMode || previous?.quality !== options.quality) {
      vegetation?.dispose();
      buildings?.dispose();
      streetLights?.dispose();
      buildings = undefined;
      streetLights = undefined;
      const common = {
        map: current,
        controller: themes,
        maxTiles: {low: 9, balanced: 25, high: 49}[options.quality],
        transformRequest: (url: string) => ({url: address(url)}),
      };
      vegetation = createTileflowVegetation({...common, viewMode: options.viewMode});
      if (options.viewMode === '3d') {
        buildings = createTileflowBuildings3D(common);
        streetLights = createTileflowStreetLights(common);
      }
    }
  }

  async function initialize(options: InitializeOptions, signal: AbortSignal) {
    assertActive();
    if (map || initializing)
      throw new ProtocolError('invalidRequest', 'The map is already initialized.');
    initializing = true;
    configuration = options;
    input.emit('loading', null);
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
        transformRequest: (url) => ({url: address(url)}),
      });
      detachAtmosphere = attachTileflowAtmosphere(map);
      themes = createTileflowThemeController({
        map,
        initial: style,
        loadFonts,
        loadStyle: styles.load,
        onTransition: (transition) => {
          if (!disposed && transition.phase === 'ready') {
            input.emit('themeChanged', {theme: transition.currentTheme ?? transition.targetTheme});
          }
        },
      });
      applyOptions(options.options);
      content = createMapContentRegistry(map, input.emit);
      map.on('load', () => {
        if (!disposed) input.emit('contentReady', {camera: camera(), theme: style.theme});
      });
      map.on('move', () => {
        if (cameraFrame !== undefined) return;
        cameraFrame = requestAnimationFrame(() => {
          cameraFrame = undefined;
          emitCamera(false);
        });
      });
      map.on('moveend', () => {
        if (cameraFrame !== undefined) cancelAnimationFrame(cameraFrame);
        cameraFrame = undefined;
        emitCamera(true);
      });
      map.on('click', (event) => {
        input.emit('interaction', {
          coordinate: {longitude: event.lngLat.lng, latitude: event.lngLat.lat},
          point: {x: event.point.x, y: event.point.y},
        });
      });
      map.on('error', () => {
        if (!disposed)
          input.emit('error', {code: 'resourceFailed', message: 'A map resource failed to load.'});
      });
      map.getCanvas().addEventListener(
        'webglcontextlost',
        () => {
          if (!disposed)
            input.emit('error', {
              code: 'rendererFailed',
              message: 'The graphics context was lost.',
            });
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

  return {
    dispose,
    async execute(command: Command, signal: AbortSignal): Promise<unknown> {
      assertActive();
      if (signal.aborted) throw new ProtocolError('cancelled', 'The request was cancelled.');
      switch (command.method) {
        case 'initialize':
          return initialize(command.payload, signal);
        case 'getCamera':
          return camera();
        case 'setCamera': {
          const current = requireMap();
          const next = command.payload.camera;
          current.easeTo({
            center: [next.longitude, next.latitude],
            zoom: next.zoom,
            bearing: next.bearing,
            pitch: next.pitch,
            duration: command.payload.duration,
          });
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
        case 'setContent':
          requireMap();
          content?.set(command.payload);
          return null;
        case 'fitBounds': {
          const {west, south, east, north, ...options} = command.payload;
          requireMap().fitBounds(
            [
              [west, south],
              [east < west ? east + 360 : east, north],
            ],
            options,
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
