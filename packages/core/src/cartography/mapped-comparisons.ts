/** Values the adapter maps, and comparisons folded from them; only these are folded and merged. */
const mapped = new WeakSet<object>();

/** Mark an adapter's reading of a World field, so comparisons with it can be folded. */
export function mappedValue<T>(expression: T): T {
  if (typeof expression === 'object' && expression !== null) mapped.add(expression);
  return expression;
}

/**
 * Fold a comparison of a mapped value into one `match` on the properties it is mapped from.
 *
 * The OpenMapTiles adapter reads a World field as a `match` over OpenMapTiles properties. Comparing
 * that value with a string (`==`, `!=`) or matching on it would otherwise repeat the whole mapping in
 * every filter and paint property that reads the field, several times over for road layers.
 * Expressions it cannot fold are returned unchanged.
 */
export function foldMappedComparison(expression: readonly unknown[]): unknown {
  const folded = fold(expression);
  if (folded !== expression && Array.isArray(folded)) mapped.add(folded);
  return folded;
}

function fold(expression: readonly unknown[]): unknown {
  const [operator, input, operand] = expression;
  if (operator === 'all' || operator === 'any') return mergeMatches(operator, expression);
  if (!isMatch(input) || !mapped.has(input)) return expression;
  if ((operator === '==' || operator === '!=') && expression.length === 3) {
    if (typeof operand !== 'string') return expression;
    return compose(input, new Map([[operand, operator === '==']]), operator !== '==') ?? expression;
  }
  if (operator === 'match') {
    const table = matchTable(expression);
    return table ? (compose(input, table.outputs, table.fallback) ?? expression) : expression;
  }
  return expression;
}

type Table = ReadonlyMap<string, unknown>;

/**
 * Merge the operands of `all` or `any` that match on the same property into one `match`, so a road
 * kind such as "under construction, as a primary road" reads one OpenMapTiles class.
 */
function mergeMatches(operator: 'all' | 'any', expression: readonly unknown[]): unknown {
  const operands = expression.slice(1);
  const mergeable = (operand: unknown): operand is readonly unknown[] =>
    isMatch(operand) && mapped.has(operand) && matchTable(operand) !== undefined;
  const groups = new Map<string, {input: unknown; tables: {outputs: Table; fallback: unknown}[]}>();
  for (const operand of operands) {
    const table = mergeable(operand) ? matchTable(operand) : undefined;
    if (!table) continue;
    const key = JSON.stringify((operand as readonly unknown[])[1]);
    const group = groups.get(key) ?? {input: (operand as readonly unknown[])[1], tables: []};
    group.tables.push(table);
    groups.set(key, group);
  }
  if (![...groups.values()].some(({tables}) => tables.length > 1)) return expression;
  const merged = new Set<string>();
  const result: unknown[] = [];
  for (const operand of operands) {
    const key = mergeable(operand) ? JSON.stringify(operand[1]) : undefined;
    const group = key === undefined ? undefined : groups.get(key);
    if (!group || group.tables.length < 2) {
      result.push(operand);
      continue;
    }
    if (merged.has(key!)) continue;
    merged.add(key!);
    const labels = [...new Set(group.tables.flatMap(({outputs}) => [...outputs.keys()]))];
    const outputOf = (label: string) =>
      combine(
        operator,
        group.tables.map(({outputs, fallback}) =>
          outputs.has(label) ? outputs.get(label) : fallback,
        ),
      );
    result.push(
      matchOf(
        group.input,
        labels.map((label) => [label, outputOf(label)]),
        combine(
          operator,
          group.tables.map(({fallback}) => fallback),
        ),
      ),
    );
  }
  return combine(operator, result);
}

/** `all` or `any` of boolean operands, without operands that cannot change the result. */
function combine(operator: 'all' | 'any', operands: readonly unknown[]): unknown {
  const decisive = operator === 'any';
  if (operands.some((operand) => operand === decisive)) return decisive;
  const remaining = operands.filter((operand) => operand !== !decisive);
  const unique = [
    ...new Map(remaining.map((operand) => [JSON.stringify(operand), operand])).values(),
  ];
  if (unique.length === 0) return !decisive;
  return unique.length === 1 ? unique[0] : [operator, ...unique];
}

function isMatch(value: unknown): value is readonly unknown[] {
  return (
    Array.isArray(value) && value[0] === 'match' && value.length >= 5 && value.length % 2 === 1
  );
}

/** The string labels of a `match` and their outputs, or undefined for other labels. */
function matchTable(
  expression: readonly unknown[],
): {outputs: Table; fallback: unknown} | undefined {
  const outputs = new Map<string, unknown>();
  for (let index = 2; index < expression.length - 1; index += 2) {
    const labels = expression[index];
    for (const label of Array.isArray(labels) ? labels : [labels]) {
      if (typeof label !== 'string') return undefined;
      outputs.set(label, expression[index + 1]);
    }
  }
  return {outputs, fallback: expression.at(-1)};
}

/** `['match', value, ...table, fallback]`, with a mapped value's own branches folded in. */
function compose(value: unknown, table: Table, fallback: unknown): unknown {
  if (typeof value === 'string') return table.has(value) ? table.get(value) : fallback;
  if (!isMatch(value)) return matchOf(value, [...table], fallback);
  const input = value[1];
  const branches: [string, unknown][] = [];
  const labelled = new Set<string>();
  for (let index = 2; index < value.length - 1; index += 2) {
    const labels = value[index];
    const list = Array.isArray(labels) ? labels : [labels];
    if (!list.every((label) => typeof label === 'string')) return undefined;
    const output = compose(value[index + 1], table, fallback);
    if (output === undefined) return undefined;
    for (const label of list as string[]) {
      labelled.add(label);
      branches.push([label, output]);
    }
  }
  const otherwise = value.at(-1);
  if (isIdentity(otherwise, input)) {
    // An unmapped value reads as itself, so the table applies to the source property directly.
    for (const [label, output] of table) if (!labelled.has(label)) branches.push([label, output]);
    return matchOf(input, branches, fallback);
  }
  const composed = compose(otherwise, table, fallback);
  return composed === undefined ? undefined : matchOf(input, branches, composed);
}

/** A `match` that groups labels by output and leaves out those that reach the fallback anyway. */
function matchOf(input: unknown, branches: readonly [string, unknown][], fallback: unknown) {
  const otherwise = JSON.stringify(fallback);
  const groups = new Map<string, {labels: string[]; output: unknown}>();
  for (const [label, output] of branches) {
    const key = JSON.stringify(output);
    if (key === otherwise) continue;
    const group = groups.get(key) ?? {labels: [], output};
    group.labels.push(label);
    groups.set(key, group);
  }
  if (groups.size === 0) return fallback;
  return [
    'match',
    input,
    ...[...groups.values()].flatMap(({labels, output}) => [
      labels.length === 1 ? labels[0] : labels,
      output,
    ]),
    fallback,
  ];
}

function isIdentity(value: unknown, input: unknown): boolean {
  const same = (candidate: unknown) => JSON.stringify(candidate) === JSON.stringify(input);
  return same(value) || (Array.isArray(value) && value[0] === 'to-string' && same(value[1]));
}
