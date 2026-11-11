import {isTileflowThemeColorOperation, isTileflowThemeTokenReference} from './cartography/values';
import {type TileflowColorKnobs, validateTileflowColorKnobs} from './color-knobs';
import type {TileflowTheme} from './themes/model';
import {resolveThemeValues} from './themes/model';
import type {MapLibreStyle} from './types';

// Compiler-only expressions carry provenance through lowering, cloning and physical planning.
// They are removed from the exported style; identity never comes from comparing colour values.
export const tileflowColorMetadataKey = 'tileflow:colors';
const marker = '__tileflow_color_program';
type Path = (string | number)[];
export type TileflowColorProgram = unknown;
export type TileflowColorBindings = {
  version: 1;
  programs: TileflowColorProgram[];
  bindings: [Path, number][];
  tokens: Pick<TileflowTheme['tokens'], 'color' | 'number'>;
  /** The map's colour knobs, which `colors` may name beside tokens. */
  knobs?: TileflowColorKnobs;
};
export function colorProgramMarker(value: unknown, program: TileflowColorProgram): unknown[] {
  return [
    'let',
    marker,
    ['literal', program],
    '__tileflow_color_value',
    value,
    ['var', '__tileflow_color_value'],
  ];
}
export function isColorProgramMarker(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length === 6 &&
    value[0] === 'let' &&
    value[1] === marker &&
    Array.isArray(value[2]) &&
    value[2][0] === 'literal'
  );
}
export function colorProgramValue(value: unknown): unknown {
  return isColorProgramMarker(value) ? value[4] : value;
}
export function colorProgramOf(value: unknown): unknown {
  return isColorProgramMarker(value) ? (value[2] as unknown[])[1] : value;
}
/** Apply provenance to an already validated/resolved tree, preserving expression/zoom boundaries. */
export function preserveThemeColorPrograms<T>(
  authored: unknown,
  resolved: T,
  theme: TileflowTheme,
  insideExpression = false,
): T {
  if (
    (isTileflowThemeTokenReference(authored) && authored.category === 'color') ||
    isTileflowThemeColorOperation(authored)
  ) {
    const value = colorProgramMarker(resolved, resolveProgramNumbers(authored, theme));
    return (insideExpression ? value : {kind: 'expression', value}) as T;
  }
  if (Array.isArray(authored) && Array.isArray(resolved))
    return resolved.map((value, index) =>
      preserveThemeColorPrograms(authored[index], value, theme, insideExpression),
    ) as T;
  if (record(authored) && record(resolved)) {
    if (authored.kind === 'theme-fixed') return resolved;
    return Object.fromEntries(
      Object.entries(resolved).map(([key, value]) => [
        key,
        preserveThemeColorPrograms(
          authored[key],
          value,
          theme,
          insideExpression ||
            authored.kind === 'expression' ||
            (authored.kind === 'zoom' && key === 'stops'),
        ),
      ]),
    ) as T;
  }
  return resolved;
}
function resolveProgramNumbers(value: unknown, theme: TileflowTheme): unknown {
  if (isTileflowThemeTokenReference(value) && value.category === 'number')
    return resolveThemeValues({opacity: value}, theme).opacity;
  if (Array.isArray(value)) return value.map((node) => resolveProgramNumbers(node, theme));
  if (record(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, node]) => [key, resolveProgramNumbers(node, theme)]),
    );
  return value;
}
/** A detached, ordinary MapLibre document plus explicit path-to-program bindings. */
export function extractTileflowColorPrograms(
  style: MapLibreStyle,
  tokens: TileflowColorBindings['tokens'],
  knobs?: TileflowColorKnobs,
): MapLibreStyle {
  const programs: unknown[] = [];
  const ids = new Map<string, number>();
  const bindings: TileflowColorBindings['bindings'] = [];
  const visit = (node: unknown, path: Path): unknown => {
    if (record(node) && node.kind === 'expression' && isColorProgramMarker(node.value))
      return visit(node.value, path);
    if (isColorProgramMarker(node)) {
      const program = colorProgramOf(node);
      const key = JSON.stringify(program);
      let id = ids.get(key);
      if (id === undefined) {
        id = programs.length;
        ids.set(key, id);
        programs.push(program);
      }
      bindings.push([
        path[0] === 'layers' && path[2] === 'paint' ? [path[1]!, ...path.slice(3)] : path,
        id,
      ]);
      return colorProgramValue(node);
    }
    if (Array.isArray(node)) return node.map((v, i) => visit(v, [...path, i]));
    if (record(node))
      return Object.fromEntries(
        Object.entries(node)
          .filter(([key]) => key !== tileflowColorMetadataKey)
          .map(([key, v]) => [key, visit(v, [...path, key])]),
      );
    return node;
  };
  const result = visit(style, []) as MapLibreStyle;
  if (bindings.length)
    result.metadata = {
      ...result.metadata,
      // Keep the declared catalog shape across presets. Per-preset pruning makes a shared
      // object structurally different and repeats the entire catalog in the transport.
      [tileflowColorMetadataKey]: {
        version: 1,
        programs,
        bindings,
        tokens,
        ...(knobs && Object.keys(knobs).length > 0 ? {knobs} : {}),
      },
    };
  return result;
}
export function restoreTileflowColorPrograms(style: MapLibreStyle): MapLibreStyle {
  const result = structuredClone(style);
  const metadata = result.metadata?.[tileflowColorMetadataKey] as TileflowColorBindings | undefined;
  if (!metadata) return result;
  validateBindings(metadata);
  for (const [path, id] of metadata.bindings)
    updatePath(result, path, (value) => colorProgramMarker(value, metadata.programs[id]));
  return result;
}
export function updatePath(
  root: unknown,
  inputPath: readonly (string | number)[],
  change: (value: unknown) => unknown,
): void {
  const path =
    typeof inputPath[0] === 'number'
      ? ['layers', inputPath[0], 'paint', ...inputPath.slice(1)]
      : inputPath;
  if (
    !path.length ||
    path.length > 96 ||
    path.some((key) => ['__proto__', 'constructor', 'prototype'].includes(String(key)))
  )
    throw new TypeError('Invalid colour binding path.');
  let node = root as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, key))
      throw new TypeError('Missing colour binding path.');
    node = node[key] as typeof node;
  }
  const last = path.at(-1)!;
  if (!node || !Object.hasOwn(node, last)) throw new TypeError('Missing colour binding value.');
  node[last] = change(node[last]);
}
export function validateBindings(value: TileflowColorBindings): void {
  if (
    value.version !== 1 ||
    !Array.isArray(value.programs) ||
    value.programs.length > 4096 ||
    !Array.isArray(value.bindings) ||
    value.bindings.length > 16384 ||
    !record(value.tokens?.color) ||
    !record(value.tokens?.number)
  )
    throw new TypeError('Invalid colour program catalog.');
  if (value.knobs !== undefined)
    validateTileflowColorKnobs(value.knobs, new Set(Object.keys(value.tokens.color)), 'knobs');
  for (const [path, id] of value.bindings) {
    if (
      !Array.isArray(path) ||
      !path.length ||
      path.some((key) => typeof key !== 'string' && !Number.isSafeInteger(key)) ||
      !Number.isSafeInteger(id) ||
      id < 0 ||
      id >= value.programs.length ||
      !(typeof path[0] === 'number' || ['metadata', 'light', 'sky'].includes(String(path[0])))
    )
      throw new TypeError('Invalid colour program binding.');
    if (typeof path[0] === 'number' && (path[0] < 0 || !String(path[1]).endsWith('color')))
      throw new TypeError('Colour programs can only change paint colours.');
    if (
      path[0] === 'metadata' &&
      (path[1] === tileflowColorMetadataKey ||
        ![
          'tileflow:buildings',
          'tileflow:vegetation',
          'tileflow:sun',
          'tileflow:sky',
          'tileflow:route',
        ].includes(String(path[1])))
    )
      throw new TypeError('Invalid colour metadata binding.');
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Run strict metadata readers on concrete values, then restore only their accepted colour leaves. */
export function mapColorProgramsThrough<T>(input: unknown, reader: (value: unknown) => T): T {
  return overlayColorPrograms(input, reader(stripColorPrograms(input)));
}
export function stripColorPrograms<T>(value: T): T {
  if (isColorProgramMarker(value)) return colorProgramValue(value) as T;
  if (record(value) && value.kind === 'expression' && isColorProgramMarker(value.value))
    return colorProgramValue(value.value) as T;
  if (Array.isArray(value)) return value.map(stripColorPrograms) as T;
  if (record(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, node]) => [key, stripColorPrograms(node)]),
    ) as T;
  return value;
}
export function overlayColorPrograms<T>(input: unknown, output: T): T {
  const candidate = record(input) && input.kind === 'expression' ? input.value : input;
  if (isColorProgramMarker(candidate) && typeof output === 'string')
    return colorProgramMarker(output, colorProgramOf(candidate)) as T;
  if (Array.isArray(input) && Array.isArray(output))
    return output.map((value, index) => overlayColorPrograms(input[index], value)) as T;
  if (record(input) && record(output))
    return Object.fromEntries(
      Object.entries(output).map(([key, node]) => [key, overlayColorPrograms(input[key], node)]),
    ) as T;
  return output;
}
