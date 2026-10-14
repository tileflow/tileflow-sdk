// Evaluates a compiled style's colour for one feature, for Core's 3D renderers: the colour a map
// gives each building in 3D may depend on its data, as MapLibre would draw it. Tileflow maps compile
// a closed set of expressions (Core's `expr`), so this evaluates exactly that set, at zoom 16,
// without MapLibre's own evaluator; an expression outside it gives no colour. It has no DOM
// dependency.

type Value = unknown;
type Parse = (text: string) => readonly number[] | null;
type Scope = Readonly<{properties: Readonly<Record<string, unknown>>; vars: Map<string, Value>}>;

const unsupported = new Error('Unsupported expression');

/**
 * A feature's colour from a CSS colour or a compiled colour expression, as `[r, g, b]` from 0 to 1;
 * undefined when the colour is invalid or uses an expression Core does not compile.
 */
export function tileflowFeatureColour(
  colour: string | readonly unknown[],
  properties: Readonly<Record<string, unknown>>,
  parse: Parse,
): [number, number, number] | undefined {
  let value: Value;
  try {
    value =
      typeof colour === 'string' ? colour : evaluate(colour, {properties, vars: new Map()}, parse);
  } catch {
    return undefined;
  }
  const channels = colourOf(value, parse);
  return channels ? [channels[0]!, channels[1]!, channels[2]!] : undefined;
}

function evaluate(expression: Value, scope: Scope, parse: Parse): Value {
  if (!Array.isArray(expression)) return expression;
  const [operator, ...args] = expression as [unknown, ...unknown[]];
  const at = (index: number) => evaluate(args[index], scope, parse);
  const number = (value: Value) => (typeof value === 'number' ? value : Number(value));
  switch (operator) {
    case 'literal':
      return args[0];
    case 'zoom':
      return 16;
    case 'get':
      return args.length === 1 ? (scope.properties[String(at(0))] ?? null) : null;
    case 'has':
      return String(at(0)) in scope.properties;
    case 'id':
    case 'feature-state':
    case 'global-state':
      return null;
    case 'let': {
      const vars = new Map(scope.vars);
      for (let index = 0; index + 1 < args.length - 1; index += 2)
        vars.set(String(args[index]), evaluate(args[index + 1], scope, parse));
      return evaluate(args[args.length - 1], {properties: scope.properties, vars}, parse);
    }
    case 'var':
      return scope.vars.get(String(args[0])) ?? null;
    case 'coalesce':
      for (let index = 0; index < args.length; index += 1) {
        const value = at(index);
        if (value !== null && value !== undefined) return value;
      }
      return null;
    case 'case':
      for (let index = 0; index + 1 < args.length; index += 2)
        if (at(index) === true) return at(index + 1);
      return at(args.length - 1);
    case 'match': {
      const input = at(0);
      for (let index = 1; index + 1 < args.length; index += 2) {
        const labels = Array.isArray(args[index]) ? (args[index] as unknown[]) : [args[index]];
        if (labels.some((label) => label === input)) return at(index + 1);
      }
      return at(args.length - 1);
    }
    case 'step': {
      const input = number(at(0));
      let output = 1;
      for (let index = 2; index + 1 < args.length; index += 2)
        if (input >= number(at(index))) output = index + 1;
      return at(output);
    }
    case 'interpolate': {
      const curve = args[0] as unknown[];
      const input = number(at(1));
      const stops: [number, Value][] = [];
      for (let index = 2; index + 1 < args.length; index += 2)
        stops.push([number(at(index)), at(index + 1)]);
      if (stops.length === 0) return null;
      if (input <= stops[0]![0]) return stops[0]![1];
      if (input >= stops[stops.length - 1]![0]) return stops[stops.length - 1]![1];
      const upper = stops.findIndex(([stop]) => stop > input);
      const [z0, v0] = stops[upper - 1]!;
      const [z1, v1] = stops[upper]!;
      let t = (input - z0) / (z1 - z0);
      if (curve?.[0] === 'exponential' && typeof curve[1] === 'number' && curve[1] !== 1)
        t = (curve[1] ** (input - z0) - 1) / (curve[1] ** (z1 - z0) - 1);
      if (typeof v0 === 'number' && typeof v1 === 'number') return v0 + (v1 - v0) * t;
      const [a, b] = [colourOf(v0, parse), colourOf(v1, parse)];
      return a && b ? a.map((channel, index) => channel + (b[index]! - channel) * t) : v0;
    }
    case '==':
      return at(0) === at(1);
    case '!=':
      return at(0) !== at(1);
    case '<':
      return compare(at(0), at(1)) < 0;
    case '<=':
      return compare(at(0), at(1)) <= 0;
    case '>':
      return compare(at(0), at(1)) > 0;
    case '>=':
      return compare(at(0), at(1)) >= 0;
    case 'all':
      return args.every((_, index) => at(index) === true);
    case 'any':
      return args.some((_, index) => at(index) === true);
    case '!':
      return at(0) !== true;
    case '+':
      return args.reduce<number>((sum, _, index) => sum + number(at(index)), 0);
    case '*':
      return args.reduce<number>((product, _, index) => product * number(at(index)), 1);
    case '-':
      return args.length === 1 ? -number(at(0)) : number(at(0)) - number(at(1));
    case '/':
      return number(at(0)) / number(at(1));
    case '%':
      return number(at(0)) % number(at(1));
    case 'abs':
      return Math.abs(number(at(0)));
    case 'min':
      return Math.min(...args.map((_, index) => number(at(index))));
    case 'max':
      return Math.max(...args.map((_, index) => number(at(index))));
    case 'to-number':
      for (let index = 0; index < args.length; index += 1) {
        const value = at(index);
        const converted =
          typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
        if (value !== null && value !== '' && Number.isFinite(converted)) return converted;
      }
      return 0;
    case 'to-string': {
      const value = at(0);
      return value === null || value === undefined ? '' : String(value);
    }
    case 'to-boolean':
      return Boolean(at(0));
    case 'concat':
      return args.map((_, index) => String(at(index) ?? '')).join('');
    case 'string':
    case 'number':
    case 'boolean':
      for (let index = 0; index < args.length; index += 1) {
        const value = at(index);
        if (typeof value === operator) return value;
      }
      return null;
    default:
      throw unsupported;
  }
}

function compare(a: Value, b: Value): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function colourOf(value: Value, parse: Parse): readonly number[] | undefined {
  if (typeof value === 'string') return parse(value)?.slice(0, 3);
  if (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.every((entry) => typeof entry === 'number')
  )
    return value as number[];
  return undefined;
}
