import {isMapLibreExpressionOperator} from './expression-operators';

type Scope = ReadonlyMap<string, {value: unknown; scope: Scope}>;

/** Compact generated expressions without changing literal data or discarding fallible guards. */
export function compactTileflowExpression(value: unknown, scope: Scope = new Map()): unknown {
  if (!isExpression(value) || value[0] === 'literal' || value[0] === 'var') return value;
  if (value[0] === 'let') return compactLet(value, scope);
  const node = value.map((entry, index) => {
    // Match labels are data, even when their first label names an expression operator.
    if (value[0] === 'match' && index >= 2 && index < value.length - 1 && index % 2 === 0)
      return entry;
    if (index === 0 || (value[0] === 'interpolate' && index === 1)) return entry;
    return compactTileflowExpression(entry, scope);
  });
  if (node[0] === 'all' || node[0] === 'any') {
    const operands = node
      .slice(1)
      .flatMap((entry) =>
        Array.isArray(entry) && entry[0] === node[0] ? entry.slice(1) : [entry],
      );
    return [node[0], ...operands];
  }
  if (node[0] === 'case') {
    // Only trailing equal branches can disappear: an earlier fallback-valued branch may
    // deliberately prevent a later, different branch from winning.
    while (node.length >= 4 && equal(node.at(-2), node.at(-1)) && totalBoolean(node.at(-3), scope))
      node.splice(node.length - 3, 2);
    return node.length === 2 ? node[1] : compactClassDispatch(node, scope);
  }
  if (node[0] === 'match' && totalValue(node[1], scope)) {
    for (let index = node.length - 3; index >= 2; index -= 2)
      if (equal(node[index + 1], node.at(-1))) node.splice(index, 2);
    return node.length === 3 ? node[2] : node;
  }
  if (node[0] === '*' && node.slice(1).every((entry) => numeric(entry, scope))) {
    const operands = node.slice(1).filter((entry) => entry !== 1);
    return operands.length === 0 ? 1 : operands.length === 1 ? operands[0] : ['*', ...operands];
  }
  if (node[0] === 'interpolate' && numeric(node[2], scope)) {
    const outputs = node.filter((_, index) => index >= 4 && index % 2 === 0);
    if (outputs.length > 0 && outputs.every((entry) => equal(entry, outputs[0]))) return outputs[0];
    // The planner samples zoom expressions at fixed stops. A sample exactly at a stop
    // does not need to carry both copies of the original interpolation.
    if (
      typeof node[2] === 'number' &&
      outputs.every((output) => typeof output === 'number' && Number.isFinite(output))
    ) {
      for (let index = 3; index < node.length - 1; index += 2)
        if (node[index] === node[2]) return node[index + 1];
    }
  }
  return node;
}

function compactClassDispatch(node: unknown[], scope: Scope): unknown {
  if (node.length < 6) return node;
  const branches: Array<{input: unknown; labels: unknown[]; guards: unknown[]; output: unknown}> =
    [];
  const labels = new Set<string>();
  let labelType: string | undefined;
  for (let index = 1; index < node.length - 1; index += 2) {
    const condition = node[index];
    const parts =
      Array.isArray(condition) && condition[0] === 'all' ? condition.slice(1) : [condition];
    const at = parts.findIndex(
      (part) =>
        Array.isArray(part) &&
        part[0] === 'match' &&
        part.length === 5 &&
        part[3] === true &&
        part[4] === false,
    );
    if (at < 0 || !parts.every((part) => totalBoolean(part, scope))) return node;
    const match = parts[at] as unknown[];
    const ownLabels = Array.isArray(match[2]) ? match[2] : [match[2]];
    if (ownLabels.length === 0) return node;
    for (const label of ownLabels) {
      labelType ??= typeof label;
      if (!['number', 'string'].includes(labelType) || typeof label !== labelType) return node;
      const key = JSON.stringify(label);
      if (labels.has(key)) return node; // Case precedence must survive overlapping labels.
      labels.add(key);
    }
    branches.push({
      input: match[1],
      labels: ownLabels,
      guards: parts.filter((_, i) => i !== at),
      output: node[index + 1],
    });
  }
  const first = branches[0]!;
  if (
    !branches.every(
      (branch) => equal(branch.input, first.input) && equal(branch.guards, first.guards),
    )
  )
    return node;
  const fallback = node.at(-1);
  const match = [
    'match',
    first.input,
    ...branches.flatMap((branch) => [branch.labels, branch.output]),
    fallback,
  ];
  const result = first.guards.length
    ? [
        'case',
        first.guards.length === 1 ? first.guards[0] : ['all', ...first.guards],
        match,
        fallback,
      ]
    : match;
  return JSON.stringify(result).length < JSON.stringify(node).length ? result : node;
}

function compactLet(node: unknown[], scope: Scope): unknown {
  const inner = new Map(scope);
  const bindings: unknown[] = [];
  for (let index = 1; index < node.length - 1; index += 2) {
    const name = node[index];
    if (typeof name !== 'string') return node;
    // MapLibre evaluates each binding in the enclosing scope, not in sibling bindings.
    const value = compactTileflowExpression(node[index + 1], scope);
    bindings.push(name, value);
    inner.set(name, {value, scope});
  }
  const result = compactTileflowExpression(node.at(-1), inner);
  if (Array.isArray(result) && result[0] === 'var' && bindings.includes(result[1])) {
    for (let index = bindings.length - 2; index >= 0; index -= 2)
      if (bindings[index] === result[1]) return bindings[index + 1];
  }
  const retained: unknown[] = [];
  for (let index = 0; index < bindings.length; index += 2)
    if (usesVariable(result, bindings[index] as string))
      retained.push(bindings[index], bindings[index + 1]);
  // Let bindings are lazy in MapLibre: removing an unused binding does not drop evaluation.
  return retained.length ? ['let', ...retained, result] : result;
}

function usesVariable(value: unknown, name: string): boolean {
  if (!Array.isArray(value) || value[0] === 'literal') return false;
  if (value[0] === 'var') return value[1] === name;
  return value.some((entry) => usesVariable(entry, name));
}

function numeric(value: unknown, scope: Scope): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (!Array.isArray(value)) return false;
  if (value[0] === 'zoom') return value.length === 1;
  if (value[0] === 'var' && typeof value[1] === 'string') {
    const binding = scope.get(value[1]);
    return binding !== undefined && numeric(binding.value, binding.scope);
  }
  if (
    value[0] === '*' ||
    value[0] === '+' ||
    value[0] === '-' ||
    value[0] === 'max' ||
    value[0] === 'min'
  )
    return value.length > 1 && value.slice(1).every((entry) => numeric(entry, scope));
  if (value[0] === 'case')
    return (
      value
        .slice(1, -1)
        .every((entry, index) =>
          index % 2 === 0 ? totalBoolean(entry, scope) : numeric(entry, scope),
        ) && numeric(value.at(-1), scope)
    );
  if (value[0] === 'interpolate')
    return (
      numeric(value[2], scope) &&
      value
        .filter((_, index) => index >= 4 && index % 2 === 0)
        .every((entry) => numeric(entry, scope))
    );
  return false;
}

function totalBoolean(value: unknown, scope: Scope): boolean {
  if (typeof value === 'boolean') return true;
  if (!Array.isArray(value)) return false;
  if (value[0] === 'has') return value.length === 2 && typeof value[1] === 'string';
  if (value[0] === '!' && value.length === 2) return totalBoolean(value[1], scope);
  if (value[0] === 'all' || value[0] === 'any')
    return value.slice(1).every((entry) => totalBoolean(entry, scope));
  if ((value[0] === '==' || value[0] === '!=') && value.length === 3)
    return totalValue(value[1], scope) && totalValue(value[2], scope);
  if (value[0] === 'match')
    return (
      totalValue(value[1], scope) &&
      value
        .filter((_, index) => index >= 3 && index % 2 === 1)
        .every((entry) => totalBoolean(entry, scope)) &&
      totalBoolean(value.at(-1), scope)
    );
  return false;
}

function totalValue(value: unknown, scope: Scope): boolean {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return true;
  if (!Array.isArray(value)) return false;
  if (value[0] === 'literal') return true;
  if (value[0] === 'get' || value[0] === 'has')
    return value.length === 2 && typeof value[1] === 'string';
  if (value[0] === 'geometry-type' || value[0] === 'id') return value.length === 1;
  if (value[0] === 'to-string') return value.length === 2 && totalValue(value[1], scope);
  return numeric(value, scope) || totalBoolean(value, scope);
}

function isExpression(value: unknown): value is unknown[] {
  return Array.isArray(value) && isMapLibreExpressionOperator(value[0]);
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Let bindings share repeated, typed expressions without eagerly evaluating them. */
function shareExpressions(value: unknown): unknown {
  if (!isExpression(value)) return value;
  let result = value;
  const bindings: unknown[] = [];
  const serialized = new WeakMap<unknown[], string>();
  const textOf = (node: unknown[]) => {
    let text = serialized.get(node);
    if (text === undefined) {
      text = JSON.stringify(node);
      serialized.set(node, text);
    }
    return text;
  };
  const originalText = textOf(value);
  for (let index = 0; index < 16; index += 1) {
    let name = `__tf${index}`;
    while (originalText.includes(JSON.stringify(name))) name += '_';
    const candidates = new Map<string, {node: unknown[]; count: number}>();
    visit(result, (node) => {
      if (
        textOf(node).length < 48 ||
        !selfContained(node) ||
        !(totalBoolean(node, new Map()) || numeric(node, new Map()) || stringOutput(node))
      )
        return node;
      const key = textOf(node);
      const entry = candidates.get(key);
      if (entry) entry.count += 1;
      else candidates.set(key, {node, count: 1});
      return node;
    });
    const reference = ['var', name];
    const referenceLength = JSON.stringify(reference).length;
    const best = [...candidates.entries()]
      .map(([key, entry]) => ({
        key,
        ...entry,
        saving: (entry.count - 1) * key.length - entry.count * referenceLength - name.length - 8,
      }))
      .filter(({count, saving}) => count > 1 && saving > 0)
      .sort((a, b) => b.saving - a.saving || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))[0];
    if (!best) break;
    bindings.push(name, best.node);
    result = visit(result, (node) => (textOf(node) === best.key ? reference : node));
  }
  if (!bindings.length) return value;
  const shared = ['let', ...bindings, result];
  return JSON.stringify(shared).length < originalText.length ? shared : value;
}

function stringOutput(value: unknown): boolean {
  if (typeof value === 'string') return true;
  if (!Array.isArray(value)) return false;
  if (value[0] === 'case')
    return (
      value
        .slice(1, -1)
        .every((entry, index) =>
          index % 2 === 0 ? totalBoolean(entry, new Map()) : stringOutput(entry),
        ) && stringOutput(value.at(-1))
    );
  if (value[0] === 'match')
    return (
      totalValue(value[1], new Map()) &&
      value.filter((_, index) => index >= 3 && index % 2 === 1).every(stringOutput) &&
      stringOutput(value.at(-1))
    );
  return false;
}

function selfContained(value: unknown): boolean {
  if (!isExpression(value) || value[0] === 'literal') return true;
  if (value[0] === 'var' || value[0] === 'let' || value[0] === 'zoom') return false;
  return value.slice(1).every(selfContained);
}

function visit(value: unknown[], transform: (node: unknown[]) => unknown[]): unknown[] {
  if (!isExpression(value) || value[0] === 'literal') return value;
  const replaced = transform(value);
  if (replaced !== value) return replaced;
  let changed = false;
  const children = value.map((entry, index) => {
    if (value[0] === 'match' && index >= 2 && index < value.length - 1 && index % 2 === 0)
      return entry;
    const child = isExpression(entry) ? visit(entry, transform) : entry;
    changed ||= child !== entry;
    return child;
  });
  return changed ? children : value;
}

export function compactTileflowLayer<T extends Record<string, unknown>>(layer: T): T {
  const result = {...layer};
  for (const group of ['paint', 'layout'] as const) {
    const properties = layer[group];
    if (properties && typeof properties === 'object' && !Array.isArray(properties))
      Object.assign(result, {
        [group]: Object.fromEntries(
          Object.entries(properties).map(([key, value]) => [
            key,
            // Asset discovery enumerates these outputs before resource preparation. Keep
            // their branches visible instead of hiding an image/font choice in a binding.
            /(?:image|pattern|font)$/u.test(key)
              ? compactTileflowExpression(value)
              : shareExpressions(compactTileflowExpression(value)),
          ]),
        ),
      });
  }
  return result;
}
