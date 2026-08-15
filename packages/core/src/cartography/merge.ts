import {isTileflowExpression, isTileflowZoomValue} from './values';

export function mergeTileflowDesign<T>(base: T, ...overlays: readonly unknown[]): T {
  let resolved: unknown = cloneJson(base);
  for (const overlay of overlays) {
    resolved = mergeValue(resolved, overlay);
  }
  return resolved as T;
}

function mergeValue(base: unknown, overlay: unknown): unknown {
  if (overlay === undefined) return cloneJson(base);
  if (
    Array.isArray(overlay) ||
    isTileflowExpression(overlay) ||
    isTileflowZoomValue(overlay) ||
    !isRecord(overlay)
  ) {
    return cloneJson(overlay);
  }

  const baseRecord = isRecord(base) ? base : {};
  const result: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(baseRecord), ...Object.keys(overlay)])) {
    const overlayValue = overlay[key];
    if (overlayValue === undefined) {
      if (key in baseRecord) result[key] = cloneJson(baseRecord[key]);
      continue;
    }
    result[key] = mergeValue(baseRecord[key], overlayValue);
  }
  return result;
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
