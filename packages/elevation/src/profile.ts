import {elevationLimits, type ElevationUnit, metersPerFoot} from './constants';
import type {
  ElevationProfileResponse,
  ElevationProfileSample,
  ElevationProfileSummary,
} from './contract';

/**
 * Elevation profiles without a network: measured from lines that already carry heights (a GPX
 * track, a GeoJSON line with altitudes) or read from an Elevation API answer, then queried for a
 * point, a range or their per-sample grade and cumulative climb. Summaries follow the API's rules
 * exactly, so a local profile and an API profile of the same samples agree.
 */

export type ElevationProfile = Readonly<{
  unit: ElevationUnit;
  /** `[longitude, latitude, elevation, distance]`, the distance from the start of the first line. */
  samples: readonly ElevationProfileSample[];
  /** The first and last sample index of each line. */
  lines: readonly (readonly [number, number])[];
  summary: ElevationProfileSummary;
  /** The spacing of the samples, or null when they are a line's own positions. */
  interval: number | null;
  /** The climb threshold of the summary, in `unit`. */
  climbThreshold: number;
  /** The credit to show with the data, when it comes from Tileflow. */
  attribution: string | null;
}>;

export type ElevationProfilePoint = Readonly<{
  position: readonly [number, number];
  elevation: number | null;
  distance: number;
  /** The grade in percent over the 100 m (or the interval, if longer) centred here. */
  grade: number | null;
  /** The ascent from the start of the profile, counted with its climb threshold. */
  ascent: number;
  /** The index of the sample at or before this point. */
  index: number;
  /** The line this point is on. */
  line: number;
}>;

export type ElevationProfileSeries = Readonly<{
  grades: readonly (number | null)[];
  ascent: readonly number[];
  descent: readonly number[];
}>;

/** Lines whose positions may carry an altitude in metres as a third coordinate. */
export type ElevatedLine =
  | Readonly<{type: 'LineString'; coordinates: readonly (readonly number[])[]}>
  | Readonly<{type: 'MultiLineString'; coordinates: readonly (readonly (readonly number[])[])[]}>;

const earthRadiusMeters = 6_371_008.8;
const radians = Math.PI / 180;
const series = new WeakMap<ElevationProfile, ElevationProfileSeries>();

export function haversineMeters(a: readonly number[], b: readonly number[]) {
  const dLat = (b[1]! - a[1]!) * radians;
  const dLng = (b[0]! - a[0]!) * radians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1]! * radians) * Math.cos(b[1]! * radians) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(h)));
}

const toUnit = (meters: number, unit: ElevationUnit) =>
  unit === 'feet' ? meters / metersPerFoot : meters;
const round = (value: number) => Math.round(value * 10) / 10 + 0;

/**
 * A profile whose samples are the positions of `line`, with distances measured along it. A
 * position without a third coordinate has a null elevation. Altitudes are metres, as in GeoJSON
 * and GPX; the profile is in `unit`.
 */
export function elevationProfileFromLine(
  line: ElevatedLine,
  options: Readonly<{unit?: ElevationUnit; climbThreshold?: number}> = {},
): ElevationProfile {
  const unit = options.unit ?? 'meters';
  const parts =
    line?.type === 'LineString'
      ? [line.coordinates]
      : line?.type === 'MultiLineString'
        ? line.coordinates
        : null;
  if (!parts || parts.length === 0 || parts.some((part) => !Array.isArray(part) || part.length < 1))
    throw new Error('Invalid elevation line');
  const samples: ElevationProfileSample[] = [];
  const lines: [number, number][] = [];
  let distance = 0;
  for (const part of parts) {
    const first = samples.length;
    part.forEach((position, index) => {
      if (
        !Array.isArray(position) ||
        !Number.isFinite(position[0]) ||
        !Number.isFinite(position[1]) ||
        Math.abs(position[0]!) > 180 ||
        Math.abs(position[1]!) > 90
      )
        throw new Error('Invalid elevation line position');
      if (index > 0) distance += haversineMeters(part[index - 1]!, position);
      const altitude = position[2];
      samples.push([
        position[0]!,
        position[1]!,
        typeof altitude === 'number' && Number.isFinite(altitude) ? toUnit(altitude, unit) : null,
        toUnit(distance, unit),
      ]);
    });
    lines.push([first, samples.length - 1]);
  }
  const climbThreshold =
    options.climbThreshold ?? toUnit(elevationLimits.defaultClimbThresholdMeters, unit);
  return Object.freeze({
    unit,
    samples,
    lines,
    summary: summarizeElevationProfile({samples, lines, unit, climbThreshold, interval: null}),
    interval: null,
    climbThreshold,
    attribution: null,
  });
}

/** The profile of an Elevation API answer. */
export function elevationProfileFromResponse(
  response: ElevationProfileResponse,
  options: Readonly<{climbThreshold?: number}> = {},
): ElevationProfile {
  return Object.freeze({
    unit: response.unit,
    samples: response.samples,
    lines: response.lines,
    summary: response.summary,
    interval: response.interval,
    climbThreshold:
      options.climbThreshold ?? toUnit(elevationLimits.defaultClimbThresholdMeters, response.unit),
    attribution: response.attribution,
  });
}

/** The same profile in another unit. */
export function convertElevationProfile(
  profile: ElevationProfile,
  unit: ElevationUnit,
): ElevationProfile {
  if (profile.unit === unit) return profile;
  const factor = unit === 'feet' ? 1 / metersPerFoot : metersPerFoot;
  const length = (value: number | null) => (value === null ? null : value * factor);
  const summary = profile.summary;
  return Object.freeze({
    ...profile,
    unit,
    samples: profile.samples.map(
      ([lng, lat, height, distance]) =>
        [lng, lat, length(height), distance * factor] as ElevationProfileSample,
    ),
    summary: {
      ...summary,
      distance: summary.distance * factor,
      ascent: length(summary.ascent),
      descent: length(summary.descent),
      minElevation: length(summary.minElevation),
      maxElevation: length(summary.maxElevation),
      startElevation: length(summary.startElevation),
      endElevation: length(summary.endElevation),
    },
    interval: length(profile.interval),
    climbThreshold: profile.climbThreshold * factor,
  });
}

/**
 * The Elevation API's summary of samples, every length in `unit`: climbs and drops that reach
 * `climbThreshold` from the last counted elevation, and the steepest grades over a run of at least
 * the larger of 100 m and `interval`, never across two lines.
 */
export function summarizeElevationProfile(input: {
  samples: readonly ElevationProfileSample[];
  lines: readonly (readonly [number, number])[];
  unit: ElevationUnit;
  climbThreshold: number;
  interval: number | null;
}): ElevationProfileSummary {
  const {samples, unit} = input;
  const run = Math.max(toUnit(elevationLimits.minimumGradeRunMeters, unit), input.interval ?? 0);
  let ascent = 0;
  let descent = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let maxGrade = Number.NEGATIVE_INFINITY;
  let minGrade = Number.POSITIVE_INFINITY;
  let any = false;
  for (const [first, last] of input.lines) {
    const valid: number[] = [];
    for (let index = first; index <= last; index += 1)
      if (samples[index]![2] !== null) valid.push(index);
    if (valid.length === 0) continue;
    any = true;
    let reference = samples[valid[0]!]![2]!;
    for (const index of valid) {
      const value = samples[index]![2]!;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
      if (value - reference >= input.climbThreshold && value > reference) {
        ascent += value - reference;
        reference = value;
      } else if (reference - value >= input.climbThreshold && value < reference) {
        descent += reference - value;
        reference = value;
      }
    }
    const grade = (from: number, to: number) => {
      const distance = samples[to]![3] - samples[from]![3];
      if (distance <= 0) return;
      const value = ((samples[to]![2]! - samples[from]![2]!) / distance) * 100;
      maxGrade = Math.max(maxGrade, value);
      minGrade = Math.min(minGrade, value);
    };
    let ahead = 0;
    let measured = false;
    for (let position = 0; position < valid.length; position += 1) {
      ahead = Math.max(ahead, position + 1);
      while (
        ahead < valid.length &&
        samples[valid[ahead]!]![3] - samples[valid[position]!]![3] < run
      )
        ahead += 1;
      if (ahead >= valid.length) break;
      grade(valid[position]!, valid[ahead]!);
      measured = true;
    }
    if (!measured && valid.length > 1) grade(valid[0]!, valid[valid.length - 1]!);
  }
  const height = (index: number) => {
    const value = samples[index]?.[2];
    return value === null || value === undefined ? null : round(value);
  };
  const percent = (value: number) => (Number.isFinite(value) ? round(value) : null);
  const last = samples.at(-1);
  return {
    distance: round(last ? last[3] : 0),
    ascent: any ? round(ascent) : null,
    descent: any ? round(descent) : null,
    minElevation: any ? round(minimum) : null,
    maxElevation: any ? round(maximum) : null,
    startElevation: height(0),
    endElevation: height(samples.length - 1),
    maxGrade: percent(maxGrade),
    minGrade: percent(minGrade),
  };
}

/** The line a sample index belongs to. */
function lineOf(profile: ElevationProfile, index: number) {
  for (let line = 0; line < profile.lines.length; line += 1)
    if (index <= profile.lines[line]![1]) return line;
  return profile.lines.length - 1;
}

/** The interpolated elevation at a distance within one line, or null without data on both sides. */
function heightAt(profile: ElevationProfile, line: number, distance: number) {
  const [first, last] = profile.lines[line]!;
  const {samples} = profile;
  const clamped = Math.min(samples[last]![3], Math.max(samples[first]![3], distance));
  let low = first;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (samples[middle]![3] <= clamped) low = middle;
    else high = middle;
  }
  const a = samples[low]!;
  const b = samples[high]!;
  if (a[2] === null || b[2] === null) return a[2] ?? b[2];
  const span = b[3] - a[3];
  return span > 0 ? a[2] + ((b[2] - a[2]) * (clamped - a[3])) / span : a[2];
}

/**
 * The grade in percent at every sample, over the 100 m (or the interval, if longer) centred on it
 * within its line, and the ascent and descent from the start of the profile up to every sample.
 */
export function elevationProfileSeries(profile: ElevationProfile): ElevationProfileSeries {
  const cached = series.get(profile);
  if (cached) return cached;
  const {samples} = profile;
  const ascent: number[] = [];
  const descent: number[] = [];
  let climbed = 0;
  let dropped = 0;
  for (const [first, last] of profile.lines) {
    let reference: number | null = null;
    for (let index = first; index <= last; index += 1) {
      const height = samples[index]![2];
      if (height !== null) {
        if (reference === null) reference = height;
        else if (height - reference >= profile.climbThreshold && height > reference) {
          climbed += height - reference;
          reference = height;
        } else if (reference - height >= profile.climbThreshold && height < reference) {
          dropped += reference - height;
          reference = height;
        }
      }
      ascent.push(climbed);
      descent.push(dropped);
    }
  }
  const result = Object.freeze({grades: elevationProfileGrades(profile), ascent, descent});
  series.set(profile, result);
  return result;
}

/**
 * The grade in percent at every sample over a run of `run` (in the profile's unit) centred on it
 * within its line; a line shorter than the run is measured end to end. The default run is the
 * larger of 100 m and the interval. Longer runs smooth the noise of surface models, for example to
 * colour a chart by sustained grade.
 */
export function elevationProfileGrades(
  profile: ElevationProfile,
  run = Math.max(
    toUnit(elevationLimits.minimumGradeRunMeters, profile.unit),
    profile.interval ?? 0,
  ),
): (number | null)[] {
  const {samples} = profile;
  const grades: (number | null)[] = [];
  profile.lines.forEach(([first, last], line) => {
    const start = samples[first]![3];
    const end = samples[last]![3];
    for (let index = first; index <= last; index += 1) {
      const distance = samples[index]![3];
      const from = Math.max(start, Math.min(distance - run / 2, end - run));
      const to = Math.min(end, from + run);
      const low = heightAt(profile, line, from);
      const high = heightAt(profile, line, to);
      grades.push(
        low === null || high === null || to <= from ? null : ((high - low) / (to - from)) * 100,
      );
    }
  });
  return grades;
}

/** The profile at `distance`, interpolated between its samples. */
export function elevationProfileAt(
  profile: ElevationProfile,
  distance: number,
): ElevationProfilePoint | null {
  const {samples} = profile;
  if (samples.length === 0 || !Number.isFinite(distance)) return null;
  const clamped = Math.min(samples.at(-1)![3], Math.max(0, distance));
  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (samples[middle]![3] <= clamped) low = middle;
    else high = middle;
  }
  // Two lines meet at one distance: the earlier line ends where the next starts.
  const line = lineOf(profile, low);
  const index = low;
  const a = samples[low]!;
  const b = samples[Math.min(high, profile.lines[line]![1])]!;
  const span = b[3] - a[3];
  const t = span > 0 ? Math.min(1, Math.max(0, (clamped - a[3]) / span)) : 0;
  const {grades, ascent} = elevationProfileSeries(profile);
  const gradeA = grades[low] ?? null;
  const gradeB = grades[Math.min(high, profile.lines[line]![1])] ?? null;
  return Object.freeze({
    position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as const,
    elevation: heightAt(profile, line, clamped),
    distance: clamped,
    grade: gradeA === null || gradeB === null ? (gradeA ?? gradeB) : gradeA + (gradeB - gradeA) * t,
    ascent: ascent[low]!,
    index,
    line,
  });
}

/** The nearest sample to a position, by straight-line distance in degrees scaled by latitude. */
export function nearestElevationSample(
  profile: ElevationProfile,
  position: readonly [number, number],
) {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  const scale = Math.cos(position[1] * radians);
  profile.samples.forEach(([lng, lat], index) => {
    const dx = (lng - position[0]) * scale;
    const dy = lat - position[1];
    const value = dx * dx + dy * dy;
    if (value < bestDistance) {
      bestDistance = value;
      best = index;
    }
  });
  return best;
}

/**
 * The part of a profile between two distances, with interpolated ends and its own summary, for
 * example the climb a reader selects on a chart. Distances restart at 0.
 */
export function sliceElevationProfile(
  profile: ElevationProfile,
  from: number,
  to: number,
): ElevationProfile | null {
  const start = elevationProfileAt(profile, Math.min(from, to));
  const end = elevationProfileAt(profile, Math.max(from, to));
  if (!start || !end || end.distance <= start.distance) return null;
  const samples: ElevationProfileSample[] = [];
  const lines: [number, number][] = [];
  const offset = start.distance;
  const push = (sample: ElevationProfileSample) => samples.push(sample);
  for (let line = start.line; line <= end.line; line += 1) {
    const [first, last] = profile.lines[line]!;
    const lineStart = samples.length;
    const begin = line === start.line ? start : null;
    const finish = line === end.line ? end : null;
    if (begin) push([begin.position[0], begin.position[1], begin.elevation, 0]);
    for (let index = first; index <= last; index += 1) {
      const sample = profile.samples[index]!;
      if (sample[3] <= (begin?.distance ?? -1) || sample[3] >= (finish?.distance ?? Infinity))
        continue;
      push([sample[0], sample[1], sample[2], sample[3] - offset]);
    }
    if (finish)
      push([finish.position[0], finish.position[1], finish.elevation, finish.distance - offset]);
    if (samples.length > lineStart) lines.push([lineStart, samples.length - 1]);
  }
  return Object.freeze({
    ...profile,
    samples,
    lines,
    summary: summarizeElevationProfile({
      samples,
      lines,
      unit: profile.unit,
      climbThreshold: profile.climbThreshold,
      interval: profile.interval,
    }),
  });
}
