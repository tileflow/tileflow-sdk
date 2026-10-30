import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyCircleStyle} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import type {TileflowCircleStyle, TileflowLineStyle} from '../../cartography/styles';
import {expression, toMapLibreStyleValue} from '../../cartography/values';
import type {TileflowRoadClass, TileflowRoadRoundaboutStyle} from '../../types';
import {tileflowRoadClassFilter} from './semantics';

/** The actual surface styles, after module, class and road-treatment resolution. */
export type RoundaboutSurface = {
  roadClass: TileflowRoadClass;
  casing?: TileflowLineStyle;
  fill?: TileflowLineStyle;
};

type Value = {condition: unknown[]; value: unknown};

export function compileRoundabouts(
  request: TileflowRoadRoundaboutStyle | undefined,
  surfaces: readonly RoundaboutSurface[],
  context: TileflowDomainCompileContext,
  contributions: TileflowLayerContribution[],
): void {
  const {fields, layers} = context.data.schema;
  if (!layers.circularFeature) return;
  const drawn = surfaces.filter(({fill}) => fill && fill.visible !== false);
  if (!drawn.length) return;
  const values = (resolve: (surface: RoundaboutSurface) => unknown): Value[] =>
    drawn.map((surface) => ({
      condition: tileflowRoadClassFilter(fields, surface.roadClass),
      value: toMapLibreStyleValue(resolve(surface) as never),
    }));
  const widths = values(({fill}) => fill?.width ?? 1);
  const casings = values(({casing}) => casing?.width ?? 0);
  const gaps = values(({casing}) => casing?.gapWidth ?? 0);
  const fallbackWidth =
    request?.fallbackWidth === undefined ? undefined : toMapLibreStyleValue(request.fallbackWidth);
  const borderWidth =
    request?.borderWidth === undefined ? undefined : toMapLibreStyleValue(request.borderWidth);
  const radiusAt15 = ['to-number', ['get', fields.circularRadiusAtZoom15], 0];
  const radiusMeters = ['to-number', ['get', fields.circularRadiusMeters], 0];
  const innerMeters = ['to-number', ['get', fields.circularInnerRadiusMeters], 0];
  const outerMeters = ['to-number', ['get', fields.circularOuterRadiusMeters], 0];
  const physical = [
    'all',
    ['>', radiusMeters, 0],
    ['>=', innerMeters, 0],
    ['>', outerMeters, innerMeters],
  ];
  const geometryLevels = zoomLevels([
    ...(fallbackWidth === undefined ? widths.map(({value}) => value) : [fallbackWidth]),
    ...(borderWidth === undefined
      ? [...widths, ...casings, ...gaps].map(({value}) => value)
      : [borderWidth]),
  ]);
  const borderAt = (level: number): unknown =>
    borderWidth === undefined
      ? select(
          values(({casing, fill}) => {
            if (!casing || casing.visible === false) return 0;
            const casingWidth = atZoom(toMapLibreStyleValue(casing.width ?? 0), level);
            const gap = atZoom(toMapLibreStyleValue(casing.gapWidth ?? 0), level);
            const fillWidth = atZoom(toMapLibreStyleValue(fill?.width ?? 1), level);
            return [
              'max',
              0,
              [
                'case',
                ['>', gap, 0],
                ['-', ['+', gap, ['*', 2, casingWidth]], fillWidth],
                ['-', casingWidth, fillWidth],
              ],
            ];
          }),
          0,
        )
      : atZoom(borderWidth, level);
  const geometry = (casing: boolean, width: boolean) =>
    expression<number>(
      bindRepeated([
        'interpolate',
        ['exponential', 2],
        ['zoom'],
        ...geometryLevels.flatMap((level) => {
          const centerline = ['*', radiusAt15, 2 ** (level - 15)];
          const fallback =
            fallbackWidth === undefined
              ? select(
                  widths.map(({condition, value}) => ({condition, value: atZoom(value, level)})),
                  0,
                )
              : atZoom(fallbackWidth, level);
          const inner = [
            'case',
            physical,
            ['*', centerline, ['/', innerMeters, radiusMeters]],
            ['-', centerline, ['/', fallback, 2]],
          ];
          const fillWidth = [
            'case',
            physical,
            ['*', centerline, ['/', ['-', outerMeters, innerMeters], radiusMeters]],
            fallback,
          ];
          const border = casing ? borderAt(level) : 0;
          return [
            level,
            width
              ? ['max', 0, ['+', fillWidth, border]]
              : ['max', 0, ['-', inner, ['/', border, 2]]],
          ];
        }),
      ]),
    );
  const phaseStyle = (phase: 'casing' | 'fill'): TileflowCircleStyle => ({
    color: 'rgba(0, 0, 0, 0)',
    minZoom: 15,
    pitchAlignment: 'map' as const,
    pitchScale: 'map' as const,
    radius: geometry(phase === 'casing', false),
    strokeWidth: geometry(phase === 'casing', true),
    strokeColor:
      phase === 'casing'
        ? context.colors.roads.casing
        : expression<string>([
            'match',
            ['coalesce', ['get', fields.class], 'minor'],
            'motorway',
            context.colors.roads.motorway,
            'trunk',
            context.colors.roads.trunk,
            'primary',
            context.colors.roads.primary,
            ['secondary', 'tertiary'],
            context.colors.roads.secondary,
            context.colors.roads.minor,
          ]),
    strokeOpacity: phaseVisibility(drawn, phase, fields),
  });
  for (const phase of ['casing', 'fill'] as const) {
    const style = mergeTileflowDesign(phaseStyle(phase), request?.[phase]);
    if (style.visible === false) continue;
    const eligible = drawn.filter(
      (surface) =>
        request?.[phase] !== undefined || (surface[phase] && surface[phase]?.visible !== false),
    );
    if (!eligible.length) continue;
    contributions.push({
      kind: 'layer',
      layer: applyCircleStyle(
        {
          id: `tileflow-road-circular-${phase}`,
          type: 'circle',
          source: context.data.sourceId,
          'source-layer': layers.circularFeature,
          filter: [
            'all',
            ['==', ['get', fields.circularKind], 'road_ring'],
            [
              'any',
              ...eligible.map((surface) => tileflowRoadClassFilter(fields, surface.roadClass)),
            ],
          ],
        },
        style,
      ),
      localOrder: 900,
      owner: 'roads',
      // Approach fills cover the ring's border where the two meet.
      slot: phase === 'casing' ? 'transport-surface-casing' : 'transport-surface-fill',
      target: `roads.roundabouts.${phase}`,
    });
  }
}

// Expressions a binding may stand for: never a match label or an interpolation's curve.
const bindable = new Set([
  'case',
  'match',
  'all',
  'any',
  '!',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'has',
  'get',
  'to-number',
  'coalesce',
  '+',
  '-',
  '*',
  '/',
  'max',
  'min',
]);

/**
 * States once, with `let`, the feature expressions a zoom curve repeats most at its stops. A `var`
 * evaluates as the expression it names, so features draw as before; the style is smaller and quicker
 * to parse. Bindings wrap the curve, as MapLibre allows; each one costs MapLibre's validation a walk of
 * what it names wherever it is used, so only the two largest savings are bound.
 */
function bindRepeated(curve: unknown[]): unknown[] {
  let tree: unknown[] = curve;
  for (let index = 0; index < 2; index += 1) {
    const json = new Map<unknown[], string>();
    const found = new Map<string, number>();
    const visit = (value: unknown): {text: string; free: boolean} => {
      if (!Array.isArray(value) || value[0] === 'literal')
        return {text: JSON.stringify(value), free: true};
      const parts = value.map(visit);
      const text = `[${parts.map((part) => part.text).join(',')}]`;
      json.set(value, text);
      const free = value[0] !== 'zoom' && value[0] !== 'var' && parts.every((part) => part.free);
      if (free && typeof value[0] === 'string' && bindable.has(value[0]))
        found.set(text, (found.get(text) ?? 0) + 1);
      return {text, free};
    };
    visit(tree);
    let best: string | undefined;
    let saving = 256;
    for (const [text, count] of found) {
      const saved = (count - 1) * text.length;
      if (count > 1 && saved > saving) [best, saving] = [text, saved];
    }
    if (best === undefined) break;
    const name = `tileflow_${index}`;
    const replace = (value: unknown): unknown => {
      if (!Array.isArray(value) || value[0] === 'literal') return value;
      if (json.get(value) === best) return ['var', name];
      return value.map(replace);
    };
    tree = ['let', name, JSON.parse(best), replace(tree)];
  }
  return tree;
}

function select(values: readonly Value[], fallback: unknown): unknown {
  if (!values.length) return fallback;
  const serialized = JSON.stringify(values[0]!.value);
  if (values.every(({value}) => JSON.stringify(value) === serialized)) return values[0]!.value;
  return ['case', ...values.flatMap(({condition, value}) => [condition, value]), fallback];
}

function phaseVisibility(
  surfaces: readonly RoundaboutSurface[],
  phase: 'fill' | 'casing',
  fields: TileflowDomainCompileContext['data']['schema']['fields'],
) {
  const levels = [
    ...new Set(
      surfaces.flatMap((surface) => {
        const style = surface[phase];
        return [style?.minZoom, style?.maxZoom].filter(
          (value): value is number => value !== undefined,
        );
      }),
    ),
  ].sort((left, right) => left - right);
  if (!levels.length) return 1;
  const at = (level: number) =>
    select(
      surfaces.map((surface) => {
        const style = surface[phase];
        return {
          condition: tileflowRoadClassFilter(fields, surface.roadClass),
          value:
            (style?.minZoom === undefined || level >= style.minZoom) &&
            (style?.maxZoom === undefined || level < style.maxZoom)
              ? 1
              : 0,
        };
      }),
      0,
    );
  return expression<number>([
    'step',
    ['zoom'],
    at(-1),
    ...levels.flatMap((level) => [level, at(level)]),
  ]);
}

/** One native zoom curve must combine metric radii and independently authored widths. */
function zoomLevels(values: readonly unknown[]): number[] {
  const levels = new Set(Array.from({length: 10}, (_, index) => index + 15));
  for (const value of values) {
    if (!isZoomCurve(value)) continue;
    for (let index = 3; index < value.length - 1; index += 2) {
      const level = value[index] as number;
      if (level < 15 || level > 24) continue;
      levels.add(level);
      if (value[0] === 'step' && level > 15) {
        // A native interpolation cannot express a discontinuity. Keep the transition
        // within one millionth of a zoom level immediately before the authored step.
        const previous = index > 3 ? (value[index - 2] as number) : 15;
        levels.add(level - Math.min(0.000001, (level - Math.max(15, previous)) / 2));
      }
    }
    if (value[0] !== 'interpolate') continue;
    const interpolation = value[1] as unknown[];
    if (interpolation[0] === 'exponential' && interpolation[1] === 2) continue;
    for (let index = 3; index < value.length - 3; index += 2) {
      const lower = value[index] as number;
      const upper = value[index + 2] as number;
      const from = value[index + 1];
      const to = value[index + 3];
      // Feature expressions have no known error bound. Preserve their authored
      // stops instead of multiplying large expression trees with dense samples.
      if (typeof from !== 'number' || typeof to !== 'number' || from === to) continue;
      const difference = to - from;
      const start = Math.max(15, lower);
      const end = Math.min(24, upper);
      if (start >= end) continue;
      const knots = [start, ...levels].filter((level) => level >= start && level < end);
      knots.push(end);
      knots.sort((left, right) => left - right);
      for (let knot = 0; knot < knots.length - 1; knot++) {
        refine(knots[knot]!, knots[knot + 1]!);
      }
      function refine(left: number, right: number): void {
        // Numeric curves target 0.1px, with a bounded subdivision depth.
        if (right - left <= 1 / 32) return;
        const factor = (level: number) =>
          interpolationFactor(interpolation, level - lower, upper - lower);
        const leftFactor = factor(left);
        const rightFactor = factor(right);
        const error = Math.max(
          ...[0.25, 0.5, 0.75].map((fraction) => {
            const level = left + (right - left) * fraction;
            const sampled =
              leftFactor +
              (rightFactor - leftFactor) *
                interpolationFactor(['exponential', 2], level - left, right - left);
            return Math.abs((factor(level) - sampled) * difference);
          }),
        );
        if (error <= 0.1) return;
        const middle = (left + right) / 2;
        levels.add(middle);
        refine(left, middle);
        refine(middle, right);
      }
    }
  }
  return [...levels].sort((left, right) => left - right);
}

function interpolationFactor(interpolation: unknown[], distance: number, span: number): number {
  if (interpolation[0] === 'linear' || interpolation[1] === 1) return distance / span;
  if (interpolation[0] !== 'exponential') return Number.NaN;
  const logarithm = Math.log(interpolation[1] as number);
  return Math.expm1(logarithm * distance) / Math.expm1(logarithm * span);
}

function isZoomCurve(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    ((value[0] === 'interpolate' && isZoom(value[2])) || (value[0] === 'step' && isZoom(value[1])))
  );
}

function isZoom(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === 'zoom';
}

function atZoom(value: unknown, level: number): unknown {
  if (!Array.isArray(value) || value[0] === 'literal') return value;
  if (isZoom(value)) return level;
  if (!isZoomCurve(value)) return value.map((entry) => atZoom(entry, level));
  const stops: Array<{level: number; value: unknown}> = [];
  for (let index = 3; index < value.length - 1; index += 2) {
    stops.push({level: value[index] as number, value: value[index + 1]});
  }
  const exact = stops.find((stop) => stop.level === level);
  if (exact) return foldConstants(exact.value);
  const lower = [...stops].reverse().find((stop) => stop.level < level);
  const upper = stops.find((stop) => stop.level > level);
  if (value[0] === 'step') return foldConstants(lower?.value ?? value[2]);
  if (!lower) return foldConstants(upper?.value ?? 0);
  if (!upper) return foldConstants(lower.value);
  // At a known zoom the curve's position between its stops is known too.
  const at = interpolationFactor(
    value[1] as unknown[],
    level - lower.level,
    upper.level - lower.level,
  );
  const folded = Number.isFinite(at)
    ? interpolated(foldConstants(lower.value), foldConstants(upper.value), at)
    : undefined;
  return (
    folded ?? ['interpolate', value[1], level, lower.level, lower.value, upper.level, upper.value]
  );
}

/** Arithmetic on constants, evaluated as MapLibre would. */
function foldConstants(value: unknown): unknown {
  if (!Array.isArray(value) || value[0] === 'literal') return value;
  const folded = value.map(foldConstants);
  const [operator, ...operands] = folded;
  if (!operands.length || !operands.every((operand) => typeof operand === 'number')) return folded;
  const numbers = operands as number[];
  const result =
    operator === '*'
      ? numbers.reduce((product, number) => product * number, 1)
      : operator === '+'
        ? numbers.reduce((sum, number) => sum + number, 0)
        : operator === '-'
          ? numbers.length === 1
            ? -numbers[0]!
            : numbers[0]! - numbers[1]!
          : operator === '/' && numbers.length === 2
            ? numbers[0]! / numbers[1]!
            : operator === 'max'
              ? Math.max(...numbers)
              : operator === 'min'
                ? Math.min(...numbers)
                : undefined;
  return result !== undefined && Number.isFinite(result) ? result : folded;
}

/**
 * The value a fraction `at` of the way between two numeric outputs: numbers, or `case` and `match`
 * expressions that choose between them by the same conditions, so every feature takes the same
 * branch of both. Undefined when the two cannot be combined that way.
 */
function interpolated(lower: unknown, upper: unknown, at: number): unknown {
  if (typeof lower === 'number' && typeof upper === 'number') return lower + (upper - lower) * at;
  if (JSON.stringify(lower) === JSON.stringify(upper)) return lower;
  if (
    !Array.isArray(lower) ||
    !Array.isArray(upper) ||
    lower.length !== upper.length ||
    (lower[0] !== 'case' && lower[0] !== 'match') ||
    lower[0] !== upper[0]
  )
    return undefined;
  // `case`: conditions then outputs from 1; `match`: an input, then labels and outputs from 2.
  const first = lower[0] === 'case' ? 1 : 2;
  const result: unknown[] = lower.slice(0, first);
  if (JSON.stringify(result) !== JSON.stringify(upper.slice(0, first))) return undefined;
  for (let index = first; index < lower.length; index += 1) {
    const output = (index - first) % 2 === 1 || index === lower.length - 1;
    if (!output) {
      if (JSON.stringify(lower[index]) !== JSON.stringify(upper[index])) return undefined;
      result.push(lower[index]);
      continue;
    }
    const value = interpolated(lower[index], upper[index], at);
    if (value === undefined) return undefined;
    result.push(value);
  }
  return result;
}
