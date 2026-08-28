import {isMapLibreExpressionOperator} from './expression-operators';

declare const expressionBrand: unique symbol;
const themeValueBrand = Symbol('TileflowThemeValue');
const zoomBrand = Symbol('TileflowZoom');

export const tileflowThemeTokenCategories = Object.freeze([
  'color',
  'font',
  'image',
  'number',
] as const);
export type TileflowThemeTokenCategory = (typeof tileflowThemeTokenCategories)[number];

type TileflowThemeTokenPrimitive = {
  color: string;
  font: string;
  image: string;
  number: number;
};

/** A JSON-safe semantic reference. The category is carried at runtime as well as in its type. */
export type TileflowThemeTokenReference<
  TCategory extends TileflowThemeTokenCategory = TileflowThemeTokenCategory,
> = {
  readonly category: TCategory;
  readonly kind: 'theme-token';
  readonly token: string;
  readonly [themeValueBrand]: TileflowThemeTokenPrimitive[TCategory];
};

/** An explicit opt-out from theme substitution. A reason is mandatory for auditability. */
export type TileflowFixedValue<T> = {
  readonly kind: 'theme-fixed';
  readonly reason: string;
  readonly value: T;
  readonly [themeValueBrand]: T;
};

export type TileflowThemeColorMix = {
  readonly amount: TileflowThemeNumberValue;
  readonly from: TileflowThemeColorValue;
  readonly kind: 'theme-color';
  readonly operation: 'mix';
  readonly space: 'oklch';
  readonly to: TileflowThemeColorValue;
  readonly [themeValueBrand]: string;
};

export type TileflowThemeColorAlpha = {
  readonly color: TileflowThemeColorValue;
  readonly kind: 'theme-color';
  readonly opacity: TileflowThemeNumberValue;
  readonly operation: 'alpha';
  readonly [themeValueBrand]: string;
};

export type TileflowThemeColorOperation = TileflowThemeColorAlpha | TileflowThemeColorMix;
export type TileflowThemeNumberValue =
  | number
  | TileflowFixedValue<number>
  | TileflowThemeTokenReference<'number'>;
export type TileflowThemeColorValue =
  | string
  | TileflowFixedValue<string>
  | TileflowThemeColorOperation
  | TileflowThemeTokenReference<'color'>;
export type TileflowThemeFontValue =
  | string
  | TileflowFixedValue<string>
  | TileflowThemeTokenReference<'font'>;
export type TileflowThemeImageValue =
  | string
  | TileflowFixedValue<string>
  | TileflowThemeTokenReference<'image'>;

export type TileflowThemeValue<T> =
  | T
  | TileflowFixedValue<T>
  | (T extends number
      ? TileflowThemeTokenReference<'number'>
      : T extends string
        ? TileflowThemeTokenReference<'color' | 'font' | 'image'> | TileflowThemeColorOperation
        : never);

export const token = {
  color(name: string): TileflowThemeTokenReference<'color'> {
    return createTokenReference('color', name);
  },
  font(name: string): TileflowThemeTokenReference<'font'> {
    return createTokenReference('font', name);
  },
  image(name: string): TileflowThemeTokenReference<'image'> {
    return createTokenReference('image', name);
  },
  number(name: string): TileflowThemeTokenReference<'number'> {
    return createTokenReference('number', name);
  },
};

export function fixed<T>(value: T, options: {reason: string}): TileflowFixedValue<T> {
  const reason = options.reason.trim();
  if (!reason) throw new Error('Tileflow fixed values require a non-empty reason.');
  cloneJson(value);
  return {kind: 'theme-fixed', reason, value} as TileflowFixedValue<T>;
}

export const color = {
  alpha(
    value: TileflowThemeColorValue,
    opacity: TileflowThemeNumberValue,
  ): TileflowThemeColorAlpha {
    return {
      color: cloneJson(value),
      kind: 'theme-color',
      opacity: cloneJson(opacity),
      operation: 'alpha',
    } as TileflowThemeColorAlpha;
  },
  mix(
    from: TileflowThemeColorValue,
    to: TileflowThemeColorValue,
    options: {amount: TileflowThemeNumberValue; space?: 'oklch'},
  ): TileflowThemeColorMix {
    if (options.space !== undefined && options.space !== 'oklch') {
      throw new Error('Tileflow color mixing supports only the deterministic OKLCH color space.');
    }
    return {
      amount: cloneJson(options.amount),
      from: cloneJson(from),
      kind: 'theme-color',
      operation: 'mix',
      space: 'oklch',
      to: cloneJson(to),
    } as TileflowThemeColorMix;
  },
};

export type TileflowExpression<T> = {
  readonly kind: 'expression';
  readonly value: readonly unknown[];
  /** Opaque result type. Only Tileflow's closed `expr.*` builders expose this brand publicly. */
  readonly [expressionBrand]: T;
};

export type TileflowZoomInterpolation = 'linear' | 'exponential';

type TileflowZoomValueCommon<T> = {
  readonly kind: 'zoom';
  readonly stops: readonly (readonly [number, T])[];
  readonly [zoomBrand]?: T;
};

export type TileflowZoomValue<T> = TileflowZoomValueCommon<T> &
  (
    | {readonly base: number; readonly interpolation: 'exponential'}
    | {readonly base?: never; readonly interpolation: 'linear' | 'step'}
  );

export type TileflowStyleValue<T> =
  | TileflowExpression<T>
  | TileflowThemeValue<T>
  | TileflowZoomValue<TileflowThemeValue<T>>;

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

  if (isTileflowThemeValueNode(value)) {
    throw new Error('Tileflow theme values must be resolved before MapLibre style compilation.');
  }
  return cloneJson(value as T);
}

export function isTileflowExpression(value: unknown): value is TileflowExpression<unknown> {
  return isRecord(value) && value.kind === 'expression' && Array.isArray(value.value);
}

export function isTileflowZoomValue(value: unknown): value is TileflowZoomValue<unknown> {
  return isRecord(value) && value.kind === 'zoom' && Array.isArray(value.stops);
}

export function isTileflowThemeTokenReference(
  value: unknown,
): value is TileflowThemeTokenReference {
  return (
    isRecord(value) &&
    hasExactOwnKeys(value, ['category', 'kind', 'token']) &&
    value.kind === 'theme-token' &&
    typeof value.token === 'string' &&
    /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/.test(value.token) &&
    (tileflowThemeTokenCategories as readonly unknown[]).includes(value.category)
  );
}

export function isTileflowFixedValue(value: unknown): value is TileflowFixedValue<unknown> {
  return (
    isRecord(value) &&
    hasExactOwnKeys(value, ['kind', 'reason', 'value']) &&
    value.kind === 'theme-fixed' &&
    typeof value.reason === 'string' &&
    Boolean(value.reason.trim()) &&
    Object.hasOwn(value, 'value')
  );
}

export function isTileflowThemeColorOperation(
  value: unknown,
): value is TileflowThemeColorOperation {
  if (!isRecord(value) || value.kind !== 'theme-color') return false;
  if (value.operation === 'alpha') {
    return (
      hasExactOwnKeys(value, ['color', 'kind', 'opacity', 'operation']) &&
      Object.hasOwn(value, 'color') &&
      Object.hasOwn(value, 'opacity')
    );
  }
  return (
    value.operation === 'mix' &&
    hasExactOwnKeys(value, ['amount', 'from', 'kind', 'operation', 'space', 'to']) &&
    value.space === 'oklch' &&
    Object.hasOwn(value, 'amount') &&
    Object.hasOwn(value, 'from') &&
    Object.hasOwn(value, 'to')
  );
}

export function isTileflowThemeValueNode(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.kind === 'theme-token' || value.kind === 'theme-fixed' || value.kind === 'theme-color')
  );
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

function createTokenReference<TCategory extends TileflowThemeTokenCategory>(
  category: TCategory,
  name: string,
): TileflowThemeTokenReference<TCategory> {
  const tokenName = name.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/.test(tokenName)) {
    throw new Error(
      `Invalid Tileflow ${category} token ${JSON.stringify(name)}; expected a portable dot-separated semantic name.`,
    );
  }
  return {
    category,
    kind: 'theme-token',
    token: tokenName,
  } as TileflowThemeTokenReference<TCategory>;
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

function hasExactOwnKeys(
  value: Readonly<Record<PropertyKey, unknown>>,
  expectedKeys: readonly string[],
): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === expectedKeys.length &&
    ownKeys.every((key) => typeof key === 'string' && expectedKeys.includes(key))
  );
}
