import {
  colorProgramValue,
  tileflowColorMetadataKey,
  updatePath,
  validateBindings,
  type TileflowColorBindings,
} from './color-program';
import {isTileflowColorKnobName, resolveTileflowColorKnobs} from './color-knobs';
import {normalizeTileflowCssColor} from './css-color';
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
  if (keys.length > 1024) throw new TypeError('At most 1024 colours can be overridden.');
  // A key that is a token, or has a dot as every token of Tileflow's maps does, names a token; any
  // other key names a knob of the map.
  const isToken = (key: string) =>
    Object.hasOwn(catalog.tokens.color, key) || !isTileflowColorKnobName(key);
  const tokenKeys = keys.filter(isToken);
  const knobKeys = keys.filter((key) => !isToken(key));
  const unknown = tokenKeys.filter((key) => !Object.hasOwn(catalog.tokens.color, key));
  if (unknown.length)
    throw new TypeError(
      `Unknown colour token${unknown.length > 1 ? 's' : ''} ${unknown
        .slice(0, 5)
        .map((key) => JSON.stringify(key.slice(0, 80)))
        .join(', ')}${unknown.length > 5 ? ', ...' : ''}.`,
    );
  // The style language reads hex and comma-separated rgb() and hsl(); every other CSS colour is
  // converted here, and one that cannot be read is an error rather than a silently wrong colour.
  const normalized = Object.fromEntries(
    keys.map((key) => [
      key,
      normalizeTileflowCssColor(
        overrides[key] as string,
        `colour for ${isToken(key) ? '' : 'knob '}"${key.slice(0, 80)}"`,
      ),
    ]),
  ) as Record<string, string>;
  let knobColors: Record<string, string> = {};
  if (knobKeys.length) {
    // Knobs start from the colours this theme has without any override.
    const base = resolveTileflowTheme({
      id: 'runtime',
      version: 1,
      colorScheme: 'light',
      lighting: {},
      typography: {font: 'Noto Sans Regular'},
      tokens: {...catalog.tokens, font: {}, image: {}},
    }).tokens.color as Record<string, string>;
    knobColors = resolveTileflowColorKnobs(
      catalog.knobs,
      Object.fromEntries(knobKeys.map((key) => [key, normalized[key]!])),
      base,
    );
  }
  // A token set by name wins over the knob that governs it.
  overrides = {
    ...knobColors,
    ...Object.fromEntries(tokenKeys.map((key) => [key, normalized[key]!])),
  };
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
