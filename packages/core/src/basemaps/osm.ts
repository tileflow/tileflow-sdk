import type {TileflowOsmBasemapConfig, TileflowOsmBasemapOptions} from '../compiler';

export function osm(options: TileflowOsmBasemapOptions = {}): TileflowOsmBasemapConfig {
  return {
    type: 'osm',
    ...options,
  };
}
