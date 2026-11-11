// CSS custom properties in a colour, resolved against an element. An application that writes its
// colours as variables (`var(--primary)`, `color-mix(in oklab, var(--primary) 40%, white)`) can pass
// them to the map as they are; the value they have where the map sits is read from the page.

/** Raised for a variable that has no value and no fallback, or that cannot be resolved. */
export class TileflowCssVariableError extends Error {
  /** The variable, written as `--name`. */
  readonly variable: string;

  constructor(variable: string, message: string) {
    super(message);
    this.name = 'TileflowCssVariableError';
    this.variable = variable;
  }
}

/** Longest text a substitution may produce, and most substitutions one value may make. */
const maximumLength = 4096;
const maximumSubstitutions = 64;
const maximumDepth = 16;

/** Whether the text uses `var()` anywhere. */
export function hasTileflowCssVariable(value: string): boolean {
  return findCall(value, 0) !== null;
}

/**
 * Replaces every `var(--name[, fallback])` in `value` with the value `read` gives for the name, or
 * with the fallback when it has none. A variable's value may use `var()` itself, and so may a
 * fallback. A name with no value and no fallback throws a `TileflowCssVariableError` that names it.
 */
export function resolveTileflowCssVariables(
  value: string,
  read: (name: string) => string | null | undefined,
): string {
  const budget = {substitutions: 0};
  return resolve(value, read, [], 0, budget);
}

type Call = {end: number; fallback: string | undefined; name: string; start: number};

function resolve(
  value: string,
  read: (name: string) => string | null | undefined,
  trail: readonly string[],
  depth: number,
  budget: {substitutions: number},
): string {
  if (depth > maximumDepth) {
    throw new TileflowCssVariableError(
      trail.at(-1) ?? '--',
      'CSS variables refer to one another too deeply.',
    );
  }
  let result = '';
  let position = 0;
  for (;;) {
    const call = findCall(value, position);
    if (!call) return result + value.slice(position);
    if (++budget.substitutions > maximumSubstitutions) {
      throw new TileflowCssVariableError(
        call.name,
        'A colour uses too many CSS variables to resolve.',
      );
    }
    result += value.slice(position, call.start);
    position = call.end;
    if (!/^--[^\s,()]+$/u.test(call.name)) {
      throw new TileflowCssVariableError(
        call.name,
        `"${call.name}" is not a CSS variable name; it must start with two dashes, as in var(--primary).`,
      );
    }
    if (trail.includes(call.name)) {
      throw new TileflowCssVariableError(
        call.name,
        `The CSS variable ${call.name} refers to itself (${[...trail, call.name].join(' → ')}).`,
      );
    }
    const raw = read(call.name)?.trim();
    // A custom property that is not set reads as an empty string; one set to nothing is valid too,
    // but a colour cannot be empty, so both fall back.
    const substituted =
      raw !== undefined && raw !== ''
        ? resolve(raw, read, [...trail, call.name], depth + 1, budget)
        : call.fallback !== undefined
          ? resolve(call.fallback, read, trail, depth + 1, budget)
          : undefined;
    if (substituted === undefined) {
      throw new TileflowCssVariableError(
        call.name,
        `The CSS variable ${call.name} has no value and no fallback.`,
      );
    }
    result += substituted;
    if (result.length > maximumLength) {
      throw new TileflowCssVariableError(call.name, 'A colour with its CSS variables is too long.');
    }
  }
}

/** The first `var(...)` at or after `from`, with its name and fallback, or null. */
function findCall(value: string, from: number): Call | null {
  const lower = value.toLowerCase();
  for (
    let index = lower.indexOf('var(', from);
    index !== -1;
    index = lower.indexOf('var(', index + 1)
  ) {
    // `var(` inside a longer name, such as `somevar(`, is not the function.
    if (index > 0 && /[a-z0-9_-]/u.test(lower[index - 1]!)) continue;
    let depth = 1;
    let comma = -1;
    let cursor = index + 4;
    for (; cursor < value.length && depth > 0; cursor += 1) {
      const character = value[cursor];
      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
      else if (character === ',' && depth === 1 && comma === -1) comma = cursor;
    }
    if (depth !== 0) return null;
    const close = cursor - 1;
    const name = value.slice(index + 4, comma === -1 ? close : comma).trim();
    const fallback = comma === -1 ? undefined : value.slice(comma + 1, close).trim();
    return {end: cursor, fallback, name, start: index};
  }
  return null;
}
