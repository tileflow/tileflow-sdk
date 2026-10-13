// The motion of a timed shot, without its validation: where the camera is and which blend
// position shows at any time between keyframes. Capture renders shots frame by frame from it, and
// the browser plays them live from it, so both show the same film.

/** A camera between keyframes: always the center form, with bearing and pitch resolved. */
export type TileflowShotCamera = {
  type: 'center';
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
};

export type TileflowShotKeyframe = Readonly<{
  /** Milliseconds from the start: the first keyframe is at 0, later ones rise strictly. */
  at: number;
  camera: Readonly<{
    /** Shots committed on a map name the center camera form; the motion needs no other. */
    type?: 'center';
    center: readonly [number, number];
    zoom: number;
    bearing?: number;
    pitch?: number;
  }>;
  blend?: Readonly<{themes: readonly string[]; position: number}>;
}>;

export type TileflowShotMotion = Readonly<{
  keyframes: readonly TileflowShotKeyframe[];
  /** `smooth` (the default) eases each segment in and out; `linear` does not. */
  easing?: 'linear' | 'smooth';
}>;

/** The camera and blend position of a shot at a time. */
export type TileflowShotState = {
  at: number;
  camera: TileflowShotCamera;
  /** Present when the shot blends themes. */
  blendPosition?: number;
};

/**
 * Where a shot is at `at` milliseconds, clamped to its first and last keyframes. Within each
 * keyframe segment the center moves in Web Mercator coordinates along the shorter way around the
 * world, zoom and pitch change linearly, bearing turns along the shorter arc, and the blend position
 * changes linearly; `easing: 'smooth'` eases each segment in and out. A time on a keyframe shows
 * that keyframe exactly.
 */
export function tileflowShotStateAt(shot: TileflowShotMotion, at: number): TileflowShotState {
  const {keyframes} = shot;
  const first = keyframes[0];
  const last = keyframes.at(-1);
  if (!first || !last || keyframes.length < 2)
    throw new TypeError('A shot needs at least two keyframes.');
  const time = Math.min(last.at, Math.max(first.at, Number.isFinite(at) ? at : first.at));
  let segment = 0;
  while (segment < keyframes.length - 2 && time > keyframes[segment + 1]!.at) segment += 1;
  const from = keyframes[segment]!;
  const to = keyframes[segment + 1]!;
  const linear = Math.min(1, Math.max(0, (time - from.at) / (to.at - from.at)));
  const t = shot.easing === 'linear' ? linear : smoothstep(linear);
  return {
    at: time,
    camera: interpolateCamera(cameraOf(from), cameraOf(to), t),
    ...(from.blend && to.blend
      ? {blendPosition: interpolateNumber(from.blend.position, to.blend.position, t)}
      : {}),
  };
}

function cameraOf({camera}: TileflowShotKeyframe): TileflowShotCamera {
  return {
    type: 'center',
    center: [camera.center[0], camera.center[1]],
    zoom: camera.zoom,
    bearing: camera.bearing ?? 0,
    pitch: camera.pitch ?? 0,
  };
}

const maximumMercatorLatitude = 85.051129;

function interpolateCamera(
  from: TileflowShotCamera,
  to: TileflowShotCamera,
  t: number,
): TileflowShotCamera {
  return {
    type: 'center',
    center: interpolateCenter(from.center, to.center, t),
    zoom: interpolateNumber(from.zoom, to.zoom, t),
    bearing: interpolateBearing(from.bearing, to.bearing, t),
    pitch: interpolateNumber(from.pitch, to.pitch, t),
  };
}

function interpolateNumber(from: number, to: number, t: number): number {
  if (t <= 0 || from === to) return from;
  if (t >= 1) return to;
  return from + (to - from) * t;
}

function interpolateCenter(
  from: [number, number],
  to: [number, number],
  t: number,
): [number, number] {
  if (t <= 0 || (from[0] === to[0] && from[1] === to[1])) return [from[0], from[1]];
  if (t >= 1) return [to[0], to[1]];
  const start = mercatorFromLngLat(from);
  const end = mercatorFromLngLat(to);
  let dx = end[0] - start[0];
  if (dx > 0.5) dx -= 1;
  else if (dx < -0.5) dx += 1;
  return lngLatFromMercator([start[0] + dx * t, start[1] + (end[1] - start[1]) * t]);
}

function interpolateBearing(from: number, to: number, t: number): number {
  if (t <= 0 || from === to) return from;
  if (t >= 1) return to;
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return wrapDegrees(from + delta * t);
}

function mercatorFromLngLat([longitude, latitude]: [number, number]): [number, number] {
  const clamped = Math.max(-maximumMercatorLatitude, Math.min(maximumMercatorLatitude, latitude));
  return [
    (180 + longitude) / 360,
    (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))) / 360,
  ];
}

function lngLatFromMercator([x, y]: [number, number]): [number, number] {
  const latitude = (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90;
  return [wrapDegrees(x * 360 - 180), latitude];
}

function wrapDegrees(value: number): number {
  if (value >= -180 && value <= 180) return value;
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
