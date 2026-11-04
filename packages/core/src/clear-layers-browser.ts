/**
 * Layers that a map's appearances share but only some draw, by the paint property that clears
 * them. While that property is zero at every zoom the layer is hidden, so the renderer never fetches
 * its source; it shows again as soon as the property rises above zero, for example when a theme
 * transition into daylight starts fading the Streets climate image in.
 */
const clearLayers: readonly (readonly [layer: string, property: string])[] = [
  ['tileflow-global-landcover-underlay', 'raster-opacity'],
];

/** Structural MapLibre capabilities; importing this module never loads a renderer. */
export type TileflowClearLayersMap = {
  getLayer?: unknown;
  getLayoutProperty?: unknown;
  getPaintProperty?: unknown;
  setLayoutProperty?: unknown;
};

/** Whether a paint value is zero at every zoom: a number, or a zoom curve whose stops are zero. */
export function isTileflowClearValue(value: unknown): boolean {
  if (typeof value === 'number') return value === 0;
  if (!Array.isArray(value)) return false;
  const outputs =
    value[0] === 'interpolate'
      ? value.slice(4).filter((_, index) => index % 2 === 0)
      : value[0] === 'step'
        ? value.slice(2).filter((_, index) => index % 2 === 0)
        : undefined;
  return outputs !== undefined && outputs.every((output) => output === 0);
}

/** Hide each shared layer whose opacity is clear and show the others. */
export function syncTileflowClearLayers(map: TileflowClearLayersMap): void {
  if (
    typeof map.getLayer !== 'function' ||
    typeof map.getPaintProperty !== 'function' ||
    typeof map.getLayoutProperty !== 'function' ||
    typeof map.setLayoutProperty !== 'function'
  )
    return;
  for (const [layer, property] of clearLayers) {
    try {
      if (!map.getLayer.call(map, layer)) continue;
      const visibility = isTileflowClearValue(map.getPaintProperty.call(map, layer, property))
        ? 'none'
        : 'visible';
      if ((map.getLayoutProperty.call(map, layer, 'visibility') ?? 'visible') !== visibility)
        map.setLayoutProperty.call(map, layer, 'visibility', visibility);
    } catch {
      // A style in the middle of loading is synchronized again by its next style event.
    }
  }
}
