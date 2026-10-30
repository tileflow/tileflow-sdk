import {isExpression} from '@maplibre/maplibre-gl-style-spec';
import type {MapGeoJSONFeature, Map as MapLibreMap} from 'maplibre-gl';
import {resourceAddress} from '../observer';
import {evaluatedValue} from '../style-edits';
import {visibleTiles} from '../tiles';
import type {LayerContribution, PreviewWindow, RuntimeLayerObservation, Side} from '../types';

export type LayerRecord = {
  id: string;
  type: string;
  index: number;
  source?: string;
  sourceLayer?: string;
  minzoom: number;
  maxzoom: number;
  paint: Record<string, unknown>;
  layout: Record<string, unknown>;
  filter?: unknown;
  contributions: LayerContribution[];
  runtime?: RuntimeLayerObservation;
};
export type Evidence = {label: string; value: string; state: 'pass' | 'warn' | 'info' | 'unknown'};
export type LayerSample = {
  status: 'ready' | 'unavailable' | 'pending' | 'error';
  reason: string;
  total?: number;
  measuredAt?: string;
  features: MapGeoJSONFeature[];
};
export type LayerChange = {
  at: string;
  generation: number;
  layer: string;
  property: string;
  before: unknown;
  after: unknown;
};
export const sampleLimit = 80;
export const internalLayer = (id: string) => id.startsWith('__tileflow-inspector-');

/** getStyle omits custom layers. The renderer's public order is authoritative. */
export function layerInventory(side: Side): LayerRecord[] {
  const map = side.map;
  if (!map) return [];
  const style = map.getStyle();
  const metadata = style.metadata as Record<string, unknown> | undefined;
  const declared = new Map(style.layers.map((layer) => [layer.id, layer]));
  const sidecar = side.sidecar;
  const matchingSidecar =
    (!sidecar?.map || sidecar.map === metadata?.['tileflow:map']) &&
    (!sidecar?.theme || sidecar.theme === metadata?.['tileflow:theme']);
  const provenance = new Map(
    matchingSidecar ? sidecar?.layers.map((layer) => [layer.id, layer.contributions]) : [],
  );
  let runtime: Record<string, RuntimeLayerObservation> = {};
  try {
    runtime =
      (side.frame.contentWindow as PreviewWindow | null)?.__tileflowDescribeRuntimeLayers?.() ?? {};
  } catch {
    /* A non-preview map has no runtime capability. */
  }
  return map
    .getLayersOrder()
    .filter((id) => !internalLayer(id))
    .flatMap((id, index) => {
      const actual = map.getLayer(id);
      if (!actual) return [];
      const layer = declared.get(id);
      return [
        {
          id,
          index,
          type: actual.type,
          source: layer && 'source' in layer ? layer.source : undefined,
          sourceLayer: layer && 'source-layer' in layer ? layer['source-layer'] : undefined,
          minzoom: layer?.minzoom ?? 0,
          maxzoom: layer?.maxzoom ?? 24,
          paint: JSON.parse(JSON.stringify(layer?.paint ?? {})) as Record<string, unknown>,
          layout: JSON.parse(
            JSON.stringify(
              layer?.layout ??
                (actual.type === 'custom' && runtime[id]?.state.visible === false
                  ? {visibility: 'none'}
                  : {}),
            ),
          ) as Record<string, unknown>,
          filter:
            layer && 'filter' in layer && layer.filter
              ? JSON.parse(JSON.stringify(layer.filter))
              : undefined,
          contributions: provenance.get(id) ?? [],
          runtime: runtime[id],
        },
      ];
    });
}

export function layerLabel(layer: LayerRecord): string {
  const targets = [...new Set(layer.contributions.map((entry) => entry.target))];
  return targets.length ? targets.join(' + ') : layer.id;
}

export function layerMatches(layer: LayerRecord, query: string): boolean {
  const text = [
    layer.id,
    layer.type,
    layer.source,
    layer.sourceLayer,
    ...layer.contributions.flatMap((entry) => [entry.owner, entry.target, entry.slot]),
  ]
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/u)
    .every((part) => text.includes(part));
}

export function layerGroups(layers: LayerRecord[], mode: 'module' | 'order') {
  const groups = new Map<string, LayerRecord[]>();
  for (const layer of [...layers].reverse()) {
    const name =
      mode === 'order'
        ? 'Later → earlier draw calls'
        : layer.contributions.length
          ? [...new Set(layer.contributions.map((entry) => entry.owner))].sort().join(' + ')
          : layer.type === 'custom'
            ? 'Runtime'
            : 'Unattributed';
    const group = groups.get(name) ?? [];
    group.push(layer);
    groups.set(name, group);
  }
  return mode === 'order' ? [...groups] : [...groups].sort(([a], [b]) => a.localeCompare(b));
}

export function eligibility(layer: LayerRecord, zoom: number): string {
  if (layer.layout.visibility === 'none') return 'Hidden';
  if (layer.type === 'custom') return 'Runtime';
  if (zoom < layer.minzoom || zoom >= layer.maxzoom) return 'Outside zoom';
  return 'Enabled';
}

export function queryLayer(map: MapLibreMap, layer: LayerRecord): LayerSample {
  if (!['fill', 'line', 'symbol', 'circle', 'fill-extrusion', 'heatmap'].includes(layer.type))
    return {
      status: 'unavailable',
      reason: `${layer.type} layers do not expose rendered feature geometry.`,
      features: [],
    };
  if (!map.getLayer(layer.id))
    return {status: 'unavailable', reason: 'Layer is no longer present.', features: []};
  if (eligibility(layer, map.getZoom()) !== 'Enabled')
    return {
      status: 'unavailable',
      reason: 'The layer is hidden or outside its zoom range.',
      features: [],
    };
  try {
    const features = map.queryRenderedFeatures(undefined, {layers: [layer.id]});
    return {
      status: 'ready',
      reason: `Viewport query; at most ${sampleLimit} fragments retained. Tile boundaries and world copies can duplicate features. This is not a pixel visibility measurement.`,
      total: features.length,
      features: features.slice(0, sampleLimit),
      measuredAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'error',
      reason: error instanceof Error ? error.message : String(error),
      features: [],
    };
  }
}

export function diagnoseLayer(
  map: MapLibreMap,
  layer: LayerRecord | undefined,
  samples: LayerSample,
): Evidence[] {
  if (!layer)
    return [
      {
        label: 'Layer',
        value: 'Not present in the current renderer. The selected ID is retained.',
        state: 'warn',
      },
    ];
  const zoom = map.getZoom();
  const evidence: Evidence[] = [
    {
      label: 'Renderer',
      value: `Present · ${layer.type} · draw index ${layer.index}`,
      state: 'pass',
    },
  ];
  if (layer.type === 'custom') {
    evidence.push({
      label: 'Controller',
      value: layer.runtime
        ? `${layer.runtime.controller} · runtime state available`
        : 'No diagnostic capability exposed by this custom layer',
      state: layer.runtime ? 'info' : 'unknown',
    });
  } else {
    const enabled = layer.layout.visibility !== 'none',
      inZoom = zoom >= layer.minzoom && zoom < layer.maxzoom;
    evidence.push(
      {
        label: 'Visibility rule',
        value: enabled ? 'Enabled in style' : 'layout.visibility = none',
        state: enabled ? 'pass' : 'warn',
      },
      {
        label: 'Zoom range',
        value: `${layer.minzoom} ≤ ${zoom.toFixed(2)} < ${layer.maxzoom} · ${inZoom ? 'inside' : 'outside'} range`,
        state: inZoom ? 'pass' : 'warn',
      },
    );
  }
  if (layer.source) {
    const present = !!map.getSource(layer.source);
    let loaded: boolean | undefined;
    try {
      if (present) loaded = map.isSourceLoaded(layer.source);
    } catch {
      /* Style transition. */
    }
    evidence.push({
      label: 'Source',
      value: `${layer.source} · ${!present ? 'missing' : loaded === undefined ? 'loading state unavailable' : loaded ? 'loaded' : 'loading'}`,
      state: !present ? 'warn' : loaded ? 'pass' : 'info',
    });
    const tiles = visibleTiles(map);
    const sourceTiles = tiles.tiles.filter((tile) => tile.source === layer.source);
    evidence.push({
      label: 'Source tiles',
      value: tiles.supported
        ? `${sourceTiles.length} in-view entries · shared by every layer using this source`
        : 'Tile observation unavailable in this renderer',
      state: tiles.supported ? 'info' : 'unknown',
    });
  }
  evidence.push({
    label: 'Viewport query',
    value:
      samples.status === 'ready'
        ? `${samples.total} returned fragments · ${samples.features.length} retained`
        : samples.reason,
    state:
      samples.status === 'ready'
        ? samples.total
          ? 'pass'
          : 'info'
        : samples.status === 'error'
          ? 'warn'
          : 'unknown',
  });
  if (samples.status === 'ready' && !samples.total)
    evidence.push({
      label: 'Interpretation',
      value:
        'No query results. Possible causes include no data here, filtering, placement or loading; the query does not identify which.',
      state: 'info',
    });
  evidence.push({
    label: 'Pixel visibility',
    value:
      'Occlusion, depth testing and transparency are not measured. Draw order alone cannot prove what is visible.',
    state: 'unknown',
  });
  return evidence;
}

export function expressionDependencies(value: unknown): string[] {
  if (!isExpression(value)) return ['constant'];
  const dependencies = new Set<string>();
  function visit(node: unknown) {
    if (!Array.isArray(node) || node[0] === 'literal') return;
    if (node[0] === 'zoom') dependencies.add('zoom');
    if (['get', 'has', 'id', 'geometry-type', 'properties'].includes(node[0]))
      dependencies.add('feature');
    if (node[0] === 'feature-state') dependencies.add('feature state');
    if (node[0] === 'global-state') dependencies.add('global state');
    if (node[0] === 'image') dependencies.add('images');
    node.slice(1).forEach(visit);
  }
  visit(value);
  return dependencies.size ? [...dependencies] : ['expression'];
}

export function layerChanges(
  previous: LayerRecord[],
  next: LayerRecord[],
  generation: number,
  at = new Date().toISOString(),
): LayerChange[] {
  const before = new Map(previous.map((layer) => [layer.id, layer])),
    after = new Map(next.map((layer) => [layer.id, layer]));
  const changes: LayerChange[] = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id),
      b = after.get(id);
    const add = (property: string, from: unknown, to: unknown) => {
      if (JSON.stringify(from) !== JSON.stringify(to))
        changes.push({
          at,
          generation,
          layer: id,
          property,
          before: from ?? null,
          after: to ?? null,
        });
    };
    if (!a || !b) {
      add('presence', !!a, !!b);
      continue;
    }
    for (const key of ['index', 'source', 'sourceLayer', 'minzoom', 'maxzoom', 'filter'] as const)
      add(key, a[key], b[key]);
    for (const section of ['paint', 'layout'] as const)
      for (const key of new Set([...Object.keys(a[section]), ...Object.keys(b[section])]))
        add(`${section}.${key}`, a[section][key], b[section][key]);
  }
  return changes;
}

/** Bounded, JSON-safe evidence; credentials and inline source payloads never enter a packet. */
export function safeContext(input: unknown, maxNodes = 2400): {value: any; omitted: string[]} {
  let nodes = 0;
  const omitted: string[] = [];
  function visit(value: unknown, path: string, depth: number): unknown {
    if (++nodes > maxNodes || depth > 12) {
      omitted.push(path);
      return '[omitted]';
    }
    if (typeof value === 'string') {
      if (value.length > 4000) omitted.push(path);
      if (/^(?:\.{0,2}\/)/u.test(value)) {
        if (value.startsWith('//')) return resourceAddress(value);
        return value.split(/[?#]/u)[0].slice(0, 4000);
      }
      return value
        .slice(0, 4000)
        .replace(/[a-z][a-z\d+.-]*:\/\/[^\s"<>]+/giu, (url) => resourceAddress(url));
    }
    if (Array.isArray(value)) {
      if (value.length > 80) omitted.push(path);
      return value.slice(0, 80).map((item, index) => visit(item, `${path}/${index}`, depth + 1));
    }
    if (value && typeof value === 'object') {
      if (Object.keys(value).length > 100) omitted.push(path);
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 100)
          .map(([key, entry]) => [
            key,
            key !== 'themeTokens' &&
            /(?:token|password|authorization|secret|api[-_]?key|credential)/iu.test(key)
              ? '[redacted]'
              : visit(entry, `${path}/${key}`, depth + 1),
          ]),
      );
    }
    return value;
  }
  return {value: visit(input, '', 0), omitted};
}

export function layerContext(
  side: Side,
  selectedId: string,
  layers: LayerRecord[],
  samples: LayerSample,
  changes: LayerChange[],
  temporary: unknown,
  investigation = '',
  sampleIndex = 0,
  picked?: {feature: MapGeoJSONFeature; coordinate?: [number, number]; at: string},
): Record<string, unknown> {
  const map = side.map!,
    style = map.getStyle(),
    layer = layers.find((entry) => entry.id === selectedId);
  const metadata = style.metadata as Record<string, unknown> | undefined;
  const center = map.getCenter(),
    container = map.getContainer();
  const source = layer?.source
    ? (style.sources[layer.source] as unknown as Record<string, unknown> | undefined)
    : undefined;
  const sourceSummary = source
    ? Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'data'))
    : undefined;
  const selectedSample = picked?.feature ?? samples.features[sampleIndex];
  const evaluated =
    layer && layer.type !== 'custom'
      ? Object.fromEntries(
          (['paint', 'layout'] as const).map((section) => [
            section,
            Object.fromEntries(
              Object.keys(layer[section])
                .slice(0, 40)
                .map((key) => [
                  key,
                  evaluatedValue(map, layer.id, section, key, selectedSample) ??
                    '[evaluation unavailable]',
                ]),
            ),
          ]),
        )
      : undefined;
  const projected = safeContext({
    schemaVersion: 1,
    kind: 'layer',
    capturedAt: new Date().toISOString(),
    investigation,
    identity: {
      map: metadata?.['tileflow:map'] ?? side.definition.label,
      theme: metadata?.['tileflow:theme'],
      generation: side.artifactGeneration,
      epoch: side.loadEpoch,
      status: side.artifactStatus,
      sceneRevision: style.state?.['tileflow:preview-revision'],
    },
    scene: {
      sun: metadata?.['tileflow:sun'],
      runtime: layers
        .filter((entry) => entry.runtime)
        .map((entry) => ({id: entry.id, ...entry.runtime})),
    },
    camera: {
      center: [center.lng, center.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    },
    viewport: {width: container.clientWidth, height: container.clientHeight},
    layer: layer ?? {id: selectedId, present: false},
    evaluated: {
      zoom: map.getZoom(),
      sampleIndex: !picked && selectedSample ? sampleIndex : null,
      featureContext: picked ? 'picked feature' : selectedSample ? 'viewport sample' : 'none',
      values: evaluated,
      limit: 'First 40 explicit rules per section; transitions and placement are not reproduced.',
    },
    runtimeErrors: side.runtimeErrors.slice(-8),
    neighbors: layer
      ? {earlier: layers[layer.index - 1]?.id, later: layers[layer.index + 1]?.id}
      : undefined,
    evidence: diagnoseLayer(map, layer, samples),
    source: sourceSummary,
    samples: {
      status: samples.status,
      reason: samples.reason,
      measuredAt: samples.measuredAt,
      totalFragments: samples.total,
      selected: selectedSample
        ? {
            index: picked ? undefined : sampleIndex,
            pickedAt: picked?.at,
            coordinate: picked?.coordinate,
            id: selectedSample.id,
            geometryType: selectedSample.geometry.type,
            properties: selectedSample.properties,
          }
        : undefined,
      features: samples.features.slice(0, 8).map((feature) => ({
        id: feature.id,
        source: feature.source,
        sourceLayer: feature.sourceLayer,
        geometryType: feature.geometry.type,
        properties: feature.properties,
      })),
    },
    recentChanges: changes.filter((entry) => entry.layer === selectedId).slice(-15),
    temporary,
    limitations: [
      'Semantic ownership is not an exact source-file location.',
      'Queries can return tile fragments and duplicates; they do not measure pixel coverage.',
      'Custom layers expose only their declared diagnostic capability.',
      'Source URLs omit query strings and credentials. Inline source data and sample geometries are excluded.',
      'History covers observations during this browser session; it does not establish causality.',
    ],
  });
  return {
    ...projected.value,
    projection: {omitted: projected.omitted, truncated: projected.omitted.length > 0},
  };
}

export function contextMarkdown(context: Record<string, any>): string {
  const title = String(context.layer?.id ?? 'Layer').replaceAll('`', '');
  const fence = '`'.repeat(
    Math.max(3, ...(JSON.stringify(context).match(/`+/gu) ?? []).map((run) => run.length + 1)),
  );
  return `# Layer investigation: ${title}\n\n${context.investigation || 'Explain this layer using the observations below. Distinguish evidence from hypotheses.'}\n\n${fence}json\n${JSON.stringify(context, null, 2)}\n${fence}\n`;
}
