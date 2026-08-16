import type {TileflowProjectConfig} from './project';

export function defineTileflow<const TConfig extends TileflowProjectConfig>(
  config: TConfig,
): TConfig {
  return config;
}
