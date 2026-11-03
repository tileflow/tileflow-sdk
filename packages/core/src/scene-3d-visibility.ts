/** Shared entrance for the map's buildings, placed models and trees. */
export const tileflowSceneMinzoom = 15;
export const tileflowSceneFadeZooms = 0.25;

export function tileflowSceneOpacity(zoom: number, minzoom = tileflowSceneMinzoom): number {
  return Math.min(1, Math.max(0, (zoom - minzoom) / tileflowSceneFadeZooms));
}

/** A configured entrance can animate across its zoom band or appear fully at its start. */
export function tileflowSceneEntrance(
  zoom: number,
  [from, to]: readonly [number, number],
  animate: boolean,
): number {
  return animate && to > from
    ? Math.min(1, Math.max(0, (zoom - from) / (to - from)))
    : Number(zoom >= from);
}
