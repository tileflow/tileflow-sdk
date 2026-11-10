// CSS colours as sRGB. MapLibre's style specification reads hex, rgb() and hsl() with commas, so
// the colours an application already has (shadcn and Tailwind write every token as oklch()) are
// converted here, once, before they reach a style or a mix.

/** sRGB channels from 0 to 255 and alpha from 0 to 1. */
export type TileflowSrgbaColor = [red: number, green: number, blue: number, alpha: number];

type Space = 'oklab' | 'oklch' | 'srgb' | 'srgb-linear';
/** Coordinates in `space`; `NaN` marks a missing component (`none`, or a powerless hue). */
type Colour = {alpha: number; coords: [number, number, number]; space: Space};

const maximumLength = 512;
const maximumDepth = 6;
/** The chroma below which a hue carries no information. */
const powerlessChroma = 1e-4;

/** The syntaxes `parseTileflowCssColor` reads, for error messages. */
export const tileflowCssColorSyntaxes =
  'a hex colour, rgb(), rgba(), hsl(), hsla(), oklab(), oklch(), color-mix() or transparent';

/** The colour as sRGB, or null when it is not written in a syntax this reads. */
export function parseTileflowCssColor(value: string): TileflowSrgbaColor | null {
  if (typeof value !== 'string' || value.length > maximumLength) return null;
  const colour = parse(value.trim().toLowerCase(), 0);
  return colour ? toSrgba(colour) : null;
}

/**
 * The colour as `#rrggbb`, or `rgba(r, g, b, a)` when it is not opaque. A colour this cannot read
 * throws a `TypeError` that names it, rather than producing a wrong colour.
 */
export function normalizeTileflowCssColor(value: string, label = 'colour'): string {
  const rgba = parseTileflowCssColor(value);
  if (!rgba) throw new TypeError(describeUnreadableColour(value, label));
  return formatSrgba(rgba);
}

/** `#rrggbb` for an opaque colour and `rgba(r, g, b, a)` for any other. */
export function formatSrgba([red, green, blue, alpha]: TileflowSrgbaColor): string {
  const channels = [red, green, blue].map((channel) =>
    Math.min(255, Math.max(0, Math.round(channel))),
  ) as [number, number, number];
  const opacity = Math.min(1, Math.max(0, alpha));
  if (opacity >= 0.9995) {
    return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  }
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${Number(opacity.toFixed(3))})`;
}

function describeUnreadableColour(value: unknown, label: string): string {
  if (typeof value !== 'string') return `The ${label} must be a string, not ${typeof value}.`;
  if (value.length > maximumLength)
    return `The ${label} is too long; a colour may be at most ${maximumLength} characters.`;
  const shown = JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}...` : value);
  if (/\bvar\(|\benv\(|currentcolor|\binherit\b/iu.test(value)) {
    return `The ${label} ${shown} depends on the page. Read its computed value first, for example with getComputedStyle, and pass that.`;
  }
  return `The ${label} ${shown} is not a colour Tileflow reads. Use ${tileflowCssColorSyntaxes}.`;
}

function parse(text: string, depth: number): Colour | null {
  if (depth > maximumDepth || !text) return null;
  if (text === 'transparent') return {alpha: 0, coords: [0, 0, 0], space: 'srgb'};
  if (text.startsWith('#')) return parseHex(text);
  const call = /^([a-z-]+)\((.*)\)$/su.exec(text);
  if (!call) return null;
  const [, name, body] = call as unknown as [string, string, string];
  switch (name) {
    case 'rgb':
    case 'rgba':
      return parseRgb(body);
    case 'hsl':
    case 'hsla':
      return parseHsl(body);
    case 'oklab':
      return parseOklab(body);
    case 'oklch':
      return parseOklch(body);
    case 'color-mix':
      return parseMix(body, depth);
    default:
      return null;
  }
}

function parseHex(text: string): Colour | null {
  const digits = /^#([\da-f]+)$/u.exec(text)?.[1];
  if (!digits || ![3, 4, 6, 8].includes(digits.length)) return null;
  const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
  const bytes = full.match(/../gu)!.map((pair) => Number.parseInt(pair, 16));
  return {
    alpha: bytes.length > 3 ? bytes[3]! / 255 : 1,
    coords: [bytes[0]! / 255, bytes[1]! / 255, bytes[2]! / 255],
    space: 'srgb',
  };
}

type Arguments = {alpha: number; parts: string[]};

/** The three components and the alpha of a functional colour, in either comma or space syntax. */
function splitArguments(body: string): Arguments | null {
  if (/[()]/u.test(body)) return null;
  const [main, ...rest] = body.split('/');
  if (rest.length > 1) return null;
  const parts = main!.split(/[\s,]+/u).filter(Boolean);
  if (rest.length === 1) {
    const alpha = parseAlpha(rest[0]!.trim());
    return parts.length === 3 && alpha !== null ? {alpha, parts} : null;
  }
  // Legacy syntax carries alpha as a fourth comma-separated value.
  if (parts.length === 4 && body.includes(',')) {
    const alpha = parseAlpha(parts[3]!);
    return alpha === null ? null : {alpha, parts: parts.slice(0, 3)};
  }
  return parts.length === 3 ? {alpha: 1, parts} : null;
}

function parseAlpha(text: string): number | null {
  if (text === 'none') return 0;
  const value = number(text);
  if (value === null) return null;
  const alpha = text.endsWith('%') ? value / 100 : value;
  return Math.min(1, Math.max(0, alpha));
}

/** A number, or a percentage as a fraction `scale` per 100%; `none` is a missing component. */
function component(text: string, percentScale: number): number | null {
  if (text === 'none') return Number.NaN;
  const value = number(text);
  if (value === null) return null;
  return text.endsWith('%') ? (value / 100) * percentScale : value;
}

function number(text: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/u.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function hue(text: string): number | null {
  if (text === 'none') return Number.NaN;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/u.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  switch (match[2]) {
    case 'grad':
      return value * 0.9;
    case 'rad':
      return (value * 180) / Math.PI;
    case 'turn':
      return value * 360;
    default:
      return value;
  }
}

function parseRgb(body: string): Colour | null {
  const split = splitArguments(body);
  if (!split) return null;
  // Percentages and numbers may mix in the modern syntax; both are fractions of 255.
  const channels = split.parts.map((part) => component(part, 255));
  if (channels.some((channel) => channel === null)) return null;
  const [red, green, blue] = channels.map((channel) => channel! / 255) as [number, number, number];
  return {alpha: split.alpha, coords: [red, green, blue], space: 'srgb'};
}

function parseHsl(body: string): Colour | null {
  const split = splitArguments(body);
  if (!split) return null;
  const degrees = hue(split.parts[0]!);
  const saturation = component(split.parts[1]!, 100);
  const lightness = component(split.parts[2]!, 100);
  if (degrees === null || saturation === null || lightness === null) return null;
  const [s, l] = [saturation, lightness].map((entry) =>
    Math.min(1, Math.max(0, (Number.isNaN(entry) ? 0 : entry) / 100)),
  ) as [number, number];
  const h = ((((Number.isNaN(degrees) ? 0 : degrees) % 360) + 360) % 360) / 30;
  const a = s * Math.min(l, 1 - l);
  const channel = (offset: number) => {
    const k = (offset + h) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return {alpha: split.alpha, coords: [channel(0), channel(8), channel(4)], space: 'srgb'};
}

function parseOklab(body: string): Colour | null {
  const split = splitArguments(body);
  if (!split) return null;
  const lightness = component(split.parts[0]!, 1);
  const a = component(split.parts[1]!, 0.4);
  const b = component(split.parts[2]!, 0.4);
  if (lightness === null || a === null || b === null) return null;
  return {alpha: split.alpha, coords: [lightness, a, b], space: 'oklab'};
}

function parseOklch(body: string): Colour | null {
  const split = splitArguments(body);
  if (!split) return null;
  const lightness = component(split.parts[0]!, 1);
  const chroma = component(split.parts[1]!, 0.4);
  const angle = hue(split.parts[2]!);
  if (lightness === null || chroma === null || angle === null) return null;
  return {
    alpha: split.alpha,
    coords: [lightness, Number.isNaN(chroma) ? chroma : Math.max(0, chroma), angle],
    space: 'oklch',
  };
}

// color-mix(in <space> [<hue> hue], <colour> [<percentage>], <colour> [<percentage>])

const mixSpaces = new Set<string>(['oklab', 'oklch', 'srgb', 'srgb-linear']);

function parseMix(body: string, depth: number): Colour | null {
  const arms = splitTopLevel(body);
  if (arms.length !== 3) return null;
  const preamble = /^in\s+([a-z-]+)(?:\s+(shorter|longer|increasing|decreasing)\s+hue)?$/u.exec(
    arms[0]!.trim(),
  );
  if (!preamble || !mixSpaces.has(preamble[1]!)) return null;
  const space = preamble[1] as Space;
  const method = preamble[2] ?? 'shorter';
  if (preamble[2] && space !== 'oklch') return null;

  const parsed = [arms[1]!, arms[2]!].map((arm) => parseMixArm(arm.trim(), depth));
  if (parsed.some((arm) => arm === null)) return null;
  const [first, second] = parsed as [MixArm, MixArm];

  let weightFirst = first.percent;
  let weightSecond = second.percent;
  if (weightFirst === undefined && weightSecond === undefined) {
    weightFirst = 50;
    weightSecond = 50;
  } else if (weightFirst === undefined) weightFirst = 100 - weightSecond!;
  else if (weightSecond === undefined) weightSecond = 100 - weightFirst;
  const total = weightFirst + weightSecond!;
  if (!(total > 0) || weightFirst < 0 || weightSecond! < 0) return null;
  const alphaScale = total < 100 ? total / 100 : 1;
  const t = weightSecond! / total;

  const from = convert(first.colour, space);
  const to = convert(second.colour, space);
  const alpha = (from.alpha * (1 - t) + to.alpha * t) * alphaScale;
  const polar = space === 'oklch';
  const coords = [0, 1, 2].map((index) => {
    const a = from.coords[index]!;
    const b = to.coords[index]!;
    if (polar && index === 2) return mixHue(a, b, t, method);
    // A missing component takes the other colour's value.
    if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) ? b : a;
    // Rectangular components mix premultiplied by alpha, so a transparent arm does not tint.
    const weightA = polar ? 1 : from.alpha;
    const weightB = polar ? 1 : to.alpha;
    const premixed = a * weightA * (1 - t) + b * weightB * t;
    const opacity = polar ? 1 : from.alpha * (1 - t) + to.alpha * t;
    return opacity > 0 ? premixed / opacity : a * (1 - t) + b * t;
  }) as [number, number, number];
  return {alpha, coords, space};
}

type MixArm = {colour: Colour; percent: number | undefined};

function parseMixArm(text: string, depth: number): MixArm | null {
  // The percentage may come before or after the colour.
  const trailing = /^(.*\S)\s+([+-]?(?:\d+\.?\d*|\.\d+)%)$/su.exec(text);
  const leading = /^([+-]?(?:\d+\.?\d*|\.\d+)%)\s+(\S.*)$/su.exec(text);
  const [colourText, percentText] = trailing
    ? [trailing[1]!, trailing[2]!]
    : leading
      ? [leading[2]!, leading[1]!]
      : [text, undefined];
  const colour = parse(colourText, depth + 1);
  if (!colour) return null;
  return {colour, percent: percentText === undefined ? undefined : Number.parseFloat(percentText)};
}

/** Splits on commas outside parentheses. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let level = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(') level += 1;
    else if (character === ')') {
      level -= 1;
      if (level < 0) return [];
    } else if (character === ',' && level === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  if (level !== 0) return [];
  parts.push(text.slice(start));
  return parts;
}

function mixHue(from: number, to: number, t: number, method: string): number {
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.isNaN(from) ? to : from;
  let a = ((from % 360) + 360) % 360;
  let b = ((to % 360) + 360) % 360;
  const delta = b - a;
  if (method === 'shorter') {
    if (delta > 180) a += 360;
    else if (delta < -180) b += 360;
  } else if (method === 'longer') {
    if (delta > 0 && delta < 180) a += 360;
    else if (delta > -180 && delta <= 0) b += 360;
  } else if (method === 'increasing') {
    if (b < a) b += 360;
  } else if (a < b) a += 360;
  return (((a * (1 - t) + b * t) % 360) + 360) % 360;
}

// Conversions: sRGB <-> linear sRGB <-> OKLab <-> OKLCH.

function srgbToLinear(value: number): number {
  const magnitude = Math.abs(value);
  return magnitude <= 0.04045
    ? value / 12.92
    : Math.sign(value) * ((magnitude + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const magnitude = Math.abs(value);
  return magnitude <= 0.0031308
    ? value * 12.92
    : Math.sign(value) * (1.055 * magnitude ** (1 / 2.4) - 0.055);
}

function linearToOklab([red, green, blue]: readonly number[]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * red! + 0.5363325363 * green! + 0.0514459929 * blue!);
  const m = Math.cbrt(0.2119034982 * red! + 0.6806995451 * green! + 0.1073969566 * blue!);
  const s = Math.cbrt(0.0883024619 * red! + 0.2817188376 * green! + 0.6299787005 * blue!);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([lightness, a, b]: readonly number[]): [number, number, number] {
  const l = (lightness! + 0.3963377774 * a! + 0.2158037573 * b!) ** 3;
  const m = (lightness! - 0.1055613458 * a! - 0.0638541728 * b!) ** 3;
  const s = (lightness! - 0.0894841775 * a! - 1.291485548 * b!) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** The same colour in another space; missing components stay missing where they carry over. */
function convert(colour: Colour, space: Space): Colour {
  if (colour.space === space) return colour;
  const fixed = colour.coords.map((entry) => (Number.isNaN(entry) ? 0 : entry)) as [
    number,
    number,
    number,
  ];
  let linear: [number, number, number];
  switch (colour.space) {
    case 'srgb':
      linear = fixed.map(srgbToLinear) as [number, number, number];
      break;
    case 'srgb-linear':
      linear = fixed;
      break;
    case 'oklab':
      linear = oklabToLinear(fixed);
      break;
    default: {
      const radians = (fixed[2] * Math.PI) / 180;
      linear = oklabToLinear([
        fixed[0],
        fixed[1] * Math.cos(radians),
        fixed[1] * Math.sin(radians),
      ]);
    }
  }
  let coords: [number, number, number];
  switch (space) {
    case 'srgb':
      coords = linear.map(linearToSrgb) as [number, number, number];
      break;
    case 'srgb-linear':
      coords = linear;
      break;
    case 'oklab':
      coords = linearToOklab(linear);
      break;
    default: {
      const [lightness, a, b] = linearToOklab(linear);
      const chroma = Math.hypot(a, b);
      // A grey has no hue; leaving it missing lets the other colour of a mix supply one.
      const angle = chroma < powerlessChroma ? Number.NaN : (Math.atan2(b, a) * 180) / Math.PI;
      coords = [lightness, chroma, angle < 0 ? angle + 360 : angle];
    }
  }
  return {alpha: colour.alpha, coords, space};
}

// Gamut mapping, after CSS Color 4: reduce OKLCH chroma until the colour is close enough to its
// clipped form, so a vivid oklch() keeps its hue and lightness instead of shifting.

const justNoticeableDifference = 0.02;
const gamutEpsilon = 0.0001;

function toSrgba(colour: Colour): TileflowSrgbaColor {
  const alpha = Number.isNaN(colour.alpha) ? 0 : Math.min(1, Math.max(0, colour.alpha));
  if (colour.space === 'srgb') {
    const [red, green, blue] = colour.coords.map((entry) =>
      Math.min(1, Math.max(0, Number.isNaN(entry) ? 0 : entry)),
    ) as [number, number, number];
    return [red * 255, green * 255, blue * 255, alpha];
  }
  const polar = convert(colour, 'oklch');
  const lightness = Number.isNaN(polar.coords[0]) ? 0 : polar.coords[0];
  if (lightness >= 1) return [255, 255, 255, alpha];
  if (lightness <= 0) return [0, 0, 0, alpha];
  const mapped = mapIntoGamut(
    lightness,
    Number.isNaN(polar.coords[1]) ? 0 : polar.coords[1],
    Number.isNaN(polar.coords[2]) ? 0 : polar.coords[2],
  );
  return [...mapped.map((entry) => entry * 255), alpha] as TileflowSrgbaColor;
}

function linearOf(lightness: number, chroma: number, angle: number): [number, number, number] {
  const radians = (angle * Math.PI) / 180;
  return oklabToLinear([lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)]);
}

function inGamut(linear: readonly number[]): boolean {
  return linear.every((entry) => entry >= -gamutEpsilon && entry <= 1 + gamutEpsilon);
}

function clipLinear(linear: readonly number[]): [number, number, number] {
  return linear.map((entry) => Math.min(1, Math.max(0, entry))) as [number, number, number];
}

function distanceOk(a: readonly number[], b: readonly number[]): number {
  const [l1, a1, b1] = linearToOklab(a);
  const [l2, a2, b2] = linearToOklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Encoded sRGB channels from 0 to 1. */
function mapIntoGamut(lightness: number, chroma: number, angle: number): [number, number, number] {
  const origin = linearOf(lightness, chroma, angle);
  if (inGamut(origin)) return clipLinear(origin).map(linearToSrgb) as [number, number, number];
  let clipped = clipLinear(origin);
  if (distanceOk(clipped, origin) < justNoticeableDifference) {
    return clipped.map(linearToSrgb) as [number, number, number];
  }
  let low = 0;
  let high = chroma;
  let lowInGamut = true;
  while (high - low > gamutEpsilon) {
    const middle = (low + high) / 2;
    const candidate = linearOf(lightness, middle, angle);
    if (lowInGamut && inGamut(candidate)) {
      low = middle;
      continue;
    }
    clipped = clipLinear(candidate);
    const difference = distanceOk(clipped, candidate);
    if (difference < justNoticeableDifference) {
      if (justNoticeableDifference - difference < gamutEpsilon) break;
      lowInGamut = false;
      low = middle;
    } else high = middle;
  }
  return clipped.map(linearToSrgb) as [number, number, number];
}
