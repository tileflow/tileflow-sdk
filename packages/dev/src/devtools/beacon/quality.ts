import {
  createPropertyExpression,
  featureFilter,
  ZoomConstantExpression,
  ZoomDependentExpression,
} from '@maplibre/maplibre-gl-style-spec';
import type {MapGeoJSONFeature, Map as MapLibreMap, StyleSpecification} from 'maplibre-gl';
import {propertySpec} from '../style-edits';
import type {Camera, Finding, LabelSample} from './audit';

export type QualitySample = {
  passed: number;
  total: number;
  skipped: number;
  unit: 'labels' | 'size rules';
  findings: Finding[];
};

/** Avoid the renderer's fallback size turning an unresolved expression into a passing label. */
export function sampledTextSize(map: MapLibreMap, feature: MapGeoJSONFeature): number | undefined {
  const spec = propertySpec('symbol', 'layout', 'text-size')!;
  const compiled = createPropertyExpression(
    map.getLayoutProperty(feature.layer.id, 'text-size') ?? spec.default,
    `${feature.layer.id}.text-size`,
    spec,
    map.getGlobalState?.(),
  );
  if (compiled.result === 'error') return undefined;
  const expression = compiled.value;
  if (!(
    expression instanceof ZoomConstantExpression || expression instanceof ZoomDependentExpression
  ))
    return undefined;
  try {
    const state =
      feature.id !== undefined && feature.source
        ? map.getFeatureState({
            source: feature.source,
            sourceLayer: feature.sourceLayer,
            id: feature.id,
          })
        : {};
    const value: unknown = expression.evaluateWithoutErrorHandling(
      {zoom: map.getZoom()},
      {
        id: feature.id,
        type: feature.geometry.type.replace('Multi', '') as 'Point',
        properties: feature.properties,
      },
      state,
    );
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function labelSizeSample(labels: LabelSample[]): QualitySample {
  const known = labels.filter((l) => l.size !== undefined && Number.isFinite(l.size) && l.size > 0);
  const small = known.filter((l) => l.size! < 10);
  return {
    passed: known.length - small.length,
    total: known.length,
    skipped: labels.length - known.length,
    unit: 'labels',
    findings: small.map((l) => ({...l, message: `${l.message} · ${l.size!.toFixed(2)} CSS px`})),
  };
}

/** Rule continuity for visible features, not an inference from adjacent integer zooms.
 * Each compiled rule is evaluated once per feature at its actual zoom stops. No camera moves,
 * geometry retention or network requests. Missing evaluation context never earns a pass.
 */
export function scaleContinuitySample(
  map: MapLibreMap,
  style: StyleSpecification,
  features: MapGeoJSONFeature[],
  camera: Camera,
): QualitySample {
  const sample: QualitySample = {passed: 0, total: 0, skipped: 0, unit: 'size rules', findings: []};
  const candidates = new Map<string, MapGeoJSONFeature[]>();
  for (const feature of features) {
    if (!['line', 'symbol', 'circle'].includes(feature.layer.type)) continue;
    const list = candidates.get(feature.layer.id) ?? [];
    if (list.length >= 4 || list.some((f) => f.id !== undefined && f.id === feature.id)) continue;
    list.push(feature);
    candidates.set(feature.layer.id, list);
  }
  const globalState = map.getGlobalState?.();
  let visited = 0;
  for (const layer of style.layers) {
    const list = candidates.get(layer.id);
    if (!list?.length || layer.id.startsWith('__tileflow-devtools-')) continue;
    if (
      layer.layout?.visibility === 'none' ||
      camera.zoom < (layer.minzoom ?? 0) ||
      camera.zoom >= (layer.maxzoom ?? 24)
    )
      continue;
    if (++visited > 128) {
      sample.skipped++;
      continue;
    }
    const section = layer.type === 'symbol' ? 'layout' : 'paint';
    const property =
      layer.type === 'symbol'
        ? 'text-size'
        : layer.type === 'line'
          ? 'line-width'
          : 'circle-radius';
    if (layer.type === 'symbol' && !layer.layout?.['text-field']) continue;
    const spec = propertySpec(layer.type, section, property)!;
    const raw = (layer[section] as Record<string, unknown> | undefined)?.[property] ?? spec.default;
    const compiled = createPropertyExpression(raw, `${layer.id}.${property}`, spec, globalState);
    if (compiled.result === 'error') {
      sample.skipped++;
      continue;
    }
    const expression = compiled.value;
    if (!(
      expression instanceof ZoomConstantExpression || expression instanceof ZoomDependentExpression
    )) {
      sample.skipped++;
      continue;
    }
    const opacityProperty = layer.type === 'symbol' ? 'text-opacity' : `${layer.type}-opacity`;
    const opacitySpec = propertySpec(layer.type, 'paint', opacityProperty)!;
    const opacityRaw =
      (layer.paint as Record<string, unknown> | undefined)?.[opacityProperty] ??
      opacitySpec.default;
    const compiledOpacity = createPropertyExpression(
      opacityRaw,
      `${layer.id}.${opacityProperty}`,
      opacitySpec,
      globalState,
    );
    if (compiledOpacity.result === 'error') {
      sample.skipped++;
      continue;
    }
    const opacityExpression = compiledOpacity.value;
    if (!(
      opacityExpression instanceof ZoomConstantExpression ||
      opacityExpression instanceof ZoomDependentExpression
    )) {
      sample.skipped++;
      continue;
    }
    const stops = 'zoomStops' in expression ? expression.zoomStops : [];
    // Keep work bounded even for externally authored expressions with thousands of stops.
    if (stops.length > 128) {
      sample.skipped++;
      continue;
    }
    const min = Math.max(layer.minzoom ?? 0, map.getMinZoom());
    const max = Math.min(layer.maxzoom ?? 24, map.getMaxZoom());
    const inside = stops.filter((z) => z - 0.0001 >= min && z + 0.0001 < max);
    const filter =
      'filter' in layer && layer.filter
        ? featureFilter(layer.filter, `${layer.id}.filter`, globalState)
        : undefined;
    let known = false,
      failed = false,
      incomplete = false;
    for (const feature of list) {
      try {
        const state =
          feature.id !== undefined && feature.source
            ? map.getFeatureState({
                source: feature.source,
                sourceLayer: feature.sourceLayer,
                id: feature.id,
              })
            : {};
        const context = {
          id: feature.id,
          type: feature.geometry.type.replace('Multi', '') as 'Point',
          properties: feature.properties,
        };
        const visible = (zoom: number) => {
          if (filter && !filter.filter({zoom: Math.floor(zoom)}, context)) return false;
          const opacity: unknown = opacityExpression.evaluateWithoutErrorHandling(
            {zoom, globalState},
            context,
            state,
          );
          if (typeof opacity !== 'number' || !Number.isFinite(opacity))
            throw new Error('Unresolved opacity');
          return opacity > 0.01;
        };
        const evaluate = (zoom: number) => {
          const value: unknown = expression.evaluateWithoutErrorHandling(
            {zoom, globalState},
            context,
            state,
          );
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
            throw new Error('Unresolved size');
          return value;
        };
        // A positive observed size establishes applicability even for a constant rule.
        if (!visible(camera.zoom) || evaluate(camera.zoom) <= 0) {
          incomplete = true;
          continue;
        }
        for (const zoom of inside) {
          if (!visible(zoom - 0.0001) || !visible(zoom + 0.0001)) continue;
          const before = evaluate(zoom - 0.0001),
            after = evaluate(zoom + 0.0001);
          const delta = Math.abs(after - before);
          if (delta > 1 && delta / Math.max(1, Math.min(before, after)) > 0.25) {
            failed = true;
            if (sample.findings.length < 20)
              sample.findings.push({
                layer: layer.id,
                featureId: feature.id,
                camera: {...camera, zoom},
                message: `${property}: ${before.toFixed(2)} → ${after.toFixed(2)} px at z${zoom}; exceeds the 1 px / 25% continuity budget.`,
              });
          }
        }
        known = true;
      } catch {
        incomplete = true;
      }
    }
    // A proven jump remains a result even when another feature lacks data. A partial
    // evaluation cannot establish that an entire sampled rule is continuous.
    if (failed || (known && !incomplete)) {
      sample.total++;
      if (!failed) sample.passed++;
    } else sample.skipped++;
  }
  return sample;
}

export function combineQualitySamples(samples: QualitySample[]): QualitySample {
  return {
    unit: samples[0]?.unit ?? 'size rules',
    passed: samples.reduce((sum, s) => sum + s.passed, 0),
    total: samples.reduce((sum, s) => sum + s.total, 0),
    skipped: samples.reduce((sum, s) => sum + s.skipped, 0),
    findings: samples.flatMap((s) => s.findings).slice(0, 20),
  };
}
