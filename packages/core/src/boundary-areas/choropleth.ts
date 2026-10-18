import {isTileflowPortableId} from '../portable-identity';
import {
  maplibreOverlay,
  tileflowOverlayPlacements,
  type TileflowMapLibreOverlay,
  type TileflowOverlayPlacement,
} from '../overlays';
import type {TileflowBoundaryFeatureKey, TileflowBoundaryRow, TileflowBoundaryValues} from './join';
import {
  isTileflowBoundaryClass,
  isTileflowBoundaryFamily,
  tileflowBoundaryAreasV1Schema,
  tileflowBoundaryClassTiers,
  tileflowBoundaryFamilies,
  type TileflowBoundaryClass,
  type TileflowBoundaryClassTier,
  type TileflowBoundaryFamily,
} from './schema';

/** A MapLibre expression that evaluates to a color. */
export type TileflowColorExpression = readonly [string, ...unknown[]];

export type TileflowChoroplethStop = readonly [value: number, color: string];

/** Colors below the first threshold are `base`; each stop starts a new color class. */
export type TileflowChoroplethStepScale = Readonly<{
  base: string;
  kind: 'step';
  stops: readonly TileflowChoroplethStop[];
}>;

/** Colors interpolated linearly between stops and clamped outside them. */
export type TileflowChoroplethLinearScale = Readonly<{
  kind: 'linear';
  stops: readonly TileflowChoroplethStop[];
}>;

/** One color per category value. */
export type TileflowChoroplethCategoryScale = Readonly<{
  categories: Readonly<Record<string, string>>;
  kind: 'categories';
}>;

export type TileflowChoroplethScale =
  TileflowChoroplethCategoryScale | TileflowChoroplethLinearScale | TileflowChoroplethStepScale;

const maxScaleStops = 64;
const maxCategories = 256;

/** Validated color scales for choropleths. */
export const choroplethScale = Object.freeze({
  categories(categories: Readonly<Record<string, string>>): TileflowChoroplethCategoryScale {
    const entries = Object.entries(categories);
    if (entries.length < 1 || entries.length > maxCategories) {
      throw new Error(`A category scale needs between 1 and ${maxCategories} categories.`);
    }
    for (const [category, color] of entries) {
      if (!category) throw new Error('Category scale keys must not be empty.');
      assertColor(color);
    }
    return Object.freeze({categories: Object.freeze({...categories}), kind: 'categories'});
  },
  linear(stops: readonly TileflowChoroplethStop[]): TileflowChoroplethLinearScale {
    if (stops.length < 2) throw new Error('A linear scale needs at least two stops.');
    return Object.freeze({kind: 'linear', stops: validateStops(stops)});
  },
  step(base: string, stops: readonly TileflowChoroplethStop[]): TileflowChoroplethStepScale {
    assertColor(base);
    if (stops.length < 1) throw new Error('A step scale needs at least one stop.');
    return Object.freeze({base, kind: 'step', stops: validateStops(stops)});
  },
});

/**
 * The color a scale gives `input`. Areas whose value does not fit the scale (no value, a string on
 * a numeric scale, or an unknown category) get `missingColor`.
 */
export function choroplethColorExpression(
  scale: TileflowChoroplethScale,
  input: unknown,
  missingColor: string,
): TileflowColorExpression {
  assertColor(missingColor);
  if (scale.kind === 'categories') {
    return [
      'match',
      ['to-string', input],
      ...Object.entries(scale.categories).flat(),
      missingColor,
    ];
  }
  return ['case', ['==', ['typeof', input], 'number'], numericScale(scale, input), missingColor];
}

export type TileflowBoundaryChoroplethOutline = Readonly<{
  color: string;
  /** Line width in pixels. Defaults to 0.5. */
  width?: number;
}>;

export type TileflowBoundaryChoroplethOptions = Readonly<{
  /** Classes to color, such as `['municipality']`. */
  classes: readonly TileflowBoundaryClass[];
  /** Limit areas to these ISO 3166-1 alpha-2 countries. */
  countries?: readonly string[];
  /** Defaults to `boundaries`. The map must declare the same family in `boundaryAreas`. */
  family?: TileflowBoundaryFamily;
  /** Portable ID; the overlay's layers are `<id>-fill` and, with an outline, `<id>-outline`. */
  id: string;
  maxzoom?: number;
  /** Defaults to the first zoom at which the selected classes appear. */
  minzoom?: number;
  /** Defaults to transparent, which leaves areas without a value uncolored. */
  missingColor?: string;
  /** Fill opacity from 0 to 1. Defaults to 0.8. */
  opacity?: number;
  outline?: false | TileflowBoundaryChoroplethOutline;
  /** Defaults to `below-labels`. */
  placement?: TileflowOverlayPlacement;
  scale: TileflowChoroplethScale;
  /** Feature-state key read when `values` is omitted. Defaults to `value`. */
  state?: string;
  /** Limit areas to one class tier. */
  tiers?: readonly TileflowBoundaryClassTier[];
  /**
   * Values compiled into the style. Omit them to color areas from feature-state set at run time
   * with `createBoundaryFeatureState` from `@tileflow/core/browser`.
   */
  values?: TileflowBoundaryValues;
}>;

/** Layer metadata key that records how a choropleth reads its values. */
export const tileflowBoundaryChoroplethMetadataKey = 'tileflow:boundaryChoropleth' as const;

export type TileflowBoundaryChoroplethMetadata = Readonly<{
  family: TileflowBoundaryFamily;
  joinBy?: TileflowBoundaryFeatureKey;
  state?: string;
}>;

/** An overlay that colors Boundaries areas from values or feature-state. */
export function boundaryChoropleth(
  options: TileflowBoundaryChoroplethOptions,
): TileflowMapLibreOverlay {
  if (!isTileflowPortableId(options.id)) {
    throw new Error(`Invalid boundary choropleth ID: ${String(options.id)}.`);
  }
  const family = options.family ?? 'boundaries';
  if (!isTileflowBoundaryFamily(family)) {
    throw new Error(`Unknown Tileflow Boundaries family: ${String(family)}.`);
  }
  const classes = uniqueList(options.classes, 'classes');
  for (const value of classes) {
    if (!isTileflowBoundaryClass(value)) throw new Error(`Unknown Boundaries class: ${value}.`);
  }
  const tiers = options.tiers === undefined ? undefined : uniqueList(options.tiers, 'tiers');
  for (const value of tiers ?? []) {
    if (!(tileflowBoundaryClassTiers as readonly string[]).includes(value)) {
      throw new Error(`Unknown Boundaries class tier: ${value}.`);
    }
  }
  const countries =
    options.countries === undefined
      ? undefined
      : uniqueList(
          options.countries.map((country) => {
            if (!/^[A-Za-z]{2}$/u.test(country)) {
              throw new Error(`Invalid ISO 3166-1 alpha-2 country: ${country}.`);
            }
            return country.toUpperCase();
          }),
          'countries',
        );
  const placement = options.placement ?? 'below-labels';
  if (!tileflowOverlayPlacements.includes(placement)) {
    throw new Error(`Invalid Tileflow overlay placement: ${String(placement)}.`);
  }
  const minzoom = options.minzoom ?? defaultMinzoom(classes, tiers);
  assertZoom(minzoom, 'minzoom');
  if (options.maxzoom !== undefined) {
    assertZoom(options.maxzoom, 'maxzoom');
    if (options.maxzoom <= minzoom) throw new Error('Choropleth maxzoom must exceed its minzoom.');
  }
  const opacity = options.opacity ?? 0.8;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new Error('Choropleth opacity must be between 0 and 1.');
  }
  const missingColor = options.missingColor ?? 'rgba(0, 0, 0, 0)';
  const state = options.state?.trim() || 'value';

  const color =
    options.values === undefined
      ? choroplethColorExpression(options.scale, ['feature-state', state], missingColor)
      : staticColorExpression(options.scale, options.values, missingColor);

  const filter: unknown[] = [
    'all',
    inList(['get', 'class'], classes),
    ...(tiers ? [inList(['get', 'class_tier'], tiers)] : []),
    ...(countries ? [inList(['get', 'iso_3166_1'], countries)] : []),
  ];
  const zoomRange = {
    minzoom,
    ...(options.maxzoom === undefined ? {} : {maxzoom: options.maxzoom}),
  };
  const metadata: TileflowBoundaryChoroplethMetadata =
    options.values === undefined ? {family, state} : {family, joinBy: options.values.joinBy};
  const sourceLayer = tileflowBoundaryAreasV1Schema.layers.areas;
  const outline = options.outline;
  if (outline) {
    assertColor(outline.color);
    if (outline.width !== undefined && (!Number.isFinite(outline.width) || outline.width < 0)) {
      throw new Error('Choropleth outline width must be a non-negative number.');
    }
  }

  return maplibreOverlay({
    layers: [
      {
        filter,
        id: `${options.id}-fill`,
        metadata: {[tileflowBoundaryChoroplethMetadataKey]: metadata},
        paint: {'fill-color': color, 'fill-opacity': opacity},
        'source-layer': sourceLayer,
        type: 'fill',
        ...zoomRange,
      },
      ...(outline
        ? [
            {
              filter,
              id: `${options.id}-outline`,
              paint: {'line-color': outline.color, 'line-width': outline.width ?? 0.5},
              'source-layer': sourceLayer,
              type: 'line',
              ...zoomRange,
            },
          ]
        : []),
    ],
    placement,
    source: tileflowBoundaryFamilies[family].sourceId,
  });
}

function staticColorExpression(
  scale: TileflowChoroplethScale,
  values: TileflowBoundaryValues,
  missingColor: string,
): TileflowColorExpression | string {
  const input =
    values.joinBy === 'id'
      ? ['id']
      : values.joinBy === 'ref' || values.joinBy === 'iso_3166_1'
        ? ['get', values.joinBy]
        : undefined;
  if (!input) throw new Error(`Choropleth values cannot join by ${String(values.joinBy)}.`);
  const rows = normalizeRows(values.joinBy, values.rows);
  assertColor(missingColor);
  if (rows.size === 0) return missingColor;

  if (scale.kind === 'categories') {
    const groups = new Map<string, (number | string)[]>();
    for (const [key, value] of rows) {
      if (typeof value !== 'string') {
        throw new Error('A category scale needs string values.');
      }
      const color = scale.categories[value];
      if (color === undefined) continue;
      const group = groups.get(color);
      if (group) group.push(key);
      else groups.set(color, [key]);
    }
    if (groups.size === 0) return missingColor;
    return ['match', input, ...[...groups].flatMap(([color, keys]) => [keys, color]), missingColor];
  }

  for (const value of rows.values()) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('A numeric scale needs finite number values.');
    }
  }
  const valueOf = ['match', input, ...[...rows].flat(), 0];
  return ['match', input, [...rows.keys()], numericScale(scale, valueOf), missingColor];
}

function normalizeRows(
  joinBy: TileflowBoundaryFeatureKey,
  rows: readonly TileflowBoundaryRow[],
): Map<number | string, number | string> {
  const normalized = new Map<number | string, number | string>();
  for (const row of rows) {
    if (row.value === null) continue;
    let key: number | string;
    if (joinBy === 'id') {
      if (typeof row.key !== 'number' || !Number.isSafeInteger(row.key) || row.key < 0) {
        throw new Error(`Choropleth rows joined by id need non-negative integer keys.`);
      }
      key = row.key;
    } else {
      if (typeof row.key !== 'string' || !row.key.trim()) {
        throw new Error(`Choropleth rows joined by ${joinBy} need non-empty string keys.`);
      }
      key = joinBy === 'ref' ? row.key.trim() : row.key.trim().toUpperCase();
    }
    normalized.set(key, row.value);
  }
  return normalized;
}

function numericScale(
  scale: TileflowChoroplethLinearScale | TileflowChoroplethStepScale,
  input: unknown,
): unknown[] {
  return scale.kind === 'step'
    ? ['step', input, scale.base, ...scale.stops.flat()]
    : ['interpolate', ['linear'], input, ...scale.stops.flat()];
}

function validateStops(
  stops: readonly TileflowChoroplethStop[],
): readonly TileflowChoroplethStop[] {
  if (stops.length > maxScaleStops) {
    throw new Error(`A choropleth scale accepts at most ${maxScaleStops} stops.`);
  }
  let previous = -Infinity;
  for (const [value, color] of stops) {
    if (!Number.isFinite(value) || value <= previous) {
      throw new Error('Choropleth scale stops must be finite and strictly increasing.');
    }
    assertColor(color);
    previous = value;
  }
  return Object.freeze(stops.map((stop) => Object.freeze([stop[0], stop[1]] as const)));
}

function defaultMinzoom(
  classes: readonly TileflowBoundaryClass[],
  tiers: readonly TileflowBoundaryClassTier[] | undefined,
): number {
  const selectedTiers = tiers ?? tileflowBoundaryClassTiers;
  return Math.min(
    ...classes.flatMap((value) =>
      selectedTiers.map((tier) => tileflowBoundaryAreasV1Schema.classMinzoom[value][tier]),
    ),
  );
}

function inList(input: unknown[], values: readonly string[]): unknown[] {
  return ['match', input, [...values], true, false];
}

function uniqueList<T extends string>(values: readonly T[], name: string): T[] {
  if (!Array.isArray(values) || values.length < 1) {
    throw new Error(`Choropleth ${name} must list at least one value.`);
  }
  return [...new Set(values)];
}

function assertZoom(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 24) {
    throw new Error(`Choropleth ${name} must be between 0 and 24.`);
  }
}

function assertColor(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Choropleth colors must be non-empty CSS color strings.');
  }
}
