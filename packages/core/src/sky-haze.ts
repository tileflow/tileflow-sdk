import {tileflowColourChannels} from './theme-blend';

/**
 * The distance haze of a street view: far ground and far 3D buildings, trees and models fade into
 * the sky's horizon colour, so the city meets the sky instead of ending in a sharp cut-out. Depths
 * are view depths (along the camera's axis) in MapLibre's camera units, CSS pixels, so a vertex
 * shader compares them with its clip-space `w`.
 */
export type TileflowSkyHaze = Readonly<{
  /** The sky's horizon colour, as 0–1 sRGB channels. */
  colour: readonly [number, number, number];
  /** How much of the haze shows, from 0 to 1: it comes in as the camera tilts towards the horizon. */
  strength: number;
  /** The camera's distance to the map's centre. */
  distance: number;
  /** Where the haze starts and where it is complete, as multiples of `distance`. */
  start: number;
  end: number;
  /**
   * Where the drawn ground ends and the sky begins, above the view's centre, as the tangent of its
   * angle: MapLibre's horizon line.
   */
  horizon: number;
}>;

/** The pitch where the haze starts to show and the pitch where it shows fully, in degrees. */
export const tileflowSkyHazePitch = [45, 60] as const;

/** Where the haze starts, as a multiple of the camera's distance to the map's centre. */
export const tileflowSkyHazeStart = 1;

// MapLibre GL JS 6.13 ends the drawn ground at 85 % of the angle to the true horizon, and never
// more than 89.25° from straight down (getMercatorHorizon).
const horizonShare = 0.85;
const horizonLimit = 89.25;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

const smoothstep = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** MapLibre's horizon line above the view's centre, as the tangent of its angle, at this pitch. */
export function tileflowSkyHorizon(pitch: number): number {
  return Math.min(
    Math.tan(radians(90 - pitch)) * horizonShare,
    Math.tan(radians(horizonLimit - pitch)),
  );
}

/**
 * The view depth of flat ground seen at `rise` (the tangent of the angle above the view's centre),
 * as a multiple of the camera's distance to the centre; Infinity at or above the true horizon.
 */
export function tileflowSkyGroundDepth(pitch: number, rise: number): number {
  const cos = Math.cos(radians(pitch));
  const below = cos - Math.sin(radians(pitch)) * rise;
  return below > 0 ? cos / below : Number.POSITIVE_INFINITY;
}

/**
 * Where the haze is nine-tenths complete when it fits itself to the 3D city's reach, never nearer
 * than this many camera distances: a renderer held to few tiles does not pull the haze in.
 */
export const tileflowSkyHazeReachFloor = 3;

// Where smoothstep reaches 0.9: 3x² - 2x³ = 0.9.
const nineTenths = 0.804_2;

/**
 * A disc the 3D city covers whole, relative to the map's centre and in camera distances: how far
 * its centre lies ahead along the view and across it to the right, and its radius.
 */
export type TileflowSkyHazeReach = Readonly<{
  ahead: number;
  across: number;
  radius: number;
  /** View-aligned far boundary from the map centre, in camera distances. */
  forward?: number;
}>;

/**
 * The nearest view depth, in camera distances, at which the 3D city's edge shows: where rays across
 * the view's width, along the ground from the camera, leave the disc. Undefined when no ray crosses
 * it.
 */
export function tileflowSkyReachDepth(
  view: Readonly<{pitch: number; fov: number; aspect: number}>,
  reach: TileflowSkyHazeReach,
): number | undefined {
  const sin = Math.sin(radians(view.pitch));
  if (reach.forward !== undefined) return 1 + reach.forward * sin;
  const cos = Math.cos(radians(view.pitch));
  // The camera stands a camera distance from the centre: back along the view and up.
  const back = -sin;
  const across = Math.atan(view.aspect * Math.tan(view.fov / 2));
  let nearest: number | undefined;
  for (let step = -4; step <= 4; step += 1) {
    const angle = (across * step) / 4;
    const [x, y] = [Math.sin(angle), Math.cos(angle)];
    const [dx, dy] = [-reach.across, back - reach.ahead];
    const b = x * dx + y * dy;
    const c = dx * dx + dy * dy - reach.radius * reach.radius;
    const disc = b * b - c;
    if (disc < 0) continue;
    const along = -b + Math.sqrt(disc);
    if (along <= 0) continue;
    const depth = along * y * sin + cos * cos;
    nearest = nearest === undefined ? depth : Math.min(nearest, depth);
  }
  return nearest;
}

/** How much haze lies over something at this view depth, from 0 to 1. */
export function tileflowSkyHazeAt(haze: TileflowSkyHaze | undefined, depth: number): number {
  if (!haze || haze.strength <= 0) return 0;
  return haze.strength * smoothstep(haze.start * haze.distance, haze.end * haze.distance, depth);
}

/**
 * The haze of a view, or undefined where none shows: no sky with an opaque horizon colour, a pitch
 * of 45° or less, or a globe.
 */
export function tileflowSkyHaze(view: {
  /** The sky's `horizon-color`, as MapLibre's `getSky()` returns it. */
  horizonColor: unknown;
  /** In degrees. */
  pitch: number;
  /** The vertical field of view, in radians. */
  fov: number;
  /** The view's height, in CSS pixels. */
  height: number;
  /** MapLibre's projection transition: 0 on a flat map, 1 on the globe. */
  globe?: number;
  /** The view's width over its height; needed with `reach`. */
  aspect?: number;
  /** The disc the 3D city covers whole: the haze is nine-tenths complete where it ends. */
  reach?: TileflowSkyHazeReach;
}): TileflowSkyHaze | undefined {
  if (typeof view.horizonColor !== 'string') return undefined;
  const channels = tileflowColourChannels(view.horizonColor);
  if (!channels || channels[3] < 1) return undefined;
  const strength =
    smoothstep(tileflowSkyHazePitch[0], tileflowSkyHazePitch[1], view.pitch) *
    (1 - Math.min(1, Math.max(0, view.globe ?? 0)));
  if (!(strength > 0) || !(view.fov > 0) || !(view.height > 0)) return undefined;
  const horizon = tileflowSkyHorizon(view.pitch);
  // Complete where the ground meets the sky, which starts in the same horizon colour, or sooner
  // where the 3D city ends nearer: there the haze has all but hidden its edge.
  const ground = tileflowSkyGroundDepth(view.pitch, horizon);
  if (!Number.isFinite(ground) || ground <= tileflowSkyHazeStart) return undefined;
  const edge =
    view.reach && view.aspect
      ? tileflowSkyReachDepth({...view, aspect: view.aspect}, view.reach)
      : undefined;
  const fitted =
    edge === undefined
      ? Infinity
      : tileflowSkyHazeStart +
        (Math.max(tileflowSkyHazeReachFloor, edge) - tileflowSkyHazeStart) / nineTenths;
  const end = Math.min(ground, fitted);
  return {
    colour: [channels[0], channels[1], channels[2]],
    strength,
    distance: view.height / 2 / Math.tan(view.fov / 2),
    start: tileflowSkyHazeStart,
    end,
    horizon,
  };
}
