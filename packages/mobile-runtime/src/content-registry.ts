import {
  type GeoJSONSource,
  type MapEventType,
  type Map as MapLibreMap,
  Marker,
  type PointLike,
} from 'maplibre-gl';
import {
  createTileflowGroundLayers,
  createTileflowLineProgress,
  type TileflowGroundLayers,
  type TileflowGroundLayersMap,
  type TileflowLineProgressController,
  type TileflowLineProgressMap,
  type TileflowLineProgressShown,
  type TileflowRouteInks,
} from '@tileflow/core/browser';
import type {TileflowAnnotation} from '@tileflow/interactions';
import {
  createTileflowAnnotationRegistry,
  createTileflowMapLibrePoiController,
} from '@tileflow/interactions/maplibre';
import type {Overlay} from './content-contract';
import type {Producer, Warning} from './events';
import type {FeatureCollection} from './geojson';
import {overlayPaint, progressLayer} from './overlay-style';
import type {EventName} from './protocol';
import {ProtocolError} from './protocol';
import type {LineProgressAnimation} from './scene-contract';

/** An overlay whose data the runtime has read from the data channel and validated. */
export type ResolvedOverlay = Omit<Overlay, 'data'> & {data: FeatureCollection; digest: string};
type Content = {annotations: TileflowAnnotation[]; overlays: ResolvedOverlay[]};

/** Application content has its own namespace and survives authored style replacement. */
export function createMapContentRegistry(
  map: MapLibreMap,
  output: {
    emit: (event: EventName, produce: Producer) => void;
    warn: (warning: Warning) => void;
    /** The route inks of the theme on screen, for layers drawn in a route ink. */
    inks: () => TileflowRouteInks;
  },
) {
  let content: Content = {annotations: [], overlays: []};
  let disposed = false;
  let dirty = false;
  const prefix = '__tileflow_app_';
  const owned = new Set<string>();
  // What each source last received: its data's digest and whether it measures line progress.
  const applied = new Map<string, string>();
  let ground: TileflowGroundLayers | undefined;
  const progress = new Map<string, TileflowLineProgressController>();
  // What each progress line shows, with the declared state it started from: a style change keeps
  // what an animation reached, while new content with a different declared state replaces it.
  const progressShown = new Map<string, {declared: string; shown: TileflowLineProgressShown}>();
  let inks = output.inks();
  // Requests that need the content on the map wait for the next restore.
  const restored: (() => void)[] = [];
  const emit = output.emit;
  const annotationRegistry = createTileflowAnnotationRegistry({
    context: map,
    getKey: (definition: TileflowAnnotation) => definition.id,
    create: (map, definition) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'tileflow-annotation';
      const state = {definition, element, marker: new Marker({element})};
      const update = () => {
        element.setAttribute('aria-label', state.definition.ariaLabel);
        element.style.color = state.definition.marker?.color ?? '#e9573f';
        state.marker.setLngLat([...state.definition.coordinate]);
      };
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!disposed)
          emit('annotationActivated', () => ({
            id: state.definition.id,
            coordinate: {
              longitude: state.definition.coordinate[0],
              latitude: state.definition.coordinate[1],
            },
          }));
      });
      update();
      state.marker.addTo(map);
      return {
        ...state,
        update(next: TileflowAnnotation) {
          state.definition = next;
          update();
        },
      };
    },
    update: (instance, _map, next) => instance.update(next),
    remove: (instance) => instance.marker.remove(),
  });
  const poi = createTileflowMapLibrePoiController({
    map: {
      getStyle: () => map.getStyle(),
      on: (name, listener) => map.on(name as keyof MapEventType, listener),
      off: (name, listener) => map.off(name as keyof MapEventType, listener),
      queryRenderedFeatures: (point, options) =>
        map.queryRenderedFeatures(point as PointLike, {layers: [...options.layers]}),
    },
    bindings: [{id: 'mobile-poi', target: {kind: 'semantic-feature', domain: 'poi'}}],
    // Window methods throw when called on another object, as the controller calls them.
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    onActivate: ({target}) => {
      if (!disposed)
        emit('poiActivated', () => ({
          id: target.feature.id === undefined ? null : String(target.feature.id),
          coordinate: {longitude: target.coordinate[0], latitude: target.coordinate[1]},
          name: target.feature.properties.name ?? null,
          category: target.feature.category,
        }));
    },
  });
  const layerId = (overlay: ResolvedOverlay) => `${prefix}${overlay.id}`;
  /** Where a layer's paint goes: its ground group keeps it for when a style change re-adds it. */
  const painter = (
    overlay: ResolvedOverlay,
  ): {setPaintProperty(layer: string, name: string, value: unknown): unknown} =>
    overlay.placement === 'ground' && ground
      ? ground
      : (map as unknown as {
          setPaintProperty(layer: string, name: string, value: unknown): unknown;
        });
  const specOf = (overlay: ResolvedOverlay) => {
    const id = layerId(overlay);
    const paint = overlayPaint(overlay, inks);
    return {
      id,
      source: id,
      type: overlay.kind,
      paint,
      ...(overlay.kind === 'line' ? {layout: {'line-cap': 'round', 'line-join': 'round'}} : {}),
    };
  };
  const stopProgress = () => {
    for (const [id, controller] of progress) {
      const record = progressShown.get(id);
      if (record) record.shown = controller.get();
      controller.dispose();
    }
    progress.clear();
  };
  const startProgress = () => {
    const kept = new Set<string>();
    for (const overlay of content.overlays) {
      if (!overlay.progress) continue;
      const {highlight, ...declared} = overlay.progress;
      const key = JSON.stringify(declared);
      const record = progressShown.get(overlay.id);
      const initial =
        record?.declared === key ? record.shown : {...declared, light: declared.light ?? undefined};
      const target: TileflowLineProgressMap =
        overlay.placement === 'ground' && ground ? ground : (map as TileflowLineProgressMap);
      const controller = createTileflowLineProgress(target, {
        layers: [progressLayer(layerId(overlay), overlay, inks, highlight)],
        initial,
      });
      progress.set(overlay.id, controller);
      progressShown.set(overlay.id, {declared: key, shown: controller.get()});
      kept.add(overlay.id);
    }
    for (const id of progressShown.keys()) if (!kept.has(id)) progressShown.delete(id);
  };
  const restore = () => {
    if (disposed || !dirty || !map.isStyleLoaded()) return;
    stopProgress();
    // The ground group is rebuilt with the content; it takes its layers off the map first.
    ground?.dispose();
    ground = undefined;
    const desired = new Set(content.overlays.map(layerId));
    for (const id of owned) {
      if (desired.has(id)) continue;
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
      owned.delete(id);
      applied.delete(id);
    }
    for (const overlay of content.overlays) {
      const id = layerId(overlay);
      if (!owned.has(id) && (map.getSource(id) || map.getLayer(id)))
        throw new Error('Application content conflicts with the authored map.');
      owned.add(id);
      const lineMetrics = overlay.progress !== undefined;
      const key = `${overlay.digest}:${lineMetrics}`;
      let source = map.getSource(id) as GeoJSONSource | undefined;
      if (map.getLayer(id)) map.removeLayer(id);
      // Line metrics are fixed when a source is created.
      if (source && applied.get(id)?.endsWith(`:${lineMetrics}`) === false) {
        map.removeSource(id);
        source = undefined;
      }
      if (!source) map.addSource(id, {type: 'geojson', data: overlay.data, lineMetrics});
      else if (applied.get(id) !== key) source.setData(overlay.data);
      applied.set(id, key);
      if (overlay.placement === 'top')
        map.addLayer(specOf(overlay) as Parameters<MapLibreMap['addLayer']>[0]);
    }
    const groundOverlays = content.overlays.filter((overlay) => overlay.placement === 'ground');
    if (groundOverlays.length > 0)
      // The group places its layers under the map's labels and 3D content, and keeps them there
      // as 3D layers arrive.
      ground = createTileflowGroundLayers(map as unknown as TileflowGroundLayersMap, {
        layers: groundOverlays.map(specOf),
        occludedOpacity: Object.fromEntries(
          groundOverlays
            .filter((overlay) => overlay.occludedOpacity > 0)
            .map((overlay) => [layerId(overlay), overlay.occludedOpacity]),
        ),
      });
    startProgress();
    dirty = false;
    for (const resolve of restored.splice(0)) resolve();
  };
  const onStyleLoaded = () => {
    // A new style has none of the application's sources.
    applied.clear();
    inks = output.inks();
    dirty = true;
    onIdle();
  };
  const onIdle = () => {
    try {
      restore();
    } catch {
      output.warn({
        code: 'rendererFailed',
        message: 'Application content could not be restored.',
        context: {reason: 'contentRestore'},
      });
    }
  };
  map.on('style.load', onStyleLoaded);
  map.on('idle', onIdle);
  return {
    /** Data held by the current overlays, so content that did not change is not read again. */
    data(digest: string): FeatureCollection | undefined {
      return content.overlays.find((overlay) => overlay.digest === digest)?.data;
    },
    set(next: Content) {
      const previous = content;
      try {
        content = next;
        dirty = true;
        restore();
        annotationRegistry.reconcile(next.annotations);
      } catch (error) {
        content = previous;
        dirty = true;
        restore();
        throw error;
      }
    },
    /**
     * Repaints layers drawn in route inks after the theme on screen changes or a blend moves. Only
     * values that changed reach the map.
     */
    setInks(next: TileflowRouteInks) {
      if (disposed || JSON.stringify(next) === JSON.stringify(inks)) return;
      inks = next;
      if (dirty) return;
      for (const overlay of content.overlays) {
        if (!overlay.ink) continue;
        const id = layerId(overlay);
        const controller = progress.get(overlay.id);
        if (controller) {
          controller.configure({
            layers: [progressLayer(id, overlay, inks, overlay.progress?.highlight)],
          });
          continue;
        }
        if (!map.getLayer(id)) continue;
        const target = painter(overlay);
        for (const [name, value] of Object.entries(overlayPaint(overlay, inks)))
          target.setPaintProperty(id, name, value);
      }
    },
    /**
     * Moves the drawn stretch of line layers drawn with progress, together, once the content is on
     * the map. `finished` resolves true when every layer gets there, false when something stops it
     * first.
     */
    async animateProgress(request: LineProgressAnimation): Promise<{finished: Promise<boolean>}> {
      if (dirty) {
        await new Promise<void>((resolve) => restored.push(resolve));
        if (disposed) throw new ProtocolError('disposed', 'The map is disposed.');
      }
      const controllers = request.layers.map((id) => progress.get(id));
      const missing = request.layers.filter((_, index) => !controllers[index]);
      if (missing.length > 0)
        throw new ProtocolError(
          'invalidRequest',
          `These layers are not line layers drawn with progress: ${missing.join(', ')}.`,
          {reason: 'unknownLayer'},
        );
      const {light, ...to} = request.to;
      const target = {...to, ...(light === undefined ? {} : {light: light ?? undefined})};
      return {
        finished: Promise.all(
          controllers.map((controller) =>
            controller!.animate({to: target, duration: request.duration}),
          ),
        ).then((finished) => finished.every(Boolean)),
      };
    },
    /** Stops line progress animations where they are. */
    stopProgress(layers: readonly string[]) {
      for (const id of layers) {
        const controller = progress.get(id);
        if (controller) controller.set({});
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const resolve of restored.splice(0)) resolve();
      map.off('style.load', onStyleLoaded);
      map.off('idle', onIdle);
      stopProgress();
      poi.dispose();
      annotationRegistry.dispose();
      ground?.dispose();
      ground = undefined;
      for (const id of owned) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
      owned.clear();
      applied.clear();
    },
  };
}
