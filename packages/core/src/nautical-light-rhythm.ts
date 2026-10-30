// The rhythm of a navigational light, from its published phases or, without them, from its
// character, group and period by the conventions of IALA and the INT 1 chart symbols. It has no DOM
// or renderer dependency.

/** One phase of a light's cycle. */
export type TileflowLightPhase = Readonly<{
  /** Index of the colour shown, into the light's comma-separated `color` list. */
  colour: number;
  /** Seconds, with millisecond precision. */
  duration: number;
  /**
   * `1` while the light shines, `0` while it is eclipsed, and
   * `tileflowLightRhythmConventions.fixedIntensity` for the steady part of a fixed-and-flashing light.
   */
  intensity: number;
}>;

/** A light's repeating cycle. Lights with the same `key` flash identically. */
export type TileflowLightRhythm = Readonly<{
  /** A canonical description of the phases; equal rhythms have equal keys. */
  key: string;
  /** Seconds, the sum of the phase durations. */
  period: number;
  phases: readonly TileflowLightPhase[];
}>;

/** What the light shows at a moment, and for how many more seconds. */
export type TileflowLightState = Readonly<{
  colour: number;
  intensity: number;
  /** Seconds until the next phase begins; always positive. */
  remaining: number;
}>;

/** The `nautical-v1` light fields that define a rhythm; other properties are ignored. */
export type TileflowLightCharacteristic = Readonly<{
  character?: unknown;
  color?: unknown;
  group?: unknown;
  period_s?: unknown;
  sequence?: unknown;
}>;

/**
 * The conventions used when a light publishes no `sequence`. Durations are in seconds.
 *
 * - `Fl`: flashes of `min(flash, flashShare × period / flashes)`. Flashes of one group are
 *   separated by an eclipse of at most twice the flash, groups of a composite group such as
 *   `2+1` by twice that eclipse, and the remainder of the period is the final eclipse.
 * - `LFl`: the same layout with flashes of `longFlash`, or `flashShare × period / flashes` when
 *   the period is too short for them.
 * - `Q`, `VQ`, `UQ`: one flash per `quickCycle` (60, 120 and 240 per minute), lit for
 *   `quickDuty` of each cycle. Without a group they flash continuously; with a group of `n` they
 *   flash `n` times, then stay eclipsed until the period ends.
 * - `IQ`, `IVQ`, `IUQ`: quick flashes for `interruptedShare` of the period, then an eclipse.
 * - `Iso`: light and eclipse of equal length.
 * - `Oc`: eclipses of `occultingShare × period / eclipses`, laid out like `Fl` with light and
 *   eclipse exchanged, so the light is always longer than the eclipse.
 * - `Mo`: the Morse letters of `group`, with dots of `morseUnit` (shortened to fit the
 *   period), dashes of three units, one unit between signals and three between letters; the
 *   remainder of the period, or seven units without one, is the eclipse.
 * - `FFl`: a fixed light at `fixedIntensity` with full-intensity flashes laid out like `Fl`;
 *   `F+LFl` does the same with long flashes.
 * - `Q+LFl`, `VQ+LFl`, `UQ+LFl`, `Fl+LFl`: the group of the first part (six quick flashes when
 *   absent), then one long flash, then the eclipse.
 * - `Oc+Fl`: drawn as its occulting part.
 * - `Al.<character>`: the rhythm of that character, each lit phase taking the next colour of
 *   `color`; `Al` alone shows each colour for an equal share of the period.
 * - Grouped `Q`/`VQ` and `Q+LFl`/`VQ+LFl` without a period use the cardinal-mark periods of
 *   `cardinalPeriods`.
 *
 * `F`, an absent or unknown character, a missing period where one is needed, or a layout that
 * does not fit its period leaves the light steady.
 */
export const tileflowLightRhythmConventions = Object.freeze({
  cardinalPeriods: Object.freeze({
    Q: Object.freeze({3: 10, 6: 15, 9: 15}),
    'Q+LFl': 15,
    VQ: Object.freeze({3: 5, 6: 10, 9: 10}),
    'VQ+LFl': 10,
  }),
  fixedIntensity: 0.5,
  flash: 1,
  flashShare: 0.3,
  interruptedShare: 0.6,
  longFlash: 2,
  morseUnit: 0.5,
  occultingShare: 0.25,
  quickCycle: Object.freeze({Q: 1, UQ: 0.25, VQ: 0.5}),
  quickDuty: 0.3,
});

/** Bounds that keep a rhythm drawable and its cost small. */
export const tileflowLightRhythmLimits = Object.freeze({
  maxPeriod: 600,
  maxPhases: 256,
  maxSequenceLength: 512,
  minPhase: 0.05,
});

type Phase = {colour: number; duration: number; intensity: number};
type QuickCharacter = keyof typeof tileflowLightRhythmConventions.quickCycle;

const conventions = tileflowLightRhythmConventions;
const limits = tileflowLightRhythmLimits;
const lit = 1;
const eclipsed = 0;

/** International Morse code for letters and digits; `.` is a dot and `-` a dash. */
const morse: Readonly<Record<string, string>> = Object.freeze({
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  0: '-----',
  1: '.----',
  2: '..---',
  3: '...--',
  4: '....-',
  5: '.....',
  6: '-....',
  7: '--...',
  8: '---..',
  9: '----.',
});

/**
 * The rhythm of one light, or `undefined` when it shows steadily: a fixed light, or one without a
 * usable characteristic. `sequence` wins when it is well formed; otherwise the rhythm follows
 * `tileflowLightRhythmConventions`.
 */
export function tileflowLightRhythm(
  light: TileflowLightCharacteristic,
): TileflowLightRhythm | undefined {
  const character = typeof light.character === 'string' ? light.character.trim() : '';
  const alternating = /^Al(?:\.|$)/u.test(character);
  const base = alternating ? character.slice(3) : character;
  const fixedPart = base === 'FFl' || base === 'F+LFl';
  const period = positiveNumber(light.period_s);
  const colours = colourCount(light.color);

  let phases = parseSequence(light.sequence, fixedPart);
  if (!phases) {
    phases =
      alternating && (base === '' || base === 'F')
        ? alternatingFixed(colours, period)
        : derivePhases(base, groupText(light.group), period);
  }
  if (!phases) return undefined;
  if (alternating && colours > 1) phases = alternateColours(phases, colours);
  return finish(phases);
}

/** What `rhythm` shows `seconds` after the shared epoch of every rhythm. */
export function tileflowLightStateAt(
  rhythm: TileflowLightRhythm,
  seconds: number,
): TileflowLightState {
  const periodMs = Math.round(rhythm.period * 1000);
  const timeMs = Number.isFinite(seconds) ? Math.floor(seconds * 1000) : 0;
  const offset = ((timeMs % periodMs) + periodMs) % periodMs;
  let end = 0;
  for (const phase of rhythm.phases) {
    end += Math.round(phase.duration * 1000);
    if (offset < end) {
      return {colour: phase.colour, intensity: phase.intensity, remaining: (end - offset) / 1000};
    }
  }
  const first = rhythm.phases[0]!;
  return {colour: first.colour, intensity: first.intensity, remaining: first.duration};
}

function parseSequence(value: unknown, fixedPart: boolean): Phase[] | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > limits.maxSequenceLength) return undefined;
  const phases: Phase[] = [];
  for (const token of text.split('+')) {
    const match = /^\s*(\()?\s*(\d+(?:\.\d+)?|\.\d+)\s*(\))?\s*$/u.exec(token);
    if (!match || Boolean(match[1]) !== Boolean(match[3])) return undefined;
    const duration = Number(match[2]);
    if (!(duration > 0)) return undefined;
    const intensity = match[1] ? (fixedPart ? conventions.fixedIntensity : eclipsed) : lit;
    phases.push({colour: 0, duration, intensity});
  }
  // A sequence that never eclipses or never shines is not a rhythm.
  if (!phases.some(({intensity}) => intensity === lit)) return undefined;
  if (!phases.some(({intensity}) => intensity !== lit)) return undefined;
  return phases;
}

function derivePhases(
  character: string,
  group: string,
  period: number | undefined,
): Phase[] | undefined {
  switch (character) {
    case 'Fl':
      return grouped(
        groupCounts(group),
        period,
        flashOf(groupCounts(group), period),
        lit,
        eclipsed,
      );
    case 'LFl':
      return grouped(
        groupCounts(group),
        period,
        longFlashOf(groupCounts(group), period),
        lit,
        eclipsed,
      );
    case 'FFl':
      return grouped(
        groupCounts(group),
        period,
        flashOf(groupCounts(group), period),
        lit,
        conventions.fixedIntensity,
      );
    case 'F+LFl':
      return grouped(
        groupCounts(group),
        period,
        longFlashOf(groupCounts(group), period),
        lit,
        conventions.fixedIntensity,
      );
    case 'Oc':
    case 'Oc+Fl': {
      const counts = groupCounts(group);
      if (!counts || !period) return undefined;
      const eclipse = (conventions.occultingShare * period) / sum(counts);
      return grouped(counts, period, eclipse, eclipsed, lit);
    }
    case 'Iso':
      return period
        ? [
            {colour: 0, duration: period / 2, intensity: lit},
            {colour: 0, duration: period / 2, intensity: eclipsed},
          ]
        : undefined;
    case 'Q':
    case 'VQ':
    case 'UQ':
      return quick(character, group, period);
    case 'IQ':
    case 'IVQ':
    case 'IUQ':
      return interruptedQuick(character.slice(1) as QuickCharacter, period);
    case 'Mo':
      return morseCode(group, period);
    case 'Q+LFl':
    case 'VQ+LFl':
    case 'UQ+LFl':
    case 'Fl+LFl':
      return withLongFlash(character, group, period);
    default:
      return undefined;
  }
}

/**
 * Pulses in groups: `pulse` seconds at `pulseIntensity`, separated within a group by gaps of at
 * most twice the pulse, between groups by twice that gap, and followed by the rest of the period.
 */
function grouped(
  counts: readonly number[] | undefined,
  period: number | undefined,
  pulse: number | undefined,
  pulseIntensity: number,
  gapIntensity: number,
): Phase[] | undefined {
  if (!counts || !period || !pulse || !(pulse >= limits.minPhase)) return undefined;
  const pulses = sum(counts);
  const groups = counts.length;
  const free = period - pulses * pulse;
  // Inner gaps weigh one unit, gaps between groups two, and the final gap at least three.
  const units = pulses - groups + 2 * (groups - 1) + 3;
  const gap = Math.min(2 * pulse, free / units);
  if (!(gap >= limits.minPhase)) return undefined;
  const phases: Phase[] = [];
  counts.forEach((count, index) => {
    for (let pulseIndex = 0; pulseIndex < count; pulseIndex += 1) {
      phases.push({colour: 0, duration: pulse, intensity: pulseIntensity});
      if (pulseIndex < count - 1) {
        phases.push({colour: 0, duration: gap, intensity: gapIntensity});
      }
    }
    if (index < groups - 1) phases.push({colour: 0, duration: 2 * gap, intensity: gapIntensity});
  });
  const used = phases.reduce((total, phase) => total + phase.duration, 0);
  phases.push({colour: 0, duration: period - used, intensity: gapIntensity});
  return phases;
}

function quick(
  character: QuickCharacter,
  group: string,
  period: number | undefined,
): Phase[] | undefined {
  const cycle = conventions.quickCycle[character];
  const flash = cycle * conventions.quickDuty;
  if (group === '') {
    return [
      {colour: 0, duration: flash, intensity: lit},
      {colour: 0, duration: cycle - flash, intensity: eclipsed},
    ];
  }
  const counts = groupCounts(group);
  if (!counts) return undefined;
  const count = sum(counts);
  const cardinal = (
    conventions.cardinalPeriods as unknown as Record<string, Record<number, number>>
  )[character]?.[count];
  const cyclePeriod = period ?? cardinal;
  if (!cyclePeriod && count === 1) return quick(character, '', undefined);
  if (!cyclePeriod || cyclePeriod < (count + 1) * cycle) return undefined;
  return [
    ...quickFlashes(count, cycle, flash),
    {colour: 0, duration: cyclePeriod - count * cycle, intensity: eclipsed},
  ];
}

function quickFlashes(count: number, cycle: number, flash: number): Phase[] {
  const phases: Phase[] = [];
  for (let index = 0; index < count; index += 1) {
    phases.push({colour: 0, duration: flash, intensity: lit});
    phases.push({colour: 0, duration: cycle - flash, intensity: eclipsed});
  }
  return phases;
}

function interruptedQuick(
  character: QuickCharacter,
  period: number | undefined,
): Phase[] | undefined {
  const cycle = conventions.quickCycle[character];
  if (!period) return undefined;
  const count = Math.max(2, Math.floor((conventions.interruptedShare * period) / cycle));
  if (period < (count + 1) * cycle) return undefined;
  return [
    ...quickFlashes(count, cycle, cycle * conventions.quickDuty),
    {colour: 0, duration: period - count * cycle, intensity: eclipsed},
  ];
}

function withLongFlash(
  character: string,
  group: string,
  period: number | undefined,
): Phase[] | undefined {
  const first = character.slice(0, character.indexOf('+'));
  const counts = groupCounts(group);
  if (group !== '' && !counts) return undefined;
  const count = counts ? sum(counts) : first === 'Fl' ? 1 : 6;
  const cyclePeriod =
    period ??
    (conventions.cardinalPeriods as Record<string, unknown>)[character as 'Q+LFl'] ??
    undefined;
  if (typeof cyclePeriod !== 'number') return undefined;
  let phases: Phase[];
  if (first === 'Fl') {
    const flash = Math.min(conventions.flash, (conventions.flashShare * cyclePeriod) / (count + 2));
    phases = [];
    for (let index = 0; index < count; index += 1) {
      phases.push({colour: 0, duration: flash, intensity: lit});
      phases.push({colour: 0, duration: 2 * flash, intensity: eclipsed});
    }
  } else {
    const cycle = conventions.quickCycle[first as QuickCharacter];
    phases = quickFlashes(count, cycle, cycle * conventions.quickDuty);
  }
  phases.push({colour: 0, duration: conventions.longFlash, intensity: lit});
  const used = phases.reduce((total, phase) => total + phase.duration, 0);
  const rest = cyclePeriod - used;
  if (!(rest >= conventions.longFlash / 2)) return undefined;
  phases.push({colour: 0, duration: rest, intensity: eclipsed});
  return phases;
}

function morseCode(group: string, period: number | undefined): Phase[] | undefined {
  const letters = [...group.toUpperCase().replaceAll(/\s+/gu, '')];
  if (letters.length === 0 || letters.length > 4) return undefined;
  const codes = letters.map((letter) => morse[letter]);
  if (codes.some((code) => code === undefined)) return undefined;
  // Units: dots one, dashes three, one between signals and three between letters.
  const signalUnits: {units: number; intensity: number}[] = [];
  codes.forEach((code, letterIndex) => {
    [...code!].forEach((signal, signalIndex) => {
      if (signalIndex > 0) signalUnits.push({units: 1, intensity: eclipsed});
      signalUnits.push({units: signal === '.' ? 1 : 3, intensity: lit});
    });
    if (letterIndex < codes.length - 1) signalUnits.push({units: 3, intensity: eclipsed});
  });
  const units = signalUnits.reduce((total, signal) => total + signal.units, 0);
  const unit = period
    ? Math.min(conventions.morseUnit, period / (units + 3))
    : conventions.morseUnit;
  const cyclePeriod = period ?? (units + 7) * unit;
  if (!(unit >= limits.minPhase)) return undefined;
  return [
    ...signalUnits.map(({units: count, intensity}) => ({
      colour: 0,
      duration: count * unit,
      intensity,
    })),
    {colour: 0, duration: cyclePeriod - units * unit, intensity: eclipsed},
  ];
}

function alternatingFixed(colours: number, period: number | undefined): Phase[] | undefined {
  if (colours < 2 || !period) return undefined;
  return Array.from({length: colours}, (_, colour) => ({
    colour,
    duration: period / colours,
    intensity: lit,
  }));
}

/** Each lit phase takes the next colour; the cycle repeats until the colours line up again. */
function alternateColours(phases: readonly Phase[], colours: number): Phase[] {
  const litPhases = phases.filter(({intensity}) => intensity > eclipsed).length;
  if (litPhases === 0) return [...phases];
  const repeats = colours / gcd(litPhases, colours);
  const result: Phase[] = [];
  let next = 0;
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const phase of phases) {
      if (phase.intensity > eclipsed) {
        result.push({...phase, colour: next % colours});
        next += 1;
      } else {
        result.push({...phase});
      }
    }
  }
  return result;
}

function finish(input: readonly Phase[]): TileflowLightRhythm | undefined {
  const phases: Phase[] = [];
  for (const phase of input) {
    const duration = Math.round(phase.duration * 1000) / 1000;
    if (!Number.isFinite(duration) || duration < limits.minPhase) return undefined;
    const previous = phases.at(-1);
    if (previous && previous.intensity === phase.intensity && previous.colour === phase.colour) {
      previous.duration = Math.round((previous.duration + duration) * 1000) / 1000;
    } else {
      phases.push({colour: phase.colour, duration, intensity: phase.intensity});
    }
  }
  // A cycle whose first and last phases match is one phase across the wrap.
  if (phases.length > 1) {
    const first = phases[0]!;
    const last = phases.at(-1)!;
    if (first.intensity === last.intensity && first.colour === last.colour) {
      first.duration = Math.round((first.duration + last.duration) * 1000) / 1000;
      phases.pop();
    }
  }
  if (phases.length < 2 || phases.length > limits.maxPhases) return undefined;
  const periodMs = phases.reduce((total, phase) => total + Math.round(phase.duration * 1000), 0);
  if (periodMs > limits.maxPeriod * 1000) return undefined;
  const frozen = Object.freeze(phases.map((phase) => Object.freeze({...phase})));
  return Object.freeze({
    key: frozen
      .map(
        ({colour, duration, intensity}) => `${Math.round(duration * 1000)}:${intensity}:${colour}`,
      )
      .join(','),
    period: periodMs / 1000,
    phases: frozen,
  });
}

function flashOf(counts: readonly number[] | undefined, period: number | undefined) {
  if (!counts || !period) return undefined;
  return Math.min(conventions.flash, (conventions.flashShare * period) / sum(counts));
}

function longFlashOf(counts: readonly number[] | undefined, period: number | undefined) {
  if (!counts || !period) return undefined;
  const pulses = sum(counts);
  // A long flash still leaves at least as much eclipse as light.
  return period >= 2 * pulses * conventions.longFlash
    ? conventions.longFlash
    : (conventions.flashShare * period) / pulses;
}

/** Flash counts of a group such as `2` or `2+1`; an empty group is one flash. */
function groupCounts(group: string): readonly number[] | undefined {
  if (group === '') return [1];
  const parts = group.split('+');
  const counts: number[] = [];
  for (const part of parts) {
    if (!/^\s*\d{1,2}\s*$/u.test(part)) return undefined;
    const count = Number(part);
    if (count < 1) return undefined;
    counts.push(count);
  }
  return sum(counts) <= 32 ? counts : undefined;
}

function groupText(value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

function colourCount(value: unknown): number {
  if (typeof value !== 'string') return 0;
  return value.split(',').filter((name) => name.trim() !== '').length;
}

function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : undefined;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
