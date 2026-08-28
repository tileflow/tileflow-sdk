import type {TileflowLayerFamilyIR} from './domain-ir';
import {isMapLibreExpressionOperator} from './expression-operators';

type LayerFamily = TileflowLayerFamilyIR;

type ConditionalValue = {
  condition: unknown[];
  value: unknown;
};

type CombinedValue = {ok: true; value: unknown} | {ok: false};

const roadHighZoom = 15;

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
 * Plans physical MapLibre buckets after semantic render operations have been resolved.
 * Stable semantic keys remain available below the high-detail handoff while
 * equivalent high-zoom families are represented by data-driven cohorts.
 */
export function planTileflowLayerFamilies(
  input: readonly TileflowLayerFamilyIR[],
): TileflowLayerFamilyIR[] {
  let layers = input.map(cloneJson);
  layers = consolidateRoadLines(layers);
  layers = consolidateRoadHatches(layers);
  layers = consolidateRoadLabels(layers);
  layers = consolidateFillFamily(layers, 'land.landcover', 'land.cohorts.landcover');
  layers = consolidateFillFamily(layers, 'land.landuse', 'land.cohorts.landuse');
  layers = consolidateWaterways(layers);
  return layers;
}

function consolidateRoadLines(layers: LayerFamily[]): LayerFamily[] {
  const groups = new Map<string, Array<{index: number; layer: LayerFamily}>>();

  for (const [index, layer] of layers.entries()) {
    if (layer.renderer !== 'line' || layer.family?.kind !== 'road-line') continue;
    const key = layer.family.group;
    const group = groups.get(key) ?? [];
    group.push({index, layer});
    groups.set(key, group);
  }

  const replacements = new Map<number, LayerFamily[]>();
  for (const entries of groups.values()) {
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
    const mergedId = eligible[0]!.layer.family!.outputKey!;
    if (hasGeneratedKeyCollision(layers, mergedId, eligible)) continue;
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

function canMergeRoadLines(layers: LayerFamily[]): boolean {
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
      sameLayerSource(layer, common) &&
      Object.keys(layer.style.appearance ?? {}).every((key) => supportedPaint.has(key)) &&
      Object.keys(layer.style.placement ?? {}).every((key) => supportedLayout.has(key)) &&
      layer.style.appearance?.['line-pattern'] === undefined &&
      layer.style.placement?.visibility !== 'none' &&
      !isOrderedRenderPass(layer) &&
      sameTopLevelProperties(layer, common, ['minZoom']),
  );
}

function mergeRoadLineGroup(key: string, layers: LayerFamily[]): LayerFamily | undefined {
  const first = layers[0]!;
  const conditions = layers.map((layer) => asFilter(layer.selector));
  const paint: Record<string, unknown> = {};
  const paintKeys = new Set(layers.flatMap((layer) => Object.keys(layer.style.appearance ?? {})));
  for (const key of paintKeys) {
    const values = layers.map((layer) => layer.style.appearance?.[key]);
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
      value: layer.style.placement?.[key] ?? lineLayoutDefaults[key],
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
      value: rankedSortKey(layer.style.placement?.['line-sort-key'] ?? 0, index),
    })),
    0,
    roadHighZoom,
  );
  if (!sortKey.ok) return undefined;
  layout['line-sort-key'] = sortKey.value;

  return withMergedOrigins(
    {
      ...first,
      key,
      renderer: 'line',
      selector: unionFilters(conditions),
      range: {
        minZoom: roadHighZoom,
        ...(finiteMaximumZoom(layers) === undefined ? {} : {maxZoom: finiteMaximumZoom(layers)}),
      },
      style: {appearance: paint, placement: layout},
    },
    layers,
  );
}

function consolidateRoadHatches(layers: LayerFamily[]): LayerFamily[] {
  const groups = new Map<string, Array<{index: number; layer: LayerFamily}>>();
  for (const [index, layer] of layers.entries()) {
    if (
      (layer.renderer !== 'symbol' && layer.renderer !== 'line') ||
      layer.family?.kind !== 'road-hatch'
    ) {
      continue;
    }
    const group = groups.get(layer.family.group) ?? [];
    group.push({index, layer});
    groups.set(layer.family.group, group);
  }

  const replacements = new Map<number, LayerFamily[]>();
  for (const entries of groups.values()) {
    if (
      entries.length < 2 ||
      !areContiguous(entries) ||
      entries.some(({layer}) => isOrderedRenderPass(layer))
    ) {
      continue;
    }
    const first = entries[0]!.layer;
    if (
      !entries.every(
        ({layer}) =>
          layer.renderer === first.renderer &&
          sameLayerSource(layer, first) &&
          minimumZoom(layer) === minimumZoom(first) &&
          maximumZoom(layer) === maximumZoom(first) &&
          sameTopLevelProperties(layer, first),
      )
    ) {
      continue;
    }
    const mergedId = first.family!.outputKey!;
    if (hasGeneratedKeyCollision(layers, mergedId, entries)) continue;
    const conditions = entries.map(({layer}) => asFilter(layer.selector));
    const sortKeyProperty = first.renderer === 'line' ? 'line-sort-key' : 'symbol-sort-key';
    const layoutKeys = new Set(
      entries.flatMap(({layer}) =>
        Object.keys(layer.style.placement ?? {}).filter((key) => key !== sortKeyProperty),
      ),
    );
    const paintKeys = new Set(
      entries.flatMap(({layer}) => Object.keys(layer.style.appearance ?? {})),
    );
    const layout: Record<string, unknown> = {};
    let safe = true;
    for (const key of layoutKeys) {
      const rawValues = entries.map(({layer}) => layer.style.placement?.[key]);
      if (allEqual(rawValues)) {
        layout[key] = rawValues[0];
        continue;
      }
      const fallback =
        first.renderer === 'line'
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
        value: rankedSortKey(layer.style.placement?.[sortKeyProperty] ?? 0, index),
      })),
      0,
      minimumZoom(first),
    );
    if (!sortKey.ok) continue;
    layout[sortKeyProperty] = sortKey.value;
    const paint: Record<string, unknown> = {};
    for (const key of paintKeys) {
      const rawValues = entries.map(({layer}) => layer.style.appearance?.[key]);
      if (allEqual(rawValues)) {
        paint[key] = rawValues[0];
        continue;
      }
      if (first.renderer === 'line' && key === 'line-pattern') {
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
        first.renderer === 'line'
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
    const merged = withMergedOrigins(
      {
        ...first,
        key: mergedId,
        renderer: first.renderer,
        selector: unionFilters(conditions),
        style: {appearance: paint, placement: layout},
      },
      entries.map(({layer}) => layer),
    );
    for (const {index} of entries) replacements.set(index, []);
    replacements.set(entries.at(-1)!.index, [merged]);
  }
  return applyReplacements(layers, replacements);
}

function consolidateRoadLabels(layers: LayerFamily[]): LayerFamily[] {
  const candidates = layers
    .map((layer, index) => ({
      index,
      layer,
      roadClass: layer.family?.kind === 'road-label' ? layer.family.member : undefined,
    }))
    .filter(
      ({layer, roadClass}) =>
        layer.renderer === 'symbol' &&
        roadClass !== undefined &&
        layer.feature?.dataLayer !== undefined,
    );
  if (candidates.some(({layer}) => isOrderedRenderPass(layer))) return layers;
  const groups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const {layer} = candidate;
    const key = JSON.stringify({
      feature: layer.feature,
      range: layer.range,
      layout: layer.style.placement ?? {},
      paint: layer.style.appearance ?? {},
    });
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const replacements = new Map<number, LayerFamily[]>();
  let groupNumber = 0;
  for (const group of groups.values()) {
    if (group.length < 2 || !areContiguous(group)) continue;
    const first = group[0]!.layer;
    if (!group.every(({layer}) => sameTopLevelProperties(layer, first))) continue;
    const conditions = group.map(({layer}) => asFilter(layer.selector));
    const key = group.some(({roadClass}) => roadClass === 'motorway')
      ? 'labels.cohorts.roads.major'
      : group.some(({roadClass}) => roadClass === 'service')
        ? 'labels.cohorts.roads.local'
        : `labels.cohorts.roads.cohort${groupNumber++}`;
    if (hasGeneratedKeyCollision(layers, key, group)) continue;
    const layout = {...(first.style.placement ?? {})};
    const sortKeyValues = group.map(({layer}, index) => {
      const original = layer.style.placement?.['symbol-sort-key'] ?? 0;
      return {
        condition: conditions[index]!,
        value: rankedSortKey(original, index),
      };
    });
    if (sortKeyValues.some(({value}) => containsZoom(value))) continue;
    const sortKey = combineConditionalValues(sortKeyValues, group.length, minimumZoom(first));
    if (!sortKey.ok) continue;
    layout['symbol-sort-key'] = sortKey.value;
    const merged = withMergedOrigins(
      {
        ...first,
        key,
        selector: unionFilters(conditions),
        style: {...first.style, placement: layout},
      },
      group.map(({layer}) => layer),
    );
    for (const {index} of group) replacements.set(index, []);
    replacements.set(group.at(-1)!.index, [merged]);
  }
  return applyReplacements(layers, replacements);
}

function consolidateFillFamily(
  layers: LayerFamily[],
  group: string,
  mergedId: string,
): LayerFamily[] {
  const candidates = layers
    .map((layer, index) => ({index, layer}))
    .filter(
      ({layer}) =>
        layer.renderer === 'fill' && layer.family?.kind === 'fill' && layer.family.group === group,
    );
  if (candidates.some(({layer}) => isOrderedRenderPass(layer))) return layers;
  const groups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const {layer} = candidate;
    const layout = {...(layer.style.placement ?? {})};
    delete layout['fill-sort-key'];
    const paint = layer.style.appearance ?? {};
    if (paint['fill-pattern'] !== undefined) continue;
    const key = JSON.stringify({
      feature: layer.feature,
      range: layer.range,
      layout,
      antialias: paint['fill-antialias'],
    });
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const replacements = new Map<number, LayerFamily[]>();
  let suffix = 0;
  for (const grouped of groups.values()) {
    for (const group of contiguousRuns(grouped)) {
      if (group.length < 2) continue;
      const first = group[0]!.layer;
      if (!group.every(({layer}) => sameTopLevelProperties(layer, first))) continue;
      const conditions = group.map(({layer}) => asFilter(layer.selector));
      const reversed = [...group].reverse();
      const reversedConditions = [...conditions].reverse();
      const paintKeys = new Set(
        group.flatMap(({layer}) => Object.keys(layer.style.appearance ?? {})),
      );
      const paint: Record<string, unknown> = {};
      let safe = true;
      for (const key of paintKeys) {
        const values = group.map(({layer}) => layer.style.appearance?.[key]);
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
            value: layer.style.appearance?.[key] ?? fallback,
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
      const layout = {...(first.style.placement ?? {})};
      const sortValues = reversed.map(({layer}, index) => ({
        condition: reversedConditions[index]!,
        value: rankedSortKey(
          layer.style.placement?.['fill-sort-key'] ?? 0,
          group.length - index - 1,
        ),
      }));
      if (sortValues.some(({value}) => containsZoom(value))) continue;
      const sortKey = combineConditionalValues(sortValues, 0, minimumZoom(first));
      if (!sortKey.ok) continue;
      layout['fill-sort-key'] = sortKey.value;
      const key = suffix === 0 ? mergedId : `${mergedId}.cohort${suffix}`;
      if (hasGeneratedKeyCollision(layers, key, group)) continue;
      const merged = withMergedOrigins(
        {
          ...first,
          key,
          selector: unionFilters(conditions),
          style: {appearance: paint, placement: layout},
        },
        group.map(({layer}) => layer),
      );
      suffix += 1;
      for (const {index} of group) replacements.set(index, []);
      replacements.set(group.at(-1)!.index, [merged]);
    }
  }
  return applyReplacements(layers, replacements);
}

function consolidateWaterways(layers: LayerFamily[]): LayerFamily[] {
  const replacements = new Map<number, LayerFamily[]>();
  for (const name of ['river', 'canal', 'stream', 'other']) {
    const regularIndex = layers.findIndex(
      (layer) =>
        layer.family?.kind === 'waterway' &&
        layer.family.group === name &&
        layer.family.variant === 'regular',
    );
    const intermittentIndex = layers.findIndex(
      (layer) =>
        layer.family?.kind === 'waterway' &&
        layer.family.group === name &&
        layer.family.variant === 'intermittent',
    );
    if (regularIndex < 0 || intermittentIndex < 0) continue;
    const regular = layers[regularIndex]!;
    const intermittent = layers[intermittentIndex]!;
    if (
      !sameLayerSource(regular, intermittent) ||
      isOrderedRenderPass(regular) ||
      isOrderedRenderPass(intermittent) ||
      intermittentIndex !== regularIndex + 1 ||
      minimumZoom(regular) !== minimumZoom(intermittent) ||
      maximumZoom(regular) !== maximumZoom(intermittent) ||
      !allEqual([regular.style.placement ?? {}, intermittent.style.placement ?? {}]) ||
      !sameTopLevelProperties(regular, intermittent)
    ) {
      continue;
    }
    const conditions = [asFilter(intermittent.selector), asFilter(regular.selector)];
    const paintKeys = new Set([
      ...Object.keys(regular.style.appearance ?? {}),
      ...Object.keys(intermittent.style.appearance ?? {}),
    ]);
    const paint: Record<string, unknown> = {};
    let safe = true;
    for (const key of paintKeys) {
      const intermittentValue = intermittent.style.appearance?.[key];
      const regularValue = regular.style.appearance?.[key];
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
    const merged = withMergedOrigins(
      {
        ...regular,
        selector: unionFilters(conditions),
        style: {...regular.style, appearance: paint},
      },
      [regular, intermittent],
    );
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
  const zoomExpressions = [
    ...entries.flatMap(({value}) => (isZoomInterpolation(value) ? [value as unknown[]] : [])),
    ...(isZoomInterpolation(fallback) ? [fallback as unknown[]] : []),
  ];
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
  if (!allEqual(interpolationMethods)) return {ok: false};
  const interpolationMethod = interpolationMethods[0];
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
): {field: unknown; labels: unknown; remainder: unknown[]} | undefined {
  const parts = condition[0] === 'all' ? condition.slice(1) : [condition];
  const matchIndex = parts.findIndex(
    (part) =>
      Array.isArray(part) &&
      part.length === 5 &&
      part[0] === 'match' &&
      Array.isArray(part[1]) &&
      part[1][0] === 'get' &&
      part[1][1] !== undefined &&
      part.at(-2) === true &&
      part.at(-1) === false,
  );
  if (matchIndex < 0) return undefined;
  const classMatch = parts[matchIndex] as unknown[];
  const remainderParts = parts.filter((_, index) => index !== matchIndex);
  return {
    field: (classMatch[1] as unknown[])[1],
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
  layers: LayerFamily[],
  replacements: ReadonlyMap<number, LayerFamily[]>,
): LayerFamily[] {
  return layers.flatMap((layer, index) => replacements.get(index) ?? [layer]);
}

function sameLayerSource(left: LayerFamily, right: LayerFamily): boolean {
  return allEqual([left.feature, right.feature]);
}

function sameTopLevelProperties(
  left: LayerFamily,
  right: LayerFamily,
  additionallyIgnored: readonly string[] = [],
): boolean {
  const ignored = new Set(additionallyIgnored);
  const select = (layer: LayerFamily) => ({
    annotations: layer.annotations,
    feature: layer.feature,
    properties: layer.properties,
    range: Object.fromEntries(
      Object.entries(layer.range ?? {}).filter(([key]) => !ignored.has(key)),
    ),
    renderer: layer.renderer,
  });
  return allEqual([select(left), select(right)]);
}

function isOrderedRenderPass(layer: LayerFamily): boolean {
  // Owner-local passes carry an explicit ordering contract and must never be folded.
  // Refinements may be consolidated when the normal equivalence guards prove it safe.
  return layer.origins.some(({operations}) => operations.some(({kind}) => kind === 'pass'));
}

function withMergedOrigins(layer: LayerFamily, members: readonly LayerFamily[]): LayerFamily {
  return {...layer, origins: members.flatMap(({origins}) => origins.map(cloneJson))};
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

function hasGeneratedKeyCollision(
  layers: readonly LayerFamily[],
  key: string,
  entries: readonly {layer: LayerFamily}[],
): boolean {
  const members = new Set(entries.map(({layer}) => layer));
  return layers.some((layer) => layer.key === key && !members.has(layer));
}

function withMaximumZoom(layer: LayerFamily, maxzoom: number): LayerFamily {
  return {
    ...layer,
    range: {...(layer.range ?? {}), maxZoom: Math.min(maximumZoom(layer), maxzoom)},
  };
}

function minimumZoom(layer: LayerFamily): number {
  return typeof layer.range?.minZoom === 'number' ? layer.range.minZoom : 0;
}

function maximumZoom(layer: LayerFamily): number {
  return typeof layer.range?.maxZoom === 'number' ? layer.range.maxZoom : Infinity;
}

function finiteMaximumZoom(layers: LayerFamily[]): number | undefined {
  const maximum = Math.max(...layers.map(maximumZoom));
  return Number.isFinite(maximum) ? maximum : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
