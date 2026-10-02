import {type TileflowIconAppearance, tileflowIconAppearanceSchema} from '../icon-appearance';
import type {MapLibreStyle} from '../types';

export type TileflowPreparedIconCapabilities = {
  ids: readonly string[];
  appearances?: Readonly<Record<string, TileflowIconAppearance>>;
};

/** Admit a compiled style without repairing or changing its signed paint. */
export function validateTileflowCompiledIconCapabilities(
  style: MapLibreStyle,
  icons: TileflowPreparedIconCapabilities,
): void {
  const checked = structuredClone(style);
  applyTileflowIconCapabilities(checked, icons);

  for (const [index, layer] of checked.layers.entries()) {
    const originalPaint = record(style.layers[index]?.paint);
    const checkedPaint = record(layer.paint);
    for (const property of ['icon-color', 'icon-halo-color', 'icon-halo-width', 'icon-halo-blur']) {
      if (originalPaint[property] === undefined && checkedPaint[property] !== undefined) {
        throw Object.assign(
          new Error(`Layer "${layer.id}" is missing compiled SDF paint defaults.`),
          {
            code: 'TF_ICON_DEFAULTS_MISSING',
            path: `layers.${layer.id}.paint.${property}`,
            suggestion: 'Rebuild with the compatible SDK and verified icon metadata.',
          },
        );
      }
    }
  }
}

/** Validate the complete selectable inventory, never a sample of current features. */
export function applyTileflowIconCapabilities(
  style: MapLibreStyle,
  icons?: TileflowPreparedIconCapabilities,
): void {
  if (!icons?.appearances || !Object.keys(icons.appearances).length) return;
  const ids = [...icons.ids];
  const appearances = icons.appearances;
  for (const [id, appearance] of Object.entries(appearances)) {
    if (!ids.includes(id))
      throw new Error(`Icon capability metadata references unknown icon "${id}".`);
    tileflowIconAppearanceSchema.parse(appearance);
  }

  for (const layer of style.layers) {
    for (const property of [
      'fill-pattern',
      'fill-extrusion-pattern',
      'line-pattern',
      'background-pattern',
    ]) {
      const pattern = record(layer.paint)[property];
      if (
        pattern !== undefined &&
        [...outputs(pattern, ids)].some((id) => appearances[id]?.representation === 'sdf')
      ) {
        throw Object.assign(new Error(`Layer "${layer.id}" cannot use an SDF icon as a pattern.`), {
          code: 'TF_ICON_PATTERN_SDF',
          path: `layers.${layer.id}.paint.${property}`,
          suggestion: 'Select a fixed-color RGBA image for the pattern.',
        });
      }
    }

    const image = record(layer.layout)['icon-image'];
    if (image === undefined) continue;
    if (
      (typeof image === 'string' && /\{[^{}]+\}/u.test(image)) ||
      (typeof image !== 'string' && !Array.isArray(image))
    ) {
      throw Object.assign(new Error(`Layer "${layer.id}" has an unproven legacy icon selection.`), {
        code: 'TF_ICON_SELECTION_UNPROVEN',
        path: `layers.${layer.id}.layout.icon-image`,
        suggestion: 'Rebuild with expression-based icon selection and verified SDF metadata.',
      });
    }

    const names = [...outputs(image, ids)];
    const sdf = names.filter((id) => appearances[id]?.representation === 'sdf');
    if (!sdf.length) continue;
    if (sdf.length !== names.length) {
      throw Object.assign(
        new Error(`Layer "${layer.id}" can select both SDF and RGBA icons, including fallbacks.`),
        {
          code: 'TF_ICON_REPRESENTATION_MIXED',
          path: `layers.${layer.id}.layout.icon-image`,
          suggestion:
            'Use one representation for every selectable icon and fallback, or an explicit homogeneous image selection. Check local overrides.',
        },
      );
    }

    const paint = {...record(layer.paint)};
    for (const [property, limit] of [
      ['icon-halo-width', 2],
      ['icon-halo-blur', 1],
    ] as const) {
      if (paint[property] === undefined) continue;
      const [low, high] = numericBounds(paint[property]);
      if (low < 0 || high > limit) {
        throw Object.assign(
          new Error(`Layer "${layer.id}" ${property} must be bounded between 0 and ${limit}.`),
          {
            code: 'TF_ICON_HALO_BOUNDS',
            path: `layers.${layer.id}.paint.${property}`,
            suggestion: `Use a value or explicit min/max expression within 0–${limit} logical pixels.`,
          },
        );
      }
    }
    for (const [property, key] of [
      ['icon-color', 'color'],
      ['icon-halo-color', 'haloColor'],
      ['icon-halo-width', 'haloWidth'],
      ['icon-halo-blur', 'haloBlur'],
    ] as const) {
      if (paint[property] !== undefined) continue;
      paint[property] = defaultPaint(image, key, sdf, appearances, ids);
    }
    layer.paint = paint;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function outputs(value: unknown, ids: readonly string[]): Set<string> {
  if (typeof value === 'string') return new Set([value]);
  if (!Array.isArray(value)) return new Set(ids);
  if (value[0] === 'image' || value[0] === 'literal') return outputs(value[1], ids);
  let branches: unknown[];
  switch (value[0]) {
    case 'case':
      branches = [...value.slice(2, -1).filter((_, i) => i % 2 === 0), value.at(-1)];
      break;
    case 'match':
      branches = [...value.slice(3, -1).filter((_, i) => i % 2 === 0), value.at(-1)];
      break;
    case 'step':
      branches = value.slice(2).filter((_, i) => i % 2 === 0);
      break;
    case 'interpolate':
      branches = value.slice(4).filter((_, i) => i % 2 === 0);
      break;
    case 'coalesce':
      branches = value.slice(1);
      break;
    default:
      return new Set(ids);
  }
  return new Set(branches.flatMap((branch) => [...outputs(branch, ids)]));
}

function selection(value: unknown, ids: readonly string[]): unknown {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return null;
  if (value[0] === 'literal') return value[1];
  if (value[0] === 'image') {
    if (typeof value[1] === 'string') return ids.includes(value[1]) ? value[1] : null;
    return ['case', ['in', value[1], ['literal', ids]], value[1], null];
  }
  if (!['case', 'match', 'step', 'interpolate', 'coalesce'].includes(value[0])) return value;
  const copy = [...value];
  if (value[0] === 'coalesce')
    return ['coalesce', ...value.slice(1).map((item) => selection(item, ids))];
  const start = value[0] === 'case' || value[0] === 'step' ? 2 : value[0] === 'match' ? 3 : 4;
  for (let index = start; index < value.length - 1; index += 2)
    copy[index] = selection(value[index], ids);
  copy[copy.length - 1] = selection(value.at(-1), ids);
  return copy;
}

function numericBounds(value: unknown): [number, number] {
  if (typeof value === 'number' && Number.isFinite(value)) return [value, value];
  if (!Array.isArray(value)) return [-Infinity, Infinity];
  if (value[0] === 'literal') return numericBounds(value[1]);
  if (value[0] === 'min' || value[0] === 'max') {
    const ranges = value.slice(1).map(numericBounds);
    const operation = value[0] === 'min' ? Math.min : Math.max;
    return [
      operation(...ranges.map((range) => range[0])),
      operation(...ranges.map((range) => range[1])),
    ];
  }
  const start =
    value[0] === 'case' || value[0] === 'step'
      ? 2
      : value[0] === 'match'
        ? 3
        : value[0] === 'interpolate'
          ? 4
          : 0;
  if (start === 0) return [-Infinity, Infinity];
  const branches = value.slice(start).filter((_, i) => i % 2 === 0);
  if (value[0] === 'case' || value[0] === 'match') branches.push(value.at(-1));
  const ranges = branches.map(numericBounds);
  return [
    Math.min(...ranges.map((range) => range[0])),
    Math.max(...ranges.map((range) => range[1])),
  ];
}

function defaultPaint(
  image: unknown,
  key: keyof TileflowIconAppearance['defaults'],
  names: string[],
  appearances: Readonly<Record<string, TileflowIconAppearance>>,
  ids: readonly string[],
): unknown {
  const values = names.map((id) => appearances[id]!.defaults[key]);
  if (new Set(values).size === 1) return values[0];
  // Camera expressions must remain at the paint property's top level.
  if (Array.isArray(image) && (image[0] === 'step' || image[0] === 'interpolate')) {
    const copy = [...image];
    for (let i = image[0] === 'step' ? 2 : 4; i < copy.length; i += 2)
      copy[i] = defaultPaint(image[i], key, [...outputs(image[i], ids)], appearances, ids);
    return copy;
  }
  return [
    'match',
    ['to-string', selection(image, ids)],
    ...names.flatMap((id, i) => [id, values[i]]),
    values[0],
  ];
}
