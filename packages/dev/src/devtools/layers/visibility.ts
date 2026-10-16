import type {Map as MapLibreMap} from 'maplibre-gl';
import {internalLayer, type LayerRecord} from './model';

const featureTypes = new Set(['fill', 'line', 'symbol', 'circle', 'fill-extrusion', 'heatmap']);

/** One viewport query for the whole list. Unknown custom/raster visibility is not treated as empty. */
export function layersInView(map: MapLibreMap, layers: LayerRecord[]): Set<string> | undefined {
  const zoom = map.getZoom();
  const eligible = layers.filter(
    (layer) =>
      !internalLayer(layer.id) &&
      map.getLayer(layer.id) &&
      layer.layout.visibility !== 'none' &&
      zoom >= layer.minzoom &&
      zoom < layer.maxzoom &&
      layer.runtime?.state.shown !== false &&
      layer.runtime?.state.mounted !== false &&
      layer.runtime?.state.representation !== 'none',
  );
  const queried = eligible.filter((layer) => featureTypes.has(layer.type));
  const ids = new Set(
    eligible.filter((layer) => !featureTypes.has(layer.type)).map((layer) => layer.id),
  );
  if (!queried.length) return ids;
  try {
    const allowed = new Set(queried.map((layer) => layer.id));
    for (const feature of map.queryRenderedFeatures(undefined, {layers: [...allowed]})) {
      if (allowed.has(feature.layer.id)) ids.add(feature.layer.id);
    }
    return ids;
  } catch {
    // A style can be replaced between inventory and query. Retry after its next settled update.
    return undefined;
  }
}
