import type {TileflowMap, TileflowMapScene, TileflowStandaloneMap} from './types';

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

type IsNever<T> = [T] extends [never] ? true : false;
type Assert<T extends true> = T;
type StandaloneMapWithUnknownKey = TileflowStandaloneMap & {basemap: unknown};
type StandaloneMapWithLegacyRoot = TileflowStandaloneMap & {root: unknown};
type StandaloneMapWithExplicitSceneMap = TileflowStandaloneMap & {
  scenes: {
    proof: TileflowMapScene & {map: string};
  };
};
type StandaloneMapUnknownKeyArgument = Parameters<typeof defineMap<StandaloneMapWithUnknownKey>>[0];
type StandaloneMapLegacyRootArgument = Parameters<typeof defineMap<StandaloneMapWithLegacyRoot>>[0];
type StandaloneMapExplicitSceneMapArgument = Parameters<
  typeof defineMap<StandaloneMapWithExplicitSceneMap>
>[0];

/** Compile-time contract tests: unknown authoring keys must resolve to `never`. */
type DefineMapExactKeyTests = [
  Assert<IsNever<StandaloneMapUnknownKeyArgument['basemap']>>,
  Assert<IsNever<StandaloneMapLegacyRootArgument['root']>>,
  Assert<IsNever<StandaloneMapExplicitSceneMapArgument['scenes']['proof']['map']>>,
];
