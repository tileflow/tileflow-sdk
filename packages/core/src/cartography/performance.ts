import type {MapLibreStyle} from '../types';

export type TileflowZoomPerformance = {
  activeLayers: number;
  /** @deprecated Use styleLayerFamilies. This is not a count of runtime tile buckets. */
  estimatedBuckets: number;
  sourceLayers: Record<string, number>;
  styleLayerFamilies: number;
  symbols: number;
  zoom: number;
};

export type TileflowStylePerformance = {
  styleBytes: number;
  totalLayers: number;
  zooms: TileflowZoomPerformance[];
};

/** A deterministic, network-free structural sweep of a compiled style. */
export function analyzeTileflowStylePerformance(
  style: MapLibreStyle,
  zooms: readonly number[] = defaultZoomSamples(style.layers),
): TileflowStylePerformance {
  return {
    styleBytes: new TextEncoder().encode(JSON.stringify(style)).byteLength,
    totalLayers: style.layers.length,
    zooms: zooms.map((zoom) => {
      const active = style.layers.filter((layer) => isLayerActive(layer, zoom));
      const sourceLayers: Record<string, number> = {};
      for (const layer of active) {
        const sourceLayer =
          typeof layer['source-layer'] === 'string' ? layer['source-layer'] : '(none)';
        sourceLayers[sourceLayer] = (sourceLayers[sourceLayer] ?? 0) + 1;
      }
      const styleLayerFamilies = new Set(
        active.filter((layer) => layer.source !== undefined).map(bucketSignature),
      ).size;
      return {
        zoom,
        activeLayers: active.length,
        estimatedBuckets: styleLayerFamilies,
        styleLayerFamilies,
        symbols: active.filter((layer) => layer.type === 'symbol').length,
        sourceLayers: Object.fromEntries(
          Object.entries(sourceLayers).sort(([left], [right]) => compareCodeUnits(left, right)),
        ),
      };
    }),
  };
}

function isLayerActive(layer: Record<string, unknown>, zoom: number): boolean {
  const minimum = typeof layer.minzoom === 'number' ? layer.minzoom : 0;
  const maximum = typeof layer.maxzoom === 'number' ? layer.maxzoom : Infinity;
  const layout = asRecord(layer.layout);
  return minimum <= zoom && zoom < maximum && layout.visibility !== 'none';
}

function bucketSignature(layer: Record<string, unknown>): string {
  return stableStringify([
    layer.type,
    layer.source,
    layer['source-layer'],
    Object.hasOwn(layer, 'minzoom') ? ['set', layer.minzoom] : ['unset'],
    Object.hasOwn(layer, 'maxzoom') ? ['set', layer.maxzoom] : ['unset'],
    Object.hasOwn(layer, 'filter') ? ['set', layer.filter] : ['unset'],
    Object.hasOwn(layer, 'layout') ? ['set', layer.layout] : ['unset'],
  ]);
}

function defaultZoomSamples(layers: readonly Record<string, unknown>[]): number[] {
  const samples = new Set(Array.from({length: 25}, (_, zoom) => zoom));
  for (const layer of layers) {
    for (const value of [layer.minzoom, layer.maxzoom]) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (value >= 0 && value <= 24) samples.add(value);
      const before = value - 0.001;
      const after = value + 0.001;
      if (before >= 0 && before <= 24) samples.add(before);
      if (after >= 0 && after <= 24) samples.add(after);
    }
  }
  return [...samples].sort((left, right) => left - right);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      compareCodeUnits(left, right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
