import type {TileflowMap, TileflowMapScene} from './types';

type ExactTileflowMap<TContract, TMap extends TContract> = TMap &
  Record<Exclude<keyof TMap, keyof TContract>, never>;

type ExactTileflowMapScenes<TMap> = TMap extends {
  scenes: infer TScenes extends Record<string, TileflowMapScene>;
}
  ? {
      scenes: {
        [TName in keyof TScenes]: ExactTileflowMap<TileflowMapScene, TScenes[TName]>;
      };
    }
  : unknown;

/** Preserve the exact inferred type of a standalone or inherited semantic map. */
export function defineMap<const TMap extends TileflowMap>(
  map: ExactTileflowMap<TileflowMap, TMap> & ExactTileflowMapScenes<TMap>,
): TMap {
  return map;
}
