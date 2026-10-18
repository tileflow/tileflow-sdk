/** Shared entrance for the map's buildings, placed models and trees. */
export const tileflowSceneMinzoom = 15;
export const tileflowSceneFadeZooms = 0.25;

export function tileflowSceneOpacity(zoom: number, minzoom = tileflowSceneMinzoom): number {
  return Math.min(1, Math.max(0, (zoom - minzoom) / tileflowSceneFadeZooms));
}
