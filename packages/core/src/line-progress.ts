// A line drawn to a share of its length: the colours of a MapLibre `line-gradient` over
// `line-progress`, transparent outside the drawn stretch, with an optional bright head where the
// line is being drawn and a light that can run along it. Pure; the browser controller in
// line-progress-browser.ts animates it over a group of layers.

/** The drawn stretch of a line and its highlights, as shares of the line's length from its start. */
export type TileflowLineProgressState = Readonly<{
  /** Where the drawn stretch starts, from 0 (the default) to 1. */
  start?: number;
  /** Where the drawn stretch ends, from 0 to 1 (the default, the whole line). */
  end?: number;
  /** Where a light sits along the line, or undefined (the default) for none. */
  light?: number;
  /** The whole line's opacity, multiplied with each layer's own, from 0 to 1 (the default). */
  opacity?: number;
}>;

export type TileflowLineProgressGradientOptions = Readonly<{
  /** The line's colour. */
  color: string;
  /** The colour at the head and in the light; defaults to `color`, which shows neither. */
  highlight?: string;
  /**
   * Length of the head's highlight, as a share of the line. The head shows while the drawn stretch
   * ends before the line does. Defaults to 0.04; 0 shows no head.
   */
  headLength?: number;
  /** Length of the light, as a share of the line. Defaults to `headLength`. */
  lightLength?: number;
}>;

/** Room between stops that must not merge, as a share of the line. */
const epsilon = 0.0005;
const transparent = 'rgba(0, 0, 0, 0)';

/**
 * The `line-gradient` of a line drawn from `state.start` to `state.end`. The source of the layer
 * must be GeoJSON with `lineMetrics: true`.
 */
export function tileflowLineProgressGradient(
  state: TileflowLineProgressState,
  options: TileflowLineProgressGradientOptions,
): unknown[] {
  const start = share(state.start, 0);
  const end = Math.max(start, share(state.end, 1));
  const ink = options.color;
  const hot = options.highlight ?? ink;
  const head = share(options.headLength, 0.04);
  const lightLength = share(options.lightLength, head);
  const stops: [number, string][] = [];

  if (end - start < epsilon)
    return ['interpolate', ['linear'], ['line-progress'], 0, transparent, 1, transparent];

  if (start > 0) stops.push([start - epsilon, transparent]);
  stops.push([start, ink]);
  // The light, wherever it is on the drawn stretch: rising to the highlight behind it and falling
  // off sharply in front, as a light moving forward does.
  if (state.light !== undefined && lightLength > 0) {
    const at = share(state.light, 0);
    if (at > start && at <= end) {
      stops.push([Math.max(start, at - lightLength), ink], [at, hot]);
      if (at < end) stops.push([Math.min(end, at + lightLength * 0.35), ink]);
    }
  }
  // The head, where the line is being drawn.
  if (end < 1 && head > 0) stops.push([Math.max(start, end - head), ink], [end, hot]);
  else stops.push([end, ink]);
  if (end < 1) stops.push([end + epsilon, transparent]);
  return ['interpolate', ['linear'], ['line-progress'], ...rising(stops)];
}

/** Stops in strictly rising order within the line, keeping the first of any that collide. */
function rising(stops: readonly (readonly [number, string])[]): (number | string)[] {
  const out: (number | string)[] = [];
  let last = -1;
  for (const [at, colour] of stops) {
    if (at < 0 || at > 1 || at <= last) continue;
    out.push(at, colour);
    last = at;
  }
  return out;
}

function share(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}
