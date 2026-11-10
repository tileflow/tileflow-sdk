import {isColorProgramMarker} from '../color-program';
import {isMapLibreExpressionOperator} from './expression-operators';

type Scope = ReadonlyMap<string, {value: unknown; scope: Scope}>;

/** Compact generated expressions without changing literal data or discarding fallible guards. */
export function compactTileflowExpression(value: unknown, scope: Scope = new Map()): unknown {
  if (isColorProgramMarker(value)) return value;
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
    const decisive = node[0] === 'any';
    const operands = node
      .slice(1)
      .flatMap((entry) =>
        Array.isArray(entry) && entry[0] === node[0] ? entry.slice(1) : [entry],
      );
    // Operands are evaluated in order, so a decisive literal also skips every later operand.
    const settled = operands.indexOf(decisive);
    const remaining = (settled < 0 ? operands : operands.slice(0, settled)).filter(
      (entry) => entry !== !decisive,
    );
    if (settled >= 0 && remaining.length === 0) return decisive;
    if (settled < 0 && remaining.length === 0) return !decisive;
    if (settled >= 0) return [node[0], ...remaining, decisive];
    return remaining.length === 1 ? remaining[0] : [node[0], ...remaining];
  }
  if (node[0] === '!' && typeof node[1] === 'boolean') return !node[1];
  if (node[0] === 'case') {
    // A literal condition decides its branch statically: false never matches, and true
    // makes its output the result for every feature that reaches it.
    for (let index = 1; index < node.length - 1;) {
      if (node[index] === false) node.splice(index, 2);
      else if (node[index] === true) node.splice(index, node.length - index, node[index + 1]);
      else index += 2;
    }
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

/**
 * Compacts a layer's paint and layout expressions. Feature tests that the layer filter already
 * settles are folded first: MapLibre only evaluates these properties for features that pass the
 * filter. Besides shrinking the style, this keeps a property that becomes camera-only from being
 * evaluated at each tile's zoom, which pitched views mix across the screen.
 */
export function compactTileflowLayer<T extends Record<string, unknown>>(layer: T): T {
  return shareLayerExpressions(compactLayerExpressions(layer));
}

/**
 * Compacts a layer like {@link compactTileflowLayer}, and splits a line layer whose width, gap or
 * offset depends on both zoom and a discrete feature test into one layer per outcome.
 *
 * MapLibre evaluates such a property at each tile's zoom and the next, so a tilted view, which
 * draws tiles several zooms apart, would draw one road at different widths where tile zooms
 * meet. Each split layer selects its features in its filter and keeps a camera-only width. The
 * layer that keeps the original ID draws the features no test selects; the others go beneath
 * it. A width that depends on continuous data cannot be split and keeps a single layer.
 */
export function compactTileflowLayers<T extends Record<string, unknown>>(
  layer: T,
  /** IDs already in the style; a split layer's new ID avoids them and is added. */
  taken: Set<string> = new Set([String(layer.id)]),
): T[] {
  const parts = splitFeatureWidths(compactLayerExpressions(layer), 0);
  return parts.map(({layer: part, suffixes}) => {
    if (suffixes.length === 0) return shareLayerExpressions({...part, id: layer.id});
    const base = [String(layer.id), ...suffixes].join('-');
    let id = base;
    for (let index = 2; taken.has(id); index += 1) id = `${base}-${index}`;
    taken.add(id);
    return shareLayerExpressions({...part, id});
  });
}

const maximumWidthSplits = 3;
const widthProperties = ['line-width', 'line-gap-width', 'line-offset'] as const;

function splitFeatureWidths<T extends Record<string, unknown>>(
  layer: T,
  depth: number,
): Array<{layer: T; suffixes: string[]}> {
  const whole = [{layer, suffixes: []}];
  if (layer.type !== 'line' || !widthProperties.some((key) => composite(paintOf(layer)[key])))
    return whole;
  const test = depth < maximumWidthSplits ? widthTest(layer) : undefined;
  if (!test) return whole;
  const part = (outcome: boolean) =>
    compactLayerExpressions({
      ...layer,
      filter: [
        'all',
        ...(layer.filter === undefined ? [] : [layer.filter]),
        outcome ? test.condition : ['!', test.condition],
      ],
      ...(layer.paint === undefined ? {} : {paint: settle(layer.paint, test.condition, outcome)}),
      ...(layer.layout === undefined
        ? {}
        : {layout: settle(layer.layout, test.condition, outcome)}),
    }) as T;
  const parts = [
    ...splitFeatureWidths(part(true), depth + 1).map((entry) => ({
      ...entry,
      suffixes: [test.name, ...entry.suffixes],
    })),
    ...splitFeatureWidths(part(false), depth + 1),
  ];
  // Splitting only pays when every resulting width is camera-only.
  return parts.some(({layer: entry}) =>
    widthProperties.some((key) => composite(paintOf(entry)[key])),
  )
    ? whole
    : parts;
}

function paintOf(layer: Record<string, unknown>): Record<string, unknown> {
  const paint = layer.paint;
  return paint && typeof paint === 'object' ? (paint as Record<string, unknown>) : {};
}

/** Whether a value depends on both the camera zoom and the feature. */
function composite(value: unknown): boolean {
  return readsZoom(value) && readsFeature(value);
}

function readsZoom(value: unknown): boolean {
  if (!Array.isArray(value) || value[0] === 'literal') return false;
  return isZoom(value) || value.some(readsZoom);
}

function readsFeature(value: unknown): boolean {
  if (!Array.isArray(value) || value[0] === 'literal') return false;
  if (
    ['get', 'has', 'properties', 'geometry-type', 'id', 'feature-state', 'line-progress'].includes(
      value[0] as string,
    )
  )
    return true;
  return value.some(readsFeature);
}

/** The first discrete feature test a zoom-dependent width branches on. */
function widthTest(
  layer: Record<string, unknown>,
): {condition: unknown[]; name: string} | undefined {
  let found: {condition: unknown[]; name: string} | undefined;
  const testable = (condition: unknown): condition is unknown[] =>
    Array.isArray(condition) &&
    readsFeature(condition) &&
    !readsZoom(condition) &&
    !JSON.stringify(condition).includes('"var"') &&
    !JSON.stringify(condition).includes('"feature-state"');
  const walk = (value: unknown) => {
    if (found || !isExpression(value) || value[0] === 'literal') return;
    if (value[0] === 'case') {
      for (let index = 1; index < value.length - 1 && !found; index += 2) {
        const condition = value[index];
        if (testable(condition)) found = {condition, name: testName(condition)};
      }
    } else if (value[0] === 'match' && value.length >= 5 && featureOperand(value[1])) {
      const labels = Array.isArray(value[2]) ? value[2] : [value[2]];
      const condition = ['match', value[1], labels, true, false];
      found = {condition, name: testName(condition)};
    }
    value.forEach(walk);
  };
  for (const key of widthProperties) {
    const value = paintOf(layer)[key];
    if (composite(value)) walk(value);
    if (found) return found;
  }
  return undefined;
}

/** A short name for a feature test, for the ID of the layer that draws its features. */
function testName(condition: unknown[]): string {
  const slug = (parts: unknown[]) =>
    parts
      .map((part) =>
        String(part)
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, '-'),
      )
      .join('-')
      .replace(/^-+|-+$/gu, '') || 'variant';
  const comparison = comparedOperand(condition);
  if (comparison && condition[0] === '==') {
    const field = comparison.operand[0] === 'get' ? comparison.operand[1] : 'geometry';
    return slug(comparison.value === true ? [field] : [field, comparison.value]);
  }
  const membership = matchedOperand(condition);
  if (membership && membership.included) {
    const field = membership.operand[0] === 'get' ? membership.operand[1] : 'geometry';
    return slug([field, ...membership.labels]);
  }
  // Otherwise the first field the test reads.
  const field = JSON.stringify(condition).match(/\["get","([^"]+)"\]/u)?.[1];
  return field === undefined ? 'variant' : slug([field]);
}

/** Replaces a feature test that a layer's filter now settles with its outcome. */
function settle(value: unknown, condition: unknown[], outcome: boolean): unknown {
  if (value === undefined) return value;
  const text = JSON.stringify(condition);
  const replace = (entry: unknown): unknown => {
    if (isColorProgramMarker(entry) || !Array.isArray(entry)) return entry;
    if (JSON.stringify(entry) === text) return outcome;
    if (entry[0] === 'literal') return entry;
    return entry.map(replace);
  };
  if (value && typeof value === 'object' && !Array.isArray(value))
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replace(entry)]));
  return replace(value);
}

function compactLayerExpressions<T extends Record<string, unknown>>(layer: T): T {
  const result = {...layer};
  const facts = filterFacts(layer.filter);
  const domain = zoomDomain(layer);
  for (const group of ['paint', 'layout'] as const) {
    const properties = layer[group];
    if (properties && typeof properties === 'object' && !Array.isArray(properties))
      Object.assign(result, {
        [group]: Object.fromEntries(
          Object.entries(properties).map(([key, value]) => [
            key,
            compactTileflowExpression(clipZoomDomain(applyFilterFacts(value, facts), domain)),
          ]),
        ),
      });
  }
  return result;
}

function shareLayerExpressions<T extends Record<string, unknown>>(layer: T): T {
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
            /(?:image|pattern|font)$/u.test(key) ? value : shareExpressions(value),
          ]),
        ),
      });
  }
  return result;
}

type ZoomDomain = {min: number; max: number};

/**
 * The zooms at which MapLibre evaluates the layer: the renderer only draws it from `minzoom` to
 * `maxzoom`, and the worker builds its features in tiles from `floor(minzoom)`.
 */
function zoomDomain(layer: Record<string, unknown>): ZoomDomain {
  const min = typeof layer.minzoom === 'number' ? Math.floor(layer.minzoom) : 0;
  const max = typeof layer.maxzoom === 'number' ? Math.ceil(layer.maxzoom) : Infinity;
  return {min, max};
}

/**
 * Drops zoom stops outside the zooms the layer is drawn at, keeping the stops that bound it.
 * A zoom curve that is constant over that domain then disappears, which keeps a feature-dependent
 * value from being evaluated at each tile's zoom in pitched views.
 */
function clipZoomDomain(value: unknown, domain: ZoomDomain): unknown {
  if (isColorProgramMarker(value)) return value;
  if (!isExpression(value) || value[0] === 'literal') return value;
  if (value[0] === 'let') {
    const body = clipZoomDomain(value.at(-1), domain);
    return body === value.at(-1) ? value : [...value.slice(0, -1), body];
  }
  if (!isZoom(value[value[0] === 'interpolate' ? 2 : 1])) return value;
  if (value[0] === 'interpolate') {
    const stops: Array<[number, unknown]> = [];
    for (let index = 3; index < value.length - 1; index += 2) {
      if (typeof value[index] !== 'number') return value;
      stops.push([value[index] as number, value[index + 1]]);
    }
    let first = 0;
    while (first + 1 < stops.length && stops[first + 1]![0] <= domain.min) first += 1;
    let last = stops.length - 1;
    while (last - 1 >= first && stops[last - 1]![0] >= domain.max) last -= 1;
    const kept = stops.slice(first, last + 1);
    if (kept.length === 1) return kept[0]![1];
    if (kept.length === stops.length) return value;
    return [...value.slice(0, 3), ...kept.flat()];
  }
  if (value[0] === 'step') {
    let base = value[2];
    const stops: Array<[number, unknown]> = [];
    for (let index = 3; index < value.length - 1; index += 2) {
      const stop = value[index];
      if (typeof stop !== 'number') return value;
      if (stop <= domain.min) base = value[index + 1];
      else if (stop < domain.max) stops.push([stop, value[index + 1]]);
    }
    if (stops.length === 0) return base;
    if (stops.length * 2 + 3 === value.length) return value;
    return ['step', value[1], base, ...stops.flat()];
  }
  return value;
}

function isZoom(value: unknown): boolean {
  return Array.isArray(value) && value[0] === 'zoom' && value.length === 1;
}

type FilterFact = {is?: Primitive; isNot: Primitive[]; oneOf?: Primitive[]};
type Primitive = string | number | boolean | null;

/**
 * Feature tests every rendered feature satisfies: the filter's top-level conjuncts, and what
 * every branch of a top-level disjunction establishes, such as a merged cohort of ramps.
 */
function filterFacts(filter: unknown): Map<string, FilterFact> {
  const facts = new Map<string, FilterFact>();
  const add = (key: string, fact: FilterFact) => {
    const entry = facts.get(key);
    if (!entry) return void facts.set(key, {...fact, isNot: [...fact.isNot]});
    entry.is ??= fact.is;
    entry.isNot.push(...fact.isNot);
    if (fact.oneOf)
      entry.oneOf = entry.oneOf ? entry.oneOf.filter((v) => fact.oneOf!.includes(v)) : fact.oneOf;
  };
  const conjuncts = (value: unknown): unknown[] =>
    Array.isArray(value) && value[0] === 'all' ? value.slice(1).flatMap(conjuncts) : [value];
  for (const conjunct of conjuncts(filter)) {
    if (!Array.isArray(conjunct)) continue;
    if (conjunct[0] === 'any' && conjunct.length > 1) {
      for (const [key, fact] of commonFacts(conjunct.slice(1).map(filterFacts))) add(key, fact);
      continue;
    }
    const negated = conjunct[0] === '!' && Array.isArray(conjunct[1]);
    const test = (negated ? conjunct[1] : conjunct) as unknown[];
    const comparison = comparedOperand(test);
    if (comparison) {
      const equal = (test[0] === '==') !== negated;
      add(
        JSON.stringify(comparison.operand),
        equal ? {is: comparison.value, isNot: []} : {isNot: [comparison.value]},
      );
      continue;
    }
    const membership = matchedOperand(test);
    if (!membership) continue;
    const included = membership.included !== negated;
    add(
      JSON.stringify(membership.operand),
      included ? {isNot: [], oneOf: membership.labels} : {isNot: membership.labels},
    );
  }
  return facts;
}

/** What holds in every branch: the union of possible values, and values every branch excludes. */
function commonFacts(branches: ReadonlyMap<string, FilterFact>[]): Map<string, FilterFact> {
  const common = new Map<string, FilterFact>();
  for (const key of branches[0]?.keys() ?? []) {
    const facts = branches.map((branch) => branch.get(key));
    if (facts.some((fact) => fact === undefined)) continue;
    const known = facts as FilterFact[];
    const isNot = known[0]!.isNot.filter((value) => known.every((f) => f.isNot.includes(value)));
    const candidates = known.map((fact) => (fact.is !== undefined ? [fact.is] : fact.oneOf));
    const oneOf = candidates.every((values) => values !== undefined)
      ? [...new Set(candidates.flat() as Primitive[])]
      : undefined;
    if (oneOf?.length === 1) common.set(key, {is: oneOf[0], isNot});
    else if (oneOf || isNot.length) common.set(key, {isNot, ...(oneOf ? {oneOf} : {})});
  }
  return common;
}

/** Folds feature tests in `value` that the layer filter already decides. */
function applyFilterFacts(value: unknown, facts: ReadonlyMap<string, FilterFact>): unknown {
  if (facts.size === 0 || isColorProgramMarker(value)) return value;
  if (!isExpression(value) || value[0] === 'literal') return value;
  const node = value.map((entry, index) =>
    index === 0 ||
    (value[0] === 'match' && index >= 2 && index < value.length - 1 && index % 2 === 0)
      ? entry
      : applyFilterFacts(entry, facts),
  );
  const comparison = comparedOperand(node);
  if (comparison) {
    const known = facts.get(JSON.stringify(comparison.operand));
    const equal = known ? knownEquality(known, comparison.value) : undefined;
    if (equal !== undefined) return node[0] === '==' ? equal : !equal;
    return node;
  }
  if (node[0] === 'match' && node.length >= 5 && featureOperand(node[1])) {
    const known = facts.get(JSON.stringify(node[1]));
    if (!known) return node;
    const candidates = known.is !== undefined ? [known.is] : known.oneOf;
    if (!candidates) {
      // Branches whose every label the filter excludes can never be selected.
      const kept = [node[0], node[1]];
      for (let index = 2; index < node.length - 1; index += 2) {
        const labels = (Array.isArray(node[index]) ? node[index] : [node[index]]) as Primitive[];
        if (!labels.every((label) => known.isNot.includes(label)))
          kept.push(node[index], node[index + 1]);
      }
      if (kept.length === node.length - 1) return node;
      return kept.length === 2 ? node.at(-1) : [...kept, node.at(-1)];
    }
    const outputs = new Set<string>();
    let selected: unknown;
    for (const candidate of candidates) {
      let output = node.at(-1);
      for (let index = 2; index < node.length - 1; index += 2) {
        const labels = Array.isArray(node[index]) ? node[index] : [node[index]];
        if ((labels as unknown[]).includes(candidate)) {
          output = node[index + 1];
          break;
        }
      }
      outputs.add(JSON.stringify(output));
      selected = output;
    }
    // Several possible inputs select a branch statically only when they share its output.
    return outputs.size === 1 ? selected : node;
  }
  return node;
}

function knownEquality(known: FilterFact, value: Primitive): boolean | undefined {
  if (known.is !== undefined) return known.is === value;
  if (known.isNot.includes(value)) return false;
  if (known.oneOf && !known.oneOf.includes(value)) return false;
  if (known.oneOf?.length === 1 && known.oneOf[0] === value) return true;
  return undefined;
}

function comparedOperand(node: unknown[]): {operand: unknown[]; value: Primitive} | undefined {
  if ((node[0] !== '==' && node[0] !== '!=') || node.length !== 3) return undefined;
  if (featureOperand(node[1]) && isPrimitive(node[2]))
    return {operand: node[1] as unknown[], value: node[2]};
  if (featureOperand(node[2]) && isPrimitive(node[1]))
    return {operand: node[2] as unknown[], value: node[1]};
  return undefined;
}

function matchedOperand(
  node: unknown[],
): {operand: unknown[]; labels: Primitive[]; included: boolean} | undefined {
  if (node[0] !== 'match' || node.length !== 5 || !featureOperand(node[1])) return undefined;
  if (typeof node[3] !== 'boolean' || node[4] !== !node[3]) return undefined;
  const labels = Array.isArray(node[2]) ? node[2] : [node[2]];
  if (!labels.every((label) => typeof label === 'string' || typeof label === 'number'))
    return undefined;
  return {operand: node[1] as unknown[], labels: labels as Primitive[], included: node[3]};
}

/** A feature value whose identity is fixed for one feature: a property or its geometry type. */
function featureOperand(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value[0] === 'get') return value.length === 2 && typeof value[1] === 'string';
  return value[0] === 'geometry-type' && value.length === 1;
}

function isPrimitive(value: unknown): value is Primitive {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}
