import {
  createPropertyExpression,
  featureFilter,
  ZoomConstantExpression,
  ZoomDependentExpression,
} from '@maplibre/maplibre-gl-style-spec';
import type {MapGeoJSONFeature, Map as MapLibreMap} from 'maplibre-gl';
import {propertySpec} from '../style-edits';
import {type Evidence, expressionDependencies, type LayerRecord} from './model';

/** Explain rules for a known feature; unavailable context never becomes a hidden feature. */
export function explainFeatureVisibility(
  map: MapLibreMap,
  layer: LayerRecord,
  feature?: MapGeoJSONFeature,
): Evidence[] {
  if (layer.type === 'custom') return [];
  const evidence: Evidence[] = [];
  const context = feature && {
    id: feature.id,
    type: feature.geometry.type.replace('Multi', '') as 'Point',
    properties: feature.properties,
  };
  if (layer.filter) {
    if (!context) {
      evidence.push({
        label: 'Feature filter',
        value:
          'Select a feature in Data to explain its filter result. No conclusion from an empty view.',
        state: 'unknown',
      });
    } else {
      try {
        const filter = featureFilter(
          layer.filter as Parameters<typeof featureFilter>[0],
          `${layer.id}.filter`,
          map.getGlobalState?.(),
        );
        if (filter.needGeometry) throw new Error('Geometry context is unavailable');
        const matches = filter.filter({zoom: Math.floor(map.getZoom())}, context);
        evidence.push({
          label: 'Selected feature',
          value: matches
            ? 'Matches the layer filter. Placement and final pixels are not established by this result.'
            : `Does not match the layer filter: ${JSON.stringify(layer.filter)}`,
          state: matches ? 'info' : 'warn',
        });
      } catch {
        evidence.push({
          label: 'Feature filter',
          value: 'The filter cannot be evaluated with the available context.',
          state: 'unknown',
        });
      }
    }
  }
  const properties: Record<string, string[]> = {
    fill: ['fill-opacity'],
    line: ['line-opacity', 'line-width'],
    circle: ['circle-opacity', 'circle-radius', 'circle-stroke-opacity', 'circle-stroke-width'],
    symbol: ['text-opacity', 'text-size', 'icon-opacity', 'icon-size'],
    'fill-extrusion': ['fill-extrusion-opacity'],
    raster: ['raster-opacity'],
    background: ['background-opacity'],
  };
  for (const property of properties[layer.type] ?? []) {
    const section = property === 'text-size' || property === 'icon-size' ? 'layout' : 'paint';
    const raw = layer[section][property];
    if (raw === undefined) continue;
    const dependencies = expressionDependencies(raw);
    if (dependencies.includes('feature') && !feature) continue;
    if (dependencies.includes('feature state') && feature?.id === undefined) continue;
    try {
      const spec = propertySpec(layer.type, section, property);
      if (!spec) continue;
      const compiled = createPropertyExpression(
        raw,
        `${layer.id}.${property}`,
        spec,
        map.getGlobalState?.(),
      );
      if (compiled.result === 'error') continue;
      const expression = compiled.value;
      if (!(
        expression instanceof ZoomConstantExpression ||
        expression instanceof ZoomDependentExpression
      ))
        continue;
      const state =
        feature?.id !== undefined && feature.source
          ? map.getFeatureState({
              source: feature.source,
              sourceLayer: feature.sourceLayer,
              id: feature.id,
            })
          : {};
      const value: unknown = expression.evaluateWithoutErrorHandling(
        {zoom: map.getZoom(), globalState: map.getGlobalState?.()},
        context,
        state,
      );
      if (value !== 0) continue;
      evidence.push({
        label: property,
        value: `Evaluates to 0${feature ? ' for the selected feature' : ' at this zoom'}. This component is transparent or has zero size; other components may still draw.`,
        state: 'warn',
      });
    } catch {
      // Evaluator errors and missing state are not evidence of zero opacity or size.
    }
  }
  return evidence;
}
