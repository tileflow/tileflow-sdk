import type {TileflowLandModuleOptions} from './index';

export const tileflowLandcoverUnderlaySourceId = 'tileflow-landcover-underlay';

type Underlay = NonNullable<TileflowLandModuleOptions['globalLandcoverUnderlay']>;

const mercatorLatitude = 85.0511287798066;

/**
 * The style source of a land-cover underlay. An image of the whole Web Mercator world is the z0
 * tile of a raster source: renderers then fetch it only while its layer is visible, so a view
 * outside its zoom range never downloads it.
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
