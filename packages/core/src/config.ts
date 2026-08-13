import type {TileflowProjectConfig} from './compiler';

export function defineTileflow<const TConfig extends TileflowProjectConfig>(
  config: TConfig,
): TConfig {
  return config;
}
