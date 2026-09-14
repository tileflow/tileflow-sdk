import {lowerNativeStyleRepresentation, type NativeLayer, type NativeStyleRepresentation} from '../src/native-lowering';

type Footprint = {nodes: number; depth: number; bytes: number};

/** Match the native JSON budget: each array index/object key and each value is visited. */
export function measureNativeJson(value: unknown): Footprint {
  let nodes = 0;
  let depth = 0;
  const visit = (item: unknown, level: number): void => {
    nodes++;
    depth = Math.max(depth, level);
    if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        visit(key, level + 1);
        visit(child, level + 1);
      }
    }
  };
  visit(value, 0);
  return {nodes, depth, bytes: new TextEncoder().encode(JSON.stringify(value)).byteLength};
}

function optionalNodes(value: unknown): number {
  return value === undefined ? 0 : measureNativeJson(value).nodes;
}

function retainedPayload(layer: NativeLayer): Record<string, unknown> {
  const {id: _id, filter: _filter, minzoom: _min, maxzoom: _max, layout, paint, ...rest} = layer;
  const {'line-cap': _cap, ...otherLayout} = layout ?? {};
  const {'line-dasharray': _dash, ...otherPaint} = paint ?? {};
  return {
    ...rest,
    ...(layout ? {layout: otherLayout} : {}),
    ...(paint ? {paint: otherPaint} : {}),
  };
}

/** Diagnostic-only: spans and subtree sizes are evidence, not a native compatibility verdict. */
export function auditNativeLowering(
  source: Record<string, unknown>,
  lowered: NativeStyleRepresentation,
) {
  const inputs = source.layers as NativeLayer[];
  const layers = lowered.layers.map((span) => {
    const original = inputs[span.inputLayer]!;
    const physical = lowered.style.layers.slice(span.outputStart, span.outputStart + span.outputCount);
    const payload = measureNativeJson(retainedPayload(original));
    const maximumConcurrentBranches = Math.max(...physical.map((candidate) => {
      const zoom = candidate.minzoom ?? 0;
      return physical.filter((layer) => zoom >= (layer.minzoom ?? 0) && zoom < (layer.maxzoom ?? 24)).length;
    }));
    const branches = physical.map((layer) => ({
      id: layer.id, minzoom: layer.minzoom ?? 0, maxzoom: layer.maxzoom ?? 24,
      filterNodes: optionalNodes(layer.filter),
    }));
    return {
      ...span,
      id: original.id,
      source: original.source,
      sourceLayer: original['source-layer'],
      sortKey: original.layout?.['line-sort-key'] ?? null,
      paintIndicators: ['line-color', 'line-opacity', 'line-pattern', 'line-blur', 'line-width', 'line-gap-width', 'line-offset']
        .filter((key) => original.paint?.[key] !== undefined)
        .map((key) => ({key, kind: Array.isArray(original.paint![key]) ? 'expression' : 'constant'})),
      maximumConcurrentBranches,
      featureOrder: maximumConcurrentBranches > 1 ? 'not-proven' : 'no-simultaneous-branches',
      retainedPayload: payload,
      additionalCopiedNodes: payload.nodes * (span.outputCount - 1),
      inputFilterNodes: optionalNodes(original.filter),
      outputFilterNodes: branches.reduce((total, branch) => total + branch.filterNodes, 0),
      inputDecisionNodes: optionalNodes(original.layout?.['line-cap']) + optionalNodes(original.paint?.['line-dasharray']),
      branches,
    };
  });
  return {
    before: {...measureNativeJson(source), layers: inputs.length},
    after: {...measureNativeJson(lowered.style), layers: lowered.style.layers.length},
    // These are separate subtree accounts, not an additive decomposition of serialized bytes.
    duplication: {
      additionalCopiedNodes: layers.reduce((total, layer) => total + layer.additionalCopiedNodes, 0),
      inputFilterNodes: layers.reduce((total, layer) => total + layer.inputFilterNodes, 0),
      outputFilterNodes: layers.reduce((total, layer) => total + layer.outputFilterNodes, 0),
      inputDecisionNodes: layers.reduce((total, layer) => total + layer.inputDecisionNodes, 0),
    },
    projection: lowered.projection,
    layers,
  };
}

/** Compile the unchanged complete Streets family before measuring either theme or enforcing output limits. */
export async function auditOfficialStreets(cwd: string) {
  const {parseTileflowMap} = await import('@tileflow/core');
  const {collectTileflowMapBuildLineage} = await import('@tileflow/core/build');
  const {tileflowNativeProfileLimits, tileflowNativePreparedStyleLimits} = await import('@tileflow/core/native-profile');
  const {streets} = await import('@tileflow/maps');
  const {convertFilter} = await import('@maplibre/maplibre-gl-style-spec');
  const {prepareTileflowCatalogIcons} = await import('../src/icons');
  const {createTileflowArtifactPlan, disposeTileflowBuildArtifacts} = await import('../src/artifacts');
  const map = parseTileflowMap(streets);
  const prepared = await prepareTileflowCatalogIcons({
    maps: {[map.id]: map},
    mapMetadata: {[map.id]: {id: map.id, version: map.version, lineage: collectTileflowMapBuildLineage(streets)}},
  }, {cwd, baseDirectory: cwd, assetBaseUrl: '../..'});
  const web = await createTileflowArtifactPlan(prepared, {styleBaseUrl: '.'});
  try {
    const themes = Object.entries(web.styles[map.id]!).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([theme, style]) => {
        const lowered = lowerNativeStyleRepresentation(style, (filter) => convertFilter(structuredClone(filter) as any));
        const report = auditNativeLowering(style, lowered);
        return {
          theme, ...report,
          withinInputBudget: report.before.nodes <= tileflowNativeProfileLimits.maximumNodes &&
            report.before.bytes <= tileflowNativeProfileLimits.maximumStyleBytes &&
            report.before.depth <= tileflowNativeProfileLimits.maximumDepth &&
            report.before.layers <= tileflowNativeProfileLimits.maximumLayers,
          withinOutputBudget: report.after.nodes <= tileflowNativePreparedStyleLimits.maximumNodes &&
            report.after.bytes <= tileflowNativePreparedStyleLimits.maximumStyleBytes &&
            report.after.depth <= tileflowNativePreparedStyleLimits.maximumDepth &&
            report.after.layers <= tileflowNativePreparedStyleLimits.maximumLayers,
        };
      });
    return {
      schemaVersion: 1,
      scope: 'static-lowering-size-and-order-audit',
      nativeVisualQualification: 'pending',
      limits: tileflowNativeProfileLimits,
      preparedLimits: tileflowNativePreparedStyleLimits,
      map: map.id,
      themes,
    };
  } finally {
    await disposeTileflowBuildArtifacts(web);
  }
}
