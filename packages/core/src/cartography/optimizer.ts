import {tileflowCompilerMetadataKeys} from './contributions';
import {isMapLibreExpressionOperator} from './expression-operators';
import {tileflowModuleEffectMetadataKey} from './module-effects';

type StyleLayer = Record<string, unknown> & {id: string; type: string};

type ConditionalValue = {
  condition: unknown[];
  value: unknown;
};

type CombinedValue = {ok: true; value: unknown} | {ok: false};

const roadHighZoom = 15;

const roadClasses = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'service',
  'track',
  'pathway',
  'footway',
  'cycleway',
  'steps',
  'pedestrian',
]);

const landcoverTargets = new Set([
  'farmland',
  'flowerbed',
  'grass',
  'ice',
  'meadow',
  'protected',
  'recreationGround',
  'rock',
  'sand',
  'scrub',
  'urbanPark',
  'villageGreen',
  'wetland',
  'wood',
]);

const landuseTargets = new Set([
  'cemetery',
  'civic',
  'commercial',
  'education',
  'government',
  'industrial',
  'medical',
  'military',
  'parking',
  'railway',
  'recreation',
  'residential',
]);

const linePaintDefaults: Record<string, unknown> = {
  'line-blur': 0,
  'line-color': '#000000',
  'line-dasharray': [1, 0],
  'line-gap-width': 0,
  'line-offset': 0,
  'line-opacity': 1,
  'line-width': 1,
};

const lineLayoutDefaults: Record<string, unknown> = {
  'line-cap': 'butt',
  'line-join': 'miter',
  'line-miter-limit': 2,
  'line-round-limit': 1.05,
};

/**
 * Reduces physical MapLibre buckets after semantic module effects have been resolved.
 * Logical compiler IDs remain available below the high-detail handoff while
 * equivalent high-zoom layers are represented by data-driven cohorts.
 */
export function optimizeTileflowLayers(input: readonly Record<string, unknown>[]): StyleLayer[] {
  let layers = input.map((layer) => layer as StyleLayer);
  layers = consolidateRoadLines(layers);
  layers = consolidateRoadHatches(layers);
  layers = consolidateRoadLabels(layers);
  layers = consolidateFillFamily(
    layers,
    (target) => isFillTarget(target, 'land.landcover', landcoverTargets),
    'streets-landcover',
  );
  layers = consolidateFillFamily(
    layers,
    (target) => isFillTarget(target, 'land.landuse', landuseTargets),
    'streets-landuse',
  );
  layers = consolidateWaterways(layers);
  return layers;
}

function consolidateRoadLines(layers: StyleLayer[]): StyleLayer[] {
  const groups = new Map<string, Array<{index: number; layer: StyleLayer}>>();

  for (const [index, layer] of layers.entries()) {
    if (layer.type !== 'line') continue;
    const match = /^roads\.classes\.([^.]+)\.(tunnel|surface|bridge)\.(shadow|casing|fill)$/u.exec(
      semanticTarget(layer) ?? '',
    );
    if (!match || !roadClasses.has(match[1]!)) continue;
    const key = `${match[2]}:${match[3]}:${roadCohort(match[1]!)}`;
    const group = groups.get(key) ?? [];
    group.push({index, layer});
    groups.set(key, group);
  }

  const replacements = new Map<number, StyleLayer[]>();
  for (const [key, entries] of groups) {
    if (entries.length < 2 || !canMergeRoadLines(entries.map(({layer}) => layer))) continue;
    const eligible = entries.filter(({layer}) => maximumZoom(layer) > roadHighZoom);
    if (
      eligible.length < 2 ||
      !areContiguous(eligible) ||
      eligible.some(({layer}) => minimumZoom(layer) > roadHighZoom) ||
      !allEqual(eligible.map(({layer}) => maximumZoom(layer)))
    ) {
      continue;
    }
    const [structure, phase, cohort] = key.split(':');
    const mergedId = `streets-road-${structure}-highzoom-${cohort}-${phase}`;
    if (hasGeneratedIdCollision(layers, mergedId, eligible)) continue;
    const merged = mergeRoadLineGroup(
      mergedId,
      eligible.map(({layer}) => layer),
    );
    if (!merged) continue;
    const insertAt = eligible.at(-1)?.index;
    if (insertAt === undefined) continue;

    for (const {index, layer} of eligible) {
      const lowZoom =
        minimumZoom(layer) < roadHighZoom ? withMaximumZoom(layer, roadHighZoom) : null;
      replacements.set(index, lowZoom ? [lowZoom] : []);
    }
    replacements.set(insertAt, [...(replacements.get(insertAt) ?? []), merged]);
  }

  return applyReplacements(layers, replacements);
}

function roadCohort(roadClass: string): string {
  if (['motorway', 'trunk'].includes(roadClass)) return 'major';
  if (['primary', 'secondary', 'tertiary'].includes(roadClass)) return 'arterial';
  if (['minor', 'service', 'track'].includes(roadClass)) return 'local';
  return 'path';
}

function canMergeRoadLines(layers: StyleLayer[]): boolean {
  const common = layers[0];
  if (!common) return false;
  const supportedPaint = new Set([...Object.keys(linePaintDefaults), 'line-pattern']);
  const supportedLayout = new Set([
    ...Object.keys(lineLayoutDefaults),
    'line-sort-key',
    'visibility',
  ]);
  return layers.every(
    (layer) =>
      layer.source === common.source &&
      layer['source-layer'] === common['source-layer'] &&
      Object.keys(asRecord(layer.paint)).every((key) => supportedPaint.has(key)) &&
      Object.keys(asRecord(layer.layout)).every((key) => supportedLayout.has(key)) &&
      asRecord(layer.paint)['line-pattern'] === undefined &&
      asRecord(layer.layout).visibility !== 'none' &&
      !isModuleEffect(layer) &&
      sameTopLevelProperties(layer, common, ['minzoom']),
  );
}

function mergeRoadLineGroup(id: string, layers: StyleLayer[]): StyleLayer | undefined {
  const first = layers[0]!;
  const conditions = layers.map((layer) => asFilter(layer.filter));
  const paint: Record<string, unknown> = {};
  const paintKeys = new Set(layers.flatMap((layer) => Object.keys(asRecord(layer.paint))));
  for (const key of paintKeys) {
    const values = layers.map((layer) => asRecord(layer.paint)[key]);
    const combined = combineConditionalValues(
      values.map((value, index) => ({
        condition: conditions[index]!,
        value: value ?? linePaintDefaults[key],
      })),
      linePaintDefaults[key],
      roadHighZoom,
    );
    if (!combined.ok) return undefined;
    paint[key] = combined.value;
  }

  const layout: Record<string, unknown> = {};
  for (const key of Object.keys(lineLayoutDefaults)) {
    const values = layers.map((layer, index) => ({
      condition: conditions[index]!,
      value: asRecord(layer.layout)[key] ?? lineLayoutDefaults[key],
    }));
    if (!allEqual(values.map(({value}) => value))) {
      const combined = combineConditionalValues(values, lineLayoutDefaults[key], roadHighZoom);
      if (!combined.ok) return undefined;
      layout[key] = combined.value;
    } else if (values[0]?.value !== lineLayoutDefaults[key]) {
      layout[key] = values[0]?.value;
    }
  }
  const sortKey = combineConditionalValues(
    layers.map((layer, index) => ({
      condition: conditions[index]!,
      value: rankedSortKey(asRecord(layer.layout)['line-sort-key'] ?? 0, index),
    })),
    0,
    roadHighZoom,
  );
  if (!sortKey.ok) return undefined;
  layout['line-sort-key'] = sortKey.value;

  return {
    ...first,
    id,
    type: 'line',
    filter: unionFilters(conditions),
    minzoom: roadHighZoom,
    ...(finiteMaximumZoom(layers) ? {maxzoom: finiteMaximumZoom(layers)} : {}),
    layout,
    paint,
  };
}

function consolidateRoadHatches(layers: StyleLayer[]): StyleLayer[] {
  const groups = new Map<string, Array<{index: number; layer: StyleLayer}>>();
  for (const [index, layer] of layers.entries()) {
    if (layer.type !== 'symbol' && layer.type !== 'line') continue;
    const match = /^roads\.classes\.([^.]+)\.(tunnel|surface|bridge)\.hatch$/u.exec(
      semanticTarget(layer) ?? '',
    );
    if (!match || !roadClasses.has(match[1]!)) continue;
    const group = groups.get(match[2]!) ?? [];
    group.push({index, layer});
    groups.set(match[2]!, group);
  }

  const replacements = new Map<number, StyleLayer[]>();
  for (const [structure, entries] of groups) {
    if (
      entries.length < 2 ||
      !areContiguous(entries) ||
      entries.some(({layer}) => isModuleEffect(layer))
    ) {
      continue;
    }
    const first = entries[0]!.layer;
    if (
      !entries.every(
        ({layer}) =>
          layer.type === first.type &&
          sameLayerSource(layer, first) &&
          minimumZoom(layer) === minimumZoom(first) &&
          maximumZoom(layer) === maximumZoom(first) &&
          sameTopLevelProperties(layer, first),
      )
    ) {
      continue;
    }
    const mergedId = `streets-road-${structure}-hatch`;
    if (hasGeneratedIdCollision(layers, mergedId, entries)) continue;
    const conditions = entries.map(({layer}) => asFilter(layer.filter));
    const sortKeyProperty = first.type === 'line' ? 'line-sort-key' : 'symbol-sort-key';
    const layoutKeys = new Set(
      entries.flatMap(({layer}) =>
        Object.keys(asRecord(layer.layout)).filter((key) => key !== sortKeyProperty),
      ),
    );
    const paintKeys = new Set(entries.flatMap(({layer}) => Object.keys(asRecord(layer.paint))));
    const layout: Record<string, unknown> = {};
    let safe = true;
    for (const key of layoutKeys) {
      const rawValues = entries.map(({layer}) => asRecord(layer.layout)[key]);
      if (allEqual(rawValues)) {
        layout[key] = rawValues[0];
        continue;
      }
      const fallback =
        first.type === 'line'
          ? lineLayoutDefaults[key]
          : key === 'text-size'
            ? 16
            : key === 'text-rotate'
              ? 0
              : undefined;
      if (fallback === undefined) {
        safe = false;
        break;
      }
      const combined = combineConditionalValues(
        rawValues.map((value, index) => ({
          condition: conditions[index]!,
          value: value ?? fallback,
        })),
        fallback,
        minimumZoom(first),
      );
      if (!combined.ok) {
        safe = false;
        break;
      }
      layout[key] = combined.value;
    }
    if (!safe) continue;
    const sortKey = combineConditionalValues(
      entries.map(({layer}, index) => ({
        condition: conditions[index]!,
        value: rankedSortKey(asRecord(layer.layout)[sortKeyProperty] ?? 0, index),
      })),
      0,
      minimumZoom(first),
    );
    if (!sortKey.ok) continue;
    layout[sortKeyProperty] = sortKey.value;
    const paint: Record<string, unknown> = {};
    for (const key of paintKeys) {
      const rawValues = entries.map(({layer}) => asRecord(layer.paint)[key]);
      if (allEqual(rawValues)) {
        paint[key] = rawValues[0];
        continue;
      }
      if (first.type === 'line' && key === 'line-pattern') {
        if (rawValues.some((value) => value === undefined)) {
          safe = false;
          break;
        }
        const combined = combinePatternValues(
          rawValues.map((value, index) => ({condition: conditions[index]!, value})),
          minimumZoom(first),
        );
        if (!combined.ok) {
          safe = false;
          break;
        }
        paint[key] = combined.value;
        continue;
      }
      const fallback =
        first.type === 'line'
          ? linePaintDefaults[key]
          : key === 'text-color'
            ? '#000000'
            : key === 'text-opacity'
              ? 1
              : undefined;
      if (fallback === undefined) {
        safe = false;
        break;
      }
      const combined = combineConditionalValues(
        rawValues.map((value, index) => ({
          condition: conditions[index]!,
          value: value ?? fallback,
        })),
        fallback,
        minimumZoom(first),
      );
      if (!combined.ok) {
        safe = false;
        break;
      }
      paint[key] = combined.value;
    }
    if (!safe) continue;
    const merged: StyleLayer = {
      ...first,
      id: mergedId,
      type: first.type,
      filter: unionFilters(conditions),
      ...(first.minzoom === undefined ? {} : {minzoom: first.minzoom}),
      ...(first.maxzoom === undefined ? {} : {maxzoom: first.maxzoom}),
      layout,
      paint,
    };
    for (const {index} of entries) replacements.set(index, []);
    replacements.set(entries.at(-1)!.index, [merged]);
  }
  return applyReplacements(layers, replacements);
}

function consolidateRoadLabels(layers: StyleLayer[]): StyleLayer[] {
  const candidates = layers
    .map((layer, index) => ({
      index,
      layer,
      roadClass: /^labels\.roads\.([^.]+)$/u.exec(semanticTarget(layer) ?? '')?.[1],
    }))
    .filter(
      ({layer, roadClass}) =>
        layer.type === 'symbol' &&
        roadClass !== undefined &&
        roadClasses.has(roadClass) &&
        typeof layer['source-layer'] === 'string',
    );
  if (candidates.some(({layer}) => isModuleEffect(layer))) return layers;
  const groups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const {layer} = candidate;
    const key = JSON.stringify({
      source: layer.source,
      sourceLayer: layer['source-layer'],
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
      layout: asRecord(layer.layout),
      paint: asRecord(layer.paint),
    });
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const replacements = new Map<number, StyleLayer[]>();
  let groupNumber = 0;
  for (const group of groups.values()) {
    if (group.length < 2 || !areContiguous(group)) continue;
    const first = group[0]!.layer;
    if (!group.every(({layer}) => sameTopLevelProperties(layer, first))) continue;
    const conditions = group.map(({layer}) => asFilter(layer.filter));
    const id = group.some(({roadClass}) => roadClass === 'motorway')
      ? 'streets-label-road-major'
      : group.some(({roadClass}) => roadClass === 'service')
        ? 'streets-label-road-local'
        : `streets-label-road-cohort-${groupNumber++}`;
    if (hasGeneratedIdCollision(layers, id, group)) continue;
    const layout = {...asRecord(first.layout)};
    const sortKeyValues = group.map(({layer}, index) => {
      const original = asRecord(layer.layout)['symbol-sort-key'] ?? 0;
      return {
        condition: conditions[index]!,
        value: rankedSortKey(original, index),
      };
    });
    if (sortKeyValues.some(({value}) => containsZoom(value))) continue;
    const sortKey = combineConditionalValues(sortKeyValues, group.length, minimumZoom(first));
    if (!sortKey.ok) continue;
    layout['symbol-sort-key'] = sortKey.value;
    const merged: StyleLayer = {
      ...first,
      id,
      filter: unionFilters(conditions),
      layout,
    };
    for (const {index} of group) replacements.set(index, []);
    replacements.set(group.at(-1)!.index, [merged]);
  }
  return applyReplacements(layers, replacements);
}

function consolidateFillFamily(
  layers: StyleLayer[],
  acceptsTarget: (target: string | undefined) => boolean,
  mergedId: string,
): StyleLayer[] {
  const candidates = layers
    .map((layer, index) => ({index, layer}))
    .filter(({layer}) => layer.type === 'fill' && acceptsTarget(semanticTarget(layer)));
  if (candidates.some(({layer}) => isModuleEffect(layer))) return layers;
  const groups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const {layer} = candidate;
    const layout = {...asRecord(layer.layout)};
    delete layout['fill-sort-key'];
    const paint = asRecord(layer.paint);
    if (paint['fill-pattern'] !== undefined) continue;
    const key = JSON.stringify({
      source: layer.source,
      sourceLayer: layer['source-layer'],
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
      layout,
      antialias: paint['fill-antialias'],
    });
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const replacements = new Map<number, StyleLayer[]>();
  let suffix = 0;
  for (const grouped of groups.values()) {
    for (const group of contiguousRuns(grouped)) {
      if (group.length < 2) continue;
      const first = group[0]!.layer;
      if (!group.every(({layer}) => sameTopLevelProperties(layer, first))) continue;
      const conditions = group.map(({layer}) => asFilter(layer.filter));
      const reversed = [...group].reverse();
      const reversedConditions = [...conditions].reverse();
      const paintKeys = new Set(group.flatMap(({layer}) => Object.keys(asRecord(layer.paint))));
      const paint: Record<string, unknown> = {};
      let safe = true;
      for (const key of paintKeys) {
        const values = group.map(({layer}) => asRecord(layer.paint)[key]);
        if (!['fill-color', 'fill-opacity'].includes(key)) {
          if (!allEqual(values)) {
            safe = false;
            break;
          }
          paint[key] = values[0];
          continue;
        }
        const fallback = key === 'fill-opacity' ? 1 : '#000000';
        const combined = combineConditionalValues(
          reversed.map(({layer}, index) => ({
            condition: reversedConditions[index]!,
            value: asRecord(layer.paint)[key] ?? fallback,
          })),
          fallback,
          minimumZoom(first),
        );
        if (!combined.ok) {
          safe = false;
          break;
        }
        paint[key] = combined.value;
      }
      if (!safe) continue;
      const layout = {...asRecord(first.layout)};
      const sortValues = reversed.map(({layer}, index) => ({
        condition: reversedConditions[index]!,
        value: rankedSortKey(
          asRecord(layer.layout)['fill-sort-key'] ?? 0,
          group.length - index - 1,
        ),
      }));
      if (sortValues.some(({value}) => containsZoom(value))) continue;
      const sortKey = combineConditionalValues(sortValues, 0, minimumZoom(first));
      if (!sortKey.ok) continue;
      layout['fill-sort-key'] = sortKey.value;
      const id = suffix === 0 ? mergedId : `${mergedId}-${suffix}`;
      if (hasGeneratedIdCollision(layers, id, group)) continue;
      const merged: StyleLayer = {
        ...first,
        id,
        filter: unionFilters(conditions),
        layout,
        paint,
      };
      suffix += 1;
      for (const {index} of group) replacements.set(index, []);
      replacements.set(group.at(-1)!.index, [merged]);
    }
  }
  return applyReplacements(layers, replacements);
}

function consolidateWaterways(layers: StyleLayer[]): StyleLayer[] {
  const replacements = new Map<number, StyleLayer[]>();
  for (const name of ['river', 'canal', 'stream', 'other']) {
    const regularIndex = layers.findIndex(
      (layer) => semanticTarget(layer) === `water.waterways.${name}`,
    );
    const intermittentIndex = layers.findIndex(
      (layer) => semanticTarget(layer) === `water.intermittent.waterways.${name}`,
    );
    if (regularIndex < 0 || intermittentIndex < 0) continue;
    const regular = layers[regularIndex]!;
    const intermittent = layers[intermittentIndex]!;
    if (
      !sameLayerSource(regular, intermittent) ||
      isModuleEffect(regular) ||
      isModuleEffect(intermittent) ||
      intermittentIndex !== regularIndex + 1 ||
      minimumZoom(regular) !== minimumZoom(intermittent) ||
      maximumZoom(regular) !== maximumZoom(intermittent) ||
      !allEqual([asRecord(regular.layout), asRecord(intermittent.layout)]) ||
      !sameTopLevelProperties(regular, intermittent)
    ) {
      continue;
    }
    const conditions = [asFilter(intermittent.filter), asFilter(regular.filter)];
    const paintKeys = new Set([
      ...Object.keys(asRecord(regular.paint)),
      ...Object.keys(asRecord(intermittent.paint)),
    ]);
    const paint: Record<string, unknown> = {};
    let safe = true;
    for (const key of paintKeys) {
      const intermittentValue = asRecord(intermittent.paint)[key];
      const regularValue = asRecord(regular.paint)[key];
      if (!Object.hasOwn(linePaintDefaults, key) && key !== 'line-pattern') {
        if (!allEqual([intermittentValue, regularValue])) {
          safe = false;
          break;
        }
        paint[key] = regularValue;
        continue;
      }
      if (
        key === 'line-pattern' &&
        (intermittentValue === undefined || regularValue === undefined)
      ) {
        safe = false;
        break;
      }
      const fallback = linePaintDefaults[key] ?? regularValue;
      const combined = combineConditionalValues(
        [
          {
            condition: conditions[0]!,
            value: intermittentValue ?? fallback,
          },
          {
            condition: conditions[1]!,
            value: regularValue ?? fallback,
          },
        ],
        fallback,
        minimumZoom(regular),
      );
      if (!combined.ok) {
        safe = false;
        break;
      }
      paint[key] = combined.value;
    }
    if (!safe) continue;
    const merged: StyleLayer = {
      ...regular,
      filter: unionFilters(conditions),
      paint,
    };
    replacements.set(regularIndex, []);
    replacements.set(intermittentIndex, [merged]);
  }
  return applyReplacements(layers, replacements);
}

function combineConditionalValues(
  entries: ConditionalValue[],
  fallback: unknown,
  minimumRelevantZoom: number,
): CombinedValue {
  if (entries.length === 0) return {ok: true, value: fallback};
  if (allEqual(entries.map(({value}) => value))) {
    return {ok: true, value: entries[0]?.value};
  }
  const letValues = entries.map(({value}) =>
    Array.isArray(value) && value.length === 4 && value[0] === 'let' ? value : undefined,
  );
  if (
    letValues.every((value) => value !== undefined) &&
    allEqual(letValues.map((value) => value?.[1])) &&
    allEqual(letValues.map((value) => value?.[3]))
  ) {
    const combined = combineConditionalValues(
      entries.map(({condition}, index) => ({
        condition,
        value: letValues[index]![2],
      })),
      letValues[0]![2],
      minimumRelevantZoom,
    );
    if (!combined.ok) return combined;
    return {ok: true, value: ['let', letValues[0]![1], combined.value, letValues[0]![3]]};
  }
  const additiveValues = entries.map(({value}) =>
    Array.isArray(value) && value.length === 3 && value[0] === '+' ? value : undefined,
  );
  if (
    additiveValues.every((value) => value !== undefined) &&
    allEqual(additiveValues.map((value) => value?.[2]))
  ) {
    const combined = combineConditionalValues(
      entries.map(({condition}, index) => ({
        condition,
        value: additiveValues[index]![1],
      })),
      additiveValues[0]![1],
      minimumRelevantZoom,
    );
    if (!combined.ok) return combined;
    return {ok: true, value: ['+', combined.value, additiveValues[0]![2]]};
  }
  if (
    entries.some(({value}) => containsZoom(value) && !isZoomInterpolation(value)) ||
    (containsZoom(fallback) && !isZoomInterpolation(fallback))
  ) {
    return {ok: false};
  }
  const zoomExpressions = entries.flatMap(({value}) =>
    isZoomInterpolation(value) ? [value as unknown[]] : [],
  );
  if (zoomExpressions.length === 0) {
    return {ok: true, value: conditionalExpression(entries, fallback)};
  }

  const stops = new Set<number>([minimumRelevantZoom]);
  for (const interpolation of zoomExpressions) {
    for (let index = 3; index < interpolation.length; index += 2) {
      const stop = interpolation[index];
      if (typeof stop === 'number' && stop >= minimumRelevantZoom) stops.add(stop);
    }
  }
  if (stops.size === 1) stops.add(24);
  const orderedStops = [...stops].sort((left, right) => left - right);
  const interpolationMethods = zoomExpressions.map((value) => value[1]);
  const interpolationMethod = allEqual(interpolationMethods) ? interpolationMethods[0] : ['linear'];
  return {
    ok: true,
    value: [
      'interpolate',
      interpolationMethod,
      ['zoom'],
      ...orderedStops.flatMap((stop) => [
        stop,
        conditionalExpression(
          entries.map(({condition, value}) => ({
            condition,
            value: evaluateZoomExpression(value, stop),
          })),
          evaluateZoomExpression(fallback, stop),
        ),
      ]),
    ],
  };
}

function combinePatternValues(
  entries: ConditionalValue[],
  minimumRelevantZoom: number,
): CombinedValue {
  if (entries.some(({value}) => containsZoom(value) && !isZoomStep(value))) {
    return {ok: false};
  }
  const steps = entries.flatMap(({value}) => (isZoomStep(value) ? [value as unknown[]] : []));
  if (steps.length === 0) {
    return {ok: true, value: conditionalExpression(entries, entries[0]?.value)};
  }

  const stops = new Set<number>([minimumRelevantZoom]);
  for (const step of steps) {
    for (let index = 3; index < step.length; index += 2) {
      const stop = step[index];
      if (typeof stop === 'number' && stop >= minimumRelevantZoom) stops.add(stop);
    }
  }
  const orderedStops = [...stops].sort((left, right) => left - right);
  const outputAtZoom = (level: number) =>
    conditionalExpression(
      entries.map(({condition, value}) => ({
        condition,
        value: evaluateZoomStep(value, level),
      })),
      evaluateZoomStep(entries[0]?.value, level),
    );

  return {
    ok: true,
    value: [
      'step',
      ['zoom'],
      outputAtZoom(orderedStops[0]!),
      ...orderedStops.slice(1).flatMap((stop) => [stop, outputAtZoom(stop)]),
    ],
  };
}

function evaluateZoomStep(value: unknown, zoom: number): unknown {
  if (!isZoomStep(value)) return value;
  const step = value as unknown[];
  let output = step[2];
  for (let index = 3; index < step.length - 1; index += 2) {
    const stop = step[index];
    if (typeof stop !== 'number' || stop > zoom) break;
    output = step[index + 1];
  }
  return output;
}

function isZoomStep(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value[0] === 'step' &&
    Array.isArray(value[1]) &&
    value[1].length === 1 &&
    value[1][0] === 'zoom'
  );
}

function conditionalExpression(entries: ConditionalValue[], fallback: unknown): unknown {
  const additiveOutputs = entries.map(({value}) =>
    Array.isArray(value) && value.length === 3 && value[0] === '+' ? value : undefined,
  );
  const commonAddends = additiveOutputs.map((value) => value?.[2]);
  if (additiveOutputs.every((value) => value !== undefined) && allEqual(commonAddends)) {
    const commonAddend = commonAddends[0];
    return [
      '+',
      conditionalExpression(
        entries.map(({condition}, index) => ({
          condition,
          value: additiveOutputs[index]![1],
        })),
        ['-', expressionOutput(fallback), expressionOutput(commonAddend)],
      ),
      expressionOutput(commonAddend),
    ];
  }
  const classMatches = entries.map(({condition}) => splitClassMatch(condition));
  if (
    classMatches.every((match) => match !== undefined) &&
    allEqual(classMatches.map((match) => match?.field)) &&
    allEqual(classMatches.map((match) => match?.remainder)) &&
    classMatchLabelsAreDisjoint(classMatches.map((match) => match!.labels))
  ) {
    return [
      'match',
      ['get', classMatches[0]!.field],
      ...entries.flatMap(({value}, index) => [
        classMatches[index]!.labels,
        expressionOutput(value),
      ]),
      expressionOutput(fallback),
    ];
  }
  return [
    'case',
    ...entries.flatMap(({condition, value}) => [condition, expressionOutput(value)]),
    expressionOutput(fallback),
  ];
}

function classMatchLabelsAreDisjoint(labels: unknown[]): boolean {
  const seen = new Set<string>();
  for (const entry of labels.flatMap((label) => (Array.isArray(label) ? label : [label]))) {
    const serialized = stableSerialize(entry);
    if (seen.has(serialized)) return false;
    seen.add(serialized);
  }
  return true;
}

function splitClassMatch(
  condition: unknown[],
): {field: string; labels: unknown; remainder: unknown[]} | undefined {
  const parts = condition[0] === 'all' ? condition.slice(1) : [condition];
  const matchIndex = parts.findIndex(
    (part) =>
      Array.isArray(part) &&
      part.length === 5 &&
      part[0] === 'match' &&
      Array.isArray(part[1]) &&
      part[1][0] === 'get' &&
      typeof part[1][1] === 'string' &&
      part.at(-2) === true &&
      part.at(-1) === false,
  );
  if (matchIndex < 0) return undefined;
  const classMatch = parts[matchIndex] as unknown[];
  const remainderParts = parts.filter((_, index) => index !== matchIndex);
  return {
    field: (classMatch[1] as unknown[])[1] as string,
    labels: classMatch[2],
    remainder:
      remainderParts.length === 0
        ? ['literal', true]
        : remainderParts.length === 1
          ? (remainderParts[0] as unknown[])
          : ['all', ...remainderParts],
  };
}

function evaluateZoomExpression(value: unknown, zoom: number): unknown {
  if (!isZoomInterpolation(value)) return value;
  const expression = value as unknown[];
  const stops: Array<{zoom: number; value: unknown}> = [];
  for (let index = 3; index < expression.length - 1; index += 2) {
    const stop = expression[index];
    if (typeof stop === 'number') stops.push({zoom: stop, value: expression[index + 1]});
  }
  const exact = stops.find((stop) => stop.zoom === zoom);
  if (exact) return exact.value;
  const lower = [...stops].reverse().find((stop) => stop.zoom < zoom);
  const upper = stops.find((stop) => stop.zoom > zoom);
  if (!lower) return upper?.value;
  if (!upper) return lower.value;
  return [
    'interpolate',
    expression[1],
    zoom,
    lower.zoom,
    expressionOutput(lower.value),
    upper.zoom,
    expressionOutput(upper.value),
  ];
}

function isZoomInterpolation(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value[0] === 'interpolate' &&
    Array.isArray(value[1]) &&
    (value[1][0] === 'linear' ||
      (value[1][0] === 'exponential' && typeof value[1][1] === 'number')) &&
    Array.isArray(value[2]) &&
    value[2].length === 1 &&
    value[2][0] === 'zoom'
  );
}

function expressionOutput(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return isExpressionArray(value) ? value : ['literal', value];
}

function isExpressionArray(value: unknown[]): boolean {
  return isMapLibreExpressionOperator(value[0]);
}

function containsZoom(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value[0] === 'literal') return false;
  if (value.length === 1 && value[0] === 'zoom') return true;
  return value.some((entry, index) => index > 0 && containsZoom(entry));
}

function rankedSortKey(value: unknown, rank: number): unknown {
  if (value === 0) return rank * 3;
  return ['+', rank * 3, ['/', value, ['+', 1, ['abs', value]]]];
}

function unionFilters(filters: unknown[][]): unknown[] {
  return filters.length === 1 ? filters[0]! : ['any', ...filters];
}

function asFilter(value: unknown): unknown[] {
  return Array.isArray(value) ? value : ['literal', true];
}

function applyReplacements(
  layers: StyleLayer[],
  replacements: ReadonlyMap<number, StyleLayer[]>,
): StyleLayer[] {
  return layers.flatMap((layer, index) => replacements.get(index) ?? [layer]);
}

function sameLayerSource(left: StyleLayer, right: StyleLayer): boolean {
  return left.source === right.source && left['source-layer'] === right['source-layer'];
}

function sameTopLevelProperties(
  left: StyleLayer,
  right: StyleLayer,
  additionallyIgnored: readonly string[] = [],
): boolean {
  const ignored = new Set(['id', 'filter', 'layout', 'paint', ...additionallyIgnored]);
  const select = (layer: StyleLayer) =>
    Object.fromEntries(
      Object.entries(layer)
        .filter(([key]) => !ignored.has(key))
        .flatMap(([key, value]) => {
          if (key !== 'metadata') return [[key, value]];
          const metadata = publicMetadata(value);
          return metadata ? [[key, metadata]] : [];
        }),
    );
  return allEqual([select(left), select(right)]);
}

function isModuleEffect(layer: StyleLayer): boolean {
  const marker = asRecord(layer.metadata)[tileflowModuleEffectMetadataKey];
  // Added semantic contributions carry an explicit ordering contract and must
  // never be folded. Patches may be consolidated when the normal typed/range/
  // equivalence guards prove it safe.
  return marker === 'add';
}

function publicMetadata(value: unknown): Record<string, unknown> | undefined {
  const metadata = {...asRecord(value)};
  delete metadata[tileflowModuleEffectMetadataKey];
  for (const key of Object.values(tileflowCompilerMetadataKeys)) delete metadata[key];
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function isFillTarget(
  target: string | undefined,
  prefix: string,
  allowedNames: ReadonlySet<string>,
): boolean {
  if (!target?.startsWith(`${prefix}.`) || !target.endsWith('.fill')) return false;
  const name = target.slice(prefix.length + 1, -'.fill'.length);
  return !name.includes('.') && allowedNames.has(name);
}

function semanticTarget(layer: StyleLayer): string | undefined {
  const target = asRecord(layer.metadata)[tileflowCompilerMetadataKeys.target];
  return typeof target === 'string' ? target : legacySemanticTarget(layer.id);
}

/** Compatibility for direct optimizer callers created before compiler provenance was attached. */
function legacySemanticTarget(id: string): string | undefined {
  let match = /^streets-road-(tunnel|surface|bridge)-(.+)-(shadow|casing|fill)$/u.exec(id);
  if (match) return `roads.classes.${match[2]}.${match[1]}.${match[3]}`;
  match = /^streets-road-(tunnel|surface|bridge)-(.+)-hatch$/u.exec(id);
  if (match) return `roads.classes.${match[2]}.${match[1]}.hatch`;
  match = /^streets-label-road-(.+)$/u.exec(id);
  if (match) return `labels.roads.${match[1]}`;
  match = /^streets-landcover-(.+)$/u.exec(id);
  if (match) return `land.landcover.${match[1]}.fill`;
  match = /^streets-landuse-(.+)$/u.exec(id);
  if (match) return `land.landuse.${match[1]}.fill`;
  match = /^streets-waterway-(river|canal|stream|other)(-intermittent)?$/u.exec(id);
  if (match) {
    return match[2] ? `water.intermittent.waterways.${match[1]}` : `water.waterways.${match[1]}`;
  }
  return undefined;
}

function areContiguous(entries: readonly {index: number}[]): boolean {
  return entries.every(
    (entry, index) => index === 0 || entry.index === entries[index - 1]!.index + 1,
  );
}

function contiguousRuns<T extends {index: number}>(entries: readonly T[]): T[][] {
  const runs: T[][] = [];
  for (const entry of entries) {
    const run = runs.at(-1);
    if (!run || entry.index !== run.at(-1)!.index + 1) runs.push([entry]);
    else run.push(entry);
  }
  return runs;
}

function hasGeneratedIdCollision(
  layers: readonly StyleLayer[],
  id: string,
  entries: readonly {layer: StyleLayer}[],
): boolean {
  const members = new Set(entries.map(({layer}) => layer));
  return layers.some((layer) => layer.id === id && !members.has(layer));
}

function withMaximumZoom(layer: StyleLayer, maxzoom: number): StyleLayer {
  return {...layer, maxzoom: Math.min(maximumZoom(layer), maxzoom)};
}

function minimumZoom(layer: StyleLayer): number {
  return typeof layer.minzoom === 'number' ? layer.minzoom : 0;
}

function maximumZoom(layer: StyleLayer): number {
  return typeof layer.maxzoom === 'number' ? layer.maxzoom : Infinity;
}

function finiteMaximumZoom(layers: StyleLayer[]): number | undefined {
  const maximum = Math.max(...layers.map(maximumZoom));
  return Number.isFinite(maximum) ? maximum : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function allEqual(values: unknown[]): boolean {
  if (values.length < 2) return true;
  const first = stableSerialize(values[0]);
  return values.every((value) => stableSerialize(value) === first);
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(',')}}`;
}
