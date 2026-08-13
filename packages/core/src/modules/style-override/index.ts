import type {
  TileflowStyleLayerOverride,
  TileflowStyleOverrideModuleConfig,
  TileflowStyleOverrideOptions,
} from '../../compiler';

export function styleOverride(
  options: TileflowStyleOverrideOptions = {},
): TileflowStyleOverrideModuleConfig {
  return {
    type: 'styleOverride',
    ...(options.layers ? {layers: options.layers} : {}),
    ...(options.removeLayers ? {removeLayers: options.removeLayers} : {}),
  };
}

export function applyStyleOverrides(
  layers: Array<Record<string, unknown>>,
  modules: readonly TileflowStyleOverrideModuleConfig[] = [],
): Array<Record<string, unknown>> {
  return modules.reduce(applyStyleOverride, layers);
}

function applyStyleOverride(
  layers: Array<Record<string, unknown>>,
  moduleConfig: TileflowStyleOverrideModuleConfig,
): Array<Record<string, unknown>> {
  const removeLayers = new Set(moduleConfig.removeLayers ?? []);
  let nextLayers = layers.filter((layer) => !removeLayers.has(String(layer.id)));

  for (const [layerId, override] of Object.entries(moduleConfig.layers ?? {})) {
    nextLayers = applyLayerOverride(nextLayers, layerId, override);
  }

  return nextLayers;
}

function applyLayerOverride(
  layers: Array<Record<string, unknown>>,
  layerId: string,
  override: TileflowStyleLayerOverride,
): Array<Record<string, unknown>> {
  const index = layers.findIndex((layer) => layer.id === layerId);

  if (index === -1) {
    const layer = stripControlFields({
      id: layerId,
      ...override,
    });

    return insertLayer(layers, layer, override.before);
  }

  const previousLayer = layers[index];
  const layout = mergeRecords(previousLayer.layout, override.layout);
  const paint = mergeRecords(previousLayer.paint, override.paint);
  const metadata = mergeRecords(previousLayer.metadata, override.metadata);
  const patchedLayer = stripControlFields({
    ...previousLayer,
    ...override,
    ...(layout ? {layout} : {}),
    ...(paint ? {paint} : {}),
    ...(metadata ? {metadata} : {}),
  });
  const nextLayers = [...layers];
  nextLayers[index] = patchedLayer;

  return nextLayers;
}

function insertLayer(
  layers: Array<Record<string, unknown>>,
  layer: Record<string, unknown>,
  before: string | undefined,
): Array<Record<string, unknown>> {
  if (!before) {
    return [...layers, layer];
  }

  const index = layers.findIndex((candidate) => candidate.id === before);

  if (index === -1) {
    return [...layers, layer];
  }

  return [...layers.slice(0, index), layer, ...layers.slice(index)];
}

function mergeRecords(previous: unknown, next: unknown): Record<string, unknown> | undefined {
  if (!isRecord(previous) && !isRecord(next)) {
    return undefined;
  }

  return {
    ...(isRecord(previous) ? previous : {}),
    ...(isRecord(next) ? next : {}),
  };
}

function stripControlFields(layer: Record<string, unknown>): Record<string, unknown> {
  const {before, ...styleLayer} = layer;

  return Object.fromEntries(Object.entries(styleLayer).filter(([, value]) => value !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
