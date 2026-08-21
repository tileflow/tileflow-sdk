import {isMapLibreExpressionOperator} from './expression-operators';

const expressionBrand = Symbol('TileflowExpression');
const filterBrand = Symbol('TileflowFilter');
const zoomBrand = Symbol('TileflowZoom');

export type TileflowExpression<T> = {
  readonly kind: 'expression';
  readonly value: readonly unknown[];
  readonly [expressionBrand]?: T;
};

export type TileflowFilterExpression = {
  readonly kind: 'filter';
  readonly value: readonly unknown[];
  readonly [filterBrand]?: true;
};

export type TileflowZoomInterpolation = 'linear' | 'exponential';

export type TileflowZoomValue<T> = {
  readonly base?: number;
  readonly interpolation: TileflowZoomInterpolation | 'step';
  readonly kind: 'zoom';
  readonly stops: readonly (readonly [number, T])[];
  readonly [zoomBrand]?: T;
};

export type TileflowStyleValue<T> = T | TileflowExpression<T> | TileflowZoomValue<T>;

export const zoom = {
  exponential<T>(base: number, stops: readonly (readonly [number, T])[]): TileflowZoomValue<T> {
    if (!Number.isFinite(base) || base <= 0) {
      throw new Error('Tileflow exponential zoom base must be a finite positive number.');
    }
    return createZoomValue('exponential', stops, base);
  },
  linear<T>(stops: readonly (readonly [number, T])[]): TileflowZoomValue<T> {
    return createZoomValue('linear', stops);
  },
  step<T>(stops: readonly (readonly [number, T])[]): TileflowZoomValue<T> {
    return createZoomValue('step', stops);
  },
};

export function expression<T>(value: readonly unknown[]): TileflowExpression<T> {
  validateExpressionArray(value, 'expression');
  return {kind: 'expression', value: cloneJson(value)} as TileflowExpression<T>;
}

export function filter(value: readonly unknown[]): TileflowFilterExpression {
  validateExpressionArray(value, 'filter');
  return {kind: 'filter', value: cloneJson(value)} as TileflowFilterExpression;
}

export function toMapLibreStyleValue<T>(value: TileflowStyleValue<T>): T | unknown[] {
  if (isTileflowExpression(value)) {
    return cloneJson(value.value) as unknown[];
  }

  if (isTileflowZoomValue(value)) {
    if (value.interpolation === 'step') {
      const [[, firstValue], ...rest] = value.stops;
      return [
        'step',
        ['zoom'],
        cloneJson(firstValue),
        ...rest.flatMap(([stop, stopValue]) => [stop, cloneJson(stopValue)]),
      ];
    }

    const interpolation =
      value.interpolation === 'exponential' ? ['exponential', value.base] : [value.interpolation];
    return [
      'interpolate',
      interpolation,
      ['zoom'],
      ...value.stops.flatMap(([stop, stopValue]) => [stop, cloneJson(stopValue)]),
    ];
  }

  return cloneJson(value);
}

export function toMapLibreFilter(value: TileflowFilterExpression): unknown[] {
  return cloneJson(value.value) as unknown[];
}

export function isTileflowExpression(value: unknown): value is TileflowExpression<unknown> {
  return isRecord(value) && value.kind === 'expression' && Array.isArray(value.value);
}

export function isTileflowZoomValue(value: unknown): value is TileflowZoomValue<unknown> {
  return isRecord(value) && value.kind === 'zoom' && Array.isArray(value.stops);
}

function createZoomValue<T>(
  interpolation: TileflowZoomValue<T>['interpolation'],
  stops: readonly (readonly [number, T])[],
  base?: number,
): TileflowZoomValue<T> {
  if (stops.length === 0) {
    throw new Error('Tileflow zoom values require at least one stop.');
  }

  let previous = -Infinity;
  const clonedStops = stops.map(([stop, value]) => {
    if (!Number.isFinite(stop) || stop < 0 || stop > 24) {
      throw new Error('Tileflow zoom stops must be finite numbers between 0 and 24.');
    }
    if (stop <= previous) {
      throw new Error('Tileflow zoom stops must be strictly increasing.');
    }
    previous = stop;
    return [stop, cloneJson(value)] as const;
  });

  return {
    kind: 'zoom',
    interpolation,
    ...(base === undefined ? {} : {base}),
    stops: clonedStops,
  } as TileflowZoomValue<T>;
}

function validateExpressionArray(value: readonly unknown[], name: string): void {
  if (value.length === 0 || typeof value[0] !== 'string') {
    throw new Error(`Tileflow ${name} must be a non-empty MapLibre expression array.`);
  }
  if (!isMapLibreExpressionOperator(value[0])) {
    throw new Error(`Unknown MapLibre expression operator: ${value[0]}`);
  }
  cloneJson(value);
}

function cloneJson<T>(value: T): T {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('Tileflow style values must be JSON-serializable.');
  }
  return JSON.parse(serialized) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
