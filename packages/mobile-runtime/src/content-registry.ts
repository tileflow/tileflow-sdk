import {
  type GeoJSONSource,
  type MapEventType,
  type Map as MapLibreMap,
  Marker,
  type PointLike,
} from 'maplibre-gl';
import type {TileflowAnnotation} from '@tileflow/interactions';
import {
  createTileflowAnnotationRegistry,
  createTileflowMapLibrePoiController,
} from '@tileflow/interactions/maplibre';
import type {Overlay} from './content-contract';
import type {Producer, Warning} from './events';
import type {FeatureCollection} from './geojson';
import type {EventName} from './protocol';

/** An overlay whose data the runtime has read from the data channel and validated. */
export type ResolvedOverlay = Omit<Overlay, 'data'> & {data: FeatureCollection; digest: string};
type Content = {annotations: TileflowAnnotation[]; overlays: ResolvedOverlay[]};

/** Application content has its own namespace and survives authored style replacement. */
export function createMapContentRegistry(
  map: MapLibreMap,
  output: {emit: (event: EventName, produce: Producer) => void; warn: (warning: Warning) => void},
) {
  let content: Content = {annotations: [], overlays: []};
  let disposed = false;
  let dirty = false;
  const prefix = '__tileflow_app_';
  const owned = new Set<string>();
  // The digest each source last received, so unchanged data is not sent to the worker again.
  const applied = new Map<string, string>();
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
    requestFrame: requestAnimationFrame,
    cancelFrame: cancelAnimationFrame,
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
  const restore = () => {
    if (disposed || !dirty || !map.isStyleLoaded()) return;
    const desired = new Set(content.overlays.map((item) => `${prefix}${item.id}`));
    for (const id of owned) {
      if (desired.has(id)) continue;
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
      owned.delete(id);
      applied.delete(id);
    }
    for (const overlay of content.overlays) {
      const id = `${prefix}${overlay.id}`;
      if (!owned.has(id) && (map.getSource(id) || map.getLayer(id)))
        throw new Error('Application content conflicts with the authored map.');
      owned.add(id);
      const source = map.getSource(id) as GeoJSONSource | undefined;
      if (!source) map.addSource(id, {type: 'geojson', data: overlay.data});
      else if (applied.get(id) !== overlay.digest) source.setData(overlay.data);
      applied.set(id, overlay.digest);
      if (map.getLayer(id)) map.removeLayer(id);
      if (overlay.kind === 'circle')
        map.addLayer({
          id,
          source: id,
          type: 'circle',
          paint: {
            'circle-color': overlay.color,
            'circle-radius': overlay.size,
            'circle-opacity': overlay.opacity,
          },
        });
      else if (overlay.kind === 'line')
        map.addLayer({
          id,
          source: id,
          type: 'line',
          paint: {
            'line-color': overlay.color,
            'line-width': overlay.size,
            'line-opacity': overlay.opacity,
          },
        });
      else
        map.addLayer({
          id,
          source: id,
          type: 'fill',
          paint: {'fill-color': overlay.color, 'fill-opacity': overlay.opacity},
        });
    }
    dirty = false;
  };
  const onStyleLoaded = () => {
    // A new style has none of the application's sources.
    applied.clear();
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
    dispose() {
      if (disposed) return;
      disposed = true;
      map.off('style.load', onStyleLoaded);
      map.off('idle', onIdle);
      poi.dispose();
      annotationRegistry.dispose();
      for (const id of owned) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
      owned.clear();
      applied.clear();
    },
  };
}
