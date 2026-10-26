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
import type {MapContent} from './content-contract';
import type {EventName} from './protocol';

/** Application content has its own namespace and survives authored style replacement. */
export function createMapContentRegistry(
  map: MapLibreMap,
  emit: (event: EventName, value: unknown) => void,
) {
  let content: MapContent = {annotations: [], overlays: []};
  let disposed = false;
  let dirty = false;
  const prefix = '__tileflow_app_';
  const owned = new Set<string>();
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
          emit('annotationActivated', {
            id: state.definition.id,
            coordinate: {
              longitude: state.definition.coordinate[0],
              latitude: state.definition.coordinate[1],
            },
          });
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
        emit('poiActivated', {
          id: target.feature.id === undefined ? null : String(target.feature.id),
          coordinate: {longitude: target.coordinate[0], latitude: target.coordinate[1]},
          name: target.feature.properties.name ?? null,
          category: target.feature.category,
        });
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
    }
    for (const overlay of content.overlays) {
      const id = `${prefix}${overlay.id}`;
      if (!owned.has(id) && (map.getSource(id) || map.getLayer(id)))
        throw new Error('Application content conflicts with the authored map.');
      owned.add(id);
      const source = map.getSource(id) as GeoJSONSource | undefined;
      if (source) source.setData(overlay.data);
      else map.addSource(id, {type: 'geojson', data: overlay.data});
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
    dirty = true;
    onIdle();
  };
  const onIdle = () => {
    try {
      restore();
    } catch {
      emit('error', {
        code: 'rendererFailed',
        message: 'Application content could not be restored.',
      });
    }
  };
  map.on('style.load', onStyleLoaded);
  map.on('idle', onIdle);
  return {
    set(next: MapContent) {
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
    },
  };
}
