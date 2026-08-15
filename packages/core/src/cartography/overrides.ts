export type TileflowRawOverride =
  | {kind: 'patch'; id: string; patch: Record<string, unknown>}
  | {
      kind: 'add';
      layer: Record<string, unknown> & {id: string; type: string};
      placement: TileflowLayerPlacement;
    }
  | {kind: 'remove'; id: string}
  | {kind: 'move'; id: string; placement: TileflowLayerPlacement};

export type TileflowLayerPlacement = {after: string} | {before: string};

export function patchLayer(id: string, patch: Record<string, unknown>): TileflowRawOverride {
  return {kind: 'patch', id: requireId(id), patch: cloneJson(patch)};
}

export function addLayer(
  layer: Record<string, unknown> & {id: string; type: string},
  placement: TileflowLayerPlacement,
): TileflowRawOverride {
  return {kind: 'add', layer: cloneJson({...layer, id: requireId(layer.id)}), placement};
}

export function removeLayer(id: string): TileflowRawOverride {
  return {kind: 'remove', id: requireId(id)};
}

export function moveLayer(id: string, placement: TileflowLayerPlacement): TileflowRawOverride {
  return {kind: 'move', id: requireId(id), placement};
}

export function applyTileflowRawOverrides(
  input: readonly Record<string, unknown>[],
  overrides: readonly TileflowRawOverride[],
): Array<Record<string, unknown>> {
  let layers = input.map(cloneJson);

  for (const override of overrides) {
    if (override.kind === 'add') {
      if (findLayerIndex(layers, override.layer.id) >= 0) {
        throw new Error(`Tileflow raw add targets existing layer: ${override.layer.id}`);
      }
      layers = insertAtPlacement(layers, cloneJson(override.layer), override.placement);
      continue;
    }

    const index = findLayerIndex(layers, override.id);
    if (index < 0) {
      throw new Error(`Tileflow raw ${override.kind} targets unknown layer: ${override.id}`);
    }

    if (override.kind === 'remove') {
      layers = [...layers.slice(0, index), ...layers.slice(index + 1)];
      continue;
    }

    if (override.kind === 'patch') {
      const previous = layers[index]!;
      const next = {
        ...previous,
        ...cloneJson(override.patch),
        id: previous.id,
        ...(mergeRecords(previous.layout, override.patch.layout)
          ? {layout: mergeRecords(previous.layout, override.patch.layout)}
          : {}),
        ...(mergeRecords(previous.paint, override.patch.paint)
          ? {paint: mergeRecords(previous.paint, override.patch.paint)}
          : {}),
        ...(mergeRecords(previous.metadata, override.patch.metadata)
          ? {metadata: mergeRecords(previous.metadata, override.patch.metadata)}
          : {}),
      };
      layers = [...layers];
      layers[index] = next;
      continue;
    }

    const [layer] = layers.splice(index, 1);
    layers = insertAtPlacement(layers, layer!, override.placement);
  }

  return layers;
}

function insertAtPlacement(
  layers: Array<Record<string, unknown>>,
  layer: Record<string, unknown>,
  placement: TileflowLayerPlacement,
): Array<Record<string, unknown>> {
  const target = 'before' in placement ? placement.before : placement.after;
  const targetIndex = findLayerIndex(layers, target);
  if (targetIndex < 0) {
    throw new Error(`Tileflow raw placement targets unknown layer: ${target}`);
  }
  const insertionIndex = 'before' in placement ? targetIndex : targetIndex + 1;
  return [...layers.slice(0, insertionIndex), layer, ...layers.slice(insertionIndex)];
}

function findLayerIndex(layers: readonly Record<string, unknown>[], id: string): number {
  return layers.findIndex((layer) => layer.id === id);
}

function mergeRecords(left: unknown, right: unknown): Record<string, unknown> | undefined {
  if (!isRecord(left) && !isRecord(right)) return undefined;
  return {...(isRecord(left) ? left : {}), ...(isRecord(right) ? right : {})};
}

function requireId(value: string): string {
  const id = value.trim();
  if (!id) throw new Error('Tileflow raw layer ID must not be empty.');
  return id;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
