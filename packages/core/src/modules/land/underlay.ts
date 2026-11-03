import {toMapLibreStyleValue} from '../../cartography/values';
import type {TileflowLandModuleOptions} from './index';

export const tileflowLandcoverUnderlaySourceId = 'tileflow-landcover-underlay';

type Underlay = NonNullable<TileflowLandModuleOptions['globalLandcoverUnderlay']>;

const mercatorLatitude = 85.0511287798066;

/** Whether an underlay's opacity is zero at every zoom, so it draws nothing anywhere. */
export function isTileflowUnderlayInvisible(underlay: Underlay): boolean {
  const value = toMapLibreStyleValue((underlay.opacity ?? 1) as never) as unknown;
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

/**
 * The style source of a land-cover underlay. An image of the whole Web Mercator world is the z0
 * tile of a raster source: renderers then fetch it only while its layer is visible, so a theme or
 * view that never shows it never downloads it.
 */
export function tileflowLandcoverUnderlaySource(underlay: Underlay): Record<string, unknown> {
  const world = [
    [-180, mercatorLatitude],
    [180, mercatorLatitude],
    [180, -mercatorLatitude],
    [-180, -mercatorLatitude],
  ];
  const isWorld = underlay.coordinates.every((corner, index) =>
    corner.every((value, axis) => Math.abs(value - world[index]![axis]!) < 1e-9),
  );
  return isWorld
    ? {
        type: 'raster',
        tiles: [underlay.url],
        tileSize: 512,
        minzoom: 0,
        maxzoom: 0,
        attribution: underlay.attribution,
      }
    : {type: 'image', url: underlay.url, coordinates: underlay.coordinates};
}
