import {
  formatSrgba,
  normalizeTileflowCssColor,
  oklabToSrgba,
  parseTileflowCssColor,
  srgbaToOklab,
} from './css-color';

/**
 * Colour knobs: a handful of named colours that stand for many tokens of a map. An application
 * sets `water` or `roads` to one colour, and the map works out what each token it governs becomes,
 * so the hierarchy between a map's tokens survives. A knob name has no dot; a token name always has.
 */

/**
 * What happens to one token when its knob is set to a colour, in OKLab:
 *
 * - `replace`: the token becomes the colour.
 * - `shift`: the token moves by as much as the knob's `reference` token moves to reach the colour,
 *   so tokens lighter or darker than the reference stay lighter or darker by the same amount.
 * - `mix`: the token moves `amount` of the way towards the colour.
 * - `tint`: the token keeps its lightness and takes `amount` of the colour's hue and chroma,
 *   which tints a grey without changing how light it is.
 */
export type TileflowColorKnobOperationName = 'mix' | 'replace' | 'shift' | 'tint';

export type TileflowColorKnobOperation =
  | TileflowColorKnobOperationName
  | Readonly<{
      /** How far the token goes, from 0 to 1. Defaults to 1. Not used by `replace`. */
      amount?: number;
      /** `tint` only: a multiple of the colour's chroma. Defaults to 1; 0 gives a grey. */
      chroma?: number;
      /** Added to the result's OKLab lightness, from -1 to 1, so a knob can derive a darker edge. */
      lightness?: number;
      op: TileflowColorKnobOperationName;
    }>;

export type TileflowColorKnob = Readonly<{
  /** One sentence on what the knob colours, for documentation and tools. */
  description?: string;
  /** The token `shift` measures from. Required when any token shifts, and it must be listed. */
  reference?: string;
  /** The tokens the knob governs and what becomes of each. */
  tokens: Readonly<Record<string, TileflowColorKnobOperation>>;
}>;

export type TileflowColorKnobs = Readonly<Record<string, TileflowColorKnob>>;

export const tileflowColorKnobNamePattern = /^[a-z][A-Za-z0-9]{0,31}$/u;
const maximumKnobs = 64;
const maximumKnobTokens = 512;
const operationNames: ReadonlySet<string> = new Set(['mix', 'replace', 'shift', 'tint']);

/** Whether a `colors` key names a knob rather than a token. */
export function isTileflowColorKnobName(key: string): boolean {
  return !key.includes('.');
}

/**
 * Checks knobs as a map author declares them. Every problem names the knob and the token, so an
 * author sees what to fix. `tokenNames` are the colour tokens of every theme of the map.
 */
export function validateTileflowColorKnobs(
  knobs: unknown,
  tokenNames: ReadonlySet<string> | undefined,
  label = 'colorKnobs',
): asserts knobs is TileflowColorKnobs {
  if (!isRecord(knobs)) throw new TypeError(`${label} must be an object of knobs.`);
  const names = Object.keys(knobs);
  if (names.length > maximumKnobs)
    throw new TypeError(`${label} may hold at most ${maximumKnobs} knobs.`);
  const owners = new Map<string, string>();
  for (const name of names) {
    if (!tileflowColorKnobNamePattern.test(name)) {
      throw new TypeError(
        `${label}.${name}: a knob name is letters and digits, starts with a lowercase letter, and has no dot.`,
      );
    }
    const knob = knobs[name];
    if (!isRecord(knob) || !isRecord(knob.tokens)) {
      throw new TypeError(`${label}.${name} must be an object with a tokens object.`);
    }
    const tokens = Object.keys(knob.tokens);
    if (tokens.length === 0 || tokens.length > maximumKnobTokens) {
      throw new TypeError(
        `${label}.${name}.tokens must name between 1 and ${maximumKnobTokens} tokens.`,
      );
    }
    let shifts = false;
    for (const token of tokens) {
      const operation = normalizeOperation(
        knob.tokens[token],
        `${label}.${name}.tokens["${token}"]`,
      );
      shifts ||= operation.op === 'shift';
      if (tokenNames && !tokenNames.has(token)) {
        throw new TypeError(
          `${label}.${name} governs "${token}", which is not a colour token of the map.`,
        );
      }
      const owner = owners.get(token);
      if (owner !== undefined) {
        throw new TypeError(
          `${label}: "${token}" is governed by both "${owner}" and "${name}". A token has one knob.`,
        );
      }
      owners.set(token, name);
    }
    if (knob.reference !== undefined) {
      if (typeof knob.reference !== 'string' || !tokens.includes(knob.reference)) {
        throw new TypeError(`${label}.${name}.reference must be one of the knob's own tokens.`);
      }
    } else if (shifts) {
      throw new TypeError(`${label}.${name} shifts tokens, so it needs a reference token.`);
    }
    if (knob.description !== undefined && typeof knob.description !== 'string') {
      throw new TypeError(`${label}.${name}.description must be a string.`);
    }
  }
}

type NormalizedOperation = {
  amount: number;
  chroma: number;
  lightness: number;
  op: TileflowColorKnobOperationName;
};

function normalizeOperation(value: unknown, label: string): NormalizedOperation {
  const input = typeof value === 'string' ? {op: value} : value;
  if (!isRecord(input) || typeof input.op !== 'string' || !operationNames.has(input.op)) {
    throw new TypeError(
      `${label} must be replace, shift, mix, tint or an object with one of them as op.`,
    );
  }
  const amount = optionalNumber(input.amount, 1, 0, 1, `${label}.amount`);
  const chroma = optionalNumber(input.chroma, 1, 0, 8, `${label}.chroma`);
  const lightness = optionalNumber(input.lightness, 0, -1, 1, `${label}.lightness`);
  for (const key of Object.keys(input)) {
    if (!['amount', 'chroma', 'lightness', 'op'].includes(key)) {
      throw new TypeError(`${label} has no ${JSON.stringify(key)} option.`);
    }
  }
  return {amount, chroma, lightness, op: input.op as TileflowColorKnobOperationName};
}

function optionalNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${label} must be a number from ${min} to ${max}.`);
  }
  return value;
}

/**
 * The token colours the given knobs stand for. `baseColors` are the map's own colours for the theme
 * on screen, as concrete CSS colours, which every operation starts from. A knob that is not
 * declared is an error that lists the ones that are.
 */
export function resolveTileflowColorKnobs(
  knobs: TileflowColorKnobs | undefined,
  given: Readonly<Record<string, string>>,
  baseColors: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(given)) {
    const knob = knobs && Object.hasOwn(knobs, name) ? knobs[name] : undefined;
    if (!knob) {
      const known = knobs ? Object.keys(knobs) : [];
      throw new TypeError(
        known.length > 0
          ? `Unknown colour knob ${JSON.stringify(name.slice(0, 80))}. This map has ${known.join(', ')}. Tokens have a dot, such as "surface.water".`
          : `Unknown colour token or knob ${JSON.stringify(name.slice(0, 80))}. This map declares no colour knobs.`,
      );
    }
    const colour = parseTileflowCssColor(value);
    if (!colour) normalizeTileflowCssColor(value, `colour for knob "${name}"`);
    const target = srgbaToOklab(colour!);
    const reference = knob.reference ? readBase(baseColors, knob.reference, name) : undefined;
    for (const [token, operation] of Object.entries(knob.tokens)) {
      const base = readBase(baseColors, token, name);
      result[token] = apply(
        normalizeOperation(operation, `${name}.${token}`),
        base,
        target,
        reference,
      );
    }
  }
  return result;
}

function readBase(
  baseColors: Readonly<Record<string, string>>,
  token: string,
  knob: string,
): ReturnType<typeof srgbaToOklab> {
  const value = baseColors[token];
  const parsed = value === undefined ? null : parseTileflowCssColor(value);
  if (!parsed)
    throw new TypeError(
      `Colour knob "${knob}" governs "${token}", which has no colour in this theme.`,
    );
  return srgbaToOklab(parsed);
}

type Oklab = ReturnType<typeof srgbaToOklab>;
const greyChroma = 0.003;

function apply(
  operation: NormalizedOperation,
  base: Oklab,
  target: Oklab,
  reference: Oklab | undefined,
): string {
  const [baseL, baseA, baseB, baseAlpha] = base;
  const [targetL, targetA, targetB, targetAlpha] = target;
  let l: number;
  let a: number;
  let b: number;
  switch (operation.op) {
    case 'replace':
      [l, a, b] = [targetL, targetA, targetB];
      break;
    case 'shift': {
      const [referenceL, referenceA, referenceB] = reference!;
      l = baseL + operation.amount * (targetL - referenceL);
      a = baseA + operation.amount * (targetA - referenceA);
      b = baseB + operation.amount * (targetB - referenceB);
      break;
    }
    case 'mix':
      l = baseL + operation.amount * (targetL - baseL);
      a = baseA + operation.amount * (targetA - baseA);
      b = baseB + operation.amount * (targetB - baseB);
      break;
    default: {
      // Keep the lightness; move chroma and hue towards the colour's.
      const baseChroma = Math.hypot(baseA, baseB);
      const targetChroma = Math.hypot(targetA, targetB) * operation.chroma;
      const chroma = baseChroma + (targetChroma - baseChroma) * operation.amount;
      const baseHue = Math.atan2(baseB, baseA);
      const targetHue = Math.atan2(targetB, targetA);
      let hue = targetHue;
      if (baseChroma >= greyChroma && targetChroma >= greyChroma) {
        let delta = targetHue - baseHue;
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        hue = baseHue + delta * operation.amount;
      } else if (baseChroma >= greyChroma && targetChroma < greyChroma) hue = baseHue;
      [l, a, b] = [baseL, chroma * Math.cos(hue), chroma * Math.sin(hue)];
    }
  }
  l = Math.min(1, Math.max(0, l + operation.lightness));
  // An authored see-through colour stays as see-through as it was.
  return formatSrgba(oklabToSrgba(l, a, b, baseAlpha * targetAlpha));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
