/** Finite decision lowering for native-v1. This module performs no I/O or style compilation. */
export const nativeLoweringVersion = 'native-lowering-v1' as const;
export const nativeLoweringLimits = Object.freeze({
  maximumDecisionDepth: 16,
  maximumDecisionNodes: 512,
  maximumPropertyBranches: 16,
  maximumPathsPerProperty: 64,
  maximumLayerVariants: 32,
  maximumZoomIntervals: 32,
  maximumLayers: 4096,
  maximumDashLength: 64,
});

type JsonObject = Record<string, unknown>;
type Predicate = boolean | unknown[];
type Property = 'line-cap' | 'line-dasharray';
type Leaf = string | number[];
type Tree =
  | {kind: 'leaf'; value: Leaf}
  | {kind: 'case'; arms: {when: unknown; value: Tree}[]; fallback: Tree}
  | {kind: 'step'; input: unknown; fallback: Tree; stops: {at: number; value: Tree}[]};
type Outcome = {when: Predicate; value: Leaf};
type Variant = {minimum: number; maximum: number; when: Predicate; cap?: Leaf; dash?: Leaf};
export type NativeLayer = JsonObject & {
  id: string;
  type: string;
  layout?: JsonObject;
  paint?: JsonObject;
  minzoom?: number;
  maxzoom?: number;
  filter?: unknown;
};
export type NativeLayerTransformation = {
  inputLayer: number;
  outputStart: number;
  outputCount: number;
  properties: Property[];
};
export type NativeProjectionTransformation = 'none' | 'mercator-to-implicit' | 'globe-to-mercator';
export type NativeStyleRepresentation = {
  style: JsonObject & {layers: NativeLayer[]};
  projection: NativeProjectionTransformation;
  layers: NativeLayerTransformation[];
  inputLayers: number;
  outputLayers: number;
};

/** Internal failure translated by the artifact adapter to the existing native diagnostic envelope. */
export class NativeLoweringError extends Error {
  constructor(readonly path: string, readonly reason: 'shape' | 'budget' = 'shape') {
    super(reason === 'budget' ? 'Native decision lowering exceeds its finite budget.' :
      'This native decision cannot be lowered without changing its meaning.');
    this.name = 'NativeLoweringError';
  }
}

function fail(path: string, reason: 'shape' | 'budget' = 'shape'): never {
  throw new NativeLoweringError(path, reason);
}
function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function operation(value: unknown, name: string, length?: number): value is unknown[] {
  return Array.isArray(value) && value[0] === name && (length === undefined || value.length === length);
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function key(value: unknown): string {
  return JSON.stringify(value);
}
function negate(value: Predicate): Predicate {
  return typeof value === 'boolean' ? !value : operation(value, '!', 2) ? value[1] as Predicate : ['!', value];
}
function combine(operator: 'all' | 'any', values: Predicate[]): Predicate {
  const identity = operator === 'all';
  const result: Predicate[] = [];
  const seen = new Set<string>();
  for (const value of values.flatMap((item) => operation(item, operator) ? item.slice(1) as Predicate[] : [item])) {
    if (value === identity) continue;
    if (value === !identity || seen.has(key(negate(value)))) return !identity;
    const serialized = key(value);
    if (!seen.has(serialized)) {seen.add(serialized); result.push(value);}
  }
  return result.length === 0 ? identity : result.length === 1 ? result[0]! : [operator, ...result];
}

/** Predicates admitted by Decisions are total; these identities preserve first-match results. */
function choose(when: Predicate, yes: Predicate, no: Predicate): Predicate {
  if (when === true) return yes;
  if (when === false) return no;
  if (key(yes) === key(no)) return yes;
  if (yes === true) return combine('any', [when, no]);
  if (yes === false) return combine('all', [negate(when), no]);
  if (no === true) return combine('any', [negate(when), yes]);
  if (no === false) return combine('all', [when, yes]);
  return ['case', when, yes, no];
}

/** Keep multi-arm decisions flat: nested binary tests would consume the output depth budget. */
function decision(arms: {when: Predicate; value: Predicate}[], fallback: Predicate): Predicate {
  const active: {when: Predicate; value: Predicate}[] = [];
  for (const arm of arms) {
    if (arm.when === false) continue;
    if (arm.when === true) {fallback = arm.value; break;}
    const previous = active.at(-1);
    if (previous && key(previous.value) === key(arm.value)) {
      previous.when = combine('any', [previous.when, arm.when]);
    } else active.push({...arm});
  }
  while (active.length && key(active.at(-1)!.value) === key(fallback)) active.pop();
  if (!active.length) return fallback;
  if (active.length === 1) return choose(active[0]!.when, active[0]!.value, fallback);
  return ['case', ...active.flatMap(({when, value}) => [when, value]), fallback];
}

/** Both layout camera values and line-dasharray use integer zoom evaluation in the pinned spec. */
class Decisions {
  private visited = 0;
  readonly cuts = new Set<number>();
  constructor(private readonly path: string, private readonly vector: boolean) {}

  private tick(depth: number): void {
    if (++this.visited > nativeLoweringLimits.maximumDecisionNodes || depth > nativeLoweringLimits.maximumDecisionDepth) {
      fail(this.path, 'budget');
    }
  }

  tree(value: unknown, property: Property, depth = 0): Tree {
    this.tick(depth);
    const leaf = operation(value, 'literal', 2) ? value[1] : value;
    if (property === 'line-cap' && typeof leaf === 'string' && ['butt', 'round', 'square'].includes(leaf)) {
      return {kind: 'leaf', value: leaf};
    }
    if (property === 'line-dasharray' && Array.isArray(leaf) && leaf.length > 0 &&
      leaf.length <= nativeLoweringLimits.maximumDashLength && leaf.every((item) => finite(item) && item >= 0)) {
      return {kind: 'leaf', value: [...leaf] as number[]};
    }
    if (operation(value, 'case') && value.length >= 4 && value.length % 2 === 0) {
      const arms: {when: unknown; value: Tree}[] = [];
      for (let index = 1; index < value.length - 1; index += 2) {
        const when = this.predicate(value[index], depth + 1);
        arms.push({when, value: this.tree(value[index + 1], property, depth + 1)});
      }
      return {kind: 'case', arms, fallback: this.tree(value.at(-1), property, depth + 1)};
    }
    if (operation(value, 'match') && value.length >= 5 && value.length % 2 === 1) {
      this.scalar(value[1], depth + 1);
      const labels = this.matchLabels(value, depth + 1);
      return {kind: 'case', arms: labels.map((when, index) => ({
        when, value: this.tree(value[index * 2 + 3], property, depth + 1),
      })), fallback: this.tree(value.at(-1), property, depth + 1)};
    }
    if (operation(value, 'step') && value.length >= 5 && value.length % 2 === 1) {
      if (this.scalar(value[1], depth + 1) !== 'number') fail(this.path);
      const stops: {at: number; value: Tree}[] = [];
      let previous = -Infinity;
      for (let index = 3; index < value.length; index += 2) {
        const at = value[index];
        if (!finite(at) || at <= previous) fail(this.path);
        previous = at;
        if (operation(value[1], 'zoom', 1)) this.cuts.add(Math.ceil(at));
        stops.push({at, value: this.tree(value[index + 1], property, depth + 1)});
      }
      return {kind: 'step', input: value[1], fallback: this.tree(value[2], property, depth + 1), stops};
    }
    return fail(this.path);
  }

  private scalar(value: unknown, depth: number): 'number' | 'scalar' {
    this.tick(depth);
    if (finite(value)) return 'number';
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return 'scalar';
    if (operation(value, 'zoom', 1)) return 'number';
    // MVT feature properties are scalar. Unchecked GeoJSON objects cannot satisfy this proof.
    if (operation(value, 'get', 2) && typeof value[1] === 'string' && this.vector) return 'scalar';
    if (operation(value, 'geometry-type', 1) || (operation(value, 'id', 1) && this.vector)) return 'scalar';
    if (operation(value, 'to-string', 2)) {
      if (operation(value[1], 'zoom', 1)) fail(this.path);
      this.scalar(value[1], depth + 1);
      return 'scalar';
    }
    if (operation(value, 'coalesce') && value.length >= 3) {
      for (const child of value.slice(1)) {
        if (operation(child, 'zoom', 1)) fail(this.path);
        this.scalar(child, depth + 1);
      }
      return 'scalar';
    }
    if (operation(value, 'to-number', 3) && finite(value[2])) {
      if (operation(value[1], 'zoom', 1)) fail(this.path);
      this.scalar(value[1], depth + 1);
      return 'number';
    }
    return fail(this.path);
  }

  private matchLabels(value: unknown[], depth: number): Predicate[] {
    const seen = new Set<string>();
    let labelType: string | undefined;
    const predicates: Predicate[] = [];
    for (let index = 2; index < value.length - 1; index += 2) {
      const labels = Array.isArray(value[index]) ? value[index] as unknown[] : [value[index]];
      if (!labels.length) fail(this.path);
      const terms: Predicate[] = [];
      for (const label of labels) {
        this.tick(depth);
        if (!(typeof label === 'string' || (finite(label) && Number.isInteger(label)))) fail(this.path);
        if (labelType !== undefined && labelType !== typeof label) fail(this.path);
        labelType = typeof label;
        const encoded = key(label);
        if (seen.has(encoded)) fail(this.path);
        seen.add(encoded);
        if (operation(value[1], 'zoom', 1)) {
          if (!finite(label)) fail(this.path);
          this.cuts.add(label); this.cuts.add(label + 1);
        }
        terms.push(['==', value[1], label]);
      }
      predicates.push(combine('any', terms));
    }
    return predicates;
  }

  private predicate(value: unknown, depth: number): Predicate {
    this.tick(depth);
    if (typeof value === 'boolean') return value;
    if (operation(value, 'literal', 2) && typeof value[1] === 'boolean') return value[1];
    if (operation(value, 'all') || operation(value, 'any')) {
      return combine(value[0] as 'all' | 'any', value.slice(1).map((child) => this.predicate(child, depth + 1)));
    }
    if (operation(value, '!', 2)) return negate(this.predicate(value[1], depth + 1));
    if (operation(value, 'has', 2) && typeof value[1] === 'string') return value;
    if (operation(value, 'match') && value.length >= 5 && value.length % 2 === 1) {
      this.scalar(value[1], depth + 1);
      const conditions = this.matchLabels(value, depth + 1);
      let remaining: Predicate = true;
      const terms: Predicate[] = [];
      for (const [index, condition] of conditions.entries()) {
        terms.push(combine('all', [condition, this.predicate(value[index * 2 + 3], depth + 1)]));
        remaining = combine('all', [remaining, negate(condition)]);
      }
      terms.push(combine('all', [remaining, this.predicate(value.at(-1), depth + 1)]));
      return combine('any', terms);
    }
    if (operation(value, 'case') && value.length >= 4 && value.length % 2 === 0) {
      let remaining: Predicate = true;
      const terms: Predicate[] = [];
      for (let index = 1; index < value.length - 1; index += 2) {
        const condition = this.predicate(value[index], depth + 1);
        terms.push(combine('all', [remaining, condition, this.predicate(value[index + 1], depth + 1)]));
        remaining = combine('all', [remaining, negate(condition)]);
      }
      terms.push(combine('all', [remaining, this.predicate(value.at(-1), depth + 1)]));
      return combine('any', terms);
    }
    if (operation(value, 'step') && value.length >= 5 && value.length % 2 === 1) {
      if (this.scalar(value[1], depth + 1) !== 'number') fail(this.path);
      let previous = -Infinity;
      let remaining: Predicate = true;
      let output = this.predicate(value[2], depth + 1);
      const terms: Predicate[] = [];
      for (let index = 3; index < value.length; index += 2) {
        const at = value[index];
        if (!finite(at) || at <= previous) fail(this.path);
        previous = at;
        if (operation(value[1], 'zoom', 1)) this.cuts.add(Math.ceil(at));
        const below: Predicate = ['<', value[1], at];
        terms.push(combine('all', [remaining, below, output]));
        remaining = combine('all', [remaining, negate(below)]);
        output = this.predicate(value[index + 1], depth + 1);
      }
      terms.push(combine('all', [remaining, output]));
      return combine('any', terms);
    }
    if (operation(value, 'in', 3) && operation(value[2], 'literal', 2) && Array.isArray(value[2][1])) {
      this.scalar(value[1], depth + 1);
      if (operation(value[1], 'zoom', 1)) fail(this.path);
      for (const item of value[2][1]) {
        this.tick(depth + 1);
        if (!(item === null || typeof item === 'boolean' || typeof item === 'string' || finite(item))) fail(this.path);
      }
      return value;
    }
    if (Array.isArray(value) && value.length === 3 && ['==', '!=', '<', '<=', '>', '>='].includes(String(value[0]))) {
      const left = this.scalar(value[1], depth + 1);
      const right = this.scalar(value[2], depth + 1);
      if (!['==', '!='].includes(String(value[0])) && (left !== 'number' || right !== 'number')) fail(this.path);
      if (operation(value[1], 'zoom', 1) || operation(value[2], 'zoom', 1)) {
        const constant = operation(value[1], 'zoom', 1) ? value[2] : value[1];
        if (!finite(constant)) fail(this.path);
        this.cuts.add(Math.ceil(constant));
        this.cuts.add(Math.floor(constant) + 1);
      }
      return value;
    }
    return fail(this.path);
  }

  private atZoom(value: unknown, zoom: number): Predicate {
    if (typeof value === 'boolean') return value;
    const expr = value as unknown[];
    if (expr[0] === 'all' || expr[0] === 'any') return combine(expr[0], expr.slice(1).map((child) => this.atZoom(child, zoom)));
    if (expr[0] === '!') return negate(this.atZoom(expr[1], zoom));
    if (operation(expr[1], 'zoom', 1) || operation(expr[2], 'zoom', 1)) {
      const left = operation(expr[1], 'zoom', 1) ? zoom : expr[1] as number;
      const right = operation(expr[2], 'zoom', 1) ? zoom : expr[2] as number;
      switch (expr[0]) {
        case '==': return left === right;
        case '!=': return left !== right;
        case '<': return left < right;
        case '<=': return left <= right;
        case '>': return left > right;
        case '>=': return left >= right;
      }
    }
    return expr;
  }

  outcomes(tree: Tree, zoom: number): Outcome[] {
    const leaves: Outcome[] = [];
    const walk = (node: Tree, guard: Predicate): void => {
      if (guard === false) return;
      if (node.kind === 'leaf') {
        leaves.push({when: guard, value: node.value});
        if (leaves.length > nativeLoweringLimits.maximumPathsPerProperty) fail(this.path, 'budget');
      } else if (node.kind === 'case') {
        let remaining: Predicate = guard;
        for (const arm of node.arms) {
          const condition = this.atZoom(arm.when, zoom);
          walk(arm.value, combine('all', [remaining, condition]));
          remaining = combine('all', [remaining, negate(condition)]);
        }
        walk(node.fallback, remaining);
      } else if (operation(node.input, 'zoom', 1)) {
        let selected = node.fallback;
        for (const stop of node.stops) {if (zoom < stop.at) break; selected = stop.value;}
        walk(selected, guard);
      } else {
        let previous = node.fallback;
        let remaining: Predicate = guard;
        for (const stop of node.stops) {
          const below: Predicate = ['<', node.input, stop.at];
          walk(previous, combine('all', [remaining, below]));
          remaining = combine('all', [remaining, negate(below)]);
          previous = stop.value;
        }
        walk(previous, remaining);
      }
    };
    walk(tree, true);
    const grouped = new Map<string, Outcome>();
    for (const outcome of leaves) {
      const id = key(outcome.value);
      if (!grouped.has(id)) grouped.set(id, {when: true, value: outcome.value});
    }
    if (grouped.size > nativeLoweringLimits.maximumPropertyBranches) fail(this.path, 'budget');
    // Keep the same outcome order and path budget, but do not serialize a DNF containing
    // every earlier arm's negated guard. Each outcome is a compact boolean decision tree.
    return [...grouped.entries()].map(([id, outcome]) => ({
      value: outcome.value, when: this.accepts(tree, id, zoom),
    }));
  }

  private accepts(tree: Tree, outcome: string, zoom: number): Predicate {
    if (tree.kind === 'leaf') return key(tree.value) === outcome;
    if (tree.kind === 'case') {
      return decision(tree.arms.map((arm) => ({
        when: this.atZoom(arm.when, zoom), value: this.accepts(arm.value, outcome, zoom),
      })), this.accepts(tree.fallback, outcome, zoom));
    }
    if (operation(tree.input, 'zoom', 1)) {
      let selected = tree.fallback;
      for (const stop of tree.stops) {if (zoom < stop.at) break; selected = stop.value;}
      return this.accepts(selected, outcome, zoom);
    }
    return decision(tree.stops.map((stop, index) => ({
      when: ['<', tree.input, stop.at],
      value: this.accepts(index === 0 ? tree.fallback : tree.stops[index - 1]!.value, outcome, zoom),
    })), this.accepts(tree.stops.at(-1)!.value, outcome, zoom));
  }

}

function isConstant(value: unknown, property: Property): boolean {
  return value === undefined || (property === 'line-cap' ? typeof value === 'string' :
    Array.isArray(value) && value.every((item) => typeof item === 'number'));
}

function lowerLayer(layer: NativeLayer, index: number, vector: boolean): {variants: Variant[]; properties: Property[]} | undefined {
  if (layer.type !== 'line') return;
  const properties: Property[] = [];
  let cap: {decisions: Decisions; tree: Tree} | undefined;
  let dash: {decisions: Decisions; tree: Tree} | undefined;
  for (const [group, property] of [['layout', 'line-cap'], ['paint', 'line-dasharray']] as const) {
    const value = layer[group]?.[property];
    if (isConstant(value, property)) continue;
    const decisions = new Decisions(`/layers/${index}/${group}/${property}`, vector);
    const tree = decisions.tree(value, property);
    properties.push(property);
    if (property === 'line-cap') cap = {decisions, tree}; else dash = {decisions, tree};
  }
  if (!properties.length) return;
  const minimum = layer.minzoom ?? 0;
  const maximum = layer.maxzoom ?? 24;
  if (!finite(minimum) || !finite(maximum) || minimum < 0 || maximum > 24 || minimum >= maximum) {
    fail(`/layers/${index}/minzoom`);
  }
  const cuts = [...new Set([minimum, maximum, ...[...(cap?.decisions.cuts ?? []), ...(dash?.decisions.cuts ?? [])]
    .filter((cut) => cut > minimum && cut < maximum)])].sort((a, b) => a - b);
  if (cuts.length - 1 > nativeLoweringLimits.maximumZoomIntervals) fail(`/layers/${index}`, 'budget');
  const variants: Variant[] = [];
  const tails = new Map<string, Variant>();
  for (let part = 0; part < cuts.length - 1; part++) {
    const low = cuts[part]!;
    const high = cuts[part + 1]!;
    const caps = cap ? cap.decisions.outcomes(cap.tree, Math.floor(low)) : [{when: true as const, value: undefined}];
    const dashes = dash ? dash.decisions.outcomes(dash.tree, Math.floor(low)) : [{when: true as const, value: undefined}];
    for (const c of caps) for (const d of dashes) {
      const when = combine('all', [c.when, d.when]);
      if (when === false) continue;
      const signature = key([when, c.value, d.value]);
      const tail = tails.get(signature);
      if (tail && tail.maximum === low) {tail.maximum = high; continue;}
      const variant = {minimum: low, maximum: high, when,
        ...(cap ? {cap: c.value!} : {}), ...(dash ? {dash: d.value!} : {})};
      variants.push(variant);
      tails.set(signature, variant);
      if (variants.length > nativeLoweringLimits.maximumLayerVariants) fail(`/layers/${index}`, 'budget');
    }
  }
  return {variants, properties};
}

/** Filters supplied here must be expressions. The production adapter uses the pinned legacy converter. */
export function lowerNativeStyleRepresentation(
  input: JsonObject,
  normalizeFilter: (filter: unknown) => unknown = (filter) => filter,
): NativeStyleRepresentation {
  if (!Array.isArray(input.layers) || input.layers.length > nativeLoweringLimits.maximumLayers) fail('/layers', 'budget');
  const originalLayers = input.layers as NativeLayer[];
  const reserved = new Set<string>();
  for (const [index, layer] of originalLayers.entries()) {
    if (!object(layer) || typeof layer.id !== 'string' || reserved.has(layer.id)) fail(`/layers/${index}/id`);
    reserved.add(layer.id);
  }
  let projection: NativeProjectionTransformation = 'none';
  if (input.projection !== undefined) {
    if (!object(input.projection) || Object.keys(input.projection).length !== 1 ||
      typeof input.projection.type !== 'string' || !['globe', 'mercator'].includes(input.projection.type)) fail('/projection');
    projection = input.projection.type === 'globe' ? 'globe-to-mercator' : 'mercator-to-implicit';
  }
  const layers: NativeLayer[] = [];
  const transformations: NativeLayerTransformation[] = [];
  for (const [index, layer] of originalLayers.entries()) {
    const source = object(input.sources) && typeof layer.source === 'string' ? input.sources[layer.source] : undefined;
    const lowered = lowerLayer(layer, index, object(source) && source.type === 'vector');
    if (!lowered) {layers.push(layer); continue;}
    if (layers.length + lowered.variants.length + originalLayers.length - index - 1 > nativeLoweringLimits.maximumLayers) {
      fail(`/layers/${index}`, 'budget');
    }
    const originalFilter = layer.filter === undefined ? undefined : normalizeFilter(layer.filter);
    const outputStart = layers.length;
    for (const [branch, variant] of lowered.variants.entries()) {
      const stem = `${layer.id}--native-v1-${branch}`;
      let id = stem;
      let collision = 0;
      while (reserved.has(id)) id = `${stem}-${++collision}`;
      reserved.add(id);
      const next: NativeLayer = {...layer, id};
      if (variant.minimum !== (layer.minzoom ?? 0)) next.minzoom = variant.minimum;
      if (variant.maximum !== (layer.maxzoom ?? 24)) next.maxzoom = variant.maximum;
      if (variant.when !== true) next.filter = originalFilter === undefined ? variant.when : ['all', originalFilter, variant.when];
      if (variant.cap !== undefined) next.layout = {...layer.layout, 'line-cap': variant.cap};
      if (variant.dash !== undefined) next.paint = {...layer.paint, 'line-dasharray': variant.dash};
      layers.push(next);
    }
    transformations.push({inputLayer: index, outputStart, outputCount: lowered.variants.length, properties: lowered.properties});
  }
  const changed = projection !== 'none' || transformations.length > 0;
  const output: JsonObject & {layers: NativeLayer[]} = changed ? {...input, layers} : input as JsonObject & {layers: NativeLayer[]};
  if (changed && projection !== 'none') delete output.projection;
  return {style: output, projection, layers: transformations, inputLayers: originalLayers.length, outputLayers: layers.length};
}
