import {isMapLibreExpressionOperator} from '../../cartography/expression-operators';

type Layer = Record<string, unknown> & {id: string; type: string};

/**
 * MapLibre properties that may vary per feature inside one layer, with the specification default
 * used for a category that leaves the property unset. Every other layout or paint property is
 * constant across a layer, so categories that disagree on it cannot share a placement layer.
 * Kept dependency-free so Core does not ship the full style specification; a test compares it
 * with the pinned MapLibre style specification.
 */
export const tileflowPoiFeatureVaryingProperties: Readonly<
  Record<'circle' | 'symbol', Readonly<Record<string, unknown>>>
> = Object.freeze({
  circle: Object.freeze({
    'circle-blur': 0,
    'circle-color': '#000000',
    'circle-opacity': 1,
    'circle-radius': 5,
    'circle-sort-key': undefined,
    'circle-stroke-color': '#000000',
    'circle-stroke-opacity': 1,
    'circle-stroke-width': 0,
  }),
  symbol: Object.freeze({
    'icon-anchor': 'center',
    'icon-color': '#000000',
    'icon-halo-blur': 0,
    'icon-halo-color': 'rgba(0, 0, 0, 0)',
    'icon-halo-width': 0,
    // An empty image draws no icon, so a category without one stays text-only.
    'icon-image': '',
    'icon-offset': [0, 0],
    'icon-opacity': 1,
    'icon-padding': [2],
    'icon-rotate': 0,
    'icon-size': 1,
    'symbol-sort-key': undefined,
    'text-anchor': 'center',
    'text-color': '#000000',
    'text-field': '',
    // MapLibre can vary `text-font` per feature, but Tileflow prepares glyphs for a static font
    // stack, so the font stays a layer-wide property.
    'text-halo-blur': 0,
    'text-halo-color': 'rgba(0, 0, 0, 0)',
    'text-halo-width': 0,
    'text-justify': 'center',
    'text-letter-spacing': 0,
    'text-max-width': 10,
    'text-offset': [0, 0],
    'text-opacity': 1,
    'text-radial-offset': 0,
    'text-rotate': 0,
    'text-size': 16,
    'text-transform': 'none',
    'text-variable-anchor-offset': undefined,
  }),
});

/**
 * Specification defaults of the layer-wide symbol and circle properties Tileflow writes, so that
 * a category that leaves one unset agrees with a category that sets the default explicitly.
 */
export const tileflowPoiLayerPropertyDefaults: Readonly<Record<string, unknown>> = Object.freeze({
  'circle-pitch-alignment': 'viewport',
  'circle-pitch-scale': 'map',
  'circle-translate': [0, 0],
  'circle-translate-anchor': 'map',
  'icon-allow-overlap': false,
  'icon-ignore-placement': false,
  'icon-keep-upright': false,
  'icon-optional': false,
  'icon-pitch-alignment': 'auto',
  'icon-rotation-alignment': 'auto',
  'icon-text-fit': 'none',
  'icon-text-fit-padding': [0, 0, 0, 0],
  'symbol-avoid-edges': false,
  'symbol-placement': 'point',
  'symbol-spacing': 250,
  'symbol-z-order': 'auto',
  'text-allow-overlap': false,
  'text-ignore-placement': false,
  'text-keep-upright': true,
  'text-line-height': 1.2,
  'text-max-angle': 45,
  'text-optional': false,
  'text-padding': 2,
  'text-pitch-alignment': 'auto',
  'text-rotation-alignment': 'auto',
  visibility: 'visible',
});

/** Raised when POI categories cannot share one placement layer. */
export class TileflowPoiPlacementError extends Error {
  readonly code = 'TILEFLOW_POI_PLACEMENT_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'TileflowPoiPlacementError';
  }
}

/**
 * Combines layers compiled for individual categories into one layer whose feature-varying
 * properties select each category's value with a `match` on the category field. MapLibre orders
 * symbol placement only within a layer, so one layer is what lets World's importance ranks order
 * every category together. Zoom curves stay at the top of each expression, as MapLibre requires:
 * curves of the same kind are evaluated at the union of their stops, which reproduces each
 * category's linear, exponential or step curve exactly.
 */
export function mergePoiCategoryLayers(
  entries: readonly {category: string; layer: Layer}[],
  options: {categoryField: string; filter: unknown; id: string},
): Layer {
  const [first] = entries;
  if (!first) throw new TileflowPoiPlacementError('A POI placement layer needs a category.');
  const kind = first.layer.type === 'circle' ? 'circle' : 'symbol';
  const varying = tileflowPoiFeatureVaryingProperties[kind];
  const categories = entries.map(({category}) => category);

  for (const property of ['type', 'source', 'source-layer', 'minzoom', 'maxzoom'] as const) {
    requireShared(entries, property, (layer) => layer[property]);
  }

  const result: Layer = {
    ...first.layer,
    id: options.id,
    filter: options.filter,
  };
  for (const part of ['layout', 'paint'] as const) {
    const records = entries.map(({layer}) => asRecord(layer[part]));
    const properties = [...new Set(records.flatMap((record) => Object.keys(record)))].sort();
    const merged: Record<string, unknown> = {};
    for (const property of properties) {
      const fallback = Object.hasOwn(varying, property)
        ? varying[property]
        : tileflowPoiLayerPropertyDefaults[property];
      const values = records.map((record) =>
        Object.hasOwn(record, property) ? record[property] : fallback,
      );
      if (values.every((value) => sameJson(value, values[0]))) {
        if (values[0] !== undefined) merged[property] = values[0];
        continue;
      }
      if (!Object.hasOwn(varying, property)) {
        throw conflict(entries, property, (layer) => asRecord(layer[part])[property]);
      }
      if (values.some((value) => value === undefined)) {
        throw new TileflowPoiPlacementError(
          `POI categories ${categories.join(', ')} set ${property} for only some categories, ` +
            'and MapLibre has no default to fill in for the rest. Set it for every category.',
        );
      }
      merged[property] = matchByCategory(
        property,
        categories.map((category, index) => [category, values[index]] as const),
        ['get', options.categoryField],
      );
    }
    if (Object.keys(merged).length) result[part] = merged;
    else delete result[part];
  }
  return result;
}

function requireShared(
  entries: readonly {category: string; layer: Layer}[],
  property: string,
  read: (layer: Layer) => unknown,
): void {
  const value = read(entries[0]!.layer);
  if (entries.every(({layer}) => sameJson(read(layer), value))) return;
  throw conflict(entries, property, read);
}

function conflict(
  entries: readonly {category: string; layer: Layer}[],
  property: string,
  read: (layer: Layer) => unknown,
): TileflowPoiPlacementError {
  const described = entries
    .map(({category, layer}) => `${category}: ${JSON.stringify(read(layer)) ?? 'unset'}`)
    .join('; ');
  return new TileflowPoiPlacementError(
    `POI categories need different ${property} values (${described}), but MapLibre keeps ` +
      `${property} constant within one layer. Give them the same ${property}, or set ` +
      "placement.order to 'categories' to place each category in its own layer.",
  );
}

type ZoomCurve =
  | {kind: 'interpolate'; operator: string; interpolation: unknown; stops: [number, unknown][]}
  | {kind: 'step'; base: unknown; stops: [number, unknown][]};

function matchByCategory(
  property: string,
  values: readonly (readonly [string, unknown])[],
  input: unknown[],
): unknown {
  const curves = values.map(([, value]) => zoomCurve(value));
  const present = curves.filter((curve): curve is ZoomCurve => curve !== undefined);
  if (present.length === 0) return match(input, values);

  const reference = present[0]!;
  for (const curve of present) {
    if (
      curve.kind !== reference.kind ||
      (curve.kind === 'interpolate' &&
        reference.kind === 'interpolate' &&
        (curve.operator !== reference.operator ||
          !sameJson(curve.interpolation, reference.interpolation)))
    ) {
      throw new TileflowPoiPlacementError(
        `POI categories use different kinds of zoom curve for ${property}. Use one kind of curve ` +
          '(linear, the same exponential base, or step) for every category, or set ' +
          "placement.order to 'categories'.",
      );
    }
  }
  const stops = [...new Set(present.flatMap((curve) => curve.stops.map(([zoom]) => zoom)))].sort(
    (left, right) => left - right,
  );
  const at = (zoom: number) =>
    match(
      input,
      values.map(([category, value], index) => [
        category,
        curves[index] ? evaluateCurve(property, curves[index], zoom) : value,
      ]),
    );

  if (reference.kind === 'step') {
    const base = match(
      input,
      values.map(([category, value], index) => {
        const curve = curves[index];
        return [category, curve?.kind === 'step' ? curve.base : value];
      }),
    );
    return ['step', ['zoom'], base, ...stops.flatMap((zoom) => [zoom, at(zoom)])];
  }
  return [
    reference.operator,
    reference.interpolation,
    ['zoom'],
    ...stops.flatMap((zoom) => [zoom, at(zoom)]),
  ];
}

function match(input: unknown[], values: readonly (readonly [string, unknown])[]): unknown {
  const groups: {categories: string[]; value: unknown}[] = [];
  for (const [category, value] of values) {
    const group = groups.find((candidate) => sameJson(candidate.value, value));
    if (group) group.categories.push(category);
    else groups.push({categories: [category], value});
  }
  if (groups.length === 1) return groups[0]!.value;
  // The largest group becomes the fallback, so the expression lists only the exceptions.
  const fallback = groups.reduce((largest, group) =>
    group.categories.length > largest.categories.length ? group : largest,
  );
  return [
    'match',
    input,
    ...groups
      .filter((group) => group !== fallback)
      .flatMap((group) => [
        group.categories.length === 1 ? group.categories[0] : group.categories,
        expressionValue(group.value),
      ]),
    expressionValue(fallback.value),
  ];
}

function zoomCurve(value: unknown): ZoomCurve | undefined {
  if (!Array.isArray(value)) return undefined;
  const [operator] = value;
  if (
    (operator === 'interpolate' ||
      operator === 'interpolate-hcl' ||
      operator === 'interpolate-lab') &&
    isZoomInput(value[2])
  ) {
    return {
      kind: 'interpolate',
      operator,
      interpolation: value[1],
      stops: pairs(value.slice(3)),
    };
  }
  if (operator === 'step' && isZoomInput(value[1])) {
    return {kind: 'step', base: value[2], stops: pairs(value.slice(3))};
  }
  return undefined;
}

function evaluateCurve(property: string, curve: ZoomCurve, zoom: number): unknown {
  const {stops} = curve;
  if (curve.kind === 'step') {
    let value = curve.base;
    for (const [stop, output] of stops) if (stop <= zoom) value = output;
    return value;
  }
  const exact = stops.find(([stop]) => stop === zoom);
  if (exact) return exact[1];
  if (zoom < stops[0]![0]) return stops[0]![1];
  if (zoom > stops.at(-1)![0]) return stops.at(-1)![1];
  const upperIndex = stops.findIndex(([stop]) => stop > zoom);
  const [lowerZoom, lower] = stops[upperIndex - 1]!;
  const [upperZoom, upper] = stops[upperIndex]!;
  const t = interpolationFactor(curve.interpolation, zoom, lowerZoom, upperZoom);
  const value = interpolateOutput(lower, upper, t);
  if (value === undefined) {
    throw new TileflowPoiPlacementError(
      `POI categories interpolate ${property} between values Tileflow cannot evaluate at zoom ` +
        `${zoom}. Give every category the same zoom stops for ${property}, or set ` +
        "placement.order to 'categories'.",
    );
  }
  return value;
}

function interpolationFactor(
  interpolation: unknown,
  zoom: number,
  lower: number,
  upper: number,
): number {
  const progress = zoom - lower;
  const range = upper - lower;
  if (Array.isArray(interpolation) && interpolation[0] === 'exponential') {
    const base = Number(interpolation[1]);
    if (base !== 1) return (base ** progress - 1) / (base ** range - 1);
  }
  return progress / range;
}

function interpolateOutput(lower: unknown, upper: unknown, t: number): unknown {
  if (typeof lower === 'number' && typeof upper === 'number') {
    return roundOutput(lower + (upper - lower) * t);
  }
  const lowerArray = numericArray(lower);
  const upperArray = numericArray(upper);
  if (lowerArray && upperArray && lowerArray.length === upperArray.length) {
    return [
      'literal',
      lowerArray.map((value, index) => roundOutput(value + (upperArray[index]! - value) * t)),
    ];
  }
  if (isNumericOutput(lower) && isNumericOutput(upper)) {
    return ['+', lower, ['*', roundOutput(t), ['-', upper, lower]]];
  }
  return undefined;
}

function isNumericOutput(value: unknown): boolean {
  if (typeof value === 'number') return true;
  if (!Array.isArray(value) || typeof value[0] !== 'string') return false;
  return isMapLibreExpressionOperator(value[0]) && !['literal', 'array'].includes(value[0]);
}

function numericArray(value: unknown): number[] | undefined {
  const array =
    Array.isArray(value) && value[0] === 'literal' && Array.isArray(value[1]) ? value[1] : value;
  return Array.isArray(array) && array.every((entry) => typeof entry === 'number')
    ? (array as number[])
    : undefined;
}

function roundOutput(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Raw arrays are expressions in MapLibre, so array values inside an expression need `literal`. */
function expressionValue(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (typeof value[0] === 'string' && isMapLibreExpressionOperator(value[0])) return value;
  return ['literal', value];
}

function pairs(values: readonly unknown[]): [number, unknown][] {
  const result: [number, unknown][] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    result.push([values[index] as number, values[index + 1]]);
  }
  return result;
}

function isZoomInput(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === 'zoom';
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
