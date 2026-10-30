// The level of detail a building model draws at: by the distance from the camera to the centre of
// its bounds, so a model beside a low camera at a steep pitch keeps its nearest level however far the
// map's centre is. A tall or wide model keeps its detail farther than a small one. A model near a
// threshold keeps the level it has until it has clearly crossed it, so it does not flicker. It has
// no DOM dependency.

/**
 * By the kind of model, the distances in metres from the camera at which it draws at its mid and
 * then its far level: tall models (30 m or more), wide, low ones (80 m or more across) and the rest.
 */
export const tileflowModelLevelDistances = Object.freeze({
  tall: Object.freeze([2_000, 5_000] as const),
  wide: Object.freeze([1_500, 3_500] as const),
  small: Object.freeze([1_000, 2_500] as const),
});

/** How far past a threshold, as a ratio, a model must go before its level changes. */
export const tileflowModelLevelHysteresis = 1.1;

/** A model as its level is chosen: its bounds round its origin and how it is turned. */
export type TileflowModelLevelGeometry = Readonly<{
  /** `[minX, minY, minZ, maxX, maxY, maxZ]` in metres round its origin (x east, y north, z up). */
  bounds: readonly [number, number, number, number, number, number];
  /** Degrees clockwise from north its own north is turned to. */
  heading: number;
  /** How many levels it has, nearest first. */
  levels: number;
}>;

/** The view a level is chosen for. */
export type TileflowModelLevelView = Readonly<{
  /** The camera, in metres east, north and up of the model's origin. */
  camera: readonly [number, number, number];
}>;

/** The distances at which a model of these bounds lightens, by its height and width. */
export function tileflowModelLevelDistancesOf(
  bounds: TileflowModelLevelGeometry['bounds'],
): readonly [number, number] {
  const [minX, minY, , maxX, maxY, maxZ] = bounds;
  if (maxZ >= 30) return tileflowModelLevelDistances.tall;
  if (Math.max(maxX - minX, maxY - minY) >= 80) return tileflowModelLevelDistances.wide;
  return tileflowModelLevelDistances.small;
}

/** The distance in metres from the camera to the centre of a model's bounds, turned by its heading. */
export function tileflowModelCameraDistance(
  model: Pick<TileflowModelLevelGeometry, 'bounds' | 'heading'>,
  view: TileflowModelLevelView,
): number {
  const [minX, minY, minZ, maxX, maxY, maxZ] = model.bounds;
  const [x, y, z] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  // Turned as the shaders turn the model.
  const turn = (model.heading * Math.PI) / 180;
  const east = x * Math.cos(turn) + y * Math.sin(turn);
  const north = -x * Math.sin(turn) + y * Math.cos(turn);
  return Math.hypot(view.camera[0] - east, view.camera[1] - north, view.camera[2] - z);
}

/**
 * The level a model draws at, 0 for its nearest, by its distance from the camera against
 * `tileflowModelLevelDistancesOf`. Given the level it drew at before, it keeps it until its distance
 * is `tileflowModelLevelHysteresis` past the threshold between them.
 */
export function tileflowModelLevel(
  model: TileflowModelLevelGeometry,
  view: TileflowModelLevelView,
  previous?: number,
): number {
  const thresholds = tileflowModelLevelDistancesOf(model.bounds);
  const last = Math.max(0, Math.min(model.levels, thresholds.length + 1) - 1);
  const distance = tileflowModelCameraDistance(model, view);
  if (!Number.isFinite(distance)) return 0;
  const margin = previous === undefined ? 1 : tileflowModelLevelHysteresis;
  let level = Math.max(0, Math.min(last, previous ?? 0));
  while (level < last && distance >= thresholds[level]! * margin) level += 1;
  while (level > 0 && distance < thresholds[level - 1]! / margin) level -= 1;
  return level;
}

/** The level a model casts its shadow with when it draws at `level`: the next lighter one it has. */
export function tileflowModelShadowLevel(level: number, levels: number): number {
  return Math.max(0, Math.min(level + 1, levels - 1));
}
