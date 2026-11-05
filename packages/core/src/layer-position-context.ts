/** Structured placement diagnostics shared by authoring tools and map adapters. */
export type TileflowLayerPositionContext = Readonly<{
  reason: 'layerPositionConflict' | 'invalidLayerPosition' | 'unknownLayer';
  operation: string;
  path: string;
  layerId: string;
  referenceLayerId?: string;
  slot?: string | null;
  referenceSlot?: string | null;
  rule: string;
  limit?: number;
  count?: number;
  corrections: readonly Readonly<{code: string; message: string}>[];
}>;

export function isLayerPositionContext(value: unknown): value is TileflowLayerPositionContext {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return (
    ['layerPositionConflict', 'invalidLayerPosition', 'unknownLayer'].includes(
      String(input.reason),
    ) &&
    ['operation', 'path', 'layerId', 'rule'].every((key) => typeof input[key] === 'string') &&
    (input.referenceLayerId === undefined || typeof input.referenceLayerId === 'string') &&
    ['slot', 'referenceSlot'].every(
      (key) => input[key] === undefined || input[key] === null || typeof input[key] === 'string',
    ) &&
    ['limit', 'count'].every(
      (key) => input[key] === undefined || Number.isSafeInteger(input[key]),
    ) &&
    Array.isArray(input.corrections) &&
    input.corrections.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const entry = item as Record<string, unknown>;
      return typeof entry.code === 'string' && typeof entry.message === 'string';
    })
  );
}
