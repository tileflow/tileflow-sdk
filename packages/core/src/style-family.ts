import {isTileflowThemeName} from './portable-identity-rules';
import type {MapLibreStyle} from './types';

type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
type Reference = {$variant: number};
type ConstantReference = {$constant: number};
export type TileflowFamilyUpdate = readonly [layer: number, property: string];

/** A shared cartography document. Parameter columns are storage identities, not color tokens. */
export type TileflowStyleFamily = Readonly<{
  kind: 'tileflow-style-family';
  version: 1;
  themes: readonly string[];
  template: Json;
  parameters: readonly (readonly Json[])[];
  /** Literal shared subtrees. Entries are never interpreted as references. */
  constants: readonly Json[];
  updates: Readonly<{
    /** False means that this family contains structural alternatives requiring a style change. */
    appearanceOnly: boolean;
    paint: readonly TileflowFamilyUpdate[];
    roots: readonly ('light' | 'sky')[];
  }>;
}>;

export const tileflowStyleFamilyLimits = Object.freeze({
  themes: 64,
  documentBytes: 16 * 1024 * 1024,
  expandedStyleBytes: 8 * 1024 * 1024,
  expandedFamilyBytes: 32 * 1024 * 1024,
  layers: 4096,
  nodes: 500_000,
  depth: 96,
});

/** Factor identical JSON structure and repeated variant columns without guessing token identity. */
export function createTileflowStyleFamily(
  styles: Readonly<Record<string, MapLibreStyle>>,
): TileflowStyleFamily {
  const themes = Object.keys(styles).sort();
  if (
    !themes.length ||
    themes.length > tileflowStyleFamilyLimits.themes ||
    themes.some((name) => !isTileflowThemeName(name))
  )
    fail('Invalid theme names.');
  const parameters: Json[][] = [];
  const columns = new Map<string, number>();
  const add = (values: Json[]): Reference => {
    const key = serializeCanonicalJson(values);
    let index = columns.get(key);
    if (index === undefined) {
      index = parameters.length;
      columns.set(key, index);
      parameters.push(values);
    }
    return {$variant: index};
  };
  const factor = (values: Json[]): Json => {
    const first = values[0]!;
    // An authored object with our wire marker remains literal inside a parameter column.
    if (values.some((value) => isReference(value) || isConstantReference(value)))
      return add(values);
    if (Array.isArray(first) && values.every((v) => Array.isArray(v) && v.length === first.length))
      return first.map((_, index) => factor(values.map((v) => (v as Json[])[index]!)));
    if (
      record(first) &&
      values.every((v) => record(v) && same(Object.keys(v).sort(), Object.keys(first).sort()))
    )
      return Object.fromEntries(
        Object.keys(first)
          .sort()
          .map((key) => [key, factor(values.map((v) => (v as Record<string, Json>)[key]!))]),
      );
    if (values.every((v) => same(v, first))) return first;
    return add(values);
  };
  const documents = themes.map((name) => JSON.parse(serializeCanonicalJson(styles[name])) as Json);
  for (const document of documents) assertStyle(document);
  const template = factor(documents);
  const packed = shareConstants(template);
  const family: TileflowStyleFamily = {
    kind: 'tileflow-style-family',
    version: 1,
    themes,
    template: packed.template,
    constants: packed.constants,
    parameters,
    updates: planUpdates(template),
  };
  return parseTileflowStyleFamily(family);
}

/** Validate budgets before materializing; malformed or oversized input never reaches a renderer. */
export function parseTileflowStyleFamily(input: unknown): TileflowStyleFamily {
  assertJsonBudget(input);
  if (
    !record(input) ||
    !same(Object.keys(input).sort(), [
      'constants',
      'kind',
      'parameters',
      'template',
      'themes',
      'updates',
      'version',
    ]) ||
    input.kind !== 'tileflow-style-family' ||
    input.version !== 1 ||
    !Array.isArray(input.themes) ||
    !input.themes.length ||
    input.themes.length > tileflowStyleFamilyLimits.themes ||
    input.themes.some((name) => typeof name !== 'string' || !isTileflowThemeName(name)) ||
    new Set(input.themes).size !== input.themes.length ||
    !Array.isArray(input.parameters) ||
    !Array.isArray(input.constants)
  )
    fail('Invalid family document.');
  const family = input as unknown as TileflowStyleFamily;
  if (bytes(input) > tileflowStyleFamilyLimits.documentBytes) fail('Family document is too large.');
  for (const values of family.parameters)
    if (!Array.isArray(values) || values.length !== family.themes.length)
      fail('Invalid parameter column.');
  walk(family.template, (value) => {
    if (
      isReference(value) &&
      (!Number.isSafeInteger(value.$variant) ||
        value.$variant < 0 ||
        value.$variant >= family.parameters.length)
    )
      fail('Invalid parameter reference.');
    if (
      isConstantReference(value) &&
      (!Number.isSafeInteger(value.$constant) ||
        value.$constant < 0 ||
        value.$constant >= family.constants.length)
    )
      fail('Invalid constant reference.');
  });
  let total = 0;
  const sizes = family.parameters.map((column) => column.map(bytes));
  const constants = family.constants.map(bytes);
  for (let index = 0; index < family.themes.length; index += 1) {
    // Count the expanded representation before allocating it (repeated references can amplify).
    const size = expandedBytes(family.template, sizes, constants, index);
    total += size;
    if (
      size > tileflowStyleFamilyLimits.expandedStyleBytes ||
      total > tileflowStyleFamilyLimits.expandedFamilyBytes
    )
      fail('Expanded family is too large.');
    const style = materialize(family.template, family, index);
    assertJsonBudget(style);
    assertStyle(style);
  }
  if (!same(family.updates, planUpdates(expandTileflowFamilyTemplate(family))))
    fail('Invalid update plan.');
  return family;
}

/** Export one conventional MapLibre JSON. The result is detached from the shared document. */
export function materializeTileflowStyleFamily(
  family: TileflowStyleFamily,
  theme: string,
): MapLibreStyle {
  const index = family.themes.indexOf(theme);
  if (index < 0) fail(`Unknown family theme: ${theme}.`);
  return materialize(family.template, family, index) as unknown as MapLibreStyle;
}

/** Expand at a trust boundary when a consumer requires conventional style documents. */
export function expandTileflowStyleFamily(input: unknown): Record<string, MapLibreStyle> {
  const family = parseTileflowStyleFamily(input);
  return Object.fromEntries(
    family.themes.map((name) => [name, materializeTileflowStyleFamily(family, name)]),
  );
}

/** Read only one planned property; no complete style copy is needed for a frame. */
export function readTileflowFamilyValue(
  family: TileflowStyleFamily,
  path: readonly (string | number)[],
  theme: string,
): unknown {
  const index = family.themes.indexOf(theme);
  if (index < 0) fail(`Unknown family theme: ${theme}.`);
  let node: Json | undefined = family.template;
  for (const key of path) {
    if (isReference(node)) node = family.parameters[node.$variant]![index];
    else if (isConstantReference(node)) node = family.constants[node.$constant];
    node =
      node && typeof node === 'object' ? (node as Record<string | number, Json>)[key] : undefined;
  }
  return node === undefined ? undefined : materialize(node, family, index);
}

function materialize(node: Json, family: TileflowStyleFamily, index: number): Json {
  if (isReference(node)) return structuredClone(family.parameters[node.$variant]![index]!);
  if (isConstantReference(node)) return structuredClone(family.constants[node.$constant]!);
  if (Array.isArray(node)) return node.map((value) => materialize(value, family, index));
  if (record(node))
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, materialize(value as Json, family, index)]),
    );
  return node;
}

function planUpdates(template: Json): TileflowStyleFamily['updates'] {
  let appearanceOnly = true;
  const paint = new Map<string, TileflowFamilyUpdate>();
  const roots = new Set<'light' | 'sky'>();
  walk(template, (node, path) => {
    if (!isReference(node)) return;
    if (path[0] === 'name') return;
    if (path[0] === 'metadata') {
      const key = path[1];
      if (
        [
          'tileflow:colors',
          'tileflow:family-image-theme',
          'tileflow:theme',
          'tileflow:colorScheme',
          'tileflow:sun',
          'tileflow:route',
          'tileflow:sky',
          'tileflow:sourceRequirements',
          'tileflow:dataRequirements',
        ].includes(String(key))
      )
        return;
      if (
        key === 'tileflow:buildings' &&
        ['color', 'modelColors', 'modelLighting', 'floodLight'].includes(String(path[2]))
      )
        return;
      // Runtime layers read these per theme through the controller and mix them during a blend.
      if (key === 'tileflow:vegetation' && ['colors', 'edgeColor'].includes(String(path[2])))
        return;
      if (key === 'tileflow:street-lights' && ['color', 'intensity'].includes(String(path[2])))
        return;
      if (
        key === 'tileflow:atmosphere' &&
        [
          'skyColor',
          'horizonColor',
          'fogColor',
          'spaceColor',
          'starColor',
          'starIntensity',
        ].includes(String(path[2]))
      )
        return;
      appearanceOnly = false;
      return;
    }
    if (path[0] === 'layers' && path[2] === 'layout' && path[3] === 'icon-image') return;
    if (path[0] === 'sky' || path[0] === 'light') {
      roots.add(path[0]);
      return;
    }
    if (
      path[0] === 'layers' &&
      typeof path[1] === 'number' &&
      path[2] === 'paint' &&
      typeof path[3] === 'string'
    ) {
      paint.set(`${path[1]}/${path[3]}`, [path[1], path[3]]);
    } else appearanceOnly = false;
  });
  // A token can be constant across all presets and still be customizable at runtime.
  if (
    record(template) &&
    record(template.metadata) &&
    template.metadata['tileflow:colors'] &&
    Array.isArray(template.layers)
  )
    template.layers.forEach((layer, index) => {
      if (record(layer) && record(layer.paint))
        for (const property of Object.keys(layer.paint))
          if (property.endsWith('color')) paint.set(`${index}/${property}`, [index, property]);
    });
  return {appearanceOnly, paint: [...paint.values()], roots: [...roots].sort()};
}

function expandedBytes(node: Json, sizes: number[][], constants: number[], index: number): number {
  if (isReference(node)) return sizes[node.$variant]![index]!;
  if (isConstantReference(node)) return constants[node.$constant]!;
  if (Array.isArray(node))
    return (
      2 +
      Math.max(0, node.length - 1) +
      node.reduce<number>((n, v) => n + expandedBytes(v, sizes, constants, index), 0)
    );
  if (record(node))
    return (
      2 +
      Math.max(0, Object.keys(node).length - 1) +
      Object.entries(node).reduce(
        (n, [key, v]) => n + bytes(key) + 1 + expandedBytes(v as Json, sizes, constants, index),
        0,
      )
    );
  return bytes(node);
}

function assertStyle(style: unknown): void {
  if (
    !record(style) ||
    style.version !== 8 ||
    !record(style.sources) ||
    !Array.isArray(style.layers) ||
    style.layers.length > tileflowStyleFamilyLimits.layers
  )
    fail('Invalid expanded MapLibre style.');
  const ids = new Set<string>();
  for (const layer of style.layers) {
    if (
      !record(layer) ||
      typeof layer.id !== 'string' ||
      ids.has(layer.id) ||
      typeof layer.type !== 'string'
    )
      fail('Invalid or duplicate layer.');
    ids.add(layer.id);
  }
}

function assertJsonBudget(input: unknown): void {
  let nodes = 0;
  const stack = new Set<object>();
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > tileflowStyleFamilyLimits.nodes || depth > tileflowStyleFamilyLimits.depth)
      fail('Family complexity limit exceeded.');
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return;
    if (typeof value !== 'object' || !value || stack.has(value)) fail('Expected acyclic JSON.');
    stack.add(value);
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      fail('Expected JSON objects.');
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('Unsafe object key.');
      visit(item, depth + 1);
    }
    stack.delete(value);
  };
  visit(input, 0);
}
function walk(
  node: Json,
  visit: (node: Json, path: (string | number)[]) => void,
  path: (string | number)[] = [],
): void {
  visit(node, path);
  if (isReference(node) || isConstantReference(node)) return;
  if (Array.isArray(node)) node.forEach((value, i) => walk(value, visit, [...path, i]));
  else if (record(node))
    Object.entries(node).forEach(([key, value]) => walk(value as Json, visit, [...path, key]));
}
function isReference(node: unknown): node is Reference {
  return record(node) && Object.keys(node).length === 1 && Object.hasOwn(node, '$variant');
}
function isConstantReference(node: unknown): node is ConstantReference {
  return record(node) && Object.keys(node).length === 1 && Object.hasOwn(node, '$constant');
}

/** Expand shared literals once when a build/delivery pass needs to inspect the template. */
export function expandTileflowFamilyTemplate(family: TileflowStyleFamily): Json {
  const visit = (node: Json): Json => {
    if (isConstantReference(node)) return structuredClone(family.constants[node.$constant]!);
    if (isReference(node)) return node;
    if (Array.isArray(node)) return node.map(visit);
    if (record(node))
      return Object.fromEntries(
        Object.entries(node).map(([key, value]) => [key, visit(value as Json)]),
      );
    return node;
  };
  return visit(family.template);
}

/** Repack a resource-rewritten template while retaining and verifying its update contract. */
export function withTileflowFamilyTemplate(
  family: TileflowStyleFamily,
  template: unknown,
): TileflowStyleFamily {
  assertJsonBudget(template);
  const packed = shareConstants(template as Json);
  return parseTileflowStyleFamily({
    ...family,
    template: packed.template,
    constants: packed.constants,
  });
}

/** Share repeated filters, expressions and metadata without requiring renderer-specific compression. */
function shareConstants(template: Json): {template: Json; constants: Json[]} {
  const counts = new Map<string, number>();
  const keys = new WeakMap<object, string>();
  const inspect = (node: Json): boolean => {
    if (isReference(node) || isConstantReference(node)) return false;
    if (!node || typeof node !== 'object') return true;
    const children = Array.isArray(node) ? node : Object.values(node);
    const constant = children.map(inspect).every(Boolean);
    if (constant) {
      const key = JSON.stringify(node);
      if (key.length >= 96) {
        keys.set(node, key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return constant;
  };
  inspect(template);
  const constants: Json[] = [];
  const ids = new Map<string, number>();
  const pack = (node: Json): Json => {
    if (!node || typeof node !== 'object' || isReference(node)) return node;
    const key = keys.get(node);
    if (key && counts.get(key)! > 1) {
      let index = ids.get(key);
      if (index === undefined) {
        index = constants.length;
        ids.set(key, index);
        constants.push(node);
      }
      return {$constant: index};
    }
    if (Array.isArray(node)) return node.map(pack);
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, pack(value as Json)]),
    );
  };
  return {template: pack(template), constants};
}
function record(node: unknown): node is Record<string, unknown> {
  return !!node && typeof node === 'object' && !Array.isArray(node);
}
function same(a: unknown, b: unknown): boolean {
  return serializeCanonicalJson(a) === serializeCanonicalJson(b);
}
function serializeCanonicalJson(value: unknown): string {
  const sort = (node: unknown): unknown =>
    Array.isArray(node)
      ? node.map(sort)
      : record(node)
        ? Object.fromEntries(
            Object.keys(node)
              .sort()
              .map((key) => [key, sort(node[key])]),
          )
        : node;
  return JSON.stringify(sort(value));
}
function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
function fail(message: string): never {
  throw new TypeError(`Tileflow style family: ${message}`);
}
