import {
  colorProgramValue,
  tileflowColorMetadataKey,
  updatePath,
  validateBindings,
  type TileflowColorBindings,
} from './color-program';
import {mix} from './themes';
import {resolveThemeValues, resolveTileflowTheme, type TileflowTheme} from './themes/model';
import type {MapLibreStyle} from './types';

export type TileflowColorOverrides = Readonly<Record<string, string>>;
/** Reevaluate only explicit colour programs; fixed values and application-owned layers are untouched. */
export function applyTileflowColorOverrides(
  style: MapLibreStyle,
  overrides: TileflowColorOverrides,
): MapLibreStyle {
  const keys = Object.keys(overrides);
  if (!keys.length) return style;
  const catalog = style.metadata?.[tileflowColorMetadataKey] as TileflowColorBindings | undefined;
  if (!catalog)
    throw new TypeError(
      'This style has no runtime colour bindings. Rebuild with runtimeColors enabled.',
    );
  validateBindings(catalog);
  if (
    keys.length > 1024 ||
    keys.some(
      (key) =>
        !Object.hasOwn(catalog.tokens.color, key) ||
        typeof overrides[key] !== 'string' ||
        overrides[key]!.length > 128,
    )
  )
    throw new TypeError('Unknown colour token or invalid override.');
  const theme: TileflowTheme = {
    id: 'runtime',
    version: 1,
    colorScheme: 'light',
    lighting: {},
    typography: {font: 'Noto Sans Regular'},
    tokens: {
      ...catalog.tokens,
      color: {...catalog.tokens.color, ...overrides},
      font: {},
      image: {},
    },
  };
  const resolved = resolveTileflowTheme(theme);
  const concrete: TileflowTheme = {
    ...theme,
    tokens: {...theme.tokens, color: resolved.tokens.color, number: resolved.tokens.number},
  };
  const evaluate = (program: unknown): string => {
    if (typeof program === 'string') return program;
    if (
      Array.isArray(program) &&
      program[0] === 'srgb' &&
      program.length === 4 &&
      typeof program[3] === 'number' &&
      program[3] >= 0 &&
      program[3] <= 1
    )
      return mix(evaluate(program[1]), evaluate(program[2]), program[3]);
    if (program && typeof program === 'object' && !Array.isArray(program)) {
      const node = program as Record<string, unknown>;
      if (node.kind === 'theme-color' && node.operation === 'alpha')
        program = {...node, color: evaluate(node.color)};
      else if (node.kind === 'theme-color' && node.operation === 'mix')
        program = {...node, from: evaluate(node.from), to: evaluate(node.to)};
    }
    return resolveThemeValues({color: program}, concrete).color as string;
  };
  const affected = (node: unknown, seen = new Set<string>()): boolean => {
    if (!node || typeof node !== 'object') return false;
    const ref = node as {kind?: unknown; category?: unknown; token?: string};
    if (ref.kind === 'theme-token' && ref.category === 'color' && typeof ref.token === 'string') {
      if (Object.hasOwn(overrides, ref.token)) return true;
      if (seen.has(ref.token)) return false;
      return affected(catalog.tokens.color[ref.token], new Set([...seen, ref.token]));
    }
    return Object.values(node).some((value) => affected(value, seen));
  };
  const values = catalog.programs.map((program) =>
    affected(program) ? evaluate(program) : undefined,
  );
  const result = structuredClone(style);
  for (const [path, id] of catalog.bindings)
    if (values[id] !== undefined) updatePath(result, path, () => colorProgramValue(values[id]));
  return result;
}
