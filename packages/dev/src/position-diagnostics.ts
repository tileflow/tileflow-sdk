import {isTileflowPortableId, tileflowOverlayPlacements} from '@tileflow/core';
import type {TileflowLayerPositionContext} from '@tileflow/core';

/** Keep the placement contract bounded without forwarding arbitrary exception fields. */
export function readLayerPositionContext(
  value: unknown,
  sanitize: (text: string) => string,
): TileflowLayerPositionContext | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  if (
    !['layerPositionConflict', 'invalidLayerPosition', 'unknownLayer'].includes(
      String(input.reason),
    ) ||
    !['compileOverlay', 'addLayer', 'moveLayer', 'updateLayer'].includes(String(input.operation)) ||
    ![
      'sameSlot',
      'authoredOverlayPlacement',
      'knownReference',
      'indexRange',
      'onePosition',
    ].includes(String(input.rule)) ||
    !isTileflowPortableId(input.layerId) ||
    typeof input.path !== 'string' ||
    !['map', 'position'].includes(input.path.split('.')[0]!) ||
    !input.path.split('.').every((part) => /^[A-Za-z0-9_-]{1,128}$/u.test(part))
  )
    return undefined;

  const corrections = Array.isArray(input.corrections)
    ? input.corrections.slice(0, 8).flatMap((item: unknown) => {
        if (!item || typeof item !== 'object') return [];
        const entry = item as Record<string, unknown>;
        if (
          typeof entry.code !== 'string' ||
          typeof entry.message !== 'string' ||
          ![
            'alignSlot',
            'referenceSameSlot',
            'referenceExistingLayer',
            'chooseSlotIndex',
            'chooseOnePosition',
            'useOverlayPlacement',
            'removeRuntimePosition',
          ].includes(entry.code)
        )
          return [];
        return [{code: entry.code, message: sanitize(entry.message)}];
      })
    : [];
  const slots = Object.fromEntries(
    ['slot', 'referenceSlot'].flatMap((key) => {
      const slot = input[key];
      return slot === null || tileflowOverlayPlacements.some((name) => name === slot)
        ? [[key, slot]]
        : [];
    }),
  );

  return {
    reason: input.reason as TileflowLayerPositionContext['reason'],
    operation: input.operation as string,
    path: sanitize(input.path),
    layerId: sanitize(input.layerId),
    rule: input.rule as string,
    ...(isTileflowPortableId(input.referenceLayerId)
      ? {referenceLayerId: sanitize(input.referenceLayerId)}
      : {}),
    ...slots,
    ...(typeof input.limit === 'number' && Number.isSafeInteger(input.limit)
      ? {limit: input.limit}
      : {}),
    ...(typeof input.count === 'number' && Number.isSafeInteger(input.count)
      ? {count: input.count}
      : {}),
    corrections,
  };
}
