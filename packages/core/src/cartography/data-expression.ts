import type {TileflowDataFieldReference, TileflowDataFieldValue} from './semantic-bindings';
import {
  expression,
  isTileflowExpression,
  isTileflowThemeValueNode,
  type TileflowExpression,
  type TileflowFixedValue,
  type TileflowThemeColorOperation,
  type TileflowThemeTokenReference,
} from './values';

/** The value a themed authoring node produces after theme resolution. */
export type TileflowDataExpressionResult<T> =
  T extends TileflowFixedValue<infer TValue>
    ? TValue
    : T extends TileflowThemeTokenReference<infer TCategory>
      ? TCategory extends 'number'
        ? number
        : string
      : T extends TileflowThemeColorOperation
        ? string
        : T;

export type TileflowDataExpressionInput<T> = TileflowDataFieldReference | TileflowExpression<T> | T;

export type TileflowDataMatchBranch<TInput extends boolean | number | string, TOutput> = Readonly<{
  labels: TInput | readonly TInput[];
  value: TileflowDataExpressionInput<TOutput>;
}>;

export type TileflowDataCaseBranch<T> = Readonly<{
  value: TileflowDataExpressionInput<T>;
  when: TileflowDataExpressionInput<boolean>;
}>;

export type TileflowDataInterpolation =
  | Readonly<{kind: 'linear'}>
  | Readonly<{base: number; kind: 'exponential'}>
  | Readonly<{
      kind: 'cubic-bezier';
      x1: number;
      x2: number;
      y1: number;
      y2: number;
    }>;

export type TileflowDataStop<T> = readonly [number, TileflowDataExpressionInput<T>];

export const tileflowDataExpressionLimits = Object.freeze({
  maxBranches: 16,
  maxOperands: 16,
  maxStops: 16,
} as const);

function get<TName extends TileflowDataFieldReference['name']>(
  reference: TileflowDataFieldReference<TName>,
): TileflowExpression<TileflowDataFieldValue<TName>> {
  return make<TileflowDataFieldValue<TName>>(['get', reference]);
}

function literal<T>(value: T): TileflowExpression<TileflowDataExpressionResult<T>> {
  return make<TileflowDataExpressionResult<T>>(['literal', cloneJson(value)]);
}

function zoom(): TileflowExpression<number> {
  return make<number>(['zoom']);
}

function coalesce<T>(
  first: TileflowDataExpressionInput<T>,
  ...rest: readonly TileflowDataExpressionInput<T>[]
): TileflowExpression<TileflowDataExpressionResult<T>> {
  if (rest.length === 0) throw new Error('expr.coalesce requires at least two values.');
  validateOperandCount(1 + rest.length, 'expr.coalesce');
  return make<TileflowDataExpressionResult<T>>(['coalesce', node(first), ...rest.map(node)]);
}

function toNumber(
  value: TileflowDataExpressionInput<unknown>,
  fallback?: TileflowDataExpressionInput<number>,
): TileflowExpression<number> {
  return make<number>([
    'to-number',
    node(value),
    ...(fallback === undefined ? [] : [node(fallback)]),
  ]);
}

function toBoolean(
  value: TileflowDataExpressionInput<unknown>,
  fallback?: TileflowDataExpressionInput<boolean>,
): TileflowExpression<boolean> {
  return make<boolean>([
    'boolean',
    node(value),
    ...(fallback === undefined ? [] : [node(fallback)]),
  ]);
}

function toString(value: TileflowDataExpressionInput<unknown>): TileflowExpression<string> {
  return make<string>(['to-string', node(value)]);
}

function featureState(name: string): TileflowExpression<unknown> {
  const key = name.trim();
  if (!key) throw new Error('expr.featureState requires a non-empty state key.');
  return make<unknown>(['feature-state', key]);
}

function variable<T>(name: string): TileflowExpression<T> {
  const key = name.trim();
  if (!key) throw new Error('expr.var requires a non-empty variable name.');
  return make<T>(['var', key]);
}

function letValue<TBinding, TResult>(
  name: string,
  value: TileflowDataExpressionInput<TBinding>,
  body: TileflowDataExpressionInput<TResult>,
): TileflowExpression<TileflowDataExpressionResult<TResult>> {
  const key = name.trim();
  if (!key) throw new Error('expr.let requires a non-empty variable name.');
  return make<TileflowDataExpressionResult<TResult>>(['let', key, node(value), node(body)]);
}

function abs(value: TileflowDataExpressionInput<number>): TileflowExpression<number> {
  return make<number>(['abs', node(value)]);
}

function add(
  first: TileflowDataExpressionInput<number>,
  second: TileflowDataExpressionInput<number>,
  ...rest: readonly TileflowDataExpressionInput<number>[]
): TileflowExpression<number> {
  validateOperandCount(2 + rest.length, 'expr.add');
  return make<number>(['+', node(first), node(second), ...rest.map(node)]);
}

function subtract(
  first: TileflowDataExpressionInput<number>,
  second: TileflowDataExpressionInput<number>,
): TileflowExpression<number> {
  return make<number>(['-', node(first), node(second)]);
}

function divide(
  dividend: TileflowDataExpressionInput<number>,
  divisor: TileflowDataExpressionInput<number>,
): TileflowExpression<number> {
  return make<number>(['/', node(dividend), node(divisor)]);
}

function multiply(
  first: TileflowDataExpressionInput<number>,
  second: TileflowDataExpressionInput<number>,
  ...rest: readonly TileflowDataExpressionInput<number>[]
): TileflowExpression<number> {
  validateOperandCount(2 + rest.length, 'expr.multiply');
  return make<number>(['*', node(first), node(second), ...rest.map(node)]);
}

function minimum(
  first: TileflowDataExpressionInput<number>,
  second: TileflowDataExpressionInput<number>,
  ...rest: readonly TileflowDataExpressionInput<number>[]
): TileflowExpression<number> {
  validateOperandCount(2 + rest.length, 'expr.min');
  return make<number>(['min', node(first), node(second), ...rest.map(node)]);
}

function maximum(
  first: TileflowDataExpressionInput<number>,
  second: TileflowDataExpressionInput<number>,
  ...rest: readonly TileflowDataExpressionInput<number>[]
): TileflowExpression<number> {
  validateOperandCount(2 + rest.length, 'expr.max');
  return make<number>(['max', node(first), node(second), ...rest.map(node)]);
}

function concat(
  first: TileflowDataExpressionInput<string>,
  ...rest: readonly TileflowDataExpressionInput<string>[]
): TileflowExpression<string> {
  if (rest.length === 0) throw new Error('expr.concat requires at least two values.');
  validateOperandCount(1 + rest.length, 'expr.concat');
  return make<string>(['concat', node(first), ...rest.map(node)]);
}

function compare<T>(
  operator: '!=' | '<' | '<=' | '==' | '>' | '>=',
  left: TileflowDataExpressionInput<T>,
  right: TileflowDataExpressionInput<T>,
): TileflowExpression<boolean> {
  return make<boolean>([operator, node(left), node(right)]);
}

function all(
  first: TileflowDataExpressionInput<boolean>,
  ...rest: readonly TileflowDataExpressionInput<boolean>[]
): TileflowExpression<boolean> {
  validateOperandCount(1 + rest.length, 'expr.all');
  return make<boolean>(['all', node(first), ...rest.map(node)]);
}

function any(
  first: TileflowDataExpressionInput<boolean>,
  ...rest: readonly TileflowDataExpressionInput<boolean>[]
): TileflowExpression<boolean> {
  validateOperandCount(1 + rest.length, 'expr.any');
  return make<boolean>(['any', node(first), ...rest.map(node)]);
}

function not(value: TileflowDataExpressionInput<boolean>): TileflowExpression<boolean> {
  return make<boolean>(['!', node(value)]);
}

function has(reference: TileflowDataFieldReference): TileflowExpression<boolean> {
  return make<boolean>(['has', reference]);
}

function match<TInput extends boolean | number | string, TOutput>(
  input: TileflowDataExpressionInput<TInput>,
  branches: readonly [
    TileflowDataMatchBranch<TInput, TOutput>,
    ...TileflowDataMatchBranch<TInput, TOutput>[],
  ],
  fallback: TileflowDataExpressionInput<TOutput>,
): TileflowExpression<TileflowDataExpressionResult<TOutput>> {
  validateBranchCount(branches.length, 'expr.match');
  validateMatchLabels(branches);
  return make<TileflowDataExpressionResult<TOutput>>([
    'match',
    node(input),
    ...branches.flatMap(({labels, value}) => [
      Array.isArray(labels) ? cloneJson(labels) : labels,
      node(value),
    ]),
    node(fallback),
  ]);
}

function caseValue<T>(
  branches: readonly [TileflowDataCaseBranch<T>, ...TileflowDataCaseBranch<T>[]],
  fallback: TileflowDataExpressionInput<T>,
): TileflowExpression<TileflowDataExpressionResult<T>> {
  validateBranchCount(branches.length, 'expr.case');
  return make<TileflowDataExpressionResult<T>>([
    'case',
    ...branches.flatMap(({value, when}) => [node(when), node(value)]),
    node(fallback),
  ]);
}

function step<T>(
  input: TileflowDataExpressionInput<number>,
  fallback: TileflowDataExpressionInput<T>,
  stops: readonly [TileflowDataStop<T>, ...TileflowDataStop<T>[]],
): TileflowExpression<TileflowDataExpressionResult<T>> {
  validateStopCount(stops.length, 'expr.step');
  validateStops(stops, 'expr.step');
  return make<TileflowDataExpressionResult<T>>([
    'step',
    node(input),
    node(fallback),
    ...stops.flatMap(([stop, value]) => [stop, node(value)]),
  ]);
}

function interpolate<T>(
  interpolation: TileflowDataInterpolation,
  input: TileflowDataExpressionInput<number>,
  stops: readonly [TileflowDataStop<T>, ...TileflowDataStop<T>[]],
): TileflowExpression<TileflowDataExpressionResult<T>> {
  validateStopCount(stops.length, 'expr.interpolate');
  validateStops(stops, 'expr.interpolate');
  const method = interpolationMethod(interpolation);
  return make<TileflowDataExpressionResult<T>>([
    'interpolate',
    method,
    node(input),
    ...stops.flatMap(([stop, value]) => [stop, node(value)]),
  ]);
}

function interpolationMethod(interpolation: TileflowDataInterpolation): readonly unknown[] {
  switch (interpolation.kind) {
    case 'linear':
      return ['linear'];
    case 'exponential':
      if (!Number.isFinite(interpolation.base) || interpolation.base <= 0) {
        throw new Error('expr.interpolate exponential base must be finite and positive.');
      }
      return ['exponential', interpolation.base];
    case 'cubic-bezier': {
      const values = [interpolation.x1, interpolation.y1, interpolation.x2, interpolation.y2];
      if (values.some((value) => !Number.isFinite(value))) {
        throw new Error('expr.interpolate cubic-bezier values must be finite.');
      }
      return ['cubic-bezier', ...values];
    }
  }
}

function validateStops(
  stops: readonly (readonly [number, TileflowDataExpressionInput<unknown>])[],
  api: string,
): void {
  let previous = -Infinity;
  for (const [stop] of stops) {
    if (!Number.isFinite(stop) || stop <= previous) {
      throw new Error(`${api} stops must be finite and strictly increasing.`);
    }
    previous = stop;
  }
}

function validateOperandCount(count: number, api: string): void {
  if (count > tileflowDataExpressionLimits.maxOperands) {
    throw new Error(
      `${api} supports at most ${tileflowDataExpressionLimits.maxOperands} operands.`,
    );
  }
}

function validateBranchCount(count: number, api: string): void {
  if (count > tileflowDataExpressionLimits.maxBranches) {
    throw new Error(
      `${api} supports at most ${tileflowDataExpressionLimits.maxBranches} branches.`,
    );
  }
}

function validateStopCount(count: number, api: string): void {
  if (count > tileflowDataExpressionLimits.maxStops) {
    throw new Error(`${api} supports at most ${tileflowDataExpressionLimits.maxStops} stops.`);
  }
}

function node<T>(value: TileflowDataExpressionInput<T>): unknown {
  if (isTileflowExpression(value)) return cloneJson(value.value);
  if (isDataFieldReference(value)) return ['get', cloneJson(value)];
  if (Array.isArray(value)) return ['literal', cloneJson(value)];
  if (value !== null && typeof value === 'object' && !isTileflowThemeValueNode(value)) {
    return ['literal', cloneJson(value)];
  }
  return cloneJson(value);
}

function make<T>(value: readonly unknown[]): TileflowExpression<T> {
  return expression<T>(value);
}

function isDataFieldReference(value: unknown): value is TileflowDataFieldReference {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as {kind?: unknown}).kind === 'tileflow-data-field'
  );
}

function cloneJson<T>(value: T): T {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('Tileflow expression values must be JSON-serializable.');
  }
  return JSON.parse(serialized) as T;
}

function validateMatchLabels<TInput extends boolean | number | string, TOutput>(
  branches: readonly TileflowDataMatchBranch<TInput, TOutput>[],
): void {
  const labels = branches.flatMap(({labels}) => (Array.isArray(labels) ? [...labels] : [labels]));
  if (labels.length !== new Set(labels.map((label) => `${typeof label}:${String(label)}`)).size) {
    throw new Error('expr.match labels must be unique.');
  }
  if (branches.some(({labels}) => Array.isArray(labels) && labels.length === 0)) {
    throw new Error('expr.match label arrays must not be empty.');
  }
  const kinds = new Set(labels.map((label) => typeof label));
  if (
    kinds.size !== 1 ||
    [...kinds].some((kind) => !['boolean', 'number', 'string'].includes(kind))
  ) {
    throw new Error('expr.match labels must share one boolean, number, or string type.');
  }
  if (labels.some((label) => typeof label === 'number' && !Number.isFinite(label))) {
    throw new Error('expr.match numeric labels must be finite.');
  }
}

export type TileflowDataExpressionValidationIssue = Readonly<{
  message: string;
  path: readonly PropertyKey[];
}>;

/** Validate the exact serialized grammar emitted by the public `expr.*` builders. */
export function validateTileflowDataExpression(
  value: unknown,
): readonly TileflowDataExpressionValidationIssue[] {
  const issues: TileflowDataExpressionValidationIssue[] = [];
  visitExpression(value, [], new Set(), issues);
  return issues;
}

function visitExpression(
  value: unknown,
  path: readonly PropertyKey[],
  variables: ReadonlySet<string>,
  issues: TileflowDataExpressionValidationIssue[],
): void {
  if (!Array.isArray(value) || typeof value[0] !== 'string') {
    addExpressionIssue(issues, path, 'Expected a closed Tileflow expression array.');
    return;
  }

  const operator = value[0];
  const branchLimit = tileflowDataExpressionLimits.maxBranches;
  const operandLimit = tileflowDataExpressionLimits.maxOperands;
  const stopLimit = tileflowDataExpressionLimits.maxStops;
  const visit = (entry: unknown, index: number, scope = variables) =>
    visitExpressionNode(entry, [...path, index], scope, issues);
  const exact = (length: number): boolean => {
    if (value.length === length) return true;
    addExpressionIssue(
      issues,
      path,
      `Expression ${operator} expects ${length - 1} argument${length === 2 ? '' : 's'}.`,
    );
    return false;
  };
  const minimum = (length: number): boolean => {
    if (value.length >= length) return true;
    addExpressionIssue(
      issues,
      path,
      `Expression ${operator} expects at least ${length - 1} arguments.`,
    );
    return false;
  };

  switch (operator) {
    case 'get':
    case 'has': {
      if (exact(2)) validateFieldReference(value[1], [...path, 1], issues);
      return;
    }
    case 'literal': {
      if (exact(2) && !isJsonValue(value[1])) {
        addExpressionIssue(issues, [...path, 1], 'Expression literals must be JSON values.');
      }
      return;
    }
    case 'zoom': {
      exact(1);
      return;
    }
    case 'feature-state': {
      if (exact(2) && !isNonEmptyString(value[1])) {
        addExpressionIssue(issues, [...path, 1], 'Feature-state keys must be non-empty strings.');
      }
      return;
    }
    case 'var': {
      if (exact(2)) {
        if (!isNonEmptyString(value[1])) {
          addExpressionIssue(issues, [...path, 1], 'Variable names must be non-empty strings.');
        } else if (!variables.has(value[1])) {
          addExpressionIssue(issues, [...path, 1], `Unknown expression variable ${value[1]}.`);
        }
      }
      return;
    }
    case 'let': {
      if (!exact(4)) return;
      if (!isNonEmptyString(value[1])) {
        addExpressionIssue(issues, [...path, 1], 'Variable names must be non-empty strings.');
        visit(value[2], 2);
        visit(value[3], 3);
        return;
      }
      visit(value[2], 2);
      visit(value[3], 3, new Set([...variables, value[1]]));
      return;
    }
    case 'abs':
    case '!':
    case 'to-string': {
      if (exact(2)) visit(value[1], 1);
      return;
    }
    case 'boolean':
    case 'to-number': {
      if (value.length !== 2 && value.length !== 3) {
        addExpressionIssue(issues, path, `Expression ${operator} expects one or two arguments.`);
        return;
      }
      for (let index = 1; index < value.length; index += 1) visit(value[index], index);
      return;
    }
    case '-':
    case '/':
    case '!=':
    case '<':
    case '<=':
    case '==':
    case '>':
    case '>=': {
      if (!exact(3)) return;
      visit(value[1], 1);
      visit(value[2], 2);
      return;
    }
    case '+':
    case '*':
    case 'min':
    case 'max':
    case 'coalesce':
    case 'concat': {
      if (!minimum(3)) return;
      if (value.length - 1 > operandLimit) {
        addExpressionIssue(
          issues,
          path,
          `Expression ${operator} exceeds ${operandLimit} operands.`,
        );
        return;
      }
      for (let index = 1; index < value.length; index += 1) visit(value[index], index);
      return;
    }
    case 'all':
    case 'any': {
      if (!minimum(2)) return;
      if (value.length - 1 > operandLimit) {
        addExpressionIssue(
          issues,
          path,
          `Expression ${operator} exceeds ${operandLimit} operands.`,
        );
        return;
      }
      for (let index = 1; index < value.length; index += 1) visit(value[index], index);
      return;
    }
    case 'case': {
      if (value.length < 4 || value.length % 2 !== 0) {
        addExpressionIssue(
          issues,
          path,
          'Expression case expects condition/output pairs and a fallback.',
        );
        return;
      }
      if ((value.length - 2) / 2 > branchLimit) {
        addExpressionIssue(issues, path, `Expression case exceeds ${branchLimit} branches.`);
        return;
      }
      for (let index = 1; index < value.length; index += 1) visit(value[index], index);
      return;
    }
    case 'match': {
      if (value.length < 5 || value.length % 2 !== 1) {
        addExpressionIssue(
          issues,
          path,
          'Expression match expects label/output pairs and a fallback.',
        );
        return;
      }
      if ((value.length - 3) / 2 > branchLimit) {
        addExpressionIssue(issues, path, `Expression match exceeds ${branchLimit} branches.`);
        return;
      }
      visit(value[1], 1);
      validateSerializedMatchLabels(value, path, issues);
      for (let index = 3; index < value.length; index += 2) visit(value[index], index);
      visit(value.at(-1), value.length - 1);
      return;
    }
    case 'step': {
      if (value.length < 5 || value.length % 2 !== 1) {
        addExpressionIssue(
          issues,
          path,
          'Expression step expects an input, fallback, and stop/output pairs.',
        );
        return;
      }
      if ((value.length - 3) / 2 > stopLimit) {
        addExpressionIssue(issues, path, `Expression step exceeds ${stopLimit} stops.`);
        return;
      }
      visit(value[1], 1);
      visit(value[2], 2);
      validateSerializedStops(value, 3, path, issues);
      for (let index = 4; index < value.length; index += 2) visit(value[index], index);
      return;
    }
    case 'interpolate': {
      if (value.length < 5 || value.length % 2 !== 1) {
        addExpressionIssue(
          issues,
          path,
          'Expression interpolate expects a method, input, and stop/output pairs.',
        );
        return;
      }
      if ((value.length - 3) / 2 > stopLimit) {
        addExpressionIssue(issues, path, `Expression interpolate exceeds ${stopLimit} stops.`);
        return;
      }
      validateInterpolationArray(value[1], [...path, 1], issues);
      visit(value[2], 2);
      validateSerializedStops(value, 3, path, issues);
      for (let index = 4; index < value.length; index += 2) visit(value[index], index);
      return;
    }
    default:
      addExpressionIssue(
        issues,
        path,
        `Unsupported Tileflow expression operator ${JSON.stringify(operator)}.`,
      );
  }
}

function visitExpressionNode(
  value: unknown,
  path: readonly PropertyKey[],
  variables: ReadonlySet<string>,
  issues: TileflowDataExpressionValidationIssue[],
): void {
  if (Array.isArray(value)) {
    visitExpression(value, path, variables, issues);
    return;
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    isThemeValueNode(value)
  ) {
    return;
  }
  addExpressionIssue(
    issues,
    path,
    'Expression operands must be primitives, explicit theme values, or nested expr.* nodes.',
  );
}

function validateFieldReference(
  value: unknown,
  path: readonly PropertyKey[],
  issues: TileflowDataExpressionValidationIssue[],
): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as {kind?: unknown}).kind !== 'tileflow-data-field' ||
    !isNonEmptyString((value as {name?: unknown}).name) ||
    Object.keys(value).sort().join(',') !== 'kind,name'
  ) {
    addExpressionIssue(issues, path, 'Expected a semantic field(name) reference.');
  }
}

function validateSerializedMatchLabels(
  value: readonly unknown[],
  path: readonly PropertyKey[],
  issues: TileflowDataExpressionValidationIssue[],
): void {
  const labels: unknown[] = [];
  for (let index = 2; index < value.length - 1; index += 2) {
    const candidate = value[index];
    const branch = Array.isArray(candidate) ? candidate : [candidate];
    if (branch.length === 0 || branch.some((label) => !isMatchLabel(label))) {
      addExpressionIssue(
        issues,
        [...path, index],
        'Match labels must be a non-empty boolean, finite number, string, or homogeneous array.',
      );
      continue;
    }
    labels.push(...branch);
  }
  const kinds = new Set(labels.map((label) => typeof label));
  if (kinds.size > 1) {
    addExpressionIssue(issues, path, 'All match labels must share one primitive type.');
  }
  if (new Set(labels.map((label) => `${typeof label}:${String(label)}`)).size !== labels.length) {
    addExpressionIssue(issues, path, 'Match labels must be unique.');
  }
}

function validateSerializedStops(
  value: readonly unknown[],
  firstIndex: number,
  path: readonly PropertyKey[],
  issues: TileflowDataExpressionValidationIssue[],
): void {
  let previous = -Infinity;
  for (let index = firstIndex; index < value.length; index += 2) {
    const stop = value[index];
    if (typeof stop !== 'number' || !Number.isFinite(stop) || stop <= previous) {
      addExpressionIssue(issues, [...path, index], 'Stops must be finite and strictly increasing.');
    } else {
      previous = stop;
    }
  }
}

function validateInterpolationArray(
  value: unknown,
  path: readonly PropertyKey[],
  issues: TileflowDataExpressionValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    addExpressionIssue(issues, path, 'Expected a closed interpolation method.');
    return;
  }
  const [kind, ...parameters] = value;
  const valid =
    (kind === 'linear' && parameters.length === 0) ||
    (kind === 'exponential' &&
      parameters.length === 1 &&
      typeof parameters[0] === 'number' &&
      Number.isFinite(parameters[0]) &&
      parameters[0] > 0) ||
    (kind === 'cubic-bezier' &&
      parameters.length === 4 &&
      parameters.every((parameter) => typeof parameter === 'number' && Number.isFinite(parameter)));
  if (!valid) addExpressionIssue(issues, path, 'Expected linear, exponential, or cubic-bezier.');
}

function isThemeValueNode(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const kind = (value as {kind?: unknown}).kind;
  return kind === 'theme-token' || kind === 'theme-fixed' || kind === 'theme-color';
}

function isJsonValue(value: unknown, visited = new WeakSet<object>()): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (!value || typeof value !== 'object' || visited.has(value)) return false;
  visited.add(value);
  return (Array.isArray(value) ? value : Object.values(value)).every((entry) =>
    isJsonValue(entry, visited),
  );
}

function isMatchLabel(value: unknown): value is boolean | number | string {
  return (
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function addExpressionIssue(
  issues: TileflowDataExpressionValidationIssue[],
  path: readonly PropertyKey[],
  message: string,
): void {
  issues.push({message, path});
}

/**
 * Closed, typed data-expression builders. They preserve semantic field refs
 * and lower to byte-equivalent MapLibre expressions only inside the compiler.
 */
export const expr = Object.freeze({
  abs,
  add,
  all,
  any,
  case: caseValue,
  coalesce,
  concat,
  divide,
  eq: <T>(left: TileflowDataExpressionInput<T>, right: TileflowDataExpressionInput<T>) =>
    compare('==', left, right),
  get,
  gt: <T>(left: TileflowDataExpressionInput<T>, right: TileflowDataExpressionInput<T>) =>
    compare('>', left, right),
  gte: <T>(left: TileflowDataExpressionInput<T>, right: TileflowDataExpressionInput<T>) =>
    compare('>=', left, right),
  has,
  featureState,
  interpolate,
  let: letValue,
  literal,
  lt: <T>(left: TileflowDataExpressionInput<T>, right: TileflowDataExpressionInput<T>) =>
    compare('<', left, right),
  lte: <T>(left: TileflowDataExpressionInput<T>, right: TileflowDataExpressionInput<T>) =>
    compare('<=', left, right),
  match,
  max: maximum,
  min: minimum,
  multiply,
  ne: <T>(left: TileflowDataExpressionInput<T>, right: TileflowDataExpressionInput<T>) =>
    compare('!=', left, right),
  not,
  step,
  subtract,
  toBoolean,
  toNumber,
  toString,
  var: variable,
  zoom,
});
