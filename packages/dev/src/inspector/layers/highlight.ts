import type {GeoJSONSource, MapGeoJSONFeature, Map as MapLibreMap} from 'maplibre-gl';
import {mapValue} from '../map-value';

const sourceId = '__tileflow-inspector-layers-preview';
const layerIds = ['area', 'line', 'point'].map((part) => `${sourceId}-${part}`);

/** Scratch overlay only. Original paint, layout, feature state and source data are untouched. */
export class LayerHighlight {
  private map?: MapLibreMap;
  show(map: MapLibreMap, features: MapGeoJSONFeature[]) {
    if (this.map && this.map !== map) this.clear();
    this.map = map;
    let vertices = 0;
    const bounded = features.slice(0, 30).filter((feature) => {
      let count = 0;
      const visit = (node: unknown): void => {
        if (!Array.isArray(node) || count > 25000) return;
        if (typeof node[0] === 'number') count++;
        else node.forEach(visit);
      };
      if ('coordinates' in feature.geometry) visit(feature.geometry.coordinates);
      if (vertices + count > 25000) return false;
      vertices += count;
      return true;
    });
    if (!bounded.length) {
      this.clear();
      return false;
    }
    const data = mapValue(map, {
      type: 'FeatureCollection' as const,
      features: bounded.map((feature) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: feature.geometry,
      })),
    });
    try {
      const existing = map.getSource(sourceId) as GeoJSONSource | undefined;
      if (existing) existing.setData(data);
      else {
        map.addSource(sourceId, mapValue(map, {type: 'geojson', data}));
        map.addLayer(
          mapValue(map, {
            id: layerIds[0],
            type: 'fill',
            source: sourceId,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: {'fill-color': '#1a73e8', 'fill-opacity': 0.25},
          }),
        );
        map.addLayer(
          mapValue(map, {
            id: layerIds[1],
            type: 'line',
            source: sourceId,
            paint: {'line-color': '#1a73e8', 'line-width': 2.5},
          }),
        );
        map.addLayer(
          mapValue(map, {
            id: layerIds[2],
            type: 'circle',
            source: sourceId,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
              'circle-color': '#1a73e8',
              'circle-radius': 6,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2,
            },
          }),
        );
      }
      return true;
    } catch {
      this.clear();
      return false;
    }
  }
  clear() {
    try {
      for (const id of [...layerIds].reverse())
        if (this.map?.getLayer(id)) this.map.removeLayer(id);
      if (this.map?.getSource(sourceId)) this.map.removeSource(sourceId);
    } catch {
      /* The old map may already have been disposed. */
    }
    this.map = undefined;
  }
}
