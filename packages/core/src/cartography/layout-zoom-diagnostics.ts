import type {TileflowCompilationDiagnostic} from './compilation-report';
import {readTileflowCompilerProvenance} from './compiler-inspection';

/**
 * Warns where a layout property steps at a fractional zoom. MapLibre evaluates layout properties
 * at the integer zoom of each tile, so such a step takes effect only at the next whole zoom.
 */
export function diagnoseFractionalLayoutZoomSteps(
  layers: readonly Record<string, unknown>[],
): TileflowCompilationDiagnostic[] {
  const diagnostics: TileflowCompilationDiagnostic[] = [];
  for (const layer of layers) {
    const layout = layer.layout;
    if (layout === null || typeof layout !== 'object') continue;
    for (const [property, value] of Object.entries(layout)) {
      const stops = fractionalZoomSteps(value);
      if (stops.length === 0) continue;
      const [origin] = readTileflowCompilerProvenance(layer);
      const listed = stops.map((stop) => String(stop)).join(', ');
      diagnostics.push({
        code: 'TF_LAYOUT_FRACTIONAL_ZOOM_STEP',
        ...(origin ? {domain: origin.owner as TileflowCompilationDiagnostic['domain']} : {}),
        message:
          `${property} steps at zoom ${listed}; layout properties are evaluated at each tile's ` +
          `integer zoom, so the step takes effect at zoom ${stops.map(Math.ceil).join(', ')}.`,
        path: `layers.${String(layer.id)}.layout.${property}`,
        phase: 'lowering',
        severity: 'warning',
        suggestion: 'Step at whole zooms, or move the change to a paint property or a zoom range.',
        ...(origin ? {target: origin.target} : {}),
      });
    }
  }
  return diagnostics;
}

/** Fractional stops of every `["step", ["zoom"], …]` inside a value, in order. */
function fractionalZoomSteps(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const stops: number[] = [];
  if (value[0] === 'step' && isZoom(value[1])) {
    for (let index = 3; index < value.length; index += 2) {
      const stop = value[index];
      if (typeof stop === 'number' && !Number.isInteger(stop)) stops.push(stop);
    }
  }
  for (const entry of value) stops.push(...fractionalZoomSteps(entry));
  return stops;
}

function isZoom(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === 'zoom';
}
